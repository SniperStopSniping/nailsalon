import { expect, type Page, test } from '@playwright/test';

import { acknowledgeBookingPolicy, selectBookableSlotFromApi } from './support/booking';
import { appPath, appPathPattern, e2eBaseUrl, e2eConfig, uniqueCustomerPhone } from './support/config';

const e2eOrigin = new URL(e2eBaseUrl).origin;

async function continueFromService(page: Page) {
  await page.getByTestId('service-continue-button').click();
}

test('a selected add-on keeps its price and duration through Time and Confirm', async ({ page }) => {
  test.slow();

  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, { waitUntil: 'domcontentloaded' });
  const serviceCard = page.getByTestId(`service-card-${e2eConfig.serviceId}`);

  await expect(serviceCard).toBeEnabled();

  await serviceCard.click();
  await page.getByRole('button', { name: 'Increase Nail Repair quantity' }).click();

  const sticky = page.getByTestId('service-sticky-bar');
  const reviewedPrice = (await sticky.getByTestId('service-sticky-price').textContent())?.trim();
  const reviewedDuration = (await sticky.getByTestId('service-sticky-duration').textContent())?.trim();

  expect(reviewedPrice).toBeTruthy();
  expect(reviewedDuration).toBeTruthy();
  await expect(sticky).toContainText('1 service + 1 add-on');

  await continueFromService(page);
  await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);

  if (appPathPattern('/book/tech').test(page.url())) {
    await page.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName, 'i') }).click();
  }

  await expect(page).toHaveURL(appPathPattern('/book/time'));

  const timeUrl = new URL(page.url());
  const selected = JSON.parse(timeUrl.searchParams.get('selectedAddOns') ?? 'null');

  expect(selected).toEqual([{ addOnId: expect.any(String), quantity: 1 }]);
  await expect(page.getByTestId('booking-summary-price')).toContainText(reviewedPrice!);
  await expect(page.getByTestId('booking-summary-duration')).toContainText(reviewedDuration!);

  const technicianId = timeUrl.searchParams.get('techId');

  await selectBookableSlotFromApi(page, {
    technicianId: technicianId && technicianId !== 'any' ? technicianId : null,
    startDayOffset: 3,
    baseServiceId: timeUrl.searchParams.get('baseServiceId'),
    locationId: timeUrl.searchParams.get('locationId'),
    selectedAddOns: timeUrl.searchParams.get('selectedAddOns'),
  });

  await expect(page).toHaveURL(appPathPattern('/book/confirm'));

  const review = page.getByTestId('booking-review-summary');

  await expect(review).toContainText('Nail Repair');
  await expect(review).toContainText(reviewedDuration!);

  const closing = page.getByTestId('booking-review-closing');

  await expect(closing).toContainText('Estimated appointment total');
  await expect(closing).toContainText(reviewedPrice!);
});

