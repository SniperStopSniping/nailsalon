import { expect, type Page, test } from '@playwright/test';

import { acknowledgeBookingPolicy, selectBookableSlotFromApi } from './support/booking';
import { appPath, appPathPattern, e2eConfig, uniqueCustomerPhone } from './support/config';

async function continueFromService(page: Page) {
  const optionsDone = page.getByTestId('service-options-done-button');
  if (await optionsDone.isVisible().catch(() => false)) {
    await optionsDone.click();
  }
  await page.getByTestId('service-continue-button').click();
}

test('guest can book without OTP and receive an appointment management link', async ({ page }) => {
  test.slow();

  const phone = uniqueCustomerPhone();
  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: /book an appointment|choose your service/i })).toBeVisible();
  await expect(page.getByTestId('booking-login-phone')).toHaveCount(0);

  await page.getByTestId(`service-card-${e2eConfig.serviceId}`).click();
  await page.getByTestId(`service-add-button-${e2eConfig.serviceId}`).click();
  await continueFromService(page);
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

  await acknowledgeBookingPolicy(page);
  await page.getByRole('button', { name: /confirm appointment/i }).click();

  const bookingResponse = await bookingResponsePromise;
  const bookingBody = await bookingResponse.json();
  const manageUrl = bookingBody?.data?.manageUrl as string | undefined;

  expect(manageUrl).toBeTruthy();

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /manage this appointment/i })).toBeVisible();

  const token = new URL(manageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const cancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(token!)}`, {
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(cancellation.ok(), await cancellation.text()).toBeTruthy();
});

test('a guest can manage multiple upcoming appointments', async ({ page }) => {
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
      await page.getByTestId(`service-add-button-${e2eConfig.serviceId}`).click();
      await continueButton.waitFor({ timeout: 3000 }).catch(() => {});
    }
    await continueFromService(page);
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
  await acknowledgeBookingPolicy(page);
  await page.getByRole('button', { name: /confirm appointment/i }).click();
  const firstBody = await (await firstBookingResponse).json();
  const firstManageUrl = firstBody?.data?.manageUrl as string | undefined;

  expect(firstManageUrl).toBeTruthy();

  // A second appointment for the same guest remains a separate booking.
  await walkToConfirm();
  await page.getByLabel('Customer name').fill(`Guest ${phone.slice(-4)}`);
  await page.getByLabel('Customer email').fill(email);
  await page.getByLabel('Customer phone').fill(phone);
  const secondBookingResponse = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 201
  ));
  await acknowledgeBookingPolicy(page);
  await page.getByRole('button', { name: /confirm appointment/i }).click();
  const secondBody = await (await secondBookingResponse).json();
  const secondManageUrl = secondBody?.data?.manageUrl as string | undefined;

  expect(secondManageUrl).toBeTruthy();
  expect(secondManageUrl).not.toBe(firstManageUrl);
  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();

  // Both private links stay usable; clean up the disposable appointments.
  const firstToken = new URL(firstManageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const secondToken = new URL(secondManageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const [firstManage, secondManage] = await Promise.all([
    page.request.get(`/api/public/appointments/manage/${encodeURIComponent(firstToken!)}`),
    page.request.get(`/api/public/appointments/manage/${encodeURIComponent(secondToken!)}`),
  ]);

  expect(firstManage.ok(), await firstManage.text()).toBeTruthy();
  expect(secondManage.ok(), await secondManage.text()).toBeTruthy();

  const firstCancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(firstToken!)}`, {
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(firstCancellation.ok(), await firstCancellation.text()).toBeTruthy();

  const secondCancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(secondToken!)}`, {
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(secondCancellation.ok(), await secondCancellation.text()).toBeTruthy();
});
