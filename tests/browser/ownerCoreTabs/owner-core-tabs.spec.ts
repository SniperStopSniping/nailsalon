import type { Page } from '@playwright/test';
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
