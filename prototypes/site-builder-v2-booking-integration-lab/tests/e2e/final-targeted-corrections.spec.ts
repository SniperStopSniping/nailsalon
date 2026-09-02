import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  bookingCard,
  chooseStarter,
  destinationPageButton,
  documentSurfaceState,
  LAB_STORAGE_KEY,
  openBookingSettings,
  openFreshLab,
  openMoveForBooking,
  openPagesAndStructure,
  readStoredDocumentJson,
  sectionLabels,
  selectBooking,
  selectPageFromStructure,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

const LAYOUTS = [
  { id: 'visual_grid', label: 'Visual Grid' },
  { id: 'clean_list', label: 'Clean List' },
  { id: 'editorial_cards', label: 'Editorial Cards' },
  { id: 'category_menu', label: 'Category Menu' },
  { id: 'editorial_price_list', label: 'Editorial Price List' },
] as const;

/** Quick Book's Home page after Booking is moved to position 1. */
const QUICK_BOOK_BOOKING_FIRST = [
  'Booking',
  'Announcement Bar',
  'Salon intro',
  'Featured Services',
  'Final Booking CTA',
  'Footer',
] as const;

test.describe.configure({ mode: 'serial' });

let runtimeMonitor: ReturnType<typeof startRuntimeMonitor>;

test.beforeEach(async ({ page }) => {
  runtimeMonitor = startRuntimeMonitor(page);
});

test.afterEach(async () => {
  runtimeMonitor.assertClean();
  runtimeMonitor.stop();
});

async function closeBookingSettings(settings: Locator): Promise<void> {
  const close = settings.getByRole('button', {
    name: /Close Booking(?: settings)?/,
  });
  await close.click();
  await expect(settings).toHaveCount(0);
}

async function chooseLayout(
  page: Page,
  pageName: string,
  layout: (typeof LAYOUTS)[number],
): Promise<void> {
  const { settings } = await openBookingSettings(page, pageName);
  const heading = settings.getByRole('heading', {
    name: 'Booking',
    exact: true,
  });
  await expect(heading).toBeFocused();
  const option = settings.locator(`[data-layout-option="${layout.id}"]`);
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await closeBookingSettings(settings);
}

async function expectMeaningfulFocus(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement
      && active !== document.body
      && active !== document.documentElement
      && active.isConnected;
  })).toBe(true);
}

async function traverseBetween(
  page: Page,
  start: Locator,
  target: Locator,
  key: 'Shift+Tab' | 'Tab',
): Promise<void> {
  await start.focus();
  let reached = false;
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press(key);
    const state = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return {
        insideCustomerPreview: Boolean(active?.closest('.booking-customer-region')),
        tag: active?.tagName ?? null,
        text: active?.textContent?.trim().slice(0, 80) ?? null,
      };
    });
    expect(state.insideCustomerPreview, JSON.stringify(state)).toBe(false);
    if (await target.evaluate((element) => element === document.activeElement)) {
      reached = true;
      break;
    }
  }
  expect(reached, `${key} reached the expected owner control`).toBe(true);
}

async function expectControlOwnsHitPoints(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const results = await control.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const insetX = Math.min(6, rectangle.width / 4);
    const insetY = Math.min(6, rectangle.height / 4);
    const points = [
      [rectangle.left + rectangle.width / 2, rectangle.top + rectangle.height / 2],
      [rectangle.left + insetX, rectangle.top + insetY],
      [rectangle.right - insetX, rectangle.top + insetY],
      [rectangle.left + insetX, rectangle.bottom - insetY],
      [rectangle.right - insetX, rectangle.bottom - insetY],
    ];
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x ?? 0, y ?? 0);
      return hit?.closest('button') === element;
    });
  });
  expect(results).toEqual([true, true, true, true, true]);
}

async function openRussianWithFrench(page: Page): Promise<void> {
  const renderer = page.getByTestId('booking-section-preview');
  await renderer.getByRole('searchbox', { name: 'Search services' }).fill('russ');
  await renderer
    .locator('.featured-tile')
    .filter({ hasText: 'Russian Manicure' })
    .click();
  const detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('checkbox', { name: 'French' }).check();
  await detail.getByRole('button', { name: 'Keep browsing' }).click();
  await expect(page.getByTestId('selected-service-summary'))
    .toContainText('1 hr 45 min · From $80');
}

