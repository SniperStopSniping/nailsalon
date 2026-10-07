import { expect, test } from '@playwright/test';

import { mockApi } from './fixtures';

test('experience is mobile canonical and Flow fails closed for Free Solo', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/?salon=isla&panel=experience');

  await expect(page.getByLabel('Booking message')).toHaveValue('Welcome');
  await expect(page.getByText('Legacy Page Themes')).toHaveCount(0);
  await expect(page.getByText(/Website styles, colours, and fonts are set in Booking Page/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Style, Colours & Fonts' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto('/?salon=isla&panel=flow');

  await expect(page.getByTestId('booking-flow-unavailable')).toContainText('not included with Free Solo');

  await page.getByRole('button', { name: 'Booking Page' }).click();

  await expect(page).toHaveURL(/\/en\/admin\/website\?salon=isla$/);
});

test('legacy Booking Page links replace to the hub and Layout & Menu owns presentation controls at 320 and 390px', async ({ page }) => {
  await mockApi(page, false);

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?salon=isla&returnTo=calendar');

    await expect(page).toHaveURL('/en/admin/website?salon=isla&returnTo=calendar');

    await page.goto('/?salon=isla&panel=layouts');

    await expect(page.getByRole('heading', { level: 1, name: 'Layout & Menu', exact: true })).toBeVisible();
    await expect(page.getByTestId('booking-page-preset-picker')).toBeVisible();

    const advancedBusinessSetup = page.getByTestId('business-type-advanced');

    await expect(advancedBusinessSetup).not.toHaveAttribute('open', '');
    await expect(advancedBusinessSetup.getByTestId('business-mode-option-solo')).toBeHidden();

    await advancedBusinessSetup.locator('summary').click();

    await expect(advancedBusinessSetup).toHaveAttribute('open', '');
    await expect(advancedBusinessSetup.getByTestId('business-mode-option-solo')).toBeVisible();
    await expect(page.getByTestId('booking-page-builder')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('team Flow stays closed while its scoped access check is pending', async ({ page }) => {
  await mockApi(page, false, 250);
  await page.goto('/?salon=isla&panel=flow');

  await expect(page.getByRole('status')).toContainText('Checking booking flow access');
  await expect(page.getByText('Customize Booking Flow')).toHaveCount(0);
  await expect(page.getByText('Customize Booking Flow')).toBeVisible();
});
