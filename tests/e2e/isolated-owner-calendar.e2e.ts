import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';
import { Client } from 'pg';

import {
  attestDisposableDatabaseSession,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '../../src/libs/disposableDatabaseTarget';
import { addDaysToDateKey, getDateKeyInTimeZone, zonedTimeToUtc } from '../../src/libs/timeZone';
import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { authenticateSuperAdmin } from './support/auth';
import { e2eBaseUrl, e2eConfig } from './support/config';

// eslint-disable-next-line playwright/no-skipped-test -- This test writes only on its opt-in disposable launcher.
test.skip(process.env.E2E_ISOLATED_OWNER_CALENDAR !== 'true', 'Run using the disposable owner calendar launcher.');

test.use({ actionTimeout: 30_000, viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, timezoneId: 'America/Toronto' });

test.beforeEach(async ({ page }) => {
  // The intentionally nonresolving Clerk fixture can show a Next dev badge
  // over the owner navigation. It is absent from builds.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    });
  });
});

async function openCalendarDay(page: Page, date: string) {
  const dateButton = page.getByTestId(`calendar-day-${date}`);

  await expect(page.getByRole('button', { name: 'Next month', exact: true })).toBeVisible({ timeout: 30_000 });

  for (let index = 0; index < 2 && !await dateButton.isVisible(); index++) {
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
  }

  await expect(dateButton).toHaveAccessibleName(/1 Luster appointment|[2-9] Luster appointments/, { timeout: 30_000 });

  await dateButton.click();
}

async function createAppointment(page: Page, { doubleTap = false, title = 'New Appointment' } = {}) {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/appointments' && response.request().method() === 'POST', { timeout: 90_000 });
  const save = page.getByRole('button', { name: 'Create Appointment', exact: true });
  if (doubleTap) {
    await save.dblclick();
  } else {
    await save.click();
  }
  const response = await responsePromise;
  const body = await response.json();

  expect(response.status(), JSON.stringify(body.error)).toBe(201);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeHidden();

  return body.data;
}

