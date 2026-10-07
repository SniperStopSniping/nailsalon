import { expect, test } from '@playwright/test';

import { mockApi } from './fixtures';

async function sections(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: /^Sections/ });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') {
    await toggle.click();
  }
  return page.getByRole('navigation', { name: 'Booking Page editors' });
}

for (const width of [320, 390, 1440]) {
  test(`Isla editor scope and navigation at ${width}px`, async ({ page }, testInfo) => {
    const control = await mockApi(page, false, 0, 'isla-nail-studio');
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?salon=isla-nail-studio&panel=layouts');

    await expect(page.getByRole('heading', { level: 1, name: 'Custom Layout & Menu' })).toBeVisible();
    await expect(page.getByTestId('booking-page-preset-picker')).toHaveCount(0);
    await expect(page.getByTestId('booking-page-builder')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Booking menu layout' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit services, prices & add-ons' })).toHaveAttribute('href', '/en/admin?salon=isla-nail-studio&app=services');

    for (const [title, panel] of [
      ['Booking Step Style', 'appearance'],
      ['Custom Page Copy', 'text'],
      ['Profile & Portfolio', 'gallery'],
      ['Business Details & Privacy', 'information'],
      ['Policies Display', 'policies'],
    ]) {
      await (await sections(page)).getByRole('link', { name: title, exact: true }).press('Enter');

      await expect(page).toHaveURL(new RegExp(`panel=${panel}$`));
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      if (panel === 'appearance') {
        await expect(page.getByText(/These styles apply after service selection/)).toBeVisible();
        await expect(page.getByRole('group', { name: 'Choose your colours' })).toBeVisible();
      } else if (panel === 'text') {
        await expect(page.getByTestId('content-bio')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Edit booking message & social links' })).toBeVisible();
      } else if (panel === 'gallery') {
        await expect(page.getByTestId('information-cover-upload')).toHaveCount(0);
      } else {
        await expect(page.getByRole('switch')).toHaveCount(0);
      }

      await page.screenshot({ path: testInfo.outputPath(`isla-${panel}-${width}.png`), fullPage: true });
    }

    await (await sections(page)).getByRole('link', { name: 'Custom Page Copy', exact: true }).click();
    await page.addStyleTag({ content: 'html { font-size: 200%; letter-spacing: .12em; }' });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(control.patches).toHaveLength(0);
  });
}
