import { expect, test } from '@playwright/test';

import { appPath, e2eConfig } from './support/config';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

for (const browserTag of ['@mobile-chrome', '@mobile-safari']) {
  test(`compact confirmation requires the default agreement and keeps receipt actions usable ${browserTag}`, async ({ page }, testInfo) => {
    test.slow();

    let submitted: Record<string, unknown> | undefined;
    const manageUrl = appPath(`/${e2eConfig.salonSlug}/manage/local-layout-fixture`);
    await page.route('**/api/appointments', async (route) => {
      expect(route.request().method()).toBe('POST');

      submitted = route.request().postDataJSON();
      // Exercise the receipt without creating an appointment or sending messages.
      await route.fulfill({
        status: 201,
        json: { data: { appointment: { id: 'layout-fixture', status: 'confirmed' }, manageUrl } },
      });
    });
    const params = new URLSearchParams({
      salonSlug: e2eConfig.salonSlug,
      serviceIds: e2eConfig.serviceId,
      techId: 'any',
      date: '2030-03-20',
      time: '10:00',
    });
    await page.goto(`${appPath('/book/confirm')}?${params}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Review your appointment' })).toBeVisible();

    const name = page.getByLabel('Customer name');

    await expect.poll(() => name.evaluate(element => Object.keys(element).some(key => key.startsWith('__reactProps$')))).toBe(true);

    await name.fill('Layout Test');
    await page.getByLabel('Customer email').fill('layout@example.invalid');
    await page.getByLabel('Customer phone').fill('4165550199');

    const agreement = page.getByTestId('booking-policy-before-confirmation');
    const checkbox = agreement.getByRole('checkbox');
    const confirm = page.getByRole('button', { name: /confirm appointment/i });

    await expect(agreement).toContainText('Please arrive on time.');
    await expect(agreement).not.toContainText(/banned|no.shows/i);
    await expect(checkbox).not.toBeChecked();
    await expect(confirm).toBeDisabled();
    await expect(page.getByText(/block duplicate bookings/)).toHaveCount(0);

    await checkbox.check();

    await expect(confirm).toBeEnabled();
    await expect.poll(() => confirm.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect.poll(() => confirm.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(48);

    await page.evaluate(() => window.scrollTo(0, 0));

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
    await confirm.click();

    await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();
    expect(submitted?.bookingPolicyAcknowledgment).toMatchObject({
      accepted: true,
      version: expect.stringMatching(/^policy-v1:/),
    });

    const manage = page.getByRole('link', { name: 'Manage this appointment' });

    await expect(manage).toHaveAttribute('href', manageUrl);
    await expect.poll(() => manage.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect.poll(() => manage.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(48);
    await expect(page.getByRole('link', { name: 'Apple Calendar' })).toHaveAttribute('href', `${manageUrl}/calendar.ics`);
    await expect(page.getByRole('button', { name: 'Back to booking' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(manage.locator('..')).toHaveCSS('opacity', '1');
    await expect(page.getByText('We’re looking forward to your visit.').locator('../..')).toHaveCSS('opacity', '1');

    await page.evaluate(() => window.scrollTo(0, 0));

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    await page.screenshot({ path: testInfo.outputPath('receipt.png'), fullPage: true });
  });
}