test('owner books extras, changes duration, and rebooks on a phone @isolated-owner-calendar', async ({ page }, testInfo) => {
  test.setTimeout(300_000);

  expect(e2eBaseUrl).toBe('http://localhost:3101');
  expect(e2eConfig.salonSlug).toBe('nail-salon-no5');
  expect(e2eConfig.superAdminPhone).toBe('4165550101');

  const target = requireDisposableDatabaseTarget();
  const db = new Client({ connectionString: target.connectionString });
  await db.connect();
  try {
    await attestDisposableDatabaseSession(db, target, resolveDisposableDatabaseServerExpectation(target));
    const clientName = `Calendar QA ${randomUUID().slice(0, 8)}`;
    const availablePhone = await db.query<{ phone: string }>(`
      SELECT '41655501' || lpad(suffix::text, 2, '0') AS phone
      FROM generate_series(20, 89) suffix
      WHERE NOT EXISTS (
        SELECT 1 FROM appointment
        WHERE right(regexp_replace(client_phone, '[^0-9]', '', 'g'), 10)
          = '41655501' || lpad(suffix::text, 2, '0')
      )
      ORDER BY suffix
      LIMIT 1
    `);
    const phone = availablePhone.rows[0]?.phone;

    expect(phone).toBeTruthy();

    await authenticateSuperAdmin(page);
    await impersonateSalonAsSuperAdmin(page);
    await page.goto('/admin?salon=nail-salon-no5', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-impersonation-banner')).toBeVisible({ timeout: 30_000 });

    const today = getDateKeyInTimeZone(new Date(), 'America/Toronto');
    const occupied = await db.query<{ day: string }>(`
      SELECT DISTINCT to_char(start_time AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') AS day
      FROM appointment WHERE salon_id = 'salon_nail-salon-no5'
    `);
    const occupiedDays = new Set(occupied.rows.map(row => row.day));
    // Keep repeat runs on the disposable database from competing for the
    // same fixture date while still rebooking exactly three weeks ahead.
    const firstDate = Array.from({ length: 28 }, (_, index) => addDaysToDateKey(today, index + 7)).find((date) => {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      return weekday >= 2 && weekday <= 5 && !occupiedDays.has(date) && !occupiedDays.has(addDaysToDateKey(date, 21));
    })!;

    expect(firstDate).toBeTruthy();

    const nextDate = addDaysToDateKey(firstDate, 21);
    await page.getByRole('button', { name: 'New Appointment', exact: true }).click();
    await page.getByLabel('Phone Number *', { exact: true }).fill(phone!);
    await page.getByLabel('Client Name (optional)', { exact: true }).fill(clientName);
    await page.getByLabel('Date', { exact: true }).fill(firstDate);
    const form = page.getByRole('dialog', { name: 'New Appointment' });
    await form.getByRole('button', { name: /^BIAB Short/ }).click();

    const openings = form.getByRole('region', { name: 'Find a time' });
    const slots = openings.getByRole('button', { name: /^\d{1,2}:\d{2}$/ });

    await expect(slots.first()).toBeVisible({ timeout: 30_000 });

    const baseAvailability = await page.request.get(`/api/appointments/availability?salonSlug=nail-salon-no5&date=${firstDate}&serviceIds=svc_biab-short`);

    expect(baseAvailability.ok()).toBe(true);
    expect((await baseAvailability.json()).blockedDurationMinutes).toBe(85);

    await slots.first().click();

    await page.getByRole('button', { name: 'Removal & extras', exact: true }).click();
    await page.getByRole('checkbox', { name: /Nail Repair/ }).check({ timeout: 30_000 });

    await expect(page.getByRole('button', { name: 'Create Appointment', exact: true })).toBeDisabled();
    await expect(openings).toContainText('1h 25m', { timeout: 30_000 });
    await expect(openings).toContainText(/70\.00/);

    const extraAvailability = await page.request.get(`/api/appointments/availability?${new URLSearchParams({
      salonSlug: 'nail-salon-no5',
      date: firstDate,
      baseServiceId: 'svc_biab-short',
      selectedAddOns: JSON.stringify([{ addOnId: 'addon_e2e_nail-repair', quantity: 1 }]),
    })}`);

    expect(extraAvailability.ok()).toBe(true);
    expect((await extraAvailability.json()).blockedDurationMinutes).toBe(95);

    // Use an afternoon slot so the maximum editable duration crosses closing,
    // even on a fixture day with a longer morning schedule.
    await openings.getByRole('button', { name: 'Show all times', exact: true }).click();
    await openings.getByRole('button', { name: /^(13|14):\d{2}$/ }).first().click({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('01-extras-opening.png') });
    const created = await createAppointment(page);

    expect(created.appointment).toMatchObject({ totalDurationMinutes: 85, blockedDurationMinutes: 95, status: 'confirmed' });
    expect(created.addOns).toEqual([expect.objectContaining({ id: 'addon_e2e_nail-repair', quantity: 1, lineDurationMinutes: 10, lineTotalCents: 500 })]);

    await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
    await openCalendarDay(page, firstDate);
    const appointment = page.getByRole('button', { name: new RegExp(`${clientName}.*BIAB Short`, 'i') });

    await expect(appointment).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('02-confirmed-calendar.png') });
    await appointment.click();
    await page.getByRole('button', { name: 'Edit / reschedule' }).click();
    const duration = page.getByLabel('Duration (minutes)', { exact: true });

    await expect(duration).toHaveValue('85');

    await duration.fill('480');
    const managePath = `/api/appointments/${created.appointmentId}/manage`;
    const rejectedPromise = page.waitForResponse(response => new URL(response.url()).pathname === managePath && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();

    expect((await rejectedPromise).ok()).toBe(false);
    await expect(duration).toHaveValue('480');

    await duration.fill('95');

    await expect(page.getByTestId('appointment-sheet-projected-duration')).toHaveText('95 min');

    await page.screenshot({ path: testInfo.outputPath('03-duration-edit.png') });
    const updatedPromise = page.waitForResponse(response => new URL(response.url()).pathname === managePath && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const updatedResponse = await updatedPromise;
    const updated = await updatedResponse.json();

    expect(updatedResponse.ok(), JSON.stringify(updated.error)).toBe(true);
    expect(updated.data.detail.appointment).toMatchObject({ startTime: created.appointment.startTime, totalDurationMinutes: 95 });

    await expect(duration).toBeHidden();

    await page.getByRole('button', { name: /^Details Show$/ }).click();
    await page.getByRole('button', { name: 'Rebook client', exact: true }).click();

    await expect(page.getByLabel('Client Name (optional)', { exact: true })).toHaveValue(clientName, { timeout: 60_000 });
    await expect(form.getByRole('button', { name: /^BIAB Short/ })).toHaveAttribute('aria-pressed', 'true');

    await page.getByLabel('Date', { exact: true }).fill(nextDate);
    await slots.first().click({ timeout: 30_000 });
    const rebooked = await createAppointment(page);

    expect(created.appointment.salonClientId).toBeTruthy();
    expect(rebooked.appointment.salonClientId).toBe(created.appointment.salonClientId);

    // The day drawer can remain open below the appointment sheet after rebooking.
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (await page.getByRole('button', { name: 'Close day details' }).isVisible()) {
      await page.getByRole('button', { name: 'Close day details' }).click();
    }
    await openCalendarDay(page, nextDate);

    await expect(appointment).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('04-rebooked-calendar.png') });

    const persisted = await db.query(`
      SELECT id, total_duration_minutes, blocked_duration_minutes, status
      FROM appointment WHERE id = ANY($1) ORDER BY start_time
    `, [[created.appointmentId, rebooked.appointmentId]]);

    expect(persisted.rows).toEqual([
      { id: created.appointmentId, total_duration_minutes: 95, blocked_duration_minutes: 105, status: 'confirmed' },
      { id: rebooked.appointmentId, total_duration_minutes: 75, blocked_duration_minutes: 85, status: 'confirmed' },
    ]);
  } finally {
    await db.end();
  }
});