test('recovers a committed v2 booking after its 201 response is lost without creating twice', async ({ page }) => {
  test.slow();

  let createRequests = 0;
  let committedStatus: number | null = null;
  let committedReceipt: any;
  let attemptId: string | undefined;
  let recoveryKey: string | undefined;
  let statusRequests = 0;

  await page.route('**/api/appointments', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    createRequests += 1;
    attemptId = route.request().headers()['idempotency-key'];
    recoveryKey = route.request().headers()['x-booking-recovery-key'];

    expect(route.request().headers()['x-booking-attempt-version']).toBe('2');

    // Let the real handler commit and capture its authoritative 201, then
    // drop the response before the browser can observe it.
    const committed = await route.fetch();

    committedStatus = committed.status();

    expect(committedStatus).toBe(201);

    committedReceipt = await committed.json();
    await route.abort('connectionreset');
  });
  await page.route('**/api/public/booking-attempt/*/status', async (route) => {
    statusRequests += 1;
    await route.continue();
  });

  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId(`service-card-${e2eConfig.serviceId}`).click();
  await continueFromService(page);
  await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);

  if (appPathPattern('/book/tech').test(page.url())) {
    await page.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName, 'i') }).click();
  }

  await expect(page).toHaveURL(appPathPattern('/book/time'));

  const timeUrl = new URL(page.url());

  await selectBookableSlotFromApi(page, {
    technicianId: timeUrl.searchParams.get('techId'),
    startDayOffset: 3,
    baseServiceId: timeUrl.searchParams.get('baseServiceId'),
    locationId: timeUrl.searchParams.get('locationId'),
    selectedAddOns: timeUrl.searchParams.get('selectedAddOns'),
  });

  await expect(page).toHaveURL(appPathPattern('/book/confirm'));

  const phone = uniqueCustomerPhone();

  await page.getByLabel('Customer name').fill(`Recovery ${phone.slice(-4)}`);
  await page.getByLabel('Customer email').fill(`recovery+${Date.now()}@example.com`);
  await page.getByLabel('Customer phone').fill(phone);
  await acknowledgeBookingPolicy(page);
  const recoveredStatusResponsePromise = page.waitForResponse(response => (
    response.url().includes(`/api/public/booking-attempt/`)
    && response.url().endsWith('/status')
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: /confirm appointment/i }).click();

  await expect(page.getByRole('heading', { name: 'Booking received', exact: true })).toBeVisible({ timeout: 30_000 });

  const recoveredStatusResponse = await recoveredStatusResponsePromise;

  expect(recoveredStatusResponse.ok()).toBe(true);

  const recoveredResult = await recoveredStatusResponse.json();
  const committedAppointmentId = committedReceipt?.data?.appointmentId as string | undefined;

  expect(committedAppointmentId, 'The lost 201 must contain a committed appointment ID.').toBeTruthy();

  expect(recoveredResult).toMatchObject({
    kind: 'resolved_success',
    response: {
      data: {
        appointmentId: committedAppointmentId,
        appointment: { status: committedReceipt?.data?.appointment?.status },
      },
      meta: { recovered: true },
    },
  });
  await expect.poll(() => statusRequests).toBeGreaterThan(0);
  expect(committedStatus).toBe(201);
  expect(attemptId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(recoveryKey).toMatch(/^[0-9a-f-]{36}$/i);
  await expect.poll(() => createRequests).toBe(1);
  await expect(page.getByRole('link', { name: 'View booking details', exact: true })).toBeVisible();

  const attemptRecord = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(item => item.startsWith('luster.public-booking-attempt.v1.'));
    const raw = key ? sessionStorage.getItem(key) : null;
    return raw ? JSON.parse(raw) as { attemptId?: string; state?: string; response?: { data?: { appointmentId?: string; appointment?: { status?: string } } } } : null;
  });

  expect(attemptRecord).toMatchObject({
    attemptId,
    state: 'resolved',
    response: {
      data: {
        appointmentId: expect.any(String),
        appointment: { status: expect.any(String) },
      },
    },
  });

  const manageUrl = committedReceipt?.data?.manageUrl as string | undefined;

  expect(manageUrl).toBeTruthy();

  const token = new URL(manageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const cancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(token!)}`, {
    headers: { Origin: e2eOrigin },
    data: { action: 'cancel', reason: 'client_request' },
  });

  const cancellationResult = await cancellation.json();

  expect(cancellation.ok(), JSON.stringify(cancellationResult)).toBeTruthy();
  expect(cancellationResult).toMatchObject({ data: { status: 'cancelled' } });

  const managedAfterCancellation = await page.request.get(
    `/api/public/appointments/manage/${encodeURIComponent(token!)}`,
  );

  const managedResult = await managedAfterCancellation.json();

  expect(managedAfterCancellation.ok(), JSON.stringify(managedResult)).toBeTruthy();
  expect(managedResult).toMatchObject({
    data: { appointment: { id: committedAppointmentId, status: 'cancelled' } },
  });
});

test('guest can book without OTP and receive an appointment management link', async ({ page }) => {
  test.slow();

  const phone = uniqueCustomerPhone();
  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: /book an appointment|choose your service/i })).toBeVisible();
  await expect(page.getByTestId('booking-login-phone')).toHaveCount(0);

  await page.getByTestId(`service-card-${e2eConfig.serviceId}`).click();
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

  const originalConfirmationUrl = page.url();

  await expect(page.getByRole('heading', { name: 'Review & confirm', exact: true })).toBeVisible();

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
  const originalAppointmentId = bookingBody?.data?.appointmentId as string | undefined;

  expect(manageUrl).toBeTruthy();
  expect(originalAppointmentId).toBeTruthy();

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage appointment', exact: true })).toBeVisible();

  const token = new URL(manageUrl!, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const cancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(token!)}`, {
    headers: { Origin: e2eOrigin },
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(cancellation.ok(), await cancellation.text()).toBeTruthy();

  // A completed receipt is kept for refresh recovery. Starting Services again
  // must retire it even when the new selection reaches the identical URL.
  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId(`service-card-${e2eConfig.serviceId}`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
    .filter(key => key.startsWith('luster.public-booking-attempt.v1.')).length)).toBe(0);

  await page.goto(originalConfirmationUrl, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Review & confirm', exact: true })).toBeVisible();

  await page.getByLabel('Customer name').fill(`Guest ${phone.slice(-4)}`);
  await page.getByLabel('Customer email').fill(`guest+${Date.now()}@example.com`);
  await page.getByLabel('Customer phone').fill(phone);
  await acknowledgeBookingPolicy(page);

  const rebookingResponsePromise = page.waitForResponse(response => (
    response.url().includes('/api/appointments')
    && response.request().method() === 'POST'
    && response.status() === 201
  ));
  await page.getByRole('button', { name: /confirm appointment/i }).click();

  const rebookingResponse = await rebookingResponsePromise;
  const rebookingBody = await rebookingResponse.json();

  expect(rebookingBody?.data?.appointmentId).toBeTruthy();
  expect(rebookingBody.data.appointmentId).not.toBe(originalAppointmentId);

  const rebookingManageUrl = rebookingBody?.data?.manageUrl as string | undefined;
  const rebookingToken = rebookingManageUrl && new URL(rebookingManageUrl, page.url()).pathname.split('/').filter(Boolean).at(-1);

  expect(rebookingToken).toBeTruthy();

  const rebookingCancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(rebookingToken!)}`, {
    headers: { Origin: e2eOrigin },
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(rebookingCancellation.ok(), await rebookingCancellation.text()).toBeTruthy();
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
    headers: { Origin: e2eOrigin },
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(firstCancellation.ok(), await firstCancellation.text()).toBeTruthy();

  const secondCancellation = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(secondToken!)}`, {
    headers: { Origin: e2eOrigin },
    data: { action: 'cancel', reason: 'client_request' },
  });

  expect(secondCancellation.ok(), await secondCancellation.text()).toBeTruthy();
});
