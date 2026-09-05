import { expect, test } from '@playwright/test';

import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`Booking Page hub opens focused editors at ${viewport.width}px @owner-preview-webkit`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await impersonateSalonAsSuperAdmin(page);
    const hubUrl = `${appPath('/admin/website')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`;
    const editorUrl = `${appPath('/admin/booking-page')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`;
    const noHorizontalOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    await page.goto(hubUrl);

    await expect(page.getByRole('heading', { name: 'Booking Page', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Booking Page editors' }).getByRole('link')).toHaveCount(6);
    await expect(page.getByText(/^Live · /)).toBeVisible();
    expect(await noHorizontalOverflow()).toBe(true);

    await page.goto(`${editorUrl}&panel=text&guided=1`);

    await expect(page.getByText('Guided review · Step 2 of 6 · Your current saved setup')).toBeVisible();
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

    // Actual saved values load into the accordions (owner-only route).
    await expect(page.getByTestId('information-business-name')).toHaveValue(e2eConfig.salonName);
    await expect(page.getByTestId('information-public-url')).toContainText(e2eConfig.salonSlug);
    expect(await noHorizontalOverflow()).toBe(true);

    await page.getByText('Contact', { exact: true }).click();

    await expect(page.getByRole('switch', { name: /Show phone/ })).toBeVisible();
    await expect(page.getByTestId('information-phone')).not.toHaveValue('');

    // Edit → save → the canonical value comes back from the same salon record.
    // The shared fixture is restored in `finally` so a failure mid-journey
    // cannot leave the other viewport/project cases with a changed salon.
    const instagram = page.getByTestId('information-instagram');
    const originalInstagram = await instagram.inputValue();
    try {
      await instagram.fill('luster.e2e.fixture');
      await page.getByTestId('information-save-contact').click();

      await expect(instagram).toHaveValue('https://www.instagram.com/luster.e2e.fixture/');
    } finally {
      await instagram.fill(originalInstagram);
      await page.getByTestId('information-save-contact').click();

      await expect(page.getByTestId('information-contact').getByRole('status')).toContainText('Contact saved');
      await expect(instagram).toHaveValue(originalInstagram);
    }

    await page.getByText('Location', { exact: true }).click();

    const privacyRadios = page.getByRole('radiogroup', { name: 'Address privacy' }).getByRole('radio');

    await expect(privacyRadios).toHaveCount(3);
    await expect(page.getByTestId('information-address-street')).not.toHaveValue('');

    // Toggle away from whatever is saved, prove it persists across a reload,
    // then restore the original choice in `finally`.
    const initialPrivacy = await privacyRadios.and(page.locator('input:checked')).getAttribute('value');
    const targetPrivacy = initialPrivacy === 'after_booking' ? 'city_only' : 'after_booking';

    try {
      await page.getByTestId(`address-privacy-${targetPrivacy}`).click();

      await expect(page.getByTestId(`address-privacy-${targetPrivacy}`)).toBeChecked();
      await expect(page.getByRole('status').filter({ hasText: /^Saved$/ }).first()).toBeVisible();

      await page.reload();
      await page.getByText('Location', { exact: true }).click();

      await expect(page.getByTestId(`address-privacy-${targetPrivacy}`)).toBeChecked();
      await expect(page.getByTestId('address-privacy-unpublished')).toBeVisible();
    } finally {
      await page.getByTestId(`address-privacy-${initialPrivacy}`).click();

      await expect(page.getByTestId(`address-privacy-${initialPrivacy}`)).toBeChecked();
      await expect(page.getByRole('status').filter({ hasText: /^Saved$/ }).first()).toBeVisible();

      await page.reload();
      await page.getByText('Location', { exact: true }).click();

      await expect(page.getByTestId(`address-privacy-${initialPrivacy}`)).toBeChecked();
    }

    await page.getByText('Hours', { exact: true }).click();

    await expect(page.getByTestId('information-timezone')).toBeVisible();
    await expect(page.getByTestId('information-hours-monday-open-toggle')).toBeVisible();
    expect(await noHorizontalOverflow()).toBe(true);

    // Photos & Gallery reuses the shared Portfolio library rather than a copy.
    await page.goto(hubUrl);
    await page.getByRole('link', { name: /Photos & Gallery/ }).click();

    await expect(page.getByTestId('app-modal-panel').getByText('Portfolio', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/app=portfolio/);
  });
}
