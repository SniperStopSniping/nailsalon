import { expect, type Locator, type Page, test } from '@playwright/test';

type RecipeId = 'quick_book' | 'signature_one_page' | 'the_collective';

type CustomerAudit = {
  blankSections: string[];
  businessIdentityOwners: string[];
  contentOwners: Array<{ key: string; owner: string }>;
  documentOverflow: number;
  frameOverflow: number;
  nonCanonicalBookActions: string[];
  permanentSkeletons: number;
  sectionKinds: string[];
  serviceCatalogueOwners: string[];
};

const MULTI_PAGE_EXPECTATIONS = [
  { label: 'Home', sections: ['hero', 'reviews'] },
  { label: 'Services & Booking', sections: ['booking', 'before_you_book'] },
  { label: 'Gallery', sections: ['gallery'] },
  { label: 'About', sections: ['about_team'] },
  { label: 'Contact', sections: ['visit_contact'] },
] as const;

const openRecipe = async (page: Page, recipe: RecipeId): Promise<void> => {
  await page.goto(`/?audit=1&surface=sections&recipe=${recipe}&device=phone`);

  await expect(page.locator('[data-showcase-ready="true"]')).toBeVisible();
  await expect(page.locator('.onboarding-preview-frame')).toBeVisible();
  await expect(page.locator('.onboarding-customer-page')).toHaveCount(1);
  await expect(page.locator('.vite-error-overlay')).toHaveCount(0);
};

const auditCurrentCustomerPage = async (page: Page): Promise<CustomerAudit> =>
  page.evaluate(() => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && bounds.width > 0
        && bounds.height > 0;
    };
    const sectionKind = (section: HTMLElement): string => {
      if (section.classList.contains('onboarding-customer-hero')) {
        return 'hero';
      }
      if (section.classList.contains('onboarding-customer-gallery')) {
        return 'gallery';
      }
      if (section.classList.contains('onboarding-customer-booking')) {
        return 'booking';
      }
      if (section.classList.contains('onboarding-customer-about')) {
        return 'about_team';
      }
      if (section.classList.contains('onboarding-customer-contact')) {
        return 'visit_contact';
      }
      const libraryType = section.dataset.libraryType;
      if (libraryType === 'team' || libraryType === 'about') {
        return 'about_team';
      }
      if (libraryType === 'policies' || libraryType === 'deposits_cancellations') {
        return 'before_you_book';
      }
      if (libraryType === 'visit_us' || libraryType === 'contact') {
        return 'visit_contact';
      }
      return libraryType ?? section.className;
    };
    const pageElement = document.querySelector<HTMLElement>('.onboarding-customer-page');
    const frame = document.querySelector<HTMLElement>('.onboarding-preview-frame');
    if (!pageElement || !frame) {
      throw new Error('Customer Preview did not render.');
    }
    const sections = [...pageElement.querySelectorAll<HTMLElement>(':scope > [data-section-id]')]
      .filter(visible);
    const nonCanonicalRoots = sections.filter((section) => {
      const kind = sectionKind(section);
      return kind === 'about_team' || kind === 'visit_contact';
    });
    const nonCanonicalBookActions = nonCanonicalRoots.flatMap(root => (
      [...root.querySelectorAll<HTMLElement>('a, button')]
        .filter(visible)
        .filter(action => /book/u.test(`${action.textContent ?? ''} ${action.getAttribute('aria-label') ?? ''}`.toLowerCase()))
        .map(action => (action.textContent ?? action.getAttribute('aria-label') ?? '').trim())
    ));
    const contentOwners = [...pageElement.querySelectorAll<HTMLElement>(
      '[data-content-key][data-content-owner]',
    )]
      .filter(visible)
      .map(marker => ({
        key: marker.dataset.contentKey ?? '',
        owner: marker.dataset.contentOwner ?? '',
      }));
    const serviceCatalogueOwners = contentOwners
      .filter(marker => marker.key === 'service_catalogue')
      .map(marker => marker.owner);
    const blankSections = sections
      .filter(section => !(section.textContent ?? '').trim())
      .map(section => section.dataset.sectionId ?? 'unknown');
    const site = pageElement.closest<HTMLElement>('.onboarding-site-preview') ?? pageElement;
    const businessIdentityOwners = [...site.querySelectorAll<HTMLElement>(
      '[data-business-identity]',
    )]
      .filter(visible)
      .map(owner => owner.dataset.businessIdentity ?? 'unknown');

    return {
      blankSections,
      businessIdentityOwners,
      contentOwners,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frameOverflow: frame.scrollWidth - frame.clientWidth,
      nonCanonicalBookActions,
      permanentSkeletons: pageElement.querySelectorAll(
        '.skeleton, [data-placeholder="true"], [aria-label*="placeholder" i]',
      ).length,
      sectionKinds: sections.map(sectionKind),
      serviceCatalogueOwners,
    };
  });

