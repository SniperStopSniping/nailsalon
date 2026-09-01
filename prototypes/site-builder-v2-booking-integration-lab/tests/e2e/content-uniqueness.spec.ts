import { expect, type Page, test } from '@playwright/test';

const RECIPES = [
  'quick_book',
  'signature_one_page',
  'the_collective',
  'solo_editorial',
  'promo_led',
  'gallery_forward',
] as const;

const HARD_SITE_UNIQUE = new Set([
  'brand_logo',
  'owner_profile_photo',
  'instagram',
  'phone',
  'text',
  'email',
  'exact_address',
  'business_hours',
  'deposit_cancellation_policy',
  'before_you_book_policies',
  // The same shared Gallery collection has one site owner even though the
  // generic assertion also protects against multiple Galleries per page.
  'gallery_media',
]);

type VisibleCustomerAudit = {
  blankSections: string[];
  bookingEngines: number;
  content: Array<{ key: string; owner: string }>;
  duplicateKeys: string[];
  duplicatePublicLinks: string[];
  media: Array<{ assetId: string; role: string }>;
  overflow: number;
};

const auditVisibleCustomerPage = async (page: Page): Promise<VisibleCustomerAudit> =>
  page.evaluate(() => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const content = [...document.querySelectorAll('[data-content-key][data-content-owner]')]
      .filter(visible)
      .map(element => ({
        key: element.dataset.contentKey ?? '',
        owner: element.dataset.contentOwner ?? '',
      }));
    const media = [...document.querySelectorAll('[data-media-id][data-media-role]')]
      .filter(visible)
      .map(element => ({
        assetId: element.dataset.mediaId ?? '',
        role: element.dataset.mediaRole ?? '',
      }));
    const duplicateKeys = Object.entries(content.reduce<Record<string, number>>(
      (counts, marker) => ({ ...counts, [marker.key]: (counts[marker.key] ?? 0) + 1 }),
      {},
    )).filter(([, count]) => count > 1).map(([key]) => key);
    const publicLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .filter(visible)
      .map(link => (link.getAttribute('href') ?? '').toLowerCase().replace(/\/$/u, ''))
      .filter(href => /^(?:https?:|tel:|sms:|mailto:)/u.test(href));
    const duplicatePublicLinks = publicLinks.filter(
      (href, index) => publicLinks.indexOf(href) !== index,
    );
    const blankSections = [...document.querySelectorAll<HTMLElement>('[data-section-id]')]
      .filter(visible)
      .filter(section => section.getBoundingClientRect().height > 12
        && !(section.textContent ?? '').trim())
      .map(section => section.dataset.sectionId ?? section.id);

    return {
      blankSections,
      bookingEngines: content.filter(marker => marker.key === 'service_catalogue').length,
      content,
      duplicateKeys: [...new Set(duplicateKeys)],
      duplicatePublicLinks: [...new Set(duplicatePublicLinks)],
      media,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

const expectRecipeUnique = async (
  page: Page,
  recipe: typeof RECIPES[number],
): Promise<number> => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(`/?audit=1&surface=sections&recipe=${recipe}&full=1&device=desktop`);

  await expect(page.locator('[data-showcase-ready]')).toBeVisible();

  const navigation = await page
    .locator('nav[aria-label="Customer preview navigation"] a[href^="#preview-page-"]')
    .evaluateAll(links => links.map(link => ({
      href: link.getAttribute('href') ?? '',
      label: (link.textContent ?? '').trim(),
    })));
  const destinations = navigation.length > 0
    ? navigation
    : [{ href: '', label: 'Home' }];
  const siteOwners = new Map<string, Set<string>>();
  const rolesByAsset = new Map<string, Set<string>>();

  for (const destination of destinations) {
    if (destination.href) {
      await page.locator(
        `nav[aria-label="Customer preview navigation"] a[href="${destination.href}"]`,
      ).click();
    }
    const audit = await auditVisibleCustomerPage(page);

    expect(audit.duplicateKeys, `${recipe} ${destination.label} content`).toEqual([]);
    expect(audit.duplicatePublicLinks, `${recipe} ${destination.label} links`).toEqual([]);
    expect(audit.blankSections, `${recipe} ${destination.label} blank bands`).toEqual([]);
    expect(audit.bookingEngines, `${recipe} ${destination.label} Booking engines`)
      .toBeLessThanOrEqual(1);
    expect(audit.overflow, `${recipe} ${destination.label} overflow`).toBeLessThanOrEqual(1);

    for (const marker of audit.content) {
      const owners = siteOwners.get(marker.key) ?? new Set<string>();
      owners.add(marker.owner);
      siteOwners.set(marker.key, owners);
    }
    for (const marker of audit.media) {
      const roles = rolesByAsset.get(marker.assetId) ?? new Set<string>();
      roles.add(marker.role);
      rolesByAsset.set(marker.assetId, roles);
    }
  }

  for (const [key, owners] of siteOwners) {
    if (HARD_SITE_UNIQUE.has(key)) {
      expect([...owners], `${recipe} ${key} owners`).toHaveLength(1);
    }
  }
  for (const [assetId, roles] of rolesByAsset) {
    expect([...roles], `${recipe} ${assetId} roles`).toHaveLength(1);
  }

  return destinations.length;
};

test.describe('customer content uniqueness', () => {
  for (const recipe of RECIPES) {
    test(`${recipe} gives substantive content one visible owner`, async ({ page }) => {
      expect(await expectRecipeUnique(page, recipe)).toBeGreaterThan(0);
    });
  }
});
