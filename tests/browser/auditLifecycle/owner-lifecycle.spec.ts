import { expect, type Page, test, type TestInfo } from '@playwright/test';
import { Client } from 'pg';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '../../../src/libs/disposableDatabaseTarget';
import { getDateKeyInTimeZone } from '../../../src/libs/timeZone';
import { impersonateSalonAsSuperAdmin, openAdminAppointmentSheet, openAdminBookings } from '../../e2e/support/appointment-ops';
import { authStatePaths, e2eBaseUrl, e2eConfig, uniqueCustomerPhone } from '../../e2e/support/config';

requireDisposableDatabaseTarget(process.env);
const targetUrl = new URL(e2eBaseUrl);
if (targetUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(targetUrl.hostname)) {
  throw new Error('The owner audit requires an isolated local HTTP application.');
}

test.use({ storageState: authStatePaths.superAdmin });

async function readDatabase<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
  const target = requireDisposableDatabaseTarget(process.env);
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    await attestDisposableDatabaseSession(client, target, resolveDisposableDatabaseServerExpectation(target));
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

type StoredAppointment = {
  id: string;
  status: string;
  start_time: Date;
  salon_client_id: string;
  technician_id: string | null;
  payment_status: string | null;
  payment_method: string | null;
  amount_paid_cents: number | null;
  final_price_cents: number | null;
  tax_amount_cents: number | null;
  tip_cents: number;
  completed_at: Date | null;
};

function storedAppointments(email: string) {
  return readDatabase<StoredAppointment>(`SELECT id, status, start_time, salon_client_id, technician_id,
    payment_status, payment_method, amount_paid_cents, final_price_cents, tax_amount_cents,
    tip_cents, completed_at FROM appointment WHERE client_email = $1 ORDER BY created_at`, [email]);
}

async function unusedWeekday() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  for (let day = 0; day < 60; day++) {
    const dateKey = getDateKeyInTimeZone(date);
    const rows = await readDatabase<{ count: string }>(`SELECT count(*) FROM appointment
      WHERE (start_time AT TIME ZONE 'America/Toronto')::date = $1::date`, [dateKey]);
    if (date.getDay() !== 0 && date.getDay() !== 6 && rows[0]?.count === '0') {
      return dateKey;
    }
    date.setDate(date.getDate() + 1);
  }
  throw new Error('No unused synthetic audit date found.');
}

