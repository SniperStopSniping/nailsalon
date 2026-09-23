import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';

import { selectBookableSlotFromApi } from '../../e2e/support/booking';

const SLUG = 'synthetic-l1-public-e2e';
const SALON = 'synthetic-l1-public-e2e-salon';
const TECH = 'synthetic-l1-public-e2e-tech';
const SERVICE = 'synthetic-l1-public-e2e-service';
const AUTO = 'synthetic-l1-public-e2e-auto';
const OPTIONAL = 'synthetic-l1-public-e2e-optional';
let database: Client;

test.beforeAll(async () => {
  const target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: process.env.CONCURRENCY_TEST_DATABASE_URL });
  database = new Client({ connectionString: target.connectionString });
  await database.connect();
  await attestDisposableDatabaseSession(database, target, resolveDisposableDatabaseServerExpectation(target));
  await database.query('BEGIN');
  await database.query('DELETE FROM appointment WHERE salon_id = $1', [SALON]);
  await database.query('DELETE FROM salon_client WHERE salon_id = $1', [SALON]);
  await database.query(`INSERT INTO salon (id, slug, name, is_active, status, publication_status, address, city, state, zip_code, features, settings)
    VALUES ($1, $2, 'Synthetic L1 Public Booking', true, 'active', 'published', '1 Synthetic Way', 'Toronto', 'ON', 'M5V 1A1', $3::jsonb, $4::jsonb)
    ON CONFLICT (id) DO UPDATE SET features = EXCLUDED.features, settings = EXCLUDED.settings`, [SALON, SLUG, JSON.stringify({ catalog: { variantsV1: true, addOnGroupsV1: false, bookingModesV1: false } }), JSON.stringify({ booking: { timezone: 'America/Toronto', currency: 'CAD', bufferMinutes: 0, slotIntervalMinutes: 15 }, bookingExperience: { policy: { enabled: false } } })]);
  await database.query(`INSERT INTO technician (id, salon_id, name, is_active, weekly_schedule) VALUES ($1, $2, 'Synthetic L1 Tech', true, $3::jsonb) ON CONFLICT (id) DO UPDATE SET is_active = true, weekly_schedule = EXCLUDED.weekly_schedule`, [TECH, SALON, JSON.stringify(Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { start: '00:00', end: '23:45' }])))]);
  await database.query(`INSERT INTO service (id, salon_id, name, category, price, duration_minutes, is_active) VALUES ($1, $2, 'Synthetic 45 minute L1 service', 'manicure', 5000, 45, true) ON CONFLICT (id) DO UPDATE SET price = 5000, duration_minutes = 45, is_active = true`, [SERVICE, SALON]);
  await database.query(`INSERT INTO add_on (id, salon_id, name, slug, category, price_cents, duration_minutes, is_active) VALUES
    ($1, $2, 'Synthetic automatic prep', 'synthetic-auto', 'removal', 0, 5, true),
    ($3, $2, 'Synthetic optional French', 'synthetic-french', 'nail_art', 500, 0, true)
    ON CONFLICT (id) DO UPDATE SET is_active = true`, [AUTO, SALON, OPTIONAL]);
  await database.query(`INSERT INTO service_add_on (id, salon_id, service_id, add_on_id, selection_mode) VALUES
    ('synthetic-l1-auto-binding', $1, $2, $3, 'optional'), ('synthetic-l1-optional-binding', $1, $2, $4, 'optional') ON CONFLICT (id) DO NOTHING`, [SALON, SERVICE, AUTO, OPTIONAL]);
  await database.query(`INSERT INTO catalog_rule (id, salon_id, service_id, rule_type, subject_service_id, object_add_on_id, params, priority, is_active) VALUES ('synthetic-l1-auto-rule', $1, $2, 'include', $2, $3, '{"autoAdd":true}'::jsonb, 0, true) ON CONFLICT (id) DO UPDATE SET is_active = true`, [SALON, SERVICE, AUTO]);
  await database.query(`INSERT INTO technician_services (technician_id, service_id, enabled) VALUES ($1, $2, true) ON CONFLICT (technician_id, service_id) DO UPDATE SET enabled = true`, [TECH, SERVICE]);
  await database.query('COMMIT');
});

