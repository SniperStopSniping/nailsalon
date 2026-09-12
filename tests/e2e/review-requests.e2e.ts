import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '../../src/libs/disposableDatabaseTarget';
import { getDateKeyInTimeZone } from '../../src/libs/timeZone';
import { impersonateSalonAsSuperAdmin, openAdminAppointmentSheet, openAdminBookings } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

// Normal isolated owner authentication; review writes cannot enqueue real SMS.
test.use({ storageState: authStatePaths.superAdmin });

test('review settings require explicit automation opt-in @mobile-safari', async ({ page }) => {
  let settings = {
    googleReviewUrl: null as string | null,
    automaticEnabled: false,
    delayMinutes: 60,
    messageTemplate: 'Hi {{firstName}}! Thanks for visiting {{businessName}}. Review us: {{reviewLink}}',
    businessName: 'Daniela Nails',
  };
  await page.route('**/api/admin/review-requests/settings?**', async (route) => {
    if (route.request().method() === 'PATCH') {
      settings = { ...settings, ...route.request().postDataJSON() };
    }
    await route.fulfill({ json: { data: settings } });
  });
  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=review-requests`);
  const panel = page.getByTestId('review-request-settings');

  await expect(panel).toBeVisible();

  await panel.getByLabel('Google review link', { exact: true }).fill('https://g.page/daniela/review');

  await expect(panel.getByRole('checkbox', { name: 'Automatically request reviews' })).not.toBeChecked();

  await panel.getByRole('button', { name: 'Save review settings' }).click();

  await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(settings.automaticEnabled).toBe(false);

  await panel.getByRole('checkbox', { name: 'Automatically request reviews' }).check();
  await panel.getByLabel('Send after', { exact: true }).selectOption('60');

  await expect(panel.getByText('Reply STOP to opt out.', { exact: false })).toBeVisible();

  await panel.getByRole('button', { name: 'Save review settings' }).click();

  await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(settings.automaticEnabled).toBe(true);
});

test('isolated owner completes and queues one review through the real APIs @mobile-safari', async ({ page }, testInfo) => {
  test.slow();

  // This test writes only to the independently attested disposable CI database.
  // No dispatcher is invoked, and provider credentials must remain absent.
  const target = requireDisposableDatabaseTarget(process.env);

  expect(process.env.E2E_USE_REAL_TWILIO).not.toBe('true');
  expect(process.env.TWILIO_AUTH_TOKEN || '').toBe('');

  const database = new Client({ connectionString: target.connectionString });
  await database.connect();
  await attestDisposableDatabaseSession(database, target, resolveDisposableDatabaseServerExpectation(target));
  const suffix = randomUUID();
  const clientId = `review-e2e-client-${suffix}`;
  const appointmentId = `review-e2e-appointment-${suffix}`;
  const historicalId = `review-e2e-historical-${suffix}`;
  const technicianId = `review-e2e-technician-${suffix}`;
  let phone = '';
  let salonId = '';
  try {
    const salon = await database.query('SELECT id FROM salon WHERE slug = $1', [e2eConfig.salonSlug]);
    salonId = salon.rows[0].id;
    const unusedPhone = await database.query('SELECT \'416555\' || lpad(n::text, 4, \'0\') AS phone FROM generate_series(100, 199) n WHERE NOT EXISTS (SELECT 1 FROM salon_client WHERE salon_id = $1 AND phone = \'416555\' || lpad(n::text, 4, \'0\')) LIMIT 1', [salonId]);

    expect(unusedPhone.rows).toHaveLength(1);

    phone = unusedPhone.rows[0].phone;
    await database.query(`UPDATE salon SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{communications}', '{"sms":{"enabled":true}}'::jsonb) WHERE id = $1`, [salonId]);
    await database.query(`INSERT INTO salon_client (id, salon_id, full_name, phone) VALUES ($1, $2, 'Sarah Review Fixture', $3)`, [clientId, salonId, phone]);
    await database.query(`INSERT INTO communication_consent (id, salon_id, recipient, channel, purpose, status, source, wording_version) VALUES ($1, $2, $3, 'sms', 'appointment_transactional', 'granted', 'test', 'test-v1')`, [`review-e2e-consent-${suffix}`, salonId, phone]);
    await database.query('INSERT INTO technician (id, salon_id, name, is_active) VALUES ($1, $2, \'Review Fixture Tech\', true)', [technicianId, salonId]);
    const start = new Date();
    const end = new Date(start.getTime() + 3_600_000);
    await database.query(`INSERT INTO appointment (id, salon_id, salon_client_id, client_name, client_phone, start_time, end_time, status, total_price, total_duration_minutes, technician_id) VALUES ($1, $2, $3, 'Sarah Review Fixture', $4, $5, $6, 'confirmed', 0, 60, $7)`, [appointmentId, salonId, clientId, phone, start, end, technicianId]);
    await database.query(`INSERT INTO appointment (id, salon_id, salon_client_id, client_name, client_phone, start_time, end_time, completed_at, status, total_price, total_duration_minutes) VALUES ($1, $2, $3, 'Sarah Review Fixture', $4, $5, $6, $6, 'completed', 0, 60)`, [historicalId, salonId, clientId, phone, new Date(start.getTime() - 172_800_000), new Date(start.getTime() - 86_400_000)]);
    await impersonateSalonAsSuperAdmin(page);
    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=review-requests`);
    const panel = page.getByTestId('review-request-settings');

    await expect(panel).toBeVisible();

    await panel.getByLabel('Google review link', { exact: true }).fill(`https://g.page/r/review-fixture-${suffix}/review`);
    await panel.getByLabel('Message', { exact: true }).fill('Hi {{firstName}}! Thank you for visiting {{businessName}}. Share a Google review: {{reviewLink}}');

    await expect(panel.locator('p').filter({ hasText: 'Share a Google review:' })).toBeVisible();

    await panel.getByRole('checkbox', { name: 'Automatically request reviews' }).uncheck();
    await panel.getByRole('button', { name: 'Save review settings' }).click();

    await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    await panel.getByRole('checkbox', { name: 'Automatically request reviews' }).check();
    await panel.getByLabel('Send after', { exact: true }).selectOption('60');
    await panel.getByRole('button', { name: 'Save review settings' }).click();

    await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('owner-review-settings.png'), fullPage: true });
    const count = async () => Number((await database.query('SELECT count(*) FROM review_request WHERE salon_id = $1 AND client_id = $2', [salonId, clientId])).rows[0].count);

    expect(await count()).toBe(0);

    const completeUrl = `/api/appointments/${appointmentId}/complete?salonSlug=${e2eConfig.salonSlug}`;
    const complete = await page.request.patch(completeUrl, { data: { skipPhotoValidation: true, actualStartAt: new Date(start.getTime() - 7_200_000).toISOString(), actualEndAt: new Date(start.getTime() - 3_600_000).toISOString() } });

    expect(complete.ok(), await complete.text()).toBe(true);

    const replay = await page.request.patch(completeUrl, { data: { skipPhotoValidation: true } });

    expect(replay.ok(), await replay.text()).toBe(true);
    expect(await count()).toBe(1);

    const scheduled = (await database.query('SELECT r.scheduled_for, a.completed_at FROM review_request r JOIN appointment a ON a.id = r.appointment_id WHERE r.client_id = $1', [clientId])).rows[0];

    expect(new Date(scheduled.scheduled_for).getTime()).toBeGreaterThanOrEqual(new Date(scheduled.completed_at).getTime() + 3_600_000);

    await openAdminBookings(page);
    await openAdminAppointmentSheet(page, appointmentId, getDateKeyInTimeZone(start));
    const action = page.getByTestId('appointment-review-request-action');
    await action.getByRole('button', { name: 'Review request scheduled', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Send review request', exact: true });

    await expect(confirmation.getByText(phone, { exact: false })).toBeVisible();
    await expect(confirmation.getByText('Reply STOP to opt out.', { exact: false })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('owner-review-message-preview.png'), fullPage: true });
    await confirmation.getByRole('button', { name: 'Send now', exact: true }).click();

    await expect(confirmation).toBeHidden();
    await expect(action.getByRole('button', { name: 'Review request scheduled', exact: true })).toBeVisible();
    await expect(action.getByText(/^Sent /)).toHaveCount(0);

    const submit = await page.request.post(`/api/appointments/${appointmentId}/review-request?salonSlug=${e2eConfig.salonSlug}`, { data: {} });

    expect(submit.ok(), await submit.text()).toBe(true);
    expect(await count()).toBe(1);

    await page.screenshot({ path: testInfo.outputPath('owner-review-queued.png'), fullPage: true });
    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=review-requests`);
    await panel.getByRole('checkbox', { name: 'Automatically request reviews' }).uncheck();
    await panel.getByRole('button', { name: 'Save review settings' }).click();

    await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    const status = await page.request.get(`/api/appointments/${appointmentId}/review-request?salonSlug=${e2eConfig.salonSlug}`);

    // Proven-unsent cancellation frees manual eligibility while retaining history.
    expect((await status.json()).data.status).toBe('eligible');

    const cancelled = await database.query('SELECT r.status AS request_status, i.status AS intent_status FROM review_request r JOIN communication_intent i ON i.id = r.intent_id WHERE r.client_id = $1', [clientId]);

    expect(cancelled.rows).toEqual([{ request_status: 'cancelled', intent_status: 'canceled' }]);
  } finally {
    // Keep history on the disposable database; always leave automation disabled.
    if (salonId) {
      await database.query('UPDATE salon_retention_settings SET automatic_review_requests = false WHERE salon_id = $1', [salonId]);
      await database.query('UPDATE appointment SET status = \'cancelled\' WHERE id = $1 AND salon_id = $2 AND status = \'confirmed\'', [appointmentId, salonId]);
    }
    await database.query('UPDATE technician SET is_active = false WHERE id = $1', [technicianId]);
    await database.end();
  }
});