async function capture(page: Page, info: TestInfo, reference: string) {
  await page.screenshot({ path: info.outputPath(`${reference}.png`), fullPage: false, animations: 'disabled' });
  await info.attach(reference, { path: info.outputPath(`${reference}.png`), contentType: 'image/png' });
  await info.attach(`${reference}-ui`, { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  const geometry = await page.evaluate(() => ({
    scrollY: window.scrollY,
    viewport: { width: window.innerWidth, height: window.innerHeight, visualHeight: window.visualViewport?.height },
    panels: [...document.querySelectorAll('[data-dialog-shell-content], [data-testid="checkout-sheet"], [data-testid="checkout-scroll-region"], [data-testid="checkout-close"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.getAttribute('data-testid'), top: rect.top, bottom: rect.bottom, height: rect.height, scrollTop: element.scrollTop };
    }),
  }));
  await info.attach(`${reference}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' });

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}

test('owner creates, reloads, edits, completes a cash appointment and rebooks through the UI', async ({ page }, info) => {
  const email = `audit-owner-${info.project.name}-${Date.now()}@example.invalid`;
  const name = `Audit Owner ${info.project.name}`;
  const phone = uniqueCustomerPhone();
  const dateKey = await unusedWeekday();
  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`/admin?salon=${e2eConfig.salonSlug}`);

  await expect(page.getByTestId('owner-today-workspace')).toBeVisible();

  await page.getByTestId('quick-action-new-appointment').click();
  const form = page.getByRole('dialog', { name: 'New Appointment', exact: true });

  await expect(form.getByLabel('Phone Number *', { exact: true })).toBeVisible();

  await capture(page, info, 'S19-owner-create-empty');
  await form.getByLabel('Date', { exact: true }).fill(dateKey);
  await form.getByRole('button', { name: 'Appointment time', exact: true }).click();
  await form.getByRole('button', { name: '10:00', exact: true }).click();
  await form.getByLabel('Email (optional)', { exact: true }).fill(email);
  await form.getByLabel('Phone Number *', { exact: true }).fill(phone);
  await form.getByLabel('Client Name (optional)', { exact: true }).fill(name);
  await form.getByLabel('Date', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, 'S19-owner-create-contact');
  await form.getByRole('button', { name: 'Any available technician', exact: true }).click();
  await form.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName) }).click();
  await form.getByPlaceholder('Search services...').fill(e2eConfig.serviceName);
  await form.getByRole('button', { name: new RegExp(e2eConfig.serviceName) }).click();
  await form.getByRole('button', { name: new RegExp(e2eConfig.serviceName) }).scrollIntoViewIfNeeded();
  await capture(page, info, 'S19-owner-create-service');
  const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appointments' && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create Appointment', exact: true }).click();
  const creation = await createdResponse;

  expect(creation.status(), await creation.text()).toBe(201);
  await expect(form).toHaveCount(0);

  const created = await storedAppointments(email);

  expect(created).toHaveLength(1);
  expect(created[0]!.status).toBe('confirmed');
  expect(created[0]!.salon_client_id).toBeTruthy();
  expect(created[0]!.technician_id).toBeTruthy();

  const appointmentId = created[0]!.id;
  await page.reload();
  await openAdminBookings(page);
  await openAdminAppointmentSheet(page, appointmentId, dateKey);
  const detail = page.getByTestId('appointment-quick-edit-sheet');

  await expect(detail.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(e2eConfig.staffTechnicianName, { exact: true }).first()).toBeVisible();

  await capture(page, info, 'S94-owner-created-appointment');
  await page.getByTestId('appointment-sheet-edit-reschedule').click();
  await page.getByTestId('appointment-sheet-start-time').fill(`${dateKey}T11:00`);
  await capture(page, info, 'S94-owner-edit-time');
  await page.getByTestId('appointment-sheet-save').click();

  await expect.poll(async () => (await storedAppointments(email))[0]!.start_time.toISOString()).not.toBe(created[0]!.start_time.toISOString());

  await page.getByTestId('appointment-sheet-close').click();
  await page.reload();
  await openAdminBookings(page);
  await openAdminAppointmentSheet(page, appointmentId, dateKey);
  await page.getByRole('button', { name: 'Start appointment', exact: true }).click();

  await expect.poll(async () => (await storedAppointments(email))[0]!.status).toBe('in_progress');

  await capture(page, info, 'S94-owner-in-progress');
  await page.getByTestId('appointment-sheet-mark-completed').click();

  await expect(page.getByTestId('checkout-amount-received')).toBeVisible();

  await capture(page, info, 'S96-completion-form');
  await page.getByTestId('checkout-amount-received').scrollIntoViewIfNeeded();
  await capture(page, info, 'S96-completion-payment');
  await page.getByTestId('checkout-method-cash').click();
  await page.getByTestId('checkout-review-button').click();

  await expect(page.getByTestId('checkout-review')).toBeVisible();

  await capture(page, info, 'S97-completion-review');
  await page.getByTestId('checkout-back').click();

  await expect(page.getByTestId('checkout-amount-received')).toBeVisible();
  expect((await storedAppointments(email))[0]!.status).toBe('in_progress');

  await page.getByTestId('checkout-review-button').click();
  await page.getByTestId('checkout-complete-button').click();

  await expect(page.getByRole('heading', { name: 'Add an after photo?', exact: true })).toBeVisible();

  await capture(page, info, 'S98-completion-photo-choice');
  await page.getByRole('button', { name: 'Complete without photo', exact: true }).click();

  await expect(page.getByTestId('checkout-success')).toBeVisible();
  await expect(page.getByTestId('checkout-success-status')).toHaveText('paid');

  await capture(page, info, 'S99-completion-success');
  await page.getByTestId('checkout-close').scrollIntoViewIfNeeded();
  await capture(page, info, 'S99-completion-success-header');
  const completed = (await storedAppointments(email))[0]!;
  const payments = await readDatabase<{ amount_cents: number; method: string; voided_at: Date | null }>(
    'SELECT amount_cents, method, voided_at FROM appointment_payment WHERE appointment_id = $1',
    [appointmentId],
  );

  expect(completed.status).toBe('completed');
  expect(completed.payment_status).toBe('paid');
  expect(completed.completed_at).not.toBeNull();
  expect(completed.salon_client_id).toBe(created[0]!.salon_client_id);
  expect(payments).toHaveLength(1);
  expect(payments[0]!.method).toBe('cash');
  expect(payments[0]!.voided_at).toBeNull();
  expect(payments[0]!.amount_cents).toBe(completed.amount_paid_cents);
  expect(completed.amount_paid_cents).toBe(completed.final_price_cents! + completed.tax_amount_cents! + completed.tip_cents);

  await page.getByTestId('checkout-success-view-receipt').click();

  await expect(page.getByTestId('checkout-receipt')).toBeVisible();

  await capture(page, info, 'S100-owner-receipt');
  await page.getByTestId('checkout-close').click();
  await page.reload();
  await openAdminBookings(page);
  await openAdminAppointmentSheet(page, appointmentId, dateKey);

  await expect(page.getByTestId('appointment-sheet-view-receipt')).toBeVisible();

  await page.getByRole('button', { name: 'Rebook client', exact: true }).click();

  await expect(form.getByLabel('Client Name (optional)', { exact: true })).toHaveValue(name);
  await expect(form.getByLabel('Email (optional)', { exact: true })).toHaveValue(email);
  await expect(form.getByLabel('Phone Number *', { exact: true })).toHaveValue(`(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`);

  await capture(page, info, 'S19-rebook-prefilled-contact');
  await form.getByPlaceholder('Search services...').scrollIntoViewIfNeeded();

  await expect(form.getByRole('button', { name: new RegExp(e2eConfig.serviceName) })).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName) })).toBeVisible();

  await capture(page, info, 'S19-rebook-prefilled-service');
  const rebookDate = await unusedWeekday();
  await form.getByLabel('Date', { exact: true }).fill(rebookDate);
  await form.getByRole('button', { name: 'Appointment time', exact: true }).click();
  await form.getByRole('button', { name: '10:00', exact: true }).click();
  const rebookResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appointments' && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create Appointment', exact: true }).click();
  const rebooking = await rebookResponse;

  expect(rebooking.status(), await rebooking.text()).toBe(201);
  await expect(form).toHaveCount(0);

  const allVisits = await storedAppointments(email);

  expect(allVisits).toHaveLength(2);
  expect(allVisits[1]!.salon_client_id).toBe(completed.salon_client_id);
  expect(allVisits[1]!.status).toBe('confirmed');
  expect(allVisits[0]!.status).toBe('completed');

  await page.reload();
  await openAdminBookings(page);
  await openAdminAppointmentSheet(page, allVisits[1]!.id, rebookDate);

  await expect(page.getByTestId('appointment-quick-edit-sheet').getByText(name, { exact: true }).first()).toBeVisible();

  await capture(page, info, 'S94-rebooked-appointment');
  await info.attach('persisted-owner-lifecycle', { body: JSON.stringify({ visits: allVisits, payments }, null, 2), contentType: 'application/json' });
});

test('owner can retry an unchanged appointment after its successful creation response is lost', async ({ page }, info) => {
  const email = `audit-owner-retry-${info.project.name}-${Date.now()}@example.invalid`;
  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`/admin?salon=${e2eConfig.salonSlug}`);
  await page.getByTestId('quick-action-new-appointment').click();
  const form = page.getByRole('dialog', { name: 'New Appointment', exact: true });
  await form.getByLabel('Date', { exact: true }).fill(await unusedWeekday());
  await form.getByRole('button', { name: 'Appointment time', exact: true }).click();
  await form.getByRole('button', { name: '10:00', exact: true }).click();
  await form.getByLabel('Email (optional)', { exact: true }).fill(email);
  await form.getByLabel('Phone Number *', { exact: true }).fill(uniqueCustomerPhone());
  await form.getByLabel('Client Name (optional)', { exact: true }).fill('Audit Owner Lost Response');
  await form.getByRole('button', { name: 'Any available technician', exact: true }).click();
  await form.getByRole('button', { name: new RegExp(e2eConfig.staffTechnicianName) }).click();
  await form.getByPlaceholder('Search services...').fill(e2eConfig.serviceName);
  await form.getByRole('button', { name: new RegExp(e2eConfig.serviceName) }).click();
  let committedStatus: number | undefined;
  let originalRequestKey: string | undefined;
  await page.route('**/api/appointments', async (route) => {
    if (route.request().method() === 'POST') {
      originalRequestKey = route.request().headers()['idempotency-key'];
      const response = await route.fetch();
      committedStatus = response.status();
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  await form.getByRole('button', { name: 'Create Appointment', exact: true }).click();

  await expect(page.getByTestId('new-appointment-error')).toBeVisible();
  await expect(page.getByTestId('new-appointment-error')).toBeInViewport();
  await expect(page.getByTestId('new-appointment-error')).toBeFocused();
  expect(committedStatus).toBe(201);

  const original = await storedAppointments(email);

  expect(original).toHaveLength(1);

  await page.getByTestId('new-appointment-error').scrollIntoViewIfNeeded();
  await capture(page, info, 'S19-owner-create-response-lost');
  await page.unroute('**/api/appointments');
  const retryResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appointments' && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create Appointment', exact: true }).click();
  const retry = await retryResponse;
  const retryBody = await retry.text();
  await info.attach('creation-retry-result', { body: JSON.stringify({ status: retry.status(), body: retryBody }), contentType: 'application/json' });

  expect(await storedAppointments(email)).toHaveLength(1);
  expect(retry.ok(), retryBody).toBe(true);
  expect(originalRequestKey).toBeTruthy();
  expect(retry.request().headers()['idempotency-key']).toBe(originalRequestKey);
  expect(JSON.parse(retryBody).meta.cached).toBe(true);
  expect(JSON.parse(retryBody).data.appointment.id).toBe(original[0]!.id);
  await expect(form).toHaveCount(0);
});
