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
    await expect(page.getByRole('navigation', { name: 'Booking Page editors' }).getByRole('link')).toHaveCount(7);
    await expect(page.getByText(/^Live · /)).toBeVisible();
    expect(await noHorizontalOverflow()).toBe(true);

    await page.goto(`${editorUrl}&panel=text&guided=1`);

    await expect(page.getByText('Guided review · Step 2 of 7 · Your current saved setup')).toBeVisible();
    await expect(page.getByTestId('booking-page-publish')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save & next step' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Photos & Gallery', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/panel=gallery&guided=1/);

    await page.getByRole('button', { name: 'Save & next step' }).click();

    await expect(page.getByRole('heading', { name: 'Policies & Booking Rules', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/panel=policies&guided=1/);

    await page.goto(hubUrl);

    await page.getByRole('link', { name: /Style & Colours/ }).click();

    await expect(page.getByRole('heading', { name: 'Style & Colours', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: /^Choose your style/ }).getByRole('button')).toHaveCount(6);
    await expect(page.getByRole('group', { name: 'Choose your colours' }).getByRole('button')).toHaveCount(8);
    await expect(page.getByTitle('Live booking page preview')).toHaveCount(0);

    await page.getByRole('button', { name: 'Booking Page', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Booking Page', exact: true })).toBeVisible();

    await page.getByRole('link', { name: /Business Info Display/ }).click();

    // Booking Page presents the canonical business record without exposing a
    // second editor. Owners follow the link to Settings for operational data.
    const informationEditor = page.getByTestId('booking-page-information-editor');

    await expect(informationEditor).toContainText(e2eConfig.salonName);
    await expect(page.getByTestId('information-business-name')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Edit business profile/ })).toHaveAttribute('href', /app=settings&view=business-profile/);
    expect(await noHorizontalOverflow()).toBe(true);

    await page.getByText('Contact', { exact: true }).click();

    await expect(page.getByRole('switch', { name: /Show phone/ })).toBeVisible();
    await expect(page.getByTestId('information-phone')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Edit contact details/ })).toHaveAttribute('href', /app=settings&view=business-profile/);

    await page.getByText('Location', { exact: true }).click();

    const privacyRadios = page.getByRole('radiogroup', { name: 'Address privacy' }).getByRole('radio');

    await expect(privacyRadios).toHaveCount(3);
    await expect(page.getByTestId('information-address-street')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Edit salon address/ })).toHaveAttribute('href', /app=settings&view=location/);

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

    await expect(page.getByTestId('information-timezone')).toHaveCount(0);
    await expect(page.getByTestId('information-hours-monday-open-toggle')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Edit business hours/ })).toHaveAttribute('href', /app=settings&view=business-profile/);
    expect(await noHorizontalOverflow()).toBe(true);

    // Photos & Gallery owns the three public image roles and links onward to
    // the reusable nail-work Portfolio without turning it into a logo store.
    await page.goto(hubUrl);
    await page.getByRole('link', { name: /Photos & Gallery/ }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Photos & Gallery', exact: true })).toBeVisible();
    await expect(page.getByTestId('photos-gallery-media-controls')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage Portfolio' })).toHaveAttribute('href', /app=portfolio/);
    await expect(page).toHaveURL(/panel=gallery/);
  });
}