const KEYBOARD_SCENARIOS = [
  { height: 600, starter: 'Quick Book' as const, width: 320 },
  { height: 600, starter: 'Quick Book' as const, width: 375 },
  { height: 800, starter: 'Quick Book' as const, width: 920 },
  { height: 800, starter: 'Quick Book' as const, width: 1180 },
  { height: 900, starter: 'Quick Book' as const, width: 1440 },
  { height: 600, starter: 'Multi-page website' as const, width: 375 },
  { height: 800, starter: 'Multi-page website' as const, width: 920 },
  { height: 800, starter: 'Multi-page website' as const, width: 1180 },
  { height: 900, starter: 'Multi-page website' as const, width: 1440 },
];

for (const scenario of KEYBOARD_SCENARIOS) {
  test(`Edit preview permits real owner traversal in all layouts at ${scenario.width}×${scenario.height} ${scenario.starter}`, async ({
    context,
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await openFreshLab(page);
    await chooseStarter(page, scenario.starter);
    const pageName = scenario.starter === 'Multi-page website'
      ? 'Services / Book'
      : 'Home';
    // The owner controls that bracket the Booking card on the page under test.
    // Quick Book Home and Multi-page "Services / Book" both place Featured
    // Services directly above Booking; the section below it differs. Booking is
    // no longer the last section on either page, so the traversal now crosses
    // the Booking card between its neighbours' select surfaces instead of
    // running off the end of the canvas into the dock.
    const beforeSection = 'Featured Services';
    const afterSection = scenario.starter === 'Multi-page website'
      ? 'Deposits & Cancellations'
      : 'Final Booking CTA';
    if (pageName !== 'Home') await selectPageFromStructure(page, pageName);
    const inspectEveryLayoutInAccessibilityTree = scenario.width === 920
      && scenario.starter === 'Quick Book';
    const cdp = inspectEveryLayoutInAccessibilityTree
      ? await context.newCDPSession(page)
      : null;

    for (const layout of LAYOUTS) {
      await chooseLayout(page, pageName, layout);
      const card = bookingCard(page, pageName);
      const preview = card.getByRole('group', {
        name: `Booking menu preview — 24 services, ${layout.label}. Not interactive while editing.`,
      });
      await expect(preview).toBeVisible();
      await expect(preview).not.toHaveAttribute('aria-hidden');
      await expect(preview).not.toHaveAttribute('inert');
      await expect(preview.getByText('Russian Manicure', { exact: true }).last())
        .toBeVisible();
      await expect.poll(() => preview.evaluate((region) => (
        [...region.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], .booking-category-strip, .featured-scroller, .category-sidebar',
        )].filter((element) => element.tabIndex >= 0).length
      ))).toBe(0);

      const before = page
        .getByRole('listitem', { name: `${beforeSection} on ${pageName}` })
        .locator('.section-card__select-surface');
      const after = page
        .getByRole('listitem', { name: `${afterSection} on ${pageName}` })
        .locator('.section-card__select-surface');
      await traverseBetween(page, before, after, 'Tab');
      await traverseBetween(page, after, before, 'Shift+Tab');

      await page.evaluate(() => {
        const probe = window as typeof window & { __escapeProbe?: boolean[] };
        probe.__escapeProbe = [];
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') probe.__escapeProbe?.push(event.defaultPrevented);
        }, { once: true });
        const region = document.querySelector<HTMLElement>('.booking-customer-region');
        region?.setAttribute('tabindex', '-1');
        region?.focus();
      });
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => (
        window as typeof window & { __escapeProbe?: boolean[] }
      ).__escapeProbe)).toEqual([false]);

      if (cdp) {
        const tree = await cdp.send('Accessibility.getFullAXTree');
        const exposedNames = tree.nodes
          .filter(node => !node.ignored)
          .map(node => String(node.name?.value ?? ''));
        expect(exposedNames.some(name => name.includes(
          `Booking menu preview — 24 services, ${layout.label}. Not interactive while editing.`,
        ))).toBe(true);
        expect(exposedNames.some(name => name.includes('Russian Manicure'))).toBe(true);
        expect(exposedNames.some(name => name.includes('From $65'))).toBe(true);
        expect(exposedNames.some(name => name.includes('1 hr 30 min'))).toBe(true);
      }
    }

    await cdp?.detach();
  });
}

