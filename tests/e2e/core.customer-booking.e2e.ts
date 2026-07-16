import { expect, test } from '@playwright/test';

import { selectBookableSlotFromApi } from './support/booking';
import { appPath, appPathPattern, e2eConfig, uniqueCustomerPhone } from './support/config';

test('guest can book without OTP and receive an appointment management link', async ({ page }) => {
  test.slow();

  const phone = uniqueCustomerPhone();
  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: /choose your service/i })).toBeVisible();
  await expect(page.getByTestId('booking-login-phone')).toHaveCount(0);

  await page.getByTestId(`service-card-${e2eConfig.serviceId}`).click();
  await page.getByTestId('service-continue-button').click();
  await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);

  if (appPathPattern('/book/tech').test(page.url())) {
    const technicianCard = page.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName, 'i') });

    await expect(technicianCard).toBeVisible();

    await technicianCard.click();
  }

  await expect(page).toHaveURL(appPathPattern('/book/time'));
  await expect(page.getByTestId('booking-summary-service')).toContainText(e2eConfig.serviceName);

  const timeStepPrice = (await page.getByTestId('booking-summary-price').textContent())?.trim();

  expect(timeStepPrice).toBeTruthy();

  const timeStepUrl = new URL(page.url());
  const technicianId = timeStepUrl.searchParams.get('techId');
  await selectBookableSlotFromApi(page, {
    technicianId: technicianId && technicianId !== 'any' ? technicianId : null,
    startDayOffset: 3,
    baseServiceId: timeStepUrl.searchParams.get('baseServiceId'),
    locationId: timeStepUrl.searchParams.get('locationId'),
    selectedAddOns: timeStepUrl.searchParams.get('selectedAddOns'),
  });

  await expect(page).toHaveURL(appPathPattern('/book/confirm'));
  await expect(page.getByRole('heading', { name: /review your appointment/i })).toBeVisible();

  await page.getByLabel('Customer name').fill(`Guest ${phone.slice(-4)}`);
  await page.getByLabel('Customer email').fill(`guest+${Date.now()}@example.com`);
  await page.getByLabel('Customer phone').fill(phone);

  await expect(page.getByRole('button', { name: /confirm appointment/i })).toContainText(timeStepPrice!);

  const bookingResponsePromise = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 201
  ));

  await page.getByRole('button', { name: /confirm appointment/i }).click();

  const bookingResponse = await bookingResponsePromise;
  const bookingBody = await bookingResponse.json();
  const manageUrl = bookingBody?.data?.manageUrl as string | undefined;

  expect(manageUrl).toBeTruthy();

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /manage this appointment/i })).toBeVisible();

  const token = new URL(manageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const cancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(token!)}`, {
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(cancellation.ok(), await cancellation.text()).toBeTruthy();
});
