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

test('duplicate booking offers recovery options and a server-verified retry path', async ({ page }) => {
  test.slow();

  const phone = uniqueCustomerPhone();
  const email = `guest+${Date.now()}@example.com`;

  async function walkToConfirm() {
    await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
      waitUntil: 'domcontentloaded',
    });
    // Selection persists across visits in this tab, and a click that lands
    // before hydration is lost — so select until the continue button shows.
    const serviceCard = page.getByTestId(`service-card-${e2eConfig.serviceId}`);
    const continueButton = page.getByTestId('service-continue-button');
    await serviceCard.waitFor();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await continueButton.isVisible().catch(() => false)) {
        break;
      }
      await serviceCard.click();
      await continueButton.waitFor({ timeout: 3000 }).catch(() => {});
    }
    await continueButton.click();
    await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);
    if (appPathPattern('/book/tech').test(page.url())) {
      await page.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName, 'i') }).click();
    }

    await expect(page).toHaveURL(appPathPattern('/book/time'));

    const timeStepUrl = new URL(page.url());
    const technicianId = timeStepUrl.searchParams.get('techId');
    await selectBookableSlotFromApi(page, {
      technicianId: technicianId && technicianId !== 'any' ? technicianId : null,
      startDayOffset: 4,
      baseServiceId: timeStepUrl.searchParams.get('baseServiceId'),
      locationId: timeStepUrl.searchParams.get('locationId'),
      selectedAddOns: timeStepUrl.searchParams.get('selectedAddOns'),
    });

    await expect(page).toHaveURL(appPathPattern('/book/confirm'));
  }

  // First booking succeeds.
  await walkToConfirm();
  await page.getByLabel('Customer name').fill(`Guest ${phone.slice(-4)}`);
  await page.getByLabel('Customer email').fill(email);
  await page.getByLabel('Customer phone').fill(phone);
  const firstBookingResponse = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 201
  ));
  await page.getByRole('button', { name: /confirm appointment/i }).click();
  const firstBody = await (await firstBookingResponse).json();
  const firstManageUrl = firstBody?.data?.manageUrl as string | undefined;

  expect(firstManageUrl).toBeTruthy();

  // Second attempt with the same phone hits the duplicate gate and shows options.
  await walkToConfirm();
  await page.getByLabel('Customer name').fill(`Guest ${phone.slice(-4)}`);
  await page.getByLabel('Customer email').fill(email);
  await page.getByLabel('Customer phone').fill(phone);
  const duplicateResponse = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 409
  ));
  await page.getByRole('button', { name: /confirm appointment/i }).click();
  const duplicateBody = await (await duplicateResponse).json();

  // Anti-enumeration: the 409 body carries no appointment id or date.
  expect(JSON.stringify(duplicateBody)).not.toContain('existingAppointment');

  await expect(page.getByText('You already have a booking')).toBeVisible();

  // Self-serve link recovery from the options screen.
  await page.getByTestId('existing-appointment-send-link').click();

  await expect(page.getByTestId('existing-appointment-sent')).toContainText('Request received');

  // Editing contact info returns to the form with details preserved.
  await page.getByTestId('existing-appointment-edit-contact').click();

  await expect(page.getByRole('heading', { name: /review your appointment/i })).toBeVisible();
  await expect(page.getByLabel('Customer phone')).toHaveValue(phone);

  // Free the phone by cancelling the first appointment, then retry: the
  // server re-verifies and lets the booking through.
  const firstToken = new URL(firstManageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const firstCancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(firstToken!)}`, {
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(firstCancellation.ok(), await firstCancellation.text()).toBeTruthy();

  const retryResponse = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 201
  ));
  await page.getByRole('button', { name: /confirm appointment/i }).click();
  const retryBody = await (await retryResponse).json();

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();

  // Clean up the appointment created by the retry.
  const retryManageUrl = retryBody?.data?.manageUrl as string | undefined;
  const retryToken = new URL(retryManageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const cleanup = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(retryToken!)}`, {
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(cleanup.ok(), await cleanup.text()).toBeTruthy();
});