test('Edit preview remains escapable with desktop settings open and Booking deeply scrolled', async ({
  page,
}) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 920, height: 800 },
    { width: 1180, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    for (const layout of LAYOUTS) {
      await chooseLayout(page, 'Home', layout);
      const card = await selectBooking(page, 'Home');
      await card.scrollIntoViewIfNeeded();
      await card.locator('.booking-customer-region').evaluate((region) => {
        region.querySelectorAll<HTMLElement>('.booking-category-strip, .featured-scroller')
          .forEach((scroller) => { scroller.scrollLeft = scroller.scrollWidth; });
      });
      const { settings } = await openBookingSettings(page, 'Home');
      const settingControls = settings.locator('button:not([disabled]), input:not([disabled]), select:not([disabled])');
      const lastSettingControl = settingControls.last();
      await lastSettingControl.focus();
      let exitedSettings = false;
      for (let press = 0; press < 12; press += 1) {
        await page.keyboard.press('Tab');
        const state = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          return {
            customer: Boolean(active?.closest('.booking-customer-region')),
            settings: Boolean(active?.closest('.final-booking-settings-drawer')),
          };
        });
        expect(state.customer).toBe(false);
        if (!state.settings) {
          exitedSettings = true;
          break;
        }
      }
      expect(exitedSettings).toBe(true);
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => Boolean(
        document.activeElement?.closest('.booking-customer-region'),
      ))).toBe(false);
      await page.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);
      await expectMeaningfulFocus(page);
    }
  }
});

