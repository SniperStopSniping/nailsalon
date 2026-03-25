import { expect, test } from '@playwright/test';

import { cancelAppointmentViaApi, ensureTimeSlotVisible, pickFirstVisibleTimeSlot } from './support/booking';
import { appPath, appPathPattern, e2eConfig, uniqueCustomerPhone } from './support/config';

test('customer can log in with OTP, book, and reach the confirmation state', async ({ page }) => {
  test.slow();
  const phone = uniqueCustomerPhone();
  let appointmentId: string | null = null;

  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: /choose your services/i })).toBeVisible();
  const phoneInput = page.getByTestId('booking-login-phone');
  await expect(phoneInput).toBeVisible();
  await phoneInput.fill(phone);
  await expect(page.getByTestId('booking-login-code')).toBeVisible();
  await page.getByTestId('booking-login-code').fill(e2eConfig.customerOtpCode);

  const sessionResult = await page.evaluate(async () => {
    const response = await fetch('/api/auth/validate-session', { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      body,
    };
  });

  expect(sessionResult.ok, JSON.stringify(sessionResult.body)).toBeTruthy();

  await page.goto(
    `${appPath('/book/tech')}?salonSlug=${e2eConfig.salonSlug}&serviceIds=${encodeURIComponent(e2eConfig.serviceId)}`,
    { waitUntil: 'domcontentloaded' },
  );

  await expect(page).toHaveURL(appPathPattern('/book/tech'));
  await page.getByRole('button', { name: /surprise me with any available artist/i }).click({ force: true });

  await expect(page).toHaveURL(appPathPattern('/book/time'));
  await ensureTimeSlotVisible(page);
  await pickFirstVisibleTimeSlot(page);

  await expect(page).toHaveURL(appPathPattern('/book/confirm'));
  await expect(page.getByRole('heading', { name: /review your appointment/i })).toBeVisible();

  const bookingResponsePromise = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 201
  ));

  await page.getByRole('button', { name: /confirm appointment/i }).click();

  const bookingResponse = await bookingResponsePromise;
  const bookingBody = await bookingResponse.json();
  appointmentId = bookingBody?.data?.appointment?.id ?? null;

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /manage this appointment/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /view rewards & pending points/i })).toBeVisible();

  if (appointmentId) {
    await cancelAppointmentViaApi(page, appointmentId);
  }
});