const expectCleanCustomerPage = (audit: CustomerAudit): void => {
  expect(audit.blankSections).toEqual([]);
  expect(audit.businessIdentityOwners).toHaveLength(1);
  expect(audit.documentOverflow).toBeLessThanOrEqual(1);
  expect(audit.frameOverflow).toBeLessThanOrEqual(1);
  expect(audit.nonCanonicalBookActions).toEqual([]);
  expect(audit.permanentSkeletons).toBe(0);

  const ownersByKey = new Map<string, Set<string>>();
  for (const marker of audit.contentOwners) {
    const owners = ownersByKey.get(marker.key) ?? new Set<string>();
    owners.add(marker.owner);
    ownersByKey.set(marker.key, owners);
  }
  for (const [key, owners] of ownersByKey) {
    expect([...owners], `${key} must have one visible content owner`).toHaveLength(1);
  }
};

const expectSingleCataloguePresentation = async (page: Page): Promise<void> => {
  await expect(page.getByRole('region', { name: 'Featured services in booking' })).toHaveCount(0);
  await expect(page.getByText('Featured services', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'All services', exact: true })).toHaveCount(1);
};

const expectHeroShortcutContract = async (page: Page): Promise<void> => {
  const frame = page.locator('.onboarding-preview-frame');
  const heroAction = page.locator('[data-hero-book-action="true"]');
  const shortcut = page.locator('.customer-book-shortcut');
  await frame.evaluate((element) => {
    element.scrollTop = 0;
  });

  await expect(heroAction).toBeVisible();
  await expect(shortcut).toHaveClass(/is-hidden/u);
  await expect(shortcut).toHaveAttribute('aria-hidden', 'true');
  await expect(shortcut).toHaveAttribute('tabindex', '-1');

  await frame.evaluate((element) => {
    const hero = element.querySelector<HTMLElement>('[data-hero-book-action="true"]');
    if (!hero) {
      throw new Error('Hero action is missing.');
    }
    element.scrollTop = Math.max(element.clientHeight, hero.offsetTop + hero.offsetHeight + 120);
  });

  await expect(shortcut).not.toHaveClass(/is-hidden/u);
  await expect(shortcut).not.toHaveAttribute('aria-hidden', 'true');

  await frame.evaluate((element) => {
    element.scrollTop = 0;
  });

  await expect(shortcut).toHaveClass(/is-hidden/u);
};

const multiPageNavigation = (page: Page): Locator => page.locator(
  'nav[aria-label="Customer preview navigation"] a[href^="#preview-page-"]',
);