for (const viewport of [
  { width: 920, height: 800 },
  { width: 1024, height: 800 },
  { width: 1179, height: 800 },
  { width: 1180, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`hidden Booking settings preserve truthful controls and hitboxes at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    const { settings } = await openBookingSettings(page, 'Home');
    await expect(settings.getByRole('heading', { name: 'Booking' })).toBeFocused();
    await settings.getByRole('button', { name: 'Hide settings' }).click();
    await expect(settings).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show Booking settings' }))
      .toHaveCount(0);

    const toolbar = page.getByTestId('selected-section-toolbar');
    const edit = toolbar.getByRole('button', { name: 'Edit', exact: true });
    const more = toolbar.getByRole('button', { name: 'More', exact: true });
    await expectControlOwnsHitPoints(edit);
    await expectControlOwnsHitPoints(more);

    const collapse = toolbar.getByRole('button', { name: 'Collapse', exact: true });
    if (await collapse.isVisible()) await collapse.click();
    const expand = toolbar.getByRole('button', { name: 'Expand', exact: true });
    await expectControlOwnsHitPoints(expand);
    await expand.click();

    await more.click();
    const actions = page.getByRole('dialog', { name: 'Booking actions' });
    await expect(actions).toBeVisible();
    await actions.getByRole('button', { name: 'Close Booking actions' }).click();
    await expect(actions).toHaveCount(0);

    await edit.click();
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('heading', { name: 'Booking' })).toBeFocused();
    await settings.getByRole('button', { name: 'Hide settings' }).click();

    if (viewport.width === 1440 && viewport.height === 900) {
      await page.getByRole('button', { name: 'More site options' }).click();
      const siteOptions = page.getByRole('dialog', { name: 'More' });
      await siteOptions.getByRole('switch', { name: 'Simulate real section heights' }).click();
      await siteOptions.getByRole('button', { name: 'Close More' }).click();
    }
    await page.getByRole('listitem', { name: 'Announcement Bar on Home' }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expect(toolbar).toHaveClass(/is-away/);
    const back = toolbar.getByRole('button', { name: 'Back to Booking' });
    const show = toolbar.getByRole('button', { name: 'Show Booking settings' });
    await expectControlOwnsHitPoints(back);
    await expectControlOwnsHitPoints(show);
    const [backBox, showBox] = await Promise.all([back.boundingBox(), show.boundingBox()]);
    expect(backBox).not.toBeNull();
    expect(showBox).not.toBeNull();
    if (backBox && showBox) {
      expect(backBox.x + backBox.width).toBeLessThanOrEqual(showBox.x);
    }
    await show.click();
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('heading', { name: 'Booking' })).toBeFocused();

    if (viewport.width === 1180) {
      await settings.getByRole('button', { name: 'Hide settings' }).click();
      await back.click();
      await edit.focus();
      await page.keyboard.press('Enter');
      await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: 'Hide settings' }).click();
      await more.focus();
      await page.keyboard.press('Enter');
      const keyboardActions = page.getByRole('dialog', { name: 'Booking actions' });
      await expect(keyboardActions).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(keyboardActions).toHaveCount(0);
    }
  });
}

test('hidden settings return control stays clear through the 1179 to 1180 transition', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1179, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const { settings } = await openBookingSettings(page, 'Home');
  await settings.getByRole('button', { name: 'Hide settings' }).click();
  await page.getByRole('listitem', { name: 'Announcement Bar on Home' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  const away = page.getByTestId('selected-section-toolbar');
  await expect(away).toHaveClass(/is-away/);
  const back = away.getByRole('button', { name: 'Back to Booking' });
  const show = away.getByRole('button', { name: 'Show Booking settings' });
  await expectControlOwnsHitPoints(back);
  await expectControlOwnsHitPoints(show);
  const [backBox, showBox] = await Promise.all([back.boundingBox(), show.boundingBox()]);
  expect(backBox).not.toBeNull();
  expect(showBox).not.toBeNull();
  if (backBox && showBox) {
    expect(backBox.x + backBox.width).toBeLessThanOrEqual(showBox.x);
  }
  await page.setViewportSize({ width: 1180, height: 800 });
  await expectControlOwnsHitPoints(show);
  await show.click();
  await expect(settings).toBeVisible();
});

test('reselecting the current simulated device stays silent for pointer and keyboard input', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const phone = page.getByRole('group', { name: 'Preview viewport' })
    .getByRole('button', { name: 'Phone' });
  await phone.click();
  const liveRegion = page.getByTestId('preview-viewport-announcement');
  await expect(liveRegion).toContainText('Phone preview selected');
  const initialAnnouncement = await liveRegion.textContent();
  await page.evaluate(() => {
    const probe = window as typeof window & { __sameDeviceMutations?: number };
    probe.__sameDeviceMutations = 0;
    const region = document.querySelector('[data-testid="preview-viewport-announcement"]');
    if (region) {
      new MutationObserver(() => {
        probe.__sameDeviceMutations = (probe.__sameDeviceMutations ?? 0) + 1;
      }).observe(region, { characterData: true, childList: true, subtree: true });
    }
  });
  await phone.click();
  await phone.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  expect(await liveRegion.textContent()).toBe(initialAnnouncement);
  expect(await page.evaluate(() => (
    window as typeof window & { __sameDeviceMutations?: number }
  ).__sameDeviceMutations)).toBe(0);
  await expect(phone).toHaveAttribute('aria-pressed', 'true');
});

test('dirty option drafts warn, restore focus, and commit or discard honestly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await openRussianWithFrench(page);

  const summary = page.getByTestId('selected-service-summary');
  await summary.getByRole('button', { name: 'Change' }).click();
  let detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('button', { name: 'Close service details' }).click();
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Save your option changes?' }))
    .toHaveCount(0);

  await summary.getByRole('button', { name: 'Change' }).click();
  detail = page.getByTestId('service-detail-dialog');
  await page.getByTestId('service-detail-dialog-backdrop').click({
    position: { x: 3, y: 3 },
  });
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Save your option changes?' }))
    .toHaveCount(0);

  await summary.getByRole('button', { name: 'Change' }).click();
  detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('checkbox', { name: 'French' }).uncheck();
  await expect(detail.getByTestId('service-detail-total'))
    .toContainText('1 hr 30 min');
  await expect(summary).toContainText('1 hr 45 min · From $80');

  const close = detail.getByRole('button', { name: 'Close service details' });
  await close.click();
  let warning = page.getByRole('dialog', { name: 'Save your option changes?' });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await expect(detail).toHaveAttribute('aria-hidden', 'true');
  await expect(detail).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  await expect(close).toBeFocused();

  await page.getByTestId('service-detail-dialog-backdrop').click({
    position: { x: 3, y: 3 },
  });
  warning = page.getByRole('dialog', { name: 'Save your option changes?' });
  await expect(warning).toBeVisible();
  await page.getByTestId('booking-option-warning-dialog-backdrop').click({
    position: { x: 3, y: 3 },
  });
  await expect(warning).toHaveCount(0);
  await expect(detail).toBeVisible();

  await page.keyboard.press('Escape');
  warning = page.getByRole('dialog', { name: 'Save your option changes?' });
  await warning.getByRole('button', { name: 'Save changes' }).click();
  await expect(summary).toContainText('1 hr 30 min · From $65');
  await expect(summary.getByRole('button', { name: 'Change' })).toBeFocused();

  await summary.getByRole('button', { name: 'Change' }).click();
  detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('checkbox', { name: 'French' }).check();
  await detail.getByRole('checkbox', { name: 'Chrome' }).check();
  await detail.getByRole('button', { name: 'Keep browsing' }).click();
  await expect(summary).toContainText('1 hr 55 min · From $90 · 2 add-ons');

  await summary.getByRole('button', { name: 'Change' }).click();
  detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('checkbox', { name: 'Chrome' }).uncheck();
  await detail.getByRole('button', { name: 'Close service details' }).click();
  warning = page.getByRole('dialog', { name: 'Save your option changes?' });
  await warning.getByRole('button', { name: 'Discard changes' }).click();
  await expect(summary).toContainText('1 hr 55 min · From $90 · 2 add-ons');
  await expect(summary.getByRole('button', { name: 'Change' })).toBeFocused();

  await summary.getByRole('button', { name: 'Change' }).click();
  detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('checkbox', { name: 'French' }).uncheck();
  await detail.getByRole('checkbox', { name: 'Chrome' }).uncheck();
  await detail.getByRole('button', { name: 'Keep browsing' }).click();
  await expect(summary).toContainText('1 hr 30 min · From $65');

  await summary.getByRole('button', { name: 'Change' }).click();
  detail = page.getByTestId('service-detail-dialog');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  for (const device of ['Phone', 'Tablet'] as const) {
    await page.getByRole('group', { name: 'Preview viewport' })
      .getByRole('button', { name: device })
      .click();
    await expect(summary).toContainText('1 hr 30 min · From $65');
  }

  await page.getByRole('button', { name: 'Back to editor' }).click();
  const { settings } = await openBookingSettings(page, 'Home');
  await settings.locator('[data-layout-option="clean_list"]').click();
  await closeBookingSettings(settings);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('selected-service-summary'))
    .toContainText('1 hr 30 min · From $65');
});

test('Page settings closes only its child and restores Pages & Structure context', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const viewport of [
    { width: 375, height: 500 },
    { width: 375, height: 600 },
    { width: 920, height: 800 },
    { width: 1180, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Multi-page website');
    const structure = await openPagesAndStructure(page);
    const structureBody = structure.locator('.dialog-body');
    await structureBody.evaluate((element) => {
      element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight);
    });
    if (viewport.height === 500) {
      expect(await structureBody.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
    }
    const parentSurface = await documentSurfaceState(page);

    const closeChildAndAssert = async (
      pageName: string,
      close: (settings: Locator) => Promise<void>,
      returnedName = pageName,
    ) => {
      const trigger = structure.getByRole('button', {
        name: `Page settings for ${pageName}`,
      });
      await trigger.click();
      const settings = page.getByRole('dialog', { name: `${pageName} settings` });
      await expect(settings).toBeVisible();
      const scrollAtOpen = await structureBody.evaluate((element) => element.scrollTop);
      await close(settings);
      await expect(settings).toHaveCount(0);
      await expect(structure).toBeVisible();
      await expect(structure.getByRole('button', {
        name: `Page settings for ${returnedName}`,
      })).toBeFocused();
      expect(await structureBody.evaluate((element) => element.scrollTop))
        .toBe(scrollAtOpen);
      expect(await documentSurfaceState(page)).toEqual(parentSurface);
      await expectMeaningfulFocus(page);
    };

    await closeChildAndAssert('Home', async (settings) => {
      await settings.getByRole('button', { name: 'Cancel' }).click();
    });
    await closeChildAndAssert('Gallery', async (settings) => {
      await settings.getByRole('button', { name: 'Close Gallery settings' }).click();
    });
    await closeChildAndAssert('Team', async (settings) => {
      await settings.getByLabel('Page name').focus();
      await page.keyboard.press('Escape');
    });
    if (viewport.width < 900) {
      await closeChildAndAssert('Contact', async (settings) => {
        const backdrop = page.getByTestId('dialog-backdrop').filter({ has: settings });
        await backdrop.click({ position: { x: 3, y: 3 } });
      });
    }
    await closeChildAndAssert('Gallery', async (settings) => {
      await settings.getByLabel('Page name').fill('Portfolio');
      await settings.getByRole('switch', { name: 'Show page in menu' }).click();
      await settings.getByRole('button', { name: 'Save page' }).click();
    }, 'Portfolio');
    const portfolioTrigger = structure.getByRole('button', {
      name: 'Page settings for Portfolio',
    });
    await portfolioTrigger.click();
    const portfolioSettings = page.getByRole('dialog', { name: 'Portfolio settings' });
    await expect(portfolioSettings.getByRole('switch', { name: 'Show page in menu' }))
      .toHaveAttribute('aria-checked', 'false');
    await portfolioSettings.getByRole('button', { name: 'Cancel' }).click();
    await expect(portfolioTrigger).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(structure).toHaveCount(0);
    await expectMeaningfulFocus(page);
  }
});

test('Quick Book added-page settings preserve a genuinely deep parent list on mobile and desktop', async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const viewport of [
    { width: 375, height: 600 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    for (let index = 1; index <= 12; index += 1) {
      const structure = await openPagesAndStructure(page);
      await structure.getByRole('button', { name: 'Add page', exact: true }).click();
      const addPage = page.getByRole('dialog', { name: 'Add page' });
      await addPage.getByLabel('Page name').fill(`Extra ${String(index).padStart(2, '0')}`);
      await addPage.getByRole('button', { name: 'Add page', exact: true }).click();
      const menuPrompt = page.getByRole('dialog', { name: 'Add a menu?' });
      if (await menuPrompt.isVisible()) {
        await menuPrompt.getByRole('button', { name: 'Not now' }).click();
      }
    }

    const structure = await openPagesAndStructure(page);
    const body = structure.locator('.dialog-body');
    await expect.poll(() => body.evaluate((element) => (
      element.scrollHeight > element.clientHeight
    ))).toBe(true);
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const scrollAtOpen = await body.evaluate((element) => element.scrollTop);
    expect(scrollAtOpen).toBeGreaterThan(0);
    const trigger = structure.getByRole('button', { name: 'Page settings for Extra 06' });
    await trigger.scrollIntoViewIfNeeded();
    const settledScroll = await body.evaluate((element) => element.scrollTop);
    expect(settledScroll).toBeGreaterThan(0);
    await trigger.click();
    const settings = page.getByRole('dialog', { name: 'Extra 06 settings' });
    await settings.getByRole('switch', { name: 'Show page in menu' }).click();
    await settings.getByRole('button', { name: 'Cancel' }).click();
    await expect(structure).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await body.evaluate((element) => element.scrollTop)).toBe(settledScroll);

    await trigger.click();
    await settings.getByRole('switch', { name: 'Show page in menu' }).click();
    await settings.getByRole('button', { name: 'Save page' }).click();
    await expect(structure).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await body.evaluate((element) => element.scrollTop)).toBe(settledScroll);
    await page.keyboard.press('Escape');
    await expect(structure).toHaveCount(0);
    await expectMeaningfulFocus(page);
  }
});

test('drag announcements use one live region per event', async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await selectPageFromStructure(page, 'Services / Book');
  const move = await openMoveForBooking(page, 'Services / Book');
  await page.evaluate(() => {
    const probe = window as typeof window & {
      __liveEvents?: Array<{ politeness: string | null; text: string }>;
    };
    probe.__liveEvents = [];
    document.querySelectorAll<HTMLElement>('[aria-live]').forEach((region) => {
      new MutationObserver(() => {
        const text = region.textContent?.trim() ?? '';
        if (text) {
          probe.__liveEvents?.push({
            politeness: region.getAttribute('aria-live'),
            text,
          });
        }
      }).observe(region, { characterData: true, childList: true, subtree: true });
    });
  });
  const resetEvents = async () => page.evaluate(() => {
    (window as typeof window & {
      __liveEvents?: Array<{ politeness: string | null; text: string }>;
    }).__liveEvents = [];
  });
  const takeSingleEvent = async (
    politeness: 'assertive' | 'polite',
    text: RegExp,
  ) => {
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & {
        __liveEvents?: Array<{ politeness: string | null; text: string }>;
      }
    ).__liveEvents?.length ?? 0)).toBeGreaterThan(0);
    const events = await page.evaluate(() => (
      window as typeof window & {
        __liveEvents?: Array<{ politeness: string | null; text: string }>;
      }
    ).__liveEvents ?? []);
    expect(events, JSON.stringify(events)).toHaveLength(1);
    expect(events[0]?.politeness).toBe(politeness);
    expect(events[0]?.text).toMatch(text);
  };

  // "Services / Book" now holds six sections and Booking sits second, so the
  // disabled down-boundary belongs to the section that is genuinely last.
  const boundary = move.getByRole('button', {
    name: 'Move Footer down, unavailable — already last',
  });
  await boundary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('reorder-live-region'))
    .toHaveText('Footer is already at the last position.');
  await takeSingleEvent('polite', /^Footer is already at the last position\.$/);

  const handle = move.getByRole('button', {
    name: 'Drag Booking. Use arrow keys after lifting with Space.',
  });
  await resetEvents();
  await handle.focus();
  await page.keyboard.press('Space');
  await takeSingleEvent('assertive', /^Picked up Booking/);
  await resetEvents();
  await page.keyboard.press('ArrowUp');
  await takeSingleEvent('assertive', /^Booking is over position 1 of 6\.$/);
  await resetEvents();
  await page.keyboard.press('Space');
  await takeSingleEvent('assertive', /^Booking moved to position 1 of 6\.$/);

  await resetEvents();
  await handle.focus();
  await page.keyboard.press('Space');
  await takeSingleEvent('assertive', /^Picked up Booking/);
  await resetEvents();
  await page.keyboard.press('Escape');
  await takeSingleEvent('assertive', /^Moving Booking was cancelled\.$/);

  await move.getByRole('button', { name: 'Move Booking to another page' }).click();
  await resetEvents();
  await destinationPageButton(move, 'Home').click();
  await takeSingleEvent('polite', /^Booking staged to move to Home\.$/);
});

test('short booking-protection dialogs keep all copy and actions reachable', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 500 },
    { width: 320, height: 600 },
    { width: 375, height: 500 },
    { width: 375, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await selectBooking(page, 'Home');
    await page.getByRole('group', { name: 'Booking actions' })
      .getByRole('button', { name: 'Hide', exact: true })
      .click();
    let protection = page.getByRole('dialog', { name: 'Keep a way to book' });
    await expect(protection).toBeVisible();
    await expect(protection.getByText(/Your site needs at least one visible way/)).toBeVisible();
    const body = protection.locator('.dialog-body');
    const dimensions = await body.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(protection.getByText(/Your site needs at least one visible way/))
      .toBeInViewport();
    await expect(protection.getByRole('button', { name: 'Keep Booking' })).toBeInViewport();
    await protection.getByRole('button', { name: 'Keep Booking' }).click();

    await page.getByRole('group', { name: 'Booking actions' })
      .getByRole('button', { name: 'More', exact: true })
      .click();
    const actions = page.getByRole('dialog', { name: 'Booking actions' });
    await actions.getByRole('button', { name: 'Remove from page' }).click();
    protection = page.getByRole('dialog', { name: 'Keep a way to book' });
    await expect(protection.getByRole('button', { name: 'Keep Booking' })).toBeVisible();
    await protection.locator('.dialog-body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(protection.getByRole('button', { name: 'Keep Booking' })).toBeInViewport();
    await protection.getByRole('button', { name: 'Keep Booking' }).click();

    const structure = await openPagesAndStructure(page);
    await structure.getByRole('button', { name: 'Page settings for Home' }).click();
    const pageSettings = page.getByRole('dialog', { name: 'Home settings' });
    await pageSettings.getByRole('switch', { name: 'Show page', exact: true }).click();
    await pageSettings.getByRole('button', { name: 'Save page' }).click();
    protection = page.getByRole('dialog', { name: 'Keep a way to book' });
    await expect(protection).toBeVisible();
    await protection.locator('.dialog-body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const copy = protection.getByText(/Your site needs at least one visible way/);
    const action = protection.getByRole('button', { name: 'Keep Booking' });
    await expect(copy).toBeInViewport();
    await expect(action).toBeInViewport();
    const [copyBox, actionBox] = await Promise.all([copy.boundingBox(), action.boundingBox()]);
    expect(copyBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    if (copyBox && actionBox) {
      expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(actionBox.y);
    }
    await action.click();
    await pageSettings.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Escape');
    await expect(structure).toHaveCount(0);
  }
});

test('starter toast clears before Add page and disclaimer contrast exceeds AA', async ({ page }) => {
  const contrastRecords: Array<{
    background: string;
    foreground: string;
    ratio: number;
    width: number;
  }> = [];
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 600 : 900 });
    await openFreshLab(page);
    const record = await page.locator('.final-starter-disclaimer').evaluate((element) => {
      const parse = (color: string) => color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (channels: number[]) => (
        0.2126 * linear(channels[0] ?? 0)
        + 0.7152 * linear(channels[1] ?? 0)
        + 0.0722 * linear(channels[2] ?? 0)
      );
      const foreground = getComputedStyle(element).color;
      let backgroundElement: Element | null = element;
      let background = 'rgb(255, 255, 255)';
      while (backgroundElement) {
        const candidate = getComputedStyle(backgroundElement).backgroundColor;
        if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') {
          background = candidate;
          break;
        }
        backgroundElement = backgroundElement.parentElement;
      }
      const foregroundLuminance = luminance(parse(foreground));
      const backgroundLuminance = luminance(parse(background));
      return {
        background,
        foreground,
        ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      };
    });
    contrastRecords.push({ ...record, width });
    expect(record.ratio).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRecords[0]).toMatchObject({
    background: 'rgb(247, 242, 236)',
    foreground: 'rgb(117, 104, 103)',
  });

  for (const starter of ['Quick Book', 'One-page website', 'Multi-page website'] as const) {
    for (const viewport of [
      { width: 320, height: 600 },
      { width: 375, height: 500 },
      { width: 375, height: 600 },
      { width: 920, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await openFreshLab(page);
      await chooseStarter(page, starter);
      await expect(page.locator('.toast')).toBeVisible();
      const structure = await openPagesAndStructure(page);
      await structure.getByRole('button', { name: 'Add page' }).click();
      const addPage = page.getByRole('dialog', { name: 'Add page' });
      await expect(addPage).toBeVisible();
      await expect(page.locator('.toast')).toHaveCount(0);
      await expect(addPage.getByLabel('Page name')).toBeVisible();
      await expect(addPage.getByRole('button', { name: 'Add page', exact: true })).toBeVisible();
      await expect(addPage.getByRole('button', { name: 'Close Add page' })).toBeVisible();
      await addPage.getByRole('button', { name: 'Close Add page' }).click();
    }
  }
});

test('global search, featured selection, count spacing, and session-only history stay truthful', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  let renderer = page.getByTestId('booking-section-preview');
  await renderer.getByRole('group', { name: 'Service categories' })
    .getByRole('button', { name: 'Pedicure', exact: true })
    .click();
  const search = renderer.getByRole('searchbox', { name: 'Search services' });
  await search.fill('  RuSs  ');
  await expect(renderer.getByRole('button', { name: /Russian Manicure/ }).first())
    .toBeVisible();
  await expect(renderer.getByRole('group', { name: 'Service categories' })
    .getByRole('button', { name: 'All', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await search.fill('gel');
  expect(await renderer.getByRole('button', { name: /View details for/ }).count())
    .toBeGreaterThan(3);
  await search.fill('definitely-no-service');
  await expect(renderer.getByText('No services found')).toBeVisible();
  await search.fill('');
  await expect(renderer.getByRole('group', { name: 'Service categories' })
    .getByRole('button', { name: 'Pedicure', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');

  await renderer.getByRole('group', { name: 'Service categories' })
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await renderer.locator('.featured-tile').filter({ hasText: 'Russian Manicure' }).click();
  let detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('button', { name: 'Keep browsing' }).click();
  const featured = renderer.locator('.featured-tile').filter({ hasText: 'Russian Manicure' });
  await expect(featured).toHaveAttribute('aria-pressed', 'true');
  await expect(featured).toHaveAttribute('data-selected', 'true');
  await expect(featured.getByText('Selected')).toBeVisible();
  await featured.click();
  detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('button', { name: 'Remove selected service' }).click();
  await expect(featured).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('group', { name: 'Preview viewport' })
    .getByRole('button', { name: 'Phone' })
    .click();
  await featured.focus();
  await page.keyboard.press('Enter');
  detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('button', { name: 'Keep browsing' }).click();
  await expect(featured).toHaveAttribute('aria-pressed', 'true');
  await expect(featured.getByText('Selected')).toBeVisible();
  await featured.focus();
  await page.keyboard.press('Enter');
  detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('button', { name: 'Remove selected service' }).click();
  await expect(featured).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Back to editor' }).click();
  await chooseLayout(page, 'Home', { id: 'clean_list', label: 'Clean List' });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  renderer = page.getByTestId('booking-section-preview');
  await expect(renderer.locator('.clean-category-heading').first())
    .toContainText('Manicure · 3 services');
  expect(await renderer.locator('.clean-category-heading').allTextContents())
    .not.toEqual(expect.arrayContaining([expect.stringMatching(/·\S/) ]));

  await page.getByRole('button', { name: 'Back to editor' }).click();
  const move = await openMoveForBooking(page, 'Home');
  await move.getByLabel('Position for Booking').fill('1');
  await move.getByLabel('Position for Booking').press('Enter');
  await move.getByRole('button', { name: 'Done', exact: true }).click();
  await waitForSaved(page);
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([...QUICK_BOOK_BOOKING_FIRST]);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  const committed = await readStoredDocumentJson(page);
  await page.reload();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([...QUICK_BOOK_BOOKING_FIRST]);
  expect(await page.evaluate(key => window.localStorage.getItem(key), LAB_STORAGE_KEY))
    .toBe(committed);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
});
