import { expect, type Page, test, type TestInfo } from '@playwright/test';
import { Client } from 'pg';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '../../../src/libs/disposableDatabaseTarget';
import { getDateKeyInTimeZone } from '../../../src/libs/timeZone';
import { openAdminAppointmentSheet, openAdminBookings } from '../../e2e/support/appointment-ops';
import { acknowledgeBookingPolicy } from '../../e2e/support/booking';
import { authStatePaths, e2eBaseUrl, e2eConfig, uniqueCustomerPhone } from '../../e2e/support/config';

// Protect this file even if collected through the repository's broad E2E config.
requireDisposableDatabaseTarget(process.env);
const targetUrl = new URL(e2eBaseUrl);
if (targetUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(targetUrl.hostname)) {
  throw new Error('The audit lifecycle suite requires an isolated local HTTP application.');
}

async function capture(page: Page, info: TestInfo, reference: string) {
  await page.screenshot({ path: info.outputPath(`${reference}.png`), fullPage: true, animations: 'disabled' });
  await info.attach(reference, { path: info.outputPath(`${reference}.png`), contentType: 'image/png' });

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}

async function storedAppointments(email: string) {
  const target = requireDisposableDatabaseTarget(process.env);
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    await attestDisposableDatabaseSession(client, target, resolveDisposableDatabaseServerExpectation(target));
    return (await client.query<{
      id: string;
      status: string;
      start_time: Date;
      salon_client_id: string;
      total_duration_minutes: number;
    }>('SELECT id, status, start_time, salon_client_id, total_duration_minutes FROM appointment WHERE client_email = $1 ORDER BY created_at', [email])).rows;
  } finally {
    await client.end();
  }
}

async function bookThroughUi(page: Page, email: string, info: TestInfo) {
  await page.goto(`/book/service?salonSlug=${e2eConfig.salonSlug}`);
  await page.getByTestId(`service-card-${e2eConfig.serviceId}`).click();
  await page.getByTestId('service-continue-button').click();
  await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);
  if (new URL(page.url()).pathname.endsWith('/tech')) {
    await page.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName) }).click();
  }

  await expect(page).toHaveURL(/\/book\/time/);

  // Choose through calendar controls, not an availability API or query override.
  const date = new Date();
  date.setDate(date.getDate() + 4);
  const dateKey = getDateKeyInTimeZone(date);
  const day = page.getByTestId(`calendar-day-${dateKey}`);
  for (let week = 0; week < 2 && !(await day.isVisible()); week++) {
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
  }
  await day.click();
  const slot = page.locator('[data-testid^="time-slot-"]:not(:disabled)').first();

  await expect(slot).toBeVisible();

  await slot.click();

  await expect(page).toHaveURL(/\/book\/confirm/);

  await page.getByLabel('Customer name').fill('Audit Synthetic Client');
  await page.getByLabel('Customer email').fill(email);
  await page.getByLabel('Customer phone').fill(uniqueCustomerPhone());
  await acknowledgeBookingPolicy(page);
  await capture(page, info, 'S17-confirm-filled');
  await page.getByRole('button', { name: /confirm appointment/i }).click();

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();

  const manage = page.getByRole('link', { name: 'Manage appointment', exact: true });

  await expect(manage).toBeVisible();
  await expect(manage.locator('..')).toHaveCSS('opacity', '1');
  await expect(manage).toHaveAttribute('href');

  const manageHref = await manage.getAttribute('href');
  if (!manageHref) {
    throw new Error('The receipt must provide a management link.');
  }

  expect(new URL(manageHref).origin).toBe(new URL(page.url()).origin);

  await capture(page, info, 'S89-booking-receipt');
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
  // The security validator deliberately accepts only HTTPS links with no port.
  // Local HTTP recovery must show the honest fallback, not relax that guard.
  await expect(page.getByRole('link', { name: 'Find my booking to receive a secure management link' })).toBeVisible();

  await info.attach('local-http-recovery-limitation', { body: 'Receipt persists after reload; local HTTP management URL is rejected by the HTTPS recovery guard. Continue via the private link obtained from the original visible receipt. HTTPS recovery remains a separate check.', contentType: 'text/plain' });
  await page.goto(manageHref, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Choose a new time' })).toBeVisible();

  await capture(page, info, 'S90-manage-appointment');
  return manageHref;
}