test('owner books a calendar gap and finds BIAB openings with removal on a phone', async ({ page }, testInfo) => {
  test.setTimeout(300_000);

  expect(e2eBaseUrl).toBe('http://localhost:3101');
  expect(e2eConfig.salonSlug).toBe('nail-salon-no5');
  expect(e2eConfig.superAdminPhone).toBe('4165550101');

  const target = requireDisposableDatabaseTarget();
  const db = new Client({ connectionString: target.connectionString });
  await db.connect();
  try {
    await attestDisposableDatabaseSession(db, target, resolveDisposableDatabaseServerExpectation(target));
    const salonSlug = e2eConfig.salonSlug;
    const timeZone = 'America/Toronto';
    const today = getDateKeyInTimeZone(new Date(), timeZone);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const thursday = (11 - weekday) % 7;
    const dates = Array.from({ length: 8 }, (_, index) => addDaysToDateKey(today, thursday + (index + 1) * 7));
    const technicianId = 'tech_daniela';
    const serviceId = 'svc_biab-short';
    const fixtureClient = 'Calendar Gap Fixture';
    const fixturePhone = '4165550198';
    const startOf = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone }).toISOString();
    const used = await db.query<{ day: string }>(`
      SELECT DISTINCT to_char(start_time AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') AS day
      FROM appointment WHERE salon_id = 'salon_nail-salon-no5' AND technician_id = $1
    `, [technicianId]);
    const gapDate = dates.find(date => !used.rows.some(row => row.day === date));

    expect(gapDate).toBeTruthy();

    await db.query(`
      INSERT INTO add_on (id, salon_id, name, slug, category, price_cents, duration_minutes)
      VALUES ('addon_e2e_gap_removal', 'salon_nail-salon-no5', 'Fixture Gel Removal', 'e2e-gap-removal', 'removal', 1000, 20)
      ON CONFLICT (id) DO NOTHING
    `);
    await db.query(`
      INSERT INTO service_add_on (id, salon_id, service_id, add_on_id)
      VALUES ('service_add_on_e2e_gap_removal', 'salon_nail-salon-no5', 'svc_biab-short', 'addon_e2e_gap_removal')
      ON CONFLICT (id) DO NOTHING
    `);

    await authenticateSuperAdmin(page);
    await impersonateSalonAsSuperAdmin(page);
    await page.goto('/admin?salon=nail-salon-no5', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-impersonation-banner')).toBeVisible({ timeout: 30_000 });

    const seed = { salonSlug, technicianId, serviceIds: [serviceId], clientName: fixtureClient, clientPhone: fixturePhone };
    const bookFixture = (startTime: string) => page.request.post('/api/appointments', {
      headers: { Origin: e2eBaseUrl },
      data: { ...seed, startTime },
    });
    for (const time of ['09:00', '13:00', '15:00']) {
      const response = await bookFixture(startOf(gapDate!, time));

      expect(response.status(), await response.text()).toBe(201);
    }

    await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
    await page.getByRole('group', { name: 'Filter calendar by technician' }).getByRole('button', { name: 'Daniela', exact: true }).click();
    await openCalendarDay(page, gapDate!);
    const gaps = page.getByRole('region', { name: 'Calendar openings' });
    const shortGap = gaps.getByRole('button', { name: /2:30 PM – 3:00 PM.*30 min/i });
    const longGap = gaps.getByRole('button', { name: /10:30 AM – 1:00 PM.*2h 30m/i });

    await expect(shortGap).toBeVisible({ timeout: 30_000 });
    await expect(longGap).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('05-calendar-gaps.png'), animations: 'disabled' });
    await shortGap.click();
    const form = page.getByRole('dialog', { name: 'New Appointment' });

    await expect(form.getByLabel('Date', { exact: true })).toHaveValue(gapDate!);
    await expect(form.getByLabel('Time', { exact: true })).toContainText('14:30');

    await form.getByLabel('Phone Number *', { exact: true }).fill(fixturePhone);
    await form.getByRole('button', { name: /^BIAB Short/ }).click();

    await expect(form.getByText('The prefilled time doesn’t fit this selection. Choose another opening.')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Create Appointment', exact: true })).toBeDisabled();

    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await longGap.click();

    await expect(form.getByLabel('Date', { exact: true })).toHaveValue(gapDate!);
    await expect(form.getByLabel('Time', { exact: true })).toContainText('10:30');

    await form.getByRole('button', { name: 'Find existing client' }).click();
    await form.getByLabel('Find an existing client', { exact: true }).fill(fixtureClient);
    await form.getByRole('button', { name: new RegExp(fixtureClient) }).click();
    await form.getByRole('button', { name: /^BIAB Short/ }).click();

    await expect(form.getByRole('button', { name: 'Create Appointment', exact: true })).toBeEnabled();

    await page.screenshot({ path: testInfo.outputPath('06-gap-prefill.png'), animations: 'disabled' });
    const requests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/appointments' && request.method() === 'POST') {
        requests.push(request.url());
      }
    });
    const created = await createAppointment(page, { doubleTap: true });

    expect(requests).toHaveLength(1);
    expect(created.appointment).toMatchObject({ startTime: startOf(gapDate!, '10:30'), technicianId, clientName: fixtureClient });

    const conflict = await bookFixture(created.appointment.startTime);

    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe('TIME_CONFLICT');

    await expect(page.getByTestId(`day-detail-appointment-${created.appointmentId}`)).toBeVisible();

    await page.getByRole('button', { name: 'Close day details' }).click();
    await page.getByRole('button', { name: 'Find Opening', exact: true }).click();
    const finder = page.getByRole('dialog', { name: 'Find Opening' });
    await finder.getByRole('button', { name: /^BIAB Short/ }).click();
    await finder.getByRole('button', { name: 'Removal & extras', exact: true }).click();
    await finder.getByRole('checkbox', { name: /Fixture Gel Removal/ }).check();
    const results = finder.getByRole('region', { name: 'Find a time' });

    await expect(results).toContainText('1h 35m', { timeout: 45_000 });
    await expect(results.getByRole('heading', { level: 5 })).toHaveCount(3, { timeout: 45_000 });

    await results.getByRole('heading', { level: 5 }).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('07-find-opening.png'), animations: 'disabled' });
    await results.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().click();
    await finder.getByRole('button', { name: 'Find existing client' }).click();
    await finder.getByLabel('Find an existing client', { exact: true }).fill(fixtureClient);
    await finder.getByRole('button', { name: new RegExp(fixtureClient) }).click();
    const found = await createAppointment(page, { title: 'Find Opening' });

    expect(found.appointment).toMatchObject({ totalDurationMinutes: 95, blockedDurationMinutes: 105, salonClientId: created.appointment.salonClientId });
    expect(found.addOns).toEqual([expect.objectContaining({ id: 'addon_e2e_gap_removal', lineDurationMinutes: 20 })]);

    const saved = page.getByTestId(`day-detail-appointment-${found.appointmentId}`);

    await expect(saved).toBeVisible();
    await expect(saved).toHaveCSS('opacity', '1');

    await saved.scrollIntoViewIfNeeded();

    await page.screenshot({ path: testInfo.outputPath('08-found-opening-saved.png'), animations: 'disabled' });
    const count = await db.query(`
      SELECT count(*)::int AS count FROM appointment
      WHERE salon_id = 'salon_nail-salon-no5' AND technician_id = $1 AND start_time = $2
    `, [technicianId, created.appointment.startTime]);

    expect(count.rows[0]?.count).toBe(1);
  } finally {
    await db.end();
  }
});

