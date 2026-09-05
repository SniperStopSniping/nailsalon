import { expect, test } from '@playwright/test';

import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`Booking Page hub opens focused editors at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await impersonateSalonAsSuperAdmin(page);
    const hubUrl = `${appPath('/admin/website')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`;
    await page.goto(hubUrl);

    await expect(page.getByRole('heading', { name: 'Booking Page', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Booking Page editors' }).getByRole('link')).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto(`${appPath('/admin/booking-page')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&panel=text&guided=1`);

    await expect(page.getByText(/Guided review · Step 2 of 6/)).toBeVisible();
    await expect(page.getByTestId('booking-page-publish')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save & next step' }).click();

    await expect(page.getByRole('heading', { name: 'Policies & Booking Rules', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/panel=policies&guided=1/);

    await page.goto(hubUrl);

    await page.getByRole('link', { name: /Style & Colours The look/ }).click();

    await expect(page.getByRole('heading', { name: 'Style & Colours', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Choose your style' }).getByRole('button')).toHaveCount(6);
    await expect(page.getByRole('group', { name: 'Choose your colours' }).getByRole('button')).toHaveCount(8);
    await expect(page.getByTitle('Live booking page preview')).toHaveCount(0);

    await page.getByRole('button', { name: 'Booking Page', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Booking Page', exact: true })).toBeVisible();

    await page.getByRole('link', { name: /Your Information Business details/ }).click();
    await page.getByText('Contact', { exact: true }).click();

    await expect(page.getByRole('switch', { name: /Show phone/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