test.afterAll(async () => database?.end());

test('actual L1 public booking keeps automatic duration and exactly one appointment', async ({ page }, testInfo) => {
  await page.goto(`/book/service?salonSlug=${SLUG}`);
  const card = page.getByTestId(`service-card-${SERVICE}`);

  await expect(card).toBeVisible();

  await card.click();
  await page.getByRole('button', { name: 'Add Synthetic optional French', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Synthetic automatic prep included' })).toBeDisabled();
  await expect(page.getByTestId('service-no-removal-button')).toHaveCount(0);

  await page.getByTestId('service-options-done-button').click();
  await page.getByTestId('service-continue-button').click();
  await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);
  if (new URL(page.url()).pathname.endsWith('/book/tech')) {
    await page.getByRole('button', { name: /Synthetic L1 Tech/ }).click();
  }

  await expect(page).toHaveURL(/\/book\/time/);
  await expect(page.getByTestId('booking-summary-price')).toContainText('$55');

  const selectionUrl = new URL(page.url());
  await selectBookableSlotFromApi(page, { technicianId: selectionUrl.searchParams.get('techId') === 'any' ? null : selectionUrl.searchParams.get('techId'), startDayOffset: 3, baseServiceId: SERVICE, selectedAddOns: selectionUrl.searchParams.get('selectedAddOns'), locationId: selectionUrl.searchParams.get('locationId') });

  await expect(page.getByRole('heading', { name: /review your appointment/i })).toBeVisible();

  const phone = page.getByLabel('Customer phone', { exact: true });
  const reminders = page.getByRole('checkbox', { name: 'Text reminders', exact: true });

  await expect(phone).toHaveAttribute('required', '');
  await expect(reminders).toBeChecked();
  await expect.poll(() => phone.evaluate((element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (Number(getComputedStyle(current).opacity) < 1) {
        return false;
      }
    }
    return true;
  })).toBe(true);

  await page.screenshot({ path: path.join(process.cwd(), `artifacts/l1-public-booking/${testInfo.project.name}-review.png`), fullPage: true, animations: 'disabled' });
  await page.getByLabel('Customer name', { exact: true }).fill('Synthetic L1 Customer');
  await page.getByLabel('Customer email', { exact: true }).fill(`l1-${randomUUID()}@example.invalid`);
  await phone.fill('4165550199');
  await reminders.uncheck();
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/appointments') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /confirm appointment/i }).click();
  const response = await responsePromise;
  const body = await response.json();

  expect(response.status(), JSON.stringify(body)).toBe(201);
  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();

  await page.screenshot({ path: path.join(process.cwd(), `artifacts/l1-public-booking/${testInfo.project.name}-confirmed.png`), fullPage: true, animations: 'disabled' });
  const appointments = await database.query('SELECT id, total_price, total_duration_minutes FROM appointment WHERE salon_id = $1', [SALON]);

  expect(appointments.rows).toHaveLength(1);

  const appointment = appointments.rows[0];

  expect(appointment).toMatchObject({ total_price: 5500, total_duration_minutes: 50 });

  const additions = await database.query('SELECT add_on_id, quantity_snapshot FROM appointment_add_on WHERE appointment_id = $1 ORDER BY add_on_id', [appointment.id]);

  expect(additions.rows).toEqual([{ add_on_id: AUTO, quantity_snapshot: 1 }, { add_on_id: OPTIONAL, quantity_snapshot: 1 }]);

  const token = new URL(body.data.manageUrl, page.url()).pathname.split('/').filter(Boolean).at(-1);
  const cancelled = await page.request.patch(`/api/public/appointments/manage/${encodeURIComponent(token!)}`, { data: { action: 'cancel', reason: 'client_request' } });

  expect(cancelled.ok(), await cancelled.text()).toBeTruthy();
});
