import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';
import { Client } from 'pg';

import {
  attestDisposableDatabaseSession,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '../../src/libs/disposableDatabaseTarget';
import { addDaysToDateKey, getDateKeyInTimeZone } from '../../src/libs/timeZone';
import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { authenticateSuperAdmin } from './support/auth';
import { e2eBaseUrl, e2eConfig } from './support/config';

// eslint-disable-next-line playwright/no-skipped-test -- This test writes only on its opt-in disposable launcher.
test.skip(process.env.E2E_ISOLATED_OWNER_CALENDAR !== 'true', 'Run using the disposable owner calendar launcher.');

test.use({ actionTimeout: 30_000, viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, timezoneId: 'America/Toronto' });

async function openCalendarDay(page: Page, date: string) {
  const dateButton = page.getByTestId(`calendar-day-${date}`);

  await expect(page.getByRole('button', { name: 'Next month', exact: true })).toBeVisible({ timeout: 30_000 });

  for (let index = 0; index < 2 && !await dateButton.isVisible(); index++) {
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
  }

  await expect(dateButton).toHaveAccessibleName(/1 Luster appointment|[2-9] Luster appointments/, { timeout: 30_000 });

  await dateButton.click();
}

async function createAppointment(page: Page) {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/appointments' && response.request().method() === 'POST', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Create Appointment', exact: true }).click();
  const response = await responsePromise;
  const body = await response.json();

  expect(response.status(), JSON.stringify(body.error)).toBe(201);
  await expect(page.getByRole('heading', { name: 'New Appointment', exact: true })).toBeHidden();

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
    // Choose the next Thursday and a Thursday three weeks after it.
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const firstDate = addDaysToDateKey(today, ((4 - weekday + 7) % 7) || 7);
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

    await slots.nth(4).click({ timeout: 30_000 });
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

    await expect(page.getByLabel('Client Name (optional)', { exact: true })).toHaveValue(clientName);
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
