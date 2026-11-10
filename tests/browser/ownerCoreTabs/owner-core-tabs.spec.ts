import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3152') {
      throw new Error('External requests are forbidden in the isolated component review.');
    }
    await route.continue();
  });
});

const screenCases = [
  { screen: 'calendar', ready: (page: Page) => page.getByRole('button', { name: 'Next month' }) },
  { screen: 'clients', ready: (page: Page) => page.getByRole('button', { name: /SM Sofia Martin/ }) },
  { screen: 'services', ready: (page: Page) => page.getByText('Russian Manicure', { exact: true }) },
];
for (const { screen, ready } of screenCases) {
  test(`${screen}: readable layout from narrow phone to desktop`, async ({ page }) => {
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/?screen=${screen}`);

      await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
      await expect(ready(page)).toBeVisible();

      await noOverflow(page);
      const back = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();

      expect(back?.height).toBeGreaterThanOrEqual(44);

      if (screen === 'calendar') {
        const canvas = await page.locator('main').boundingBox();
        const add = await page.getByRole('button', { name: 'Add new appointment' }).boundingBox();

        expect(add!.x + add!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
      }
    }
  });
}

test('calendar: navigation, filters and availability disclosure remain operable', async ({ page }) => {
  await page.goto('/?screen=calendar');
  const menu = page.getByTestId('calendar-availability-menu');
  const summary = menu.locator('summary');

  await expect(page.getByRole('button', { name: 'Edit working hours' })).toBeHidden();

  await summary.click();

  await expect(page.getByRole('button', { name: 'Edit working hours' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit working hours' }).focus();
  await page.keyboard.press('Escape');

  await expect(menu).not.toHaveAttribute('open');
  await expect(summary).toBeFocused();

  await page.getByRole('button', { name: 'Monthly', exact: true }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByRole('button', { name: 'Weekly', exact: true }).click();
  await page.getByRole('group', { name: 'Filter calendar by technician' }).getByRole('button', { name: 'Daniela', exact: true }).click();
  await summary.click();
  await page.getByRole('button', { name: 'Edit working hours' }).click();

  await expect(page.getByRole('status')).toContainText('hours/working-hours');

  await noOverflow(page);
});

test('calendar: block-time entry and cancellation remain available', async ({ page }) => {
  await page.goto('/?screen=calendar');
  await page.getByTestId('calendar-availability-menu').locator('summary').click();
  await page.getByRole('button', { name: 'Block Time', exact: true }).click();

  await expect(page.getByText('Block time', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Weekly', exact: true })).toBeVisible();
});

test('clients: search, clear, profile sections and back preserve the directory', async ({ page }) => {
  await page.goto('/?screen=clients');
  const search = page.getByRole('textbox', { name: 'Search clients' });

  await expect(search).toHaveCSS('font-size', '16px');

  await search.fill('Sofia');

  await expect(page.getByRole('button', { name: /SM Sofia Martin/ })).toBeVisible();

  await page.getByRole('button', { name: 'Clear search' }).click();

  await expect(search).toHaveValue('');

  await page.getByRole('button', { name: /SM Sofia Martin/ }).click();

  await expect(page.getByRole('heading', { name: 'Sofia Martin' })).toBeVisible();

  const section = page.getByRole('combobox', { name: 'Client profile section' });

  expect((await section.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await section.selectOption({ label: 'Preferences' });

  await expect(page.getByRole('textbox', { name: 'Sensitivities and allergies' })).toBeVisible();

  await section.selectOption({ label: 'Overview' });
  await page.getByRole('button', { name: 'Clients', exact: true }).click();

  await expect(search).toBeVisible();

  await noOverflow(page);
});

test('Clients and Calendar sheets match the Services top inset', async ({ page }) => {
  await page.goto('/?screen=services&surface=sheet');
  const services = page.getByRole('dialog', { name: 'Services', exact: true });
  const topOffset = (sheet: Locator) => sheet.evaluate(
    panel => panel.getBoundingClientRect().top - (window.visualViewport?.offsetTop ?? 0),
  );

  await expect(services.getByRole('button', { name: 'Back', exact: true })).toBeVisible();

  const servicesStyle = await services.evaluate(panel => ({
    inset: Number.parseFloat(getComputedStyle(panel).top),
    radius: getComputedStyle(panel).borderTopLeftRadius,
  }));

  await expect.poll(() => topOffset(services)).toBeCloseTo(servicesStyle.inset, 0);
  expect(servicesStyle.inset).toBeGreaterThan(0);

  await page.goto('/?screen=clients&surface=sheet');
  const sheet = page.getByRole('dialog', { name: 'Clients', exact: true });

  await page.getByRole('button', { name: 'Open Clients' }).click();

  await expect(sheet.getByRole('button', { name: /SM Sofia Martin/ })).toBeVisible();
  await expect.poll(() => topOffset(sheet)).toBeCloseTo(servicesStyle.inset, 0);
  await expect(sheet).toHaveCSS('border-top-left-radius', servicesStyle.radius);

  await sheet.getByRole('tab', { name: 'Insights & Follow-ups' }).click();

  await expect(sheet.getByRole('heading', { name: 'Client health' })).toBeInViewport();
  await expect.poll(() => topOffset(sheet)).toBeCloseTo(servicesStyle.inset, 0);

  await sheet.getByRole('button', { name: 'Back', exact: true }).click();

  await expect(sheet).toBeHidden();

  await page.goto('/?screen=calendar&surface=sheet');
  const calendar = page.getByRole('dialog', { name: 'Calendar', exact: true });

  await expect(calendar.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect.poll(() => topOffset(calendar)).toBeCloseTo(servicesStyle.inset, 0);
  await expect(calendar).toHaveCSS('border-top-left-radius', servicesStyle.radius);
});

test('Clients and Insights follow the visible viewport without reserving a bottom strip', async ({ page }) => {
  await page.goto('/?screen=clients&surface=sheet');
  await page.evaluate(() => {
    // Playwright's mobile projects do not have native browser bars or a keyboard.
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight - 80,
      offsetTop: 0,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
  });
  await page.addStyleTag({ content: ':root { --owner-sheet-safe-bottom: 34px; }' });
  await page.getByRole('button', { name: 'Open Clients' }).click();
  const sheet = page.getByRole('dialog', { name: 'Clients', exact: true });
  const scroller = sheet.getByTestId('app-modal-scroll-region');
  const bottomGaps = () => scroller.evaluate((region) => {
    const viewport = window.visualViewport!;
    const panelBottom = region.parentElement!.getBoundingClientRect().bottom;
    return {
      belowSheet: Math.round(viewport.offsetTop + viewport.height - panelBottom),
      belowScroller: Math.round(panelBottom - region.getBoundingClientRect().bottom),
    };
  });

  await expect(sheet.getByRole('button', { name: /SM Sofia Martin/ })).toBeVisible();
  await expect.poll(bottomGaps).toEqual({ belowSheet: 0, belowScroller: 0 });
  await expect(scroller).toHaveCSS('padding-bottom', '34px');

  await sheet.getByRole('tab', { name: 'Insights & Follow-ups' }).click();

  await expect(sheet.getByRole('heading', { name: 'Client health' })).toBeInViewport();

  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.assign(viewport, { height: window.innerHeight });
    viewport.dispatchEvent(new Event('resize'));
  });

  await expect.poll(bottomGaps).toEqual({ belowSheet: 0, belowScroller: 0 });

  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.assign(viewport, { height: window.innerHeight - 200 });
    viewport.dispatchEvent(new Event('resize'));
    Object.assign(viewport, { offsetTop: 24 });
    viewport.dispatchEvent(new Event('scroll'));
  });

  await expect.poll(bottomGaps).toEqual({ belowSheet: 0, belowScroller: 0 });
  await expect(sheet.getByRole('button', { name: 'Back', exact: true })).toBeInViewport();
});

test('services: search recovery and detail navigation preserve the catalog', async ({ page }) => {
  await page.goto('/?screen=services');
  const search = page.getByPlaceholder('Search services…');

  await expect(search).toHaveCSS('font-size', '16px');

  await search.fill('not-a-service');

  await expect(page.getByText('No matching services')).toBeVisible();

  await page.getByTestId('services-menu-search-clear').click();

  await expect(search).toHaveValue('');

  await page.getByText('Russian Manicure', { exact: true }).click();

  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByTestId('services-sticky-chrome')).toBeHidden();

  await noOverflow(page);
  await page.getByRole('button', { name: 'Services', exact: true }).click();

  await expect(search).toBeVisible();
});

for (const width of [320, 390, 430, 1280]) {
  test(`services: a scrolled catalog opens readable details and restores its place at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=services&state=long&surface=sheet');
    const scroller = page.getByTestId('app-modal-scroll-region');
    const row = page.getByTestId('service-row-svc_2');
    await row.scrollIntoViewIfNeeded();

    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(100);

    // The browser may finish layout or scroll the row while click() waits for
    // actionability. Record the same user click that the app uses to remember
    // its return position, before React replaces the catalog with the detail.
    await row.evaluate((element) => {
      element.addEventListener('click', () => {
        const scrollRegion = element.closest<HTMLElement>('[data-testid="app-modal-scroll-region"]');
        if (scrollRegion) {
          scrollRegion.dataset.testCatalogPosition = String(scrollRegion.scrollTop);
        }
      }, { capture: true, once: true });
    });
    await row.click();
    const catalogPosition = Number(await scroller.getAttribute('data-test-catalog-position'));

    expect(catalogPosition).toBeGreaterThan(100);

    await expect(page.getByTestId('services-sticky-chrome')).toBeHidden();
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);

    const detail = page.getByTestId('service-detail-root');
    const header = detail.locator(':scope > .sticky');
    const icon = page.getByTestId('service-detail-hero-icon');

    await expect.poll(async () => {
      const headerBox = await header.boundingBox();
      const iconBox = await icon.boundingBox();
      return Boolean(headerBox && iconBox && iconBox.y >= headerBox.y + headerBox.height && iconBox.y + iconBox.height <= 844 && iconBox.x >= 0 && iconBox.x + iconBox.width <= width);
    }).toBe(true);

    await page.getByRole('button', { name: 'Services', exact: true }).click();

    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(catalogPosition);
    await expect(row).toBeVisible();
  });
}

for (const screen of ['calendar', 'clients', 'services']) {
  test(`${screen}: empty and error states keep recovery controls readable`, async ({ page }) => {
    await page.goto(`/?screen=${screen}&state=empty`);

    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();

    await noOverflow(page);
    await page.goto(`/?screen=${screen}&state=error`);

    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();

    await noOverflow(page);
  });
}