test('mobile guest books, owner opens the same record, guest reschedules and cancels through the UI', async ({ page, browser }, info) => {
  const email = `audit-${info.project.name}-${Date.now()}@example.invalid`;
  const manageHref = await bookThroughUi(page, email, info);
  const original = await storedAppointments(email);

  expect(original).toHaveLength(1);
  expect(original[0]!.salon_client_id).toBeTruthy();
  expect(original[0]!.total_duration_minutes).toBe(e2eConfig.serviceDurationMinutes);

  const owner = await browser.newContext({ storageState: authStatePaths.superAdmin, viewport: { width: 390, height: 844 }, timezoneId: 'America/Toronto' });
  try {
    const ownerPage = await owner.newPage();
    await openAdminBookings(ownerPage);
    await openAdminAppointmentSheet(ownerPage, original[0]!.id, getDateKeyInTimeZone(original[0]!.start_time));

    await expect(ownerPage.getByText('Audit Synthetic Client', { exact: true }).first()).toBeVisible();

    await capture(ownerPage, info, 'S94-owner-appointment-detail');
  } finally {
    await owner.close();
  }

  await page.getByRole('link', { name: 'Choose a new time' }).click();

  await expect(page.getByRole('button', { name: 'Keep current time', exact: true })).toBeVisible();

  await capture(page, info, 'S91-reschedule');
  const alternative = page.getByRole('button', { name: /^\d{1,2}:\d{2} [AP]M$/ }).and(page.locator(':not(:disabled)')).first();

  await expect(alternative).toBeVisible();

  await alternative.click();
  await page.getByRole('button', { name: 'Confirm new time', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Your appointment has been moved' })).toBeVisible();
  await expect(page.getByText('We have updated your booking. View your appointment for the latest details.', { exact: true })).toBeVisible();

  await capture(page, info, 'S92-reschedule-result');
  const moved = await storedAppointments(email);

  expect(moved).toHaveLength(1);
  expect(moved[0]!.id).toBe(original[0]!.id);
  expect(moved[0]!.salon_client_id).toBe(original[0]!.salon_client_id);
  expect(moved[0]!.start_time.toISOString()).not.toBe(original[0]!.start_time.toISOString());

  await page.getByRole('link', { name: 'Back to my appointment' }).click();
  await page.reload();

  await expect(page.getByRole('link', { name: 'Choose a new time' })).toBeVisible();

  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();

  expect((await storedAppointments(email))[0]!.status).not.toBe('cancelled');

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();

  await expect(page.getByText('This appointment is cancelled.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('appointment-status')).toHaveText('Cancelled');

  await capture(page, info, 'S93-cancelled');
  await page.goto(manageHref);

  await expect(page.getByText('This appointment is cancelled.', { exact: true })).toBeVisible();

  const cancelled = await storedAppointments(email);

  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]!.status).toBe('cancelled');
});

test('customer can recover when cancellation loses its network connection', async ({ page }, info) => {
  const email = `audit-recovery-${info.project.name}-${Date.now()}@example.invalid`;
  await bookThroughUi(page, email, info);
  await page.route('**/api/public/appointments/manage/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'confirm the cancellation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel appointment', exact: true })).toBeEnabled();
  expect((await storedAppointments(email))[0]!.status).not.toBe('cancelled');

  await capture(page, info, 'S95-cancellation-retry');
  await page.unroute('**/api/public/appointments/manage/*');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();

  await expect(page.getByText('This appointment is cancelled.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('appointment-status')).toHaveText('Cancelled');
  expect((await storedAppointments(email))[0]!.status).toBe('cancelled');
});

test('refresh resolves a lost cancellation response after the server committed it', async ({ page }, info) => {
  const email = `audit-uncertain-${info.project.name}-${Date.now()}@example.invalid`;
  await bookThroughUi(page, email, info);
  let mutationStatus: number | undefined;
  await page.route('**/api/public/appointments/manage/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const result = await route.fetch();
      mutationStatus = result.status();
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'confirm the cancellation' })).toBeVisible();
  expect(mutationStatus).toBe(200);
  expect((await storedAppointments(email))[0]!.status).toBe('cancelled');

  await page.getByRole('button', { name: 'Refresh appointment', exact: true }).click();

  await expect(page.getByText('This appointment is cancelled.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('appointment-status')).toHaveText('Cancelled');
  await expect(page.getByRole('button', { name: 'Cancel appointment', exact: true })).toHaveCount(0);
  expect(await storedAppointments(email)).toHaveLength(1);
});