test('walk-in selects a future date and saves to the same calendar @isolated-owner-calendar', async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  expect(e2eBaseUrl).toBe('http://localhost:3101');
  expect(e2eConfig.salonSlug).toBe('nail-salon-no5');

  const target = requireDisposableDatabaseTarget();
  const db = new Client({ connectionString: target.connectionString });
  await db.connect();
  try {
    await attestDisposableDatabaseSession(db, target, resolveDisposableDatabaseServerExpectation(target));
    const { rows } = await db.query<{ phone: string }>(`
      SELECT '41655501' || lpad(suffix::text, 2, '0') AS phone
      FROM generate_series(20, 89) suffix
      WHERE NOT EXISTS (
        SELECT 1 FROM appointment
        WHERE right(regexp_replace(client_phone, '[^0-9]', '', 'g'), 10)
          = '41655501' || lpad(suffix::text, 2, '0')
      )
      ORDER BY suffix
      LIMIT 1
    `);

    expect(rows[0]?.phone).toBeTruthy();

    const name = `Walk-in QA ${randomUUID().slice(0, 8)}`;
    const today = getDateKeyInTimeZone(new Date(), 'America/Toronto');
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const date = addDaysToDateKey(today, ((4 - weekday + 7) % 7 || 7) + 7);
    await authenticateSuperAdmin(page);
    await impersonateSalonAsSuperAdmin(page);
    await page.goto('/admin?salon=nail-salon-no5', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-impersonation-banner')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Walk-in', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Quick Walk-in' });

    await form.getByRole('button', { name: /^BIAB Short/ }).click();
    await form.getByLabel('Date', { exact: true }).fill(date);
    const times = form.getByRole('region', { name: 'Find a time' });
    await times.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().click();
    await form.getByLabel('Phone Number *', { exact: true }).fill(rows[0]!.phone);
    await form.getByLabel('Client Name (optional)', { exact: true }).fill(name);
    await page.screenshot({ path: testInfo.outputPath('09-walk-in-available-time.png'), animations: 'disabled' });

    const booked = await createAppointment(page, { title: 'Quick Walk-in' });

    expect(booked.appointment).toMatchObject({ totalDurationMinutes: 75, blockedDurationMinutes: 85, status: 'confirmed' });

    await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
    await openCalendarDay(page, date);

    await expect(page.getByTestId(`day-detail-appointment-${booked.appointmentId}`)).toContainText(name);
  } finally {
    await db.end();
  }
});
