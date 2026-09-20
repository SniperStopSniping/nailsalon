import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '../../src/libs/disposableDatabaseTarget';
import { getDateKeyInTimeZone } from '../../src/libs/timeZone';
import { impersonateSalonAsSuperAdmin, openAdminAppointmentSheet, openAdminBookings } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

// Normal isolated owner authentication; review writes cannot enqueue real SMS.
test.use({ storageState: authStatePaths.superAdmin });

test('review settings require an explicit automation mode @mobile-safari', async ({ page }) => {
  let settings = {
    googleReviewUrl: null as string | null,
    automaticEnabled: false,
    delayMinutes: 60,
    messageTemplate: 'Hi {{firstName}}! Thanks for visiting {{businessName}}. Review us: {{reviewLink}}',
    businessName: 'Daniela Nails',
  };
  const updates: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/review-requests/settings?**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const update = route.request().postDataJSON() as Record<string, unknown>;

      updates.push(update);
      settings = { ...settings, ...update };
    }
    await route.fulfill({ json: { data: settings } });
  });
  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=review-requests`);
  const panel = page.getByTestId('review-request-settings');

  await expect(panel).toBeVisible();

  await panel.getByLabel('Google review link', { exact: true }).fill('https://g.page/daniela/review');

  const automation = panel.getByRole('radiogroup', { name: 'Automatic review requests' });

  await expect(automation.getByRole('radio', { name: 'Manual only' })).toBeChecked();

  await panel.getByRole('button', { name: 'Save review settings' }).click();

  await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(updates).toHaveLength(1);
  expect(updates[0]).toEqual({
    googleReviewUrl: 'https://g.page/daniela/review',
    delayMinutes: 60,
    messageTemplate: 'Hi {{firstName}}! Thanks for visiting {{businessName}}. Review us: {{reviewLink}}',
    automationMode: 'manual',
    repeatCooldownDays: 'never',
  });

  await automation.getByRole('radio', { name: 'After marked completed' }).check();
  await panel.getByLabel('Send after', { exact: true }).selectOption('60');

  await expect(panel.getByText('Reply STOP to opt out.', { exact: false })).toHaveCount(0);
  await expect(panel.getByText('1 SMS segment · 1 credit', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Save review settings' }).click();

  await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(updates).toHaveLength(2);
  expect(updates[1]).toEqual({
    googleReviewUrl: 'https://g.page/daniela/review',
    delayMinutes: 60,
    messageTemplate: 'Hi {{firstName}}! Thanks for visiting {{businessName}}. Review us: {{reviewLink}}',
    automationMode: 'marked_completed',
    repeatCooldownDays: 'never',
  });

  await panel.getByRole('button', { name: 'Restore default' }).click();

  const finalPreview = panel.getByTestId('sms-message-preview');

  await expect(finalPreview.getByText('1 SMS segment · 1 credit', { exact: true })).toBeVisible();
  await expect(finalPreview.getByText('Daniela Nails via Luster: Thanks for visiting! We\'d love your Google review: https://g.page/daniela/review', { exact: true })).toBeVisible();

  await panel.getByLabel('Message', { exact: true }).fill('Thanks for visiting! We\'d love your Google review: {{reviewLink}} 💅');

  await expect(finalPreview.getByText('2 SMS segments · 2 credits', { exact: true })).toBeVisible();
  await expect(finalPreview.getByText(/U\+1F485/)).toBeVisible();
  await expect(finalPreview.getByText('Reply STOP to opt out.', { exact: false })).toHaveCount(0);
  expect(updates).toHaveLength(2);
});

test('client profile keeps the Google review composer reachable through More actions @mobile-safari', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/admin/review-requests/settings?**', route => route.fulfill({ json: { data: {
    googleReviewUrl: 'https://g.page/r/test/review',
    automaticEnabled: false,
    delayMinutes: 60,
    messageTemplate: 'Hi {{firstName}}, please review {{businessName}}: {{reviewLink}}',
    businessName: 'Luster Test Salon',
  } } }));
  await impersonateSalonAsSuperAdmin(page);
  await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=clients`);
  const firstClient = page.getByTestId('clients-directory-scroll').locator('button').first();

  await expect(firstClient).toBeVisible();

  await firstClient.click();
  await page.getByText('More actions', { exact: true }).filter({ visible: true }).click();
  const action = page.getByRole('button', { name: 'Send Google review link', exact: true });

  await expect(action).toBeVisible();
  await expect(action.locator('xpath=ancestor::details')).toHaveAttribute('open', '');

  const bounds = await action.boundingBox();

  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);

  await action.click();

  await expect(page.getByRole('dialog', { name: 'Send Google review link' })).toBeVisible();
  await expect(page.getByLabel('Message')).toHaveValue(/https:\/\//);
  await expect(page.getByRole('button', { name: 'Send text', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send from my phone · no Luster credits' })).toBeVisible();
});

test('isolated owner completes and queues one review through the real APIs @mobile-safari', async ({ page, baseURL }, testInfo) => {
  test.slow();

  // This test writes only to the independently attested disposable CI database.
  // The real cron may allocate its durable review intent, but provider
  // credentials and platform SMS sending must remain absent/disabled.
  expect(process.env.CI, 'Cron verification requires a freshly managed CI server; reused local servers are not allowed.').toBeTruthy();
  expect(process.env.E2E_BASE_URL || '', 'Real-write review tests require the managed local app server.').toBe('');

  const browserTarget = new URL(baseURL!);

  expect(browserTarget.protocol).toBe('http:');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(browserTarget.hostname);

  const target = requireDisposableDatabaseTarget(process.env);

  expect(process.env.E2E_USE_REAL_TWILIO).not.toBe('true');
  expect(process.env.TWILIO_AUTH_TOKEN || '').toBe('');
  expect(process.env.RESEND_API_KEY || '').toBe('');
  expect(process.env.COMMUNICATIONS_SMS_ENABLED).not.toBe('true');
  expect(process.env.CRON_SECRET, 'The managed CI server needs its synthetic cron credential.').toBeTruthy();

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
    // This journey asserts the exact trigger delay, independently of wall-clock quiet hours.
    await database.query(`UPDATE salon SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{communications}', '{"sms":{"enabled":true},"quietHours":{"enabled":false,"start":"21:00","end":"09:00"}}'::jsonb) WHERE id = $1`, [salonId]);
    await database.query(`INSERT INTO salon_client (id, salon_id, full_name, phone) VALUES ($1, $2, 'Sarah Review Fixture', $3)`, [clientId, salonId, phone]);
    await database.query(`INSERT INTO communication_consent (id, salon_id, recipient, channel, purpose, status, source, wording_version) VALUES ($1, $2, $3, 'sms', 'appointment_transactional', 'granted', 'test', 'test-v1')`, [`review-e2e-consent-${suffix}`, salonId, phone]);
    await database.query('INSERT INTO technician (id, salon_id, name, is_active) VALUES ($1, $2, \'Review Fixture Tech\', true)', [technicianId, salonId]);
    const start = new Date();
    const end = new Date(start.getTime() + 3_600_000);
    await database.query(`INSERT INTO appointment (id, salon_id, salon_client_id, client_name, client_phone, start_time, end_time, status, total_price, total_duration_minutes, technician_id) VALUES ($1, $2, $3, 'Sarah Review Fixture', $4, $5, $6, 'confirmed', 0, 60, $7)`, [appointmentId, salonId, clientId, phone, start, end, technicianId]);
    await database.query(`INSERT INTO appointment (id, salon_id, salon_client_id, client_name, client_phone, start_time, end_time, completed_at, status, total_price, total_duration_minutes) VALUES ($1, $2, $3, 'Sarah Review Fixture', $4, $5, $6, $6, 'completed', 0, 60)`, [historicalId, salonId, clientId, phone, new Date(start.getTime() - 172_800_000), new Date(start.getTime() - 86_400_000)]);
    await impersonateSalonAsSuperAdmin(page);
    // Prove the application reads this fresh attested fixture before settings writes.
    const fixtureResponse = await page.request.get(`/api/appointments/${appointmentId}/review-request?salonSlug=${e2eConfig.salonSlug}`);

    expect(fixtureResponse.ok(), await fixtureResponse.text()).toBe(true);
    expect((await fixtureResponse.json()).data.clientId).toBe(clientId);

    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=review-requests`);
    const panel = page.getByTestId('review-request-settings');

    await expect(panel).toBeVisible();

    await panel.getByLabel('Google review link', { exact: true }).fill(`https://g.page/r/review-fixture-${suffix}/review`);
    await panel.getByLabel('Message', { exact: true }).fill('Hi {{firstName}}! Thank you for visiting {{businessName}}. Share a Google review: {{reviewLink}}');

    await expect(panel.locator('p').filter({ hasText: 'Share a Google review:' })).toBeVisible();

    const automation = panel.getByRole('radiogroup', { name: 'Automatic review requests' });

    await automation.getByRole('radio', { name: 'Manual only' }).check();
    await panel.getByRole('button', { name: 'Save review settings' }).click();

    await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    // This flow exercises the legacy completion trigger, so choose it
    // deliberately instead of adopting scheduled-end automation implicitly.
    await automation.getByRole('radio', { name: 'After marked completed' }).check();
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
    expect(await count()).toBe(0);

    const triggers = await database.query('SELECT scheduled_for, trigger_at, state FROM review_request_trigger WHERE salon_id = $1 AND appointment_id = $2', [salonId, appointmentId]);

    expect(triggers.rows).toHaveLength(1);
    expect(triggers.rows[0].state).toBe('pending');
    expect(new Date(triggers.rows[0].scheduled_for).getTime()).toBe(new Date(triggers.rows[0].trigger_at).getTime() + 3_600_000);

    const beforeWorker = await page.request.get(`/api/appointments/${appointmentId}/review-request?salonSlug=${e2eConfig.salonSlug}`);

    expect(beforeWorker.ok(), await beforeWorker.text()).toBe(true);
    expect((await beforeWorker.json()).data).toMatchObject({ status: 'scheduled', scheduledFor: new Date(triggers.rows[0].scheduled_for).toISOString() });

    const worker = await page.request.post('/api/communications/dispatch', { headers: { 'x-cron-secret': process.env.CRON_SECRET! } });

    expect(worker.ok(), await worker.text()).toBe(true);
    expect((await worker.json()).reviewTriggers).toMatchObject({ phaseError: false });
    expect(await count()).toBe(1);

    const scheduled = (await database.query('SELECT r.scheduled_for, a.completed_at FROM review_request r JOIN appointment a ON a.id = r.appointment_id WHERE r.client_id = $1', [clientId])).rows[0];

    expect(new Date(scheduled.scheduled_for).getTime()).toBeGreaterThanOrEqual(new Date(scheduled.completed_at).getTime() + 3_600_000);

    const materializedTrigger = await database.query('SELECT scheduled_for, state FROM review_request_trigger WHERE salon_id = $1 AND appointment_id = $2', [salonId, appointmentId]);

    expect(materializedTrigger.rows).toEqual([{ scheduled_for: triggers.rows[0].scheduled_for, state: 'materialized' }]);

    await openAdminBookings(page);
    await openAdminAppointmentSheet(page, appointmentId, getDateKeyInTimeZone(start));
    const action = page.getByTestId('appointment-review-request-action');
    await action.getByRole('button', { name: 'Send now', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Send review request', exact: true });

    await expect(confirmation.getByText(phone, { exact: false })).toBeVisible();
    await expect(confirmation.getByText('Reply STOP to opt out.', { exact: false })).toHaveCount(0);
    await expect(confirmation.getByText(/SMS segments? · \d+ credits?/)).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('owner-review-message-preview.png'), fullPage: true });
    await confirmation.getByRole('button', { name: 'Send now', exact: true }).click();

    await expect(confirmation).toBeHidden();
    await expect(action.getByRole('button', { name: 'Send now', exact: true })).toBeVisible();
    await expect(action.getByText(/^Sent /)).toHaveCount(0);

    const submit = await page.request.post(`/api/appointments/${appointmentId}/review-request?salonSlug=${e2eConfig.salonSlug}`, { data: {} });

    expect(submit.ok(), await submit.text()).toBe(true);
    expect(await count()).toBe(1);

    await page.screenshot({ path: testInfo.outputPath('owner-review-queued.png'), fullPage: true });
    await page.goto(`${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=review-requests`);
    await automation.getByRole('radio', { name: 'Manual only' }).check();
    await panel.getByRole('button', { name: 'Save review settings' }).click();

    await expect(panel.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    const status = await page.request.get(`/api/appointments/${appointmentId}/review-request?salonSlug=${e2eConfig.salonSlug}`);

    // Proven-unsent cancellation frees manual eligibility while retaining history.
    expect((await status.json()).data).toMatchObject({ status: 'cancelled', canSendManually: true });

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