test.describe('three locked V1 customer recipes', () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test('Quick Book is the exact direct five-section journey with one Booking engine', async ({ page }) => {
    await openRecipe(page, 'quick_book');
    const audit = await auditCurrentCustomerPage(page);

    expect(audit.sectionKinds).toEqual([
      'hero',
      'gallery',
      'booking',
      'about_team',
      'visit_contact',
    ]);
    expect(audit.serviceCatalogueOwners).toHaveLength(1);

    expectCleanCustomerPage(audit);
    await expectSingleCataloguePresentation(page);
    await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);

    await page.getByRole('button', {
      name: /View details for Russian Manicure/u,
    }).first().click();
    const detail = page.getByTestId('service-detail-dialog');
    const detailBody = detail.getByTestId('service-detail-scroll-body');
    const detailFooter = detail.getByTestId('service-detail-action-footer');
    const footerBeforeScroll = await detailFooter.boundingBox();
    const panelBeforeScroll = await detail.locator('.booking-dialog-panel').boundingBox();
    const bodyBeforeScroll = await detailBody.boundingBox();
    expect(footerBeforeScroll).not.toBeNull();
    expect(panelBeforeScroll).not.toBeNull();
    expect(bodyBeforeScroll).not.toBeNull();
    if (!footerBeforeScroll || !panelBeforeScroll || !bodyBeforeScroll) return;
    expect(Math.abs(bodyBeforeScroll.y + bodyBeforeScroll.height - footerBeforeScroll.y))
      .toBeLessThanOrEqual(1);
    expect(Math.abs(
      footerBeforeScroll.y + footerBeforeScroll.height
      - (panelBeforeScroll.y + panelBeforeScroll.height),
    )).toBeLessThanOrEqual(1);
    expect(await detailBody.evaluate((body, footerSelector) => (
      !body.contains(document.querySelector(footerSelector))
    ), '[data-testid="service-detail-action-footer"]')).toBe(true);

    await detailBody.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    const footerAfterScroll = await detailFooter.boundingBox();
    expect(footerAfterScroll).not.toBeNull();
    if (!footerAfterScroll) return;
    expect(Math.abs(footerAfterScroll.y - footerBeforeScroll.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(footerAfterScroll.height - footerBeforeScroll.height)).toBeLessThanOrEqual(1);

    await detail.getByRole('button', { name: 'Keep browsing' }).click();

    const summary = page.getByTestId('selected-service-summary');
    const summaryHost = page.getByTestId('onboarding-booking-selection-host');
    await expect(summary).toBeVisible();
    await expect(summaryHost).toContainText('Russian Manicure');
    await expect(summaryHost.getByTestId('selected-service-summary')).toHaveCount(1);

    const frame = page.locator('.onboarding-preview-frame');
    await frame.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => summary.evaluate((element) => {
      const summaryBounds = element.getBoundingClientRect();
      const frameBounds = document.querySelector('.onboarding-preview-frame')?.getBoundingClientRect();
      return frameBounds ? summaryBounds.bottom < frameBounds.top : false;
    })).toBe(true);

    await expect(page.locator('nav[aria-label="Customer preview navigation"] a')).toHaveCount(1);

    await expectHeroShortcutContract(page);
  });

  test('One-page website owns each responsibility once and generates working anchor navigation', async ({ page }) => {
    await openRecipe(page, 'signature_one_page');
    const audit = await auditCurrentCustomerPage(page);

    expect(audit.sectionKinds).toEqual([
      'hero',
      'gallery',
      'about_team',
      'booking',
      'reviews',
      'before_you_book',
      'visit_contact',
    ]);
    expect(audit.serviceCatalogueOwners).toHaveLength(1);

    expectCleanCustomerPage(audit);
    await expectSingleCataloguePresentation(page);
    await expectHeroShortcutContract(page);

    const anchors = page.locator(
      'nav[aria-label="Customer preview navigation"] a:not(.customer-book-shortcut)',
    );

    await expect(anchors).toHaveText([
      'Home',
      'Gallery',
      'About',
      'Services & Booking',
      'Reviews',
      'Before You Book',
      'Visit & Contact',
    ]);

    for (const anchor of await anchors.all()) {
      const href = await anchor.getAttribute('href');

      expect(href).toMatch(/^#(?:section-|booking$)/u);

      await anchor.click();
      const target = page.locator(href!);

      await expect(target).toBeVisible();
      await expect.poll(() => target.evaluate(element => element.contains(document.activeElement)))
        .toBe(true);
    }
  });

  test('Multi-page website exposes five customer-ready pages without repeated content', async ({ page }) => {
    await openRecipe(page, 'the_collective');
    const navigation = multiPageNavigation(page);

    await expect(navigation).toHaveText(MULTI_PAGE_EXPECTATIONS.map(pageExpectation => (
      pageExpectation.label
    )));

    const siteContentOwners = new Map<string, Set<string>>();
    const allSectionKinds: string[] = [];
    let bookingEngines = 0;

    /* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect --
     * This single journey deliberately walks a locked page matrix. Home is
     * already active; the remaining entries require navigation and focus
     * verification, while only the authoritative Services page owns Booking.
     */
    for (let index = 0; index < MULTI_PAGE_EXPECTATIONS.length; index += 1) {
      const expectation = MULTI_PAGE_EXPECTATIONS[index]!;
      const link = navigation.nth(index);
      const href = await link.getAttribute('href');

      expect(href).toMatch(/^#preview-page-/u);

      if (index > 0) {
        await link.click();
      }

      await expect(link).toHaveAttribute('aria-current', 'page');

      const renderedPage = page.locator('.onboarding-customer-page');

      await expect(renderedPage).toHaveAttribute('aria-label', `${expectation.label} page`);

      if (index > 0) {
        await expect.poll(() => renderedPage.evaluate(element => (
          element.querySelector('[data-preview-page-heading="true"]') === document.activeElement
        ))).toBe(true);
      }

      const audit = await auditCurrentCustomerPage(page);

      expect(audit.sectionKinds, expectation.label).toEqual(expectation.sections);

      expectCleanCustomerPage(audit);
      if (expectation.label === 'Services & Booking') {
        await expectSingleCataloguePresentation(page);
      }
      allSectionKinds.push(...audit.sectionKinds);
      bookingEngines += audit.serviceCatalogueOwners.length;
      for (const marker of audit.contentOwners) {
        const owners = siteContentOwners.get(marker.key) ?? new Set<string>();
        owners.add(marker.owner);
        siteContentOwners.set(marker.key, owners);
      }
    }
    /* eslint-enable playwright/no-conditional-in-test, playwright/no-conditional-expect */

    expect(allSectionKinds).toEqual([
      'hero',
      'reviews',
      'booking',
      'before_you_book',
      'gallery',
      'about_team',
      'visit_contact',
    ]);
    expect(bookingEngines).toBe(1);

    for (const [key, owners] of siteContentOwners) {
      expect([...owners], `${key} must not repeat across pages`).toHaveLength(1);
    }

    await navigation.nth(1).click();

    await expect(page.locator('.customer-book-shortcut')).not.toHaveClass(/is-hidden/u);

    await navigation.first().click();

    await expect(page.locator('.customer-book-shortcut')).toHaveClass(/is-hidden/u);
  });
});
