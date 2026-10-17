/**
 * Explicitly opt-in, billable owner-UI acceptance trial. Never part of CI.
 * Uses an existing synthetic owner fixture and the fixed disposable local DB.
 * It cannot seed a design, call generation/publication APIs, or repair source.
 * Fixture/session files and provider outputs must remain outside Git.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, expect } from '@playwright/test';
import pg from 'pg';

const origin = 'http://localhost:3197';
const renderer = 'http://127.0.0.1:3198/renderer';
const { Client } = pg;
assert.equal(process.env.LUSTER_REAL_AI_TRIAL, 'true', 'Explicit isolated real-AI trial opt-in is required.');
assert(process.env.LUSTER_REAL_AI_FIXTURE, 'Set LUSTER_REAL_AI_FIXTURE to the private synthetic-owner JSON file.');
const fixture = JSON.parse(fs.readFileSync(process.env.LUSTER_REAL_AI_FIXTURE, 'utf8'));
assert.match(fixture.salonId, /^paid_ai_trial_[a-f0-9]{32}$/u);
assert.match(fixture.salonSlug, /^paid-ai-[a-z0-9-]+$/u);
assert.equal(typeof fixture.session, 'string');
const [step, messageOrArtifact, reference] = process.argv.slice(2);
assert(['message', 'photos', 'preview', 'restore', 'publish', 'book'].includes(step), 'Choose message, photos, preview, restore, publish or book.');
if (step === 'message' || step === 'restore') {
  assert(messageOrArtifact, 'An owner message or saved design identity is required.');
}
const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${step}`;
const output = path.resolve('artifacts/ai-credits/real-provider', fixture.salonSlug, runId);
fs.mkdirSync(output, { recursive: true });
const database = new Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development', password: 'luster-e2e-ci-only-password' });
await database.connect();
const identity = (await database.query('SELECT current_database() AS name, inet_server_addr()::text AS host')).rows[0];
const markers = (await database.query('SELECT environment FROM luster_environment LIMIT 2')).rows;
assert.equal(identity.name, 'luster_ai_setup_development');
assert.equal(identity.host, '127.0.0.1/32');
assert.deepEqual(markers, [{ environment: 'development' }]);
const allocation = (await database.query('SELECT cap_micro_cad FROM setup_ai_budget WHERE id=$1', ['initial-custom-website-trial'])).rows[0];
// The cross-environment CAD80 allowance was reconciled separately. This runner
// cannot create/reset/increase it, even when a fixture has unused retail credit.
assert(allocation?.cap_micro_cad <= 11_384_406, 'Reconcile the shared trial allowance before changing this bound.');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: origin, recordVideo: { dir: output } });
await context.addCookies([{ name: 'n5_admin_session', value: fixture.session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const restrictNetwork = async (target) => {
  await target.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.protocol === 'blob:' || ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
  });
};
await restrictNetwork(context);
const page = await context.newPage();
let operationId;
const startedAt = new Date();
const failures = [];
page.on('request', (request) => {
  if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/business-setup') {
    const body = request.postDataJSON();
    if (body.action === 'message') {
      operationId = body.message.operationId;
    }
  }
});
page.on('pageerror', error => failures.push(error.message.slice(0, 300)));
const head = async () => (await database.query(`SELECT w.status,r.revision,r.document FROM business_setup_workspace w
  JOIN business_setup_revision r ON r.workspace_id=w.id AND r.revision=w.head_revision WHERE w.salon_id=$1`, [fixture.salonId])).rows[0];
const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
const openPreview = async () => {
  const previewToggle = page.getByRole('button', { name: 'Preview', exact: true });
  if (await previewToggle.getAttribute('aria-pressed') !== 'true') {
    await previewToggle.click();
  }

  await expect(page.getByRole('link', { name: 'Open full preview', exact: true })).toHaveAttribute('href', `/admin/business-setup/design-preview/${fixture.salonSlug}?revision=${(await head()).revision}`, { timeout: 45_000 });

  await expect(page.locator(`iframe[src="${renderer}"]`)).toBeVisible({ timeout: 45_000 });
  await expect(page.frameLocator(`iframe[src="${renderer}"]`).locator('body')).not.toBeEmpty();

  await screenshot('owner-desktop');
  const href = await page.getByRole('link', { name: 'Open full preview', exact: true }).getAttribute('href');
  assert(href?.startsWith('/admin/business-setup/design-preview/'), 'Use the authenticated full preview supplied by the builder.');
  const preview = await context.newPage();
  try {
    for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await preview.setViewportSize({ width, height });
      await preview.goto(href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const body = preview.frameLocator(`iframe[src="${renderer}"]`).locator('body');

      await expect(body).not.toBeEmpty({ timeout: 45_000 });
      await expect(preview.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-field="business.name"]').first()).toHaveText((await head()).document.business.name, { timeout: 45_000 });
      await expect(preview.getByText('Loading your custom website…', { exact: true })).toHaveCount(0);

      const frame = preview.frames().find(item => item.url() === renderer);
      assert(frame);
      assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, `Generated ${device} layout overflows horizontally.`);
      assert.equal(await frame.evaluate(() => {
        try {
          return parent.document.cookie;
        } catch {
          return 'blocked';
        }
      }), 'blocked');
      assert.equal(await frame.evaluate(() => {
        try {
          return document.cookie;
        } catch {
          return 'blocked';
        }
      }), 'blocked');
      await preview.screenshot({ path: path.join(output, `${device}-top.png`), fullPage: true, animations: 'disabled' });
      await preview.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-services]').scrollIntoViewIfNeeded();
      await preview.screenshot({ path: path.join(output, `${device}-services.png`), fullPage: true, animations: 'disabled' });
    }
  } finally {
    await preview.close();
  }
};
let before;
let after;
let failure;
try {
  await page.goto(`/admin/business-setup?salon=${fixture.salonSlug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible({ timeout: 60_000 });

  before = await head();
  assert(before);
  if (['message', 'photos', 'restore', 'publish'].includes(step)) {
    assert.equal(before.status, 'editing', 'Return through Edit with AI before changing a published salon.');
  }
  if (step === 'message') {
    if (reference) {
      await page.locator('#setup-attach-button').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /^Inspiration/u }).click();
      await page.locator('#setup-attachment-file').setInputFiles(reference);
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Add to chat', exact: true }).click();

      await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    }
    // First-time owners intentionally have no scope selector. Existing designs
    // default to website-only, with explicit business requests routed by the app.
    const scope = page.getByRole('combobox', { name: 'What can Luster change?' });
    if (await scope.count()) {
      await scope.selectOption('website');
    }
    await page.getByLabel('Message Luster', { exact: true }).fill(messageOrArtifact);
    await screenshot('owner-input');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();

    await expect(page.getByLabel('Message Luster', { exact: true })).toHaveValue('', { timeout: 5000 });
    await expect.poll(() => operationId, { timeout: 15_000 }).toBeTruthy();

    await screenshot('submitted-loading');
    let terminal;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const row = (await database.query('SELECT status FROM business_setup_turn WHERE salon_id=$1 AND id=$2', [fixture.salonId, operationId])).rows[0];
      if (row && ['completed', 'failed'].includes(row.status)) {
        terminal = row.status;
        break;
      }
      // A single normal refresh exercises the shipped server-side resume path.
      if (attempt === 15) {
        await page.reload({ waitUntil: 'domcontentloaded' });
      }
      await page.waitForTimeout(1000);
    }
    await screenshot('owner-result');
    assert.equal(terminal, 'completed', 'Owner request did not finish. Inspect retained evidence; do not blindly re-send a paid request.');
    after = await head();
    assert(after.revision > before.revision);
    if (before.document.website.config.customFrontendId) {
      const priceEdit = messageOrArtifact.match(/\bchange BIAB to \$(\d+(?:\.\d{1,2})?)/iu);
      if (priceEdit) {
        const priorService = before.document.services.find(item => item.name === 'BIAB');
        const nextService = after.document.services.find(item => item.id === priorService?.id);
        assert(priorService && nextService, 'The price edit must retain the existing BIAB identity.');
        assert.equal(nextService.priceCents, Math.round(Number(priceEdit[1]) * 100));
        assert.equal(nextService.durationMinutes, priorService.durationMinutes);
        assert.equal(after.document.website.config.customFrontendId, before.document.website.config.customFrontendId, 'A price correction must not regenerate the design.');
      } else {
        for (const field of ['business', 'services', 'hours', 'booking', 'staff', 'bookingPolicy']) {
          assert.deepEqual(after.document[field], before.document[field], `A visual edit unexpectedly changed ${field}.`);
        }
      }
    }
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Saved as draft', { exact: true })).toBeVisible();

    assert.equal((await head()).revision, after.revision, 'Refresh changed the draft.');
    if (after.document.website.config.customFrontendId) {
      await openPreview();
    }
  } else if (step === 'photos') {
    assert(messageOrArtifact, 'Supply one or two synthetic test-image paths.');
    await page.locator('#setup-attach-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^My photos/u }).click();
    await page.locator('#setup-attachment-file').setInputFiles([messageOrArtifact, reference].filter(Boolean));
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Add to chat', exact: true }).click();

    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    await screenshot('selected-test-images');
    after = await head();
    assert(after.document.designBrief.websiteAssetIds.length > before.document.designBrief.websiteAssetIds.length);
    assert.deepEqual(after.document.services, before.document.services);
  } else if (step === 'restore') {
    await openPreview();
    await page.getByText('Previous designs', { exact: true }).click();
    const history = (await database.query('SELECT id FROM custom_site_artifact WHERE salon_id=$1 ORDER BY created_at DESC', [fixture.salonId])).rows;
    const index = history.findIndex(item => item.id === messageOrArtifact);
    assert(index >= 0, 'Choose a saved design from this synthetic salon.');
    await page.getByRole('button', { name: 'Restore as draft', exact: true }).nth(index).click();

    await expect.poll(async () => (await head()).document.website.config.customFrontendId).toBe(messageOrArtifact);

    await openPreview();
  } else if (step === 'publish') {
    const publicCheck = await browser.newContext({ baseURL: origin });
    try {
      assert.equal((await publicCheck.request.get(`/${fixture.salonSlug}/book/service`)).status(), 404, 'This new synthetic salon must remain private before approval.');
    } finally {
      await publicCheck.close();
    }
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const accept = page.getByRole('button', { name: 'Accept the displayed prices and times', exact: true });
    if (await accept.count()) {
      await accept.click();
    }
    await page.getByRole('button', { name: 'Review', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Review your changes', exact: true })).toBeVisible();

    await screenshot('exact-review');

    await expect(page.getByRole('button', { name: 'Approve and publish', exact: true })).toBeEnabled();

    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Your approved changes are published.', exact: true })).toBeVisible({ timeout: 60_000 });

    await screenshot('publication-succeeded');
  } else if (step === 'preview') {
    await openPreview();
  } else {
    // Genuine anonymous original-booking journey. No API appointment shortcut.
    const customer = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
    await restrictNetwork(customer);
    const booking = await customer.newPage();
    try {
      await booking.goto(`/${fixture.salonSlug}/book/service`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const site = booking.frameLocator(`iframe[src="${renderer}"]`);

      await expect(site.locator('[data-luster-services] > *').first()).toBeVisible({ timeout: 45_000 });

      // Select a real bound service rather than an unconnected generic link.
      const biab = site.locator('[data-luster-services] > *').filter({ hasText: /BIAB/u }).first();
      const card = await biab.count() ? biab : site.locator('[data-luster-services] > *').first();
      await card.locator('[data-luster-book]').click();

      await expect(booking).toHaveURL(/nativeBooking=1.*baseServiceId=/u);

      await booking.getByTestId('service-continue-button').click();
      await booking.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/u);
      if (new URL(booking.url()).pathname.endsWith('/book/tech')) {
        await booking.getByRole('button', { name: /Synthetic Owner/u }).click();
      }

      await expect(booking).toHaveURL(/\/book\/time/u);

      let selected = false;
      for (let day = 0; day < 14 && !selected; day += 1) {
        const buttons = booking.locator('[data-testid^="calendar-day-"]:not([disabled])');
        assert(await buttons.count(), 'The original booking calendar has no eligible days.');
        if (day >= await buttons.count()) {
          break;
        }
        await buttons.nth(day).click();
        const slot = booking.locator('[data-testid^="time-slot-"]:not([disabled])').first();
        try {
          await expect(slot).toBeVisible({ timeout: 8000 });

          await slot.click();
          selected = true;
        } catch { /* Next displayed day, as a customer would. */ }
      }
      assert(selected, 'No bookable slot was shown by the original calendar.');

      await booking.waitForURL(/\/book\/confirm(?:\?|$)/u, { timeout: 60_000 });

      await expect(booking.getByRole('heading', { name: 'Review & confirm', exact: true })).toBeVisible({ timeout: 60_000 });

      await booking.getByLabel('Customer name', { exact: true }).fill('Synthetic AI Website Customer');
      await booking.getByLabel('Customer email', { exact: true }).fill(`ai-trial-${Date.now()}@example.invalid`);
      await booking.getByLabel('Customer phone', { exact: true }).fill('4165550198');
      const sms = booking.getByRole('checkbox', { name: 'Text me appointment confirmations, reminders, and review requests', exact: true });
      if (await sms.count()) {
        await sms.uncheck();
      }
      const policy = booking.getByTestId('booking-policy-acknowledgment').getByRole('checkbox');
      if (await policy.count()) {
        await policy.check();
      }
      await booking.screenshot({ path: path.join(output, 'original-booking-confirm.png'), fullPage: true });
      const created = booking.waitForResponse(response => new URL(response.url()).pathname === '/api/appointments' && response.request().method() === 'POST');
      await booking.getByRole('button', { name: /confirm appointment/iu }).click();
      assert.equal((await created).status(), 201);

      await expect(booking.getByRole('heading', { name: /appointment confirmed/iu })).toBeVisible({ timeout: 60_000 });
      await expect(booking.getByText('BIAB', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

      // Capture the settled original receipt rather than a translucent frame
      // from its client-side entrance animation.
      await booking.waitForTimeout(1200);

      await booking.screenshot({ path: path.join(output, 'original-booking-completed.png'), fullPage: true });
    } finally {
      await customer.close();
    }
  }
} catch (error) {
  failure = error.message.slice(0, 600);
  await screenshot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  after ??= await head();
  const calls = operationId
    ? (await database.query(`SELECT id,operation_id,model,provider,status,input_tokens,output_tokens,cost_micro_usd,
    charged_micro_cad,credit_cost_micro_cad,elapsed_ms,validation FROM setup_ai_call WHERE salon_id=$1
    AND (operation_id=$2 OR operation_id=(SELECT design_operation_id FROM business_setup_turn WHERE salon_id=$1 AND id=$2)) ORDER BY created_at`, [fixture.salonId, operationId])).rows
    : [];
  const artifacts = (await database.query('SELECT id,parent_id,source_hash FROM custom_site_artifact WHERE salon_id=$1 ORDER BY created_at', [fixture.salonId])).rows;
  const appointments = (await database.query('SELECT id,total_price,total_duration_minutes FROM appointment WHERE salon_id=$1 ORDER BY created_at', [fixture.salonId])).rows;
  const evidence = { step, operationId, status: failure ? 'failed' : 'passed', failure, startedAt, elapsedMs: Date.now() - startedAt.getTime(), beforeRevision: before?.revision, afterRevision: after?.revision, artifactId: after?.document.website.config.customFrontendId ?? null, calls, artifacts, appointments, browserErrors: failures, funding: 'Synthetic CAD10 recovery grant; no Stripe payment or purchase is claimed.' };
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify({ step, status: evidence.status, revision: after?.revision, providerMicroUsd: calls.reduce((sum, item) => sum + (item.cost_micro_usd ?? 0), 0), output, ...(failure ? { failure } : {}) })}\n`);
  await context.close();
  await browser.close();
  await database.end();
}
