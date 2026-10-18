/**
 * Explicitly opt-in, billable owner-UI acceptance trial. Never part of CI.
 * Uses an existing synthetic owner fixture and the fixed disposable local DB.
 * It cannot seed a design, call generation/publication APIs, or repair source.
 * Fixture/session files and provider outputs must remain outside Git.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, expect as baseExpect, webkit } from '@playwright/test';
import pg from 'pg';

import { aiTrialOrigins, assertHttpsTrialStep, restrictAiTrialNetwork, trialApiTarget } from './lib/ai-trial-origins.mjs';

const profile = aiTrialOrigins(process.env.LUSTER_REAL_AI_HTTPS === 'true');
const { origin } = profile;
const renderer = `${profile.rendererOrigin}/renderer`;
const expect = baseExpect.configure({ timeout: 20_000 });
const { Client } = pg;
assert.equal(process.env.LUSTER_REAL_AI_TRIAL, 'true', 'Explicit isolated real-AI trial opt-in is required.');
assert(process.env.LUSTER_REAL_AI_FIXTURE, 'Set LUSTER_REAL_AI_FIXTURE to the private synthetic-owner JSON file.');
const fixture = JSON.parse(fs.readFileSync(process.env.LUSTER_REAL_AI_FIXTURE, 'utf8'));
assert.match(fixture.salonId, /^paid_ai_trial_[a-f0-9]{32}$/u);
assert.match(fixture.salonSlug, /^paid-ai-[a-z0-9-]+$/u);
assert.equal(typeof fixture.session, 'string');
const [step, messageOrArtifact, reference] = process.argv.slice(2);
const trialScope = process.env.LUSTER_REAL_AI_SCOPE ?? 'website';
assert(['website', 'business_and_website'].includes(trialScope));
const referencePurpose = process.env.LUSTER_REAL_AI_REFERENCE_PURPOSE ?? 'inspiration';
assert(['inspiration', 'own', 'keep_design'].includes(referencePurpose));
assert(['message', 'conversation', 'photos', 'preview', 'public-preview', 'start-editing', 'manual-wording', 'service-price', 'booking-link', 'restore', 'publish', 'book', 'connection-recovery'].includes(step), 'Choose message, conversation, photos, preview, public-preview, start-editing, manual-wording, service-price, booking-link, restore, publish, book or connection-recovery.');
if (profile.https) {
  assertHttpsTrialStep(step);
}
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
const canonicalSlug = async () => (await database.query('SELECT slug FROM salon WHERE id=$1', [fixture.salonId])).rows[0].slug;
let salonSlug = await canonicalSlug();
const allocation = (await database.query('SELECT cap_micro_cad FROM setup_ai_budget WHERE id=$1', ['initial-custom-website-trial'])).rows[0];
// The cross-environment CAD80 allowance was reconciled separately. This runner
// cannot create/reset/increase it, even when a fixture has unused retail credit.
assert(allocation?.cap_micro_cad <= 11_384_406, 'Reconcile the shared trial allowance before changing this bound.');

const browserName = process.env.LUSTER_REAL_AI_BROWSER ?? 'chromium';
assert(['chromium', 'webkit'].includes(browserName), 'Choose the installed Chromium or WebKit engine.');
assert(browserName === 'chromium' || step !== 'message', 'Run paid model requests once; use WebKit only to verify saved output.');
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true, ...(profile.https ? { proxy: { server: profile.proxyServer } } : {}) });
const contextOptions = { baseURL: origin, ignoreHTTPSErrors: profile.https };
const context = await browser.newContext({ ...contextOptions, viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output } });
await context.addCookies([{ name: 'n5_admin_session', value: fixture.session, domain: profile.cookieDomain, path: '/', httpOnly: true, secure: profile.https, sameSite: 'Lax' }]);
const restrictNetwork = target => restrictAiTrialNetwork(target, profile);
await restrictNetwork(context);
const page = await context.newPage();
let operationId;
const startedAt = new Date();
const failures = [];
const contactChecks = [];
const interactionChecks = [];
const serverProbes = [];
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
const livePrices = async () => (await database.query('SELECT id,name,price,duration_minutes FROM service WHERE salon_id=$1 ORDER BY id', [fixture.salonId])).rows;
const liveExtras = async () => (await database.query('SELECT id,name,price_cents,duration_minutes,pricing_type,max_quantity,is_active FROM add_on WHERE salon_id=$1 ORDER BY id', [fixture.salonId])).rows;
const liveSettingsFingerprint = async () => createHash('sha256').update(JSON.stringify((await database.query('SELECT name,city,address,business_hours,settings->\'booking\' AS booking,settings->\'payments\' AS payments,settings->\'communications\' AS communications,settings#>\'{bookingPage,live}\' AS live_website,settings#>\'{bookingPageContent,live}\' AS live_content FROM salon WHERE id=$1', [fixture.salonId])).rows[0])).digest('hex');
const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
const openPreview = async () => {
  const setupDocument = (await head()).document;
  const artifactId = setupDocument.website.config.customFrontendId;
  const artifact = (await database.query('SELECT source FROM custom_site_artifact WHERE salon_id=$1 AND id=$2', [fixture.salonId, artifactId])).rows[0];
  const canva = artifact?.source?.canva;
  const previewToggle = page.getByRole('button', { name: 'Preview', exact: true });
  if (await previewToggle.getAttribute('aria-pressed') !== 'true') {
    await previewToggle.click();
  }

  await expect(page.getByRole('link', { name: 'Open full preview', exact: true })).toHaveAttribute('href', `/admin/business-setup/design-preview/${salonSlug}?revision=${(await head()).revision}`, { timeout: 45_000 });

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
      const proposed = (await head()).document.services.find(service => service.name === 'BIAB') ?? (await head()).document.services[0];
      const proposedCard = preview.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-services] > *').filter({ hasText: proposed.name }).first();

      await expect(proposedCard.locator('[data-luster-book]')).toHaveAttribute('data-luster-book', `setup_preview_${proposed.id}`);
      await expect(proposedCard.locator('[data-luster-field="service.durationMinutes"]')).toHaveText(String(proposed.durationMinutes));

      const proposedPrice = await proposedCard.locator('[data-luster-field="service.priceLabel"]').textContent() ?? '';
      assert.equal(Math.round(Number(proposedPrice.match(/\d+(?:,\d{3})*(?:\.\d{2})?/u)?.[0]?.replaceAll(',', '')) * 100), proposed.priceCents, 'Private preview must display the proposed price, not the live price.');
      if (profile.https) {
        assert.equal(await preview.evaluate(() => isSecureContext), true);
        assert.equal(await frame.evaluate(() => {
          try {
            return localStorage.length;
          } catch {
            return 'blocked';
          }
        }), 'blocked');
        const blocked = await frame.evaluate(async () => {
          let violated = false;
          const observe = (event) => {
            violated ||= event.effectiveDirective === 'connect-src';
          };
          document.addEventListener('securitypolicyviolation', observe);
          try {
            await fetch('https://example.invalid/luster-csp-negative-check');
          } catch { /* Expected denial by the frame's CSP. */ }
          await new Promise(resolve => setTimeout(resolve, 100));
          document.removeEventListener('securitypolicyviolation', observe);
          return violated;
        });
        assert.equal(blocked, true, 'The isolated frame must enforce connect-src itself.');
        interactionChecks.push({ device, secureContext: true, parentCookies: 'blocked', frameStorage: 'blocked', connectSrcViolation: true });
      }
      assert.equal(await frame.evaluate(() => {
        try {
          return document.cookie;
        } catch {
          return 'blocked';
        }
      }), 'blocked');
      await preview.screenshot({ path: path.join(output, `${device}-top.png`), fullPage: true, animations: 'disabled' });
      if (canva) {
        const images = preview.frameLocator(`iframe[src="${renderer}"]`).locator('.canva-page > img');

        await expect(images).toHaveCount(canva.pages.length);

        for (const [index, artwork] of canva.pages.entries()) {
          await expect(images.nth(index)).toHaveAttribute('width', String(artwork.width));
          await expect(images.nth(index)).toHaveAttribute('height', String(artwork.height));
        }
        assert.equal(await frame.evaluate(() => [...document.querySelectorAll('.canva-page > img')].every(image => image.complete && image.naturalWidth > 0)), true, 'Every preserved Canva page must actually load.');
        interactionChecks.push({ device, preservedCanvaPages: canva.pages.length, areaCount: canva.areas.length });
      } else {
        await preview.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-services]').scrollIntoViewIfNeeded();
      }
      await preview.screenshot({ path: path.join(output, `${device}-services.png`), fullPage: true, animations: 'disabled' });
      const details = (await head()).document.website.content.websiteDetails;
      const links = {
        ...(details?.instagram ? { instagram: `https://www.instagram.com/${details.instagram.replace(/^@/u, '')}/` } : {}),
        ...(details?.email ? { email: `mailto:${details.email}` } : {}),
        ...(details?.phone ? { phone: `tel:${details.phone.replace(/[^+0-9]/gu, '')}` } : {}),
      };
      for (const [kind, href] of Object.entries(links)) {
        const anchor = preview.frameLocator(`iframe[src="${renderer}"]`).locator(`a[data-luster-link="${kind}"]`).first();

        await expect(anchor).toHaveAttribute('href', href);

        await anchor.scrollIntoViewIfNeeded();

        await expect(anchor).toBeVisible();

        const check = { device, kind, href, tapAttemptVerified: false };
        if (device === 'mobile' && kind === 'instagram') {
          let attempted = false;
          const observe = (request) => {
            if (request.url() === href) {
              attempted = true;
            }
          };
          context.on('request', observe);
          try {
            await anchor.click();

            await expect.poll(() => attempted, { timeout: 20_000 }).toBe(true);

            check.tapAttemptVerified = true;
          } finally {
            context.off('request', observe);
            for (const popup of context.pages().filter(item => item !== page && item !== preview)) {
              await popup.close();
            }
          }
        }
        contactChecks.push(check);
      }
      if (Object.keys(links).length) {
        await preview.screenshot({ path: path.join(output, `${device}-contacts.png`), fullPage: true, animations: 'disabled' });
      }
      if (device === 'mobile') {
        const animatedElements = await frame.evaluate(() => [...document.querySelectorAll('*')].filter(node => getComputedStyle(node).animationName !== 'none').length);
        interactionChecks.push({ browserName, animatedElements });
        const menu = preview.frameLocator(`iframe[src="${renderer}"]`).locator('button[aria-controls][aria-expanded]').filter({ hasText: /menu/iu }).first();
        if (await menu.count() && await menu.isVisible()) {
          const controlledId = await menu.getAttribute('aria-controls');
          assert.match(controlledId ?? '', /^[a-z][\w-]*$/iu);
          const navigation = preview.frameLocator(`iframe[src="${renderer}"]`).locator(`[id="${controlledId}"]`);
          await menu.focus();
          await menu.press('Enter');

          await expect(menu).toHaveAttribute('aria-expanded', 'true');
          await expect(navigation).toBeVisible();

          await preview.screenshot({ path: path.join(output, 'mobile-menu-open.png'), fullPage: true });
          await menu.press('Enter');

          await expect(menu).toHaveAttribute('aria-expanded', 'false');
          await expect(navigation).not.toBeVisible();

          interactionChecks.push({ browserName, keyboardMenu: 'passed' });
        }
        await preview.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await frame.evaluate(() => [...document.querySelectorAll('*')].every(node => getComputedStyle(node).animationName === 'none')), true, 'Reduced-motion preference must stop generated CSS animations.');
        interactionChecks.push({ browserName, reducedMotion: 'passed' });
      }
    }
  } finally {
    await preview.close();
  }
};
let before;
let after;
let failure;
let liveServicePricesBefore;
let liveAddOnsBefore;
let liveSettingsBefore;
let bookingResponseStatus;
let bookingSubmissionCount = 0;
const historicalAppointments = async () => (await database.query('SELECT id,md5(to_jsonb(a)::text) AS fingerprint FROM appointment a WHERE salon_id=$1 ORDER BY id', [fixture.salonId])).rows;
let historicalBefore;
let modelCallCountBefore;
try {
  // Local cold compilation is measured separately from provider generation.
  await page.goto(`/admin/business-setup?salon=${salonSlug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled({ timeout: 60_000 });

  before = await head();
  assert(before);
  liveServicePricesBefore = await livePrices();
  liveAddOnsBefore = await liveExtras();
  liveSettingsBefore = await liveSettingsFingerprint();
  historicalBefore = await historicalAppointments();
  modelCallCountBefore = Number((await database.query('SELECT count(*) AS count FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count);
  if (profile.https && before.status === 'editing') {
    await page.getByRole('textbox', { name: 'Message Luster', exact: true }).fill('Check that paid AI is disabled.');

    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();

    await page.getByRole('textbox', { name: 'Message Luster', exact: true }).fill('');
    interactionChecks.push({ paidAiSending: 'disabled' });
  }
  if (['message', 'photos', 'manual-wording', 'service-price', 'booking-link', 'restore', 'publish'].includes(step)) {
    assert.equal(before.status, 'editing', 'Return through Edit with AI before changing a published salon.');
  }
  if (step === 'conversation') {
    await expect(page.locator('.setup-owner').last()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.setup-assistant').last()).toContainText(/deposit|reminder/iu);

    await page.locator('.setup-owner').last().scrollIntoViewIfNeeded();
    await screenshot('saved-conversation');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.setup-owner').last().scrollIntoViewIfNeeded();
    await screenshot('saved-conversation-mobile');
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
  } else if (step === 'message') {
    if (reference) {
      await page.locator('#setup-attach-button').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: referencePurpose === 'inspiration' ? /^Inspiration/u : /^My design or menu/u }).click();
      if (referencePurpose === 'keep_design') {
        await dialog.getByRole('checkbox', { name: /^Keep my Canva design/u }).check();
      }
      await page.locator('#setup-attachment-file').setInputFiles(reference);
      await dialog.getByRole('checkbox', { name: referencePurpose === 'inspiration' ? /^I may upload these files/u : /^These are my files/u }).check();
      await dialog.getByRole('button', { name: 'Add to chat', exact: true }).click();

      await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    }
    // First-time owners intentionally have no scope selector. Existing designs
    // default to website-only, with explicit business requests routed by the app.
    const scope = page.getByRole('combobox', { name: 'What can Luster change?' });
    if (await scope.count()) {
      await scope.selectOption(trialScope === 'business_and_website' ? 'all' : 'website');
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
    assert.deepEqual(await livePrices(), liveServicePricesBefore, 'Chat changes must not update the live service catalog.');
    assert.deepEqual(await liveExtras(), liveAddOnsBefore, 'Chat changes must not update the live add-on catalog.');
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore, 'Chat changes must not update live business, payment, messaging or public website settings.');
    if (before.document.website.config.customFrontendId) {
      const priceEdit = messageOrArtifact.match(/\bchange BIAB to \$(\d+(?:\.\d{1,2})?)/iu);
      if (priceEdit) {
        const matches = before.document.services.filter(item => /^BIAB(?:[\s—\-]|$)/iu.test(item.name));
        assert.equal(matches.length, 1, 'This trial requires one unambiguous BIAB service.');
        const priorService = matches[0];
        const nextService = after.document.services.find(item => item.id === priorService?.id);
        assert(priorService && nextService, 'The price edit must retain the existing BIAB identity.');
        assert.equal(nextService.priceCents, Math.round(Number(priceEdit[1]) * 100));
        assert.equal(nextService.durationMinutes, priorService.durationMinutes);
        assert.equal(after.document.website.config.customFrontendId, before.document.website.config.customFrontendId, 'A price correction must not regenerate the design.');
        for (const field of ['business', 'hours', 'booking', 'staff', 'bookingPolicy']) {
          assert.deepEqual(after.document[field], before.document[field]);
        }
        assert.deepEqual(after.document.services.filter(item => item.id !== priorService.id), before.document.services.filter(item => item.id !== priorService.id));
      } else if (trialScope === 'website') {
        for (const field of ['business', 'services', 'hours', 'booking', 'staff', 'bookingPolicy', 'addOns']) {
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
  } else if (step === 'start-editing') {
    assert.equal(before.status, 'published');
    await page.getByRole('button', { name: 'Make more changes', exact: true }).click();

    await expect.poll(async () => (await head()).status).toBe('editing');

    after = await head();
    assert.equal(after.document.website.config.customFrontendId, before.document.website.config.customFrontendId);
    assert.deepEqual(after.document.services.map(item => ({ id: item.id, name: item.name, price: item.priceCents, duration_minutes: item.durationMinutes })).sort((a, b) => a.id.localeCompare(b.id)), liveServicePricesBefore);
    await screenshot('current-business-loaded-for-editing');
  } else if (step === 'service-price') {
    const price = Number(messageOrArtifact);
    assert(Number.isFinite(price) && price >= 0 && price <= 1000, 'Choose a bounded synthetic test price.');
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const form = page.locator('form.setup-service').filter({ has: page.locator('input[name="name"][value="BIAB"]') });

    await expect(form).toHaveCount(1);

    await form.getByRole('spinbutton', { name: 'Price', exact: true }).fill(String(price));
    await form.getByRole('button', { name: 'Save service', exact: true }).click();

    await expect.poll(async () => (await head()).document.services.find(service => service.name === 'BIAB')?.priceCents).toBe(Math.round(price * 100));

    after = await head();
    assert.equal(after.document.website.config.customFrontendId, before.document.website.config.customFrontendId);
    assert.deepEqual(await livePrices(), liveServicePricesBefore);
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
    await screenshot('manual-price-draft');
    await openPreview();
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
  } else if (step === 'manual-wording') {
    await openPreview();
    const originalId = before.document.website.config.customFrontendId;
    const original = (await database.query('SELECT source FROM custom_site_artifact WHERE salon_id=$1 AND id=$2', [fixture.salonId, originalId])).rows[0];
    assert(original);
    await page.getByText('Edit website wording', { exact: true }).click();
    const wording = page.getByRole('textbox', { name: /^Website text:/u }).first();

    await expect(wording).toBeVisible();

    await wording.fill(messageOrArtifact ?? 'Manual wording test');
    await screenshot('manual-wording-control');
    await page.getByRole('button', { name: 'Save wording', exact: true }).click();

    await expect.poll(async () => (await head()).document.website.config.customFrontendId, { timeout: 30_000 }).not.toBe(originalId);

    after = await head();
    const edited = (await database.query('SELECT source FROM custom_site_artifact WHERE salon_id=$1 AND id=$2', [fixture.salonId, after.document.website.config.customFrontendId])).rows[0];
    assert.equal(edited.source.css, original.source.css);
    assert.equal(edited.source.javascript, original.source.javascript);
    assert(edited.source.html.includes(messageOrArtifact ?? 'Manual wording test'));
    for (const field of ['business', 'services', 'hours', 'booking', 'staff', 'bookingPolicy']) {
      assert.deepEqual(after.document[field], before.document[field]);
    }
    await openPreview();
  } else if (step === 'booking-link') {
    assert.match(messageOrArtifact ?? '', /^[a-z0-9][a-z0-9-]{0,45}[a-z0-9]$/u);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByRole('textbox', { name: 'Booking link name', exact: true }).fill(messageOrArtifact);
    await screenshot('booking-link-control');
    await page.getByRole('button', { name: 'Save booking link', exact: true }).click();

    await expect.poll(async () => (await head()).document.siteSlug).toBe(messageOrArtifact);

    assert.equal(await canonicalSlug(), salonSlug, 'Saving a proposed link must not change the live address.');
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
    const anonymous = await browser.newContext(contextOptions);
    try {
      const target = trialApiTarget(`/${messageOrArtifact}/book/service`, profile);
      assert.equal((await anonymous.request.get(target.url, { headers: target.headers, timeout: 60_000 })).status(), 404, 'The proposed link must remain inaccessible before publication.');
    } finally {
      await anonymous.close();
    }
    await page.getByRole('button', { name: 'Review', exact: true }).click();

    await expect(page.getByText(`Your booking website: /en/${messageOrArtifact}/book`, { exact: true })).toBeVisible();

    await screenshot('proposed-link-review');
  } else if (step === 'restore') {
    await openPreview();
    await page.getByText('Previous designs', { exact: true }).click();
    const history = (await database.query('SELECT id FROM custom_site_artifact WHERE salon_id=$1 ORDER BY created_at DESC', [fixture.salonId])).rows;
    const index = history.findIndex(item => item.id === messageOrArtifact);
    assert(index >= 0, 'Choose a saved design from this synthetic salon.');
    await page.getByRole('button', { name: 'Restore as draft', exact: true }).nth(index).click();

    await expect.poll(async () => (await head()).document.website.config.customFrontendId).toBe(messageOrArtifact);

    after = await head();
    for (const field of ['business', 'services', 'hours', 'booking', 'staff', 'addOns', 'bookingPolicy', 'deposit', 'reminders', 'siteSlug']) {
      assert.deepEqual(after.document[field], before.document[field], `Restoring a design must preserve ${field}.`);
    }
    await openPreview();
  } else if (step === 'publish') {
    const publicCheck = await browser.newContext(contextOptions);
    try {
      const salon = (await database.query('SELECT publication_status FROM salon WHERE id=$1', [fixture.salonId])).rows[0];
      const target = trialApiTarget(`/${salonSlug}/book/service`, profile);
      assert.equal((await publicCheck.request.get(target.url, { headers: target.headers, timeout: 60_000 })).status(), salon.publication_status === 'published' ? 200 : 404, 'Preserve the existing public/private state before approval.');
    } finally {
      await publicCheck.close();
    }
    await page.getByRole('button', { name: 'Details', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Your business setup', exact: true })).toBeVisible();

    const accept = page.getByRole('button', { name: 'Accept the displayed prices and times', exact: true });
    if (await accept.count()) {
      await accept.click();
    }
    const acceptExtras = page.getByRole('button', { name: 'Accept the displayed add-ons', exact: true });
    if (await acceptExtras.count()) {
      if (!await acceptExtras.isVisible()) {
        await page.getByText(/^Add-ons and extra time/u).click();
      }
      await acceptExtras.click();
    }
    await page.getByRole('button', { name: 'Review', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Review your changes', exact: true })).toBeVisible();

    await screenshot('exact-review');

    await expect(page.getByRole('button', { name: 'Approve and publish', exact: true })).toBeEnabled();

    if (process.env.LUSTER_REAL_AI_LOSE_PUBLISH_RESPONSE === 'true') {
      await page.route('**/api/admin/business-setup', async (route) => {
        if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'publish') {
          return route.fallback();
        }
        const target = trialApiTarget('/api/admin/business-setup', profile);
        const result = await route.fetch({ url: target.url, headers: { ...await route.request().allHeaders(), ...target.headers }, maxRedirects: 0 });
        assert.equal(result.status(), 200, 'Fault injection drops only a committed successful response.');
        await route.abort('failed');
      });
    }

    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Your approved changes are published.', exact: true })).toBeVisible({ timeout: 60_000 });

    salonSlug = await canonicalSlug();

    await expect(page.getByRole('link', { name: 'Open your booking website' })).toHaveAttribute('href', `/en/${salonSlug}/book/service?publishedWebsite=1`);

    await screenshot('publication-succeeded');
    if (process.env.LUSTER_REAL_AI_LOSE_PUBLISH_RESPONSE === 'true') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });

      await expect(page.getByRole('heading', { name: 'Your approved changes are published.', exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('link', { name: 'Open your booking website' })).toHaveAttribute('href', `/en/${salonSlug}/book/service?publishedWebsite=1`);

      const receipts = (await database.query('SELECT revision FROM business_setup_publication WHERE salon_id=$1', [fixture.salonId])).rows;
      const publishedRevision = (await head()).revision;
      assert.equal(receipts.filter(receipt => receipt.revision === publishedRevision).length, 1);
      await screenshot('recovered-after-refresh');
    }
  } else if (step === 'connection-recovery') {
    assert.equal(before.status, 'editing');
    const unsent = 'Make my logo bigger';
    const input = page.getByRole('textbox', { name: 'Message Luster', exact: true });
    await input.fill(unsent);
    const interruptReview = route => route.request().method() === 'POST' && route.request().postDataJSON().action === 'review' ? route.abort('failed') : route.fallback();
    await page.route('**/api/admin/business-setup', interruptReview);
    await page.getByRole('button', { name: 'Review', exact: true }).click();

    const errorNotice = page.getByRole('alert').filter({ hasText: 'Your connection dropped. Reload your saved changes before trying again.' });

    await expect(errorNotice).toBeVisible();
    await expect(input).toHaveValue(unsent);

    await screenshot('connection-error-keeps-message');
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot('connection-error-mobile');
    await page.unroute('**/api/admin/business-setup', interruptReview);
    await page.getByRole('button', { name: 'Reload saved changes', exact: true }).click();

    await expect(errorNotice).toHaveCount(0);
    await expect(input).toHaveValue(unsent);

    await screenshot('connection-recovered');
    assert.deepEqual(await head(), before, 'Recovering a read must not create or approve a draft change.');
    interactionChecks.push({ connectionRecovery: 'plain-language error, unsent message retained, saved revision recovered without mutation' });
  } else if (step === 'preview') {
    await openPreview();
  } else if (step === 'public-preview') {
    const anonymous = await browser.newContext({ ...contextOptions, viewport: { width: 390, height: 844 } });
    await restrictNetwork(anonymous);
    const publicPage = await anonymous.newPage();
    try {
      await publicPage.goto(`/${salonSlug}/book/service`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const cards = publicPage.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-services] > *');

      await expect(cards.first()).toBeVisible({ timeout: 45_000 });

      const card = cards.filter({ hasText: /BIAB/u }).first();
      const id = await card.locator('[data-luster-book]').getAttribute('data-luster-book');
      const service = (await livePrices()).find(item => item.id === id);
      assert(service);
      const priceText = await card.locator('[data-luster-field="service.priceLabel"]').textContent() ?? '';
      assert.equal(Math.round(Number(priceText.match(/\d+(?:\.\d{2})?/u)?.[0]) * 100), service.price, 'The anonymous page must use live pricing while the draft is different.');
      await card.scrollIntoViewIfNeeded();
      await publicPage.screenshot({ path: path.join(output, 'unchanged-public-service-price.png'), fullPage: true });
    } finally {
      await anonymous.close();
    }
  } else {
    // Genuine anonymous original-booking journey. No API appointment shortcut.
    const customer = await browser.newContext({ ...contextOptions, viewport: { width: 390, height: 844 } });
    await restrictNetwork(customer);
    const booking = await customer.newPage();
    let bookingBody;
    booking.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/appointments') {
        bookingSubmissionCount += 1;
        bookingBody = request.postDataJSON();
      }
    });
    try {
      await booking.goto(`/${salonSlug}/book/service`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const site = booking.frameLocator(`iframe[src="${renderer}"]`);

      await expect(site.locator('[data-luster-services] > *').first()).toBeVisible({ timeout: 45_000 });

      // Select a real bound service rather than an unconnected generic link.
      const biab = site.locator('[data-luster-services] > *').filter({ hasText: /BIAB/u }).first();
      const card = await biab.count() ? biab : site.locator('[data-luster-services] > *').first();
      const bookButton = card.locator('[data-luster-book]');
      const serviceId = await bookButton.getAttribute('data-luster-book');
      const service = (await database.query('SELECT id,name,price,duration_minutes FROM service WHERE salon_id=$1 AND id=$2', [fixture.salonId, serviceId])).rows[0];
      assert(service, 'The generated button must bind to a real service from this salon.');

      await expect(card.locator('[data-luster-field="service.name"]')).toHaveText(service.name);
      await expect(card.locator('[data-luster-field="service.durationMinutes"]')).toHaveText(String(service.duration_minutes));

      const priceText = await card.locator('[data-luster-field="service.priceLabel"]').textContent() ?? '';
      const displayedAmount = priceText.match(/\d+(?:,\d{3})*(?:\.\d{2})?/u)?.[0];
      assert.equal(Math.round(Number(displayedAmount?.replaceAll(',', '')) * 100), service.price, 'The displayed service price must match the live booking amount.');
      await card.scrollIntoViewIfNeeded();
      await booking.screenshot({ path: path.join(output, 'original-public-website.png'), fullPage: true });

      await bookButton.click();

      await expect(booking).toHaveURL(/nativeBooking=1.*baseServiceId=/u);

      let selectedExtra;
      if (process.env.LUSTER_REAL_AI_BOOK_ADD_ON) {
        const matches = (await liveExtras()).filter(extra => extra.name === process.env.LUSTER_REAL_AI_BOOK_ADD_ON);
        assert.equal(matches.length, 1, 'Choose one unambiguous live add-on.');
        selectedExtra = matches[0];
        const choice = booking.getByRole('button', { name: `Add ${selectedExtra.name}`, exact: true });

        await expect(choice).toBeVisible({ timeout: 30_000 });

        await choice.click();
        await booking.screenshot({ path: path.join(output, 'original-booking-after-addon-click.png'), fullPage: true });

        await expect(booking.getByRole('button', { name: `Remove ${selectedExtra.name}`, exact: true })).toBeVisible();

        await booking.screenshot({ path: path.join(output, 'original-booking-selected-addon.png'), fullPage: true });
      }

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
      const created = booking.waitForResponse(response => new URL(response.url()).pathname === '/api/appointments' && response.request().method() === 'POST', { timeout: 180_000 });
      await booking.getByRole('button', { name: /confirm appointment/iu }).click();
      bookingResponseStatus = (await created).status();
      assert([200, 201].includes(bookingResponseStatus), 'Original creation or idempotent recovery must succeed; the final database check still requires exactly one new appointment.');

      await expect(booking.getByRole('heading', { name: /appointment confirmed/iu })).toBeVisible({ timeout: 60_000 });
      await expect(booking.getByText(selectedExtra ? `${service.name} + ${selectedExtra.name}` : service.name, { exact: true }).first()).toBeVisible({ timeout: 60_000 });

      // Capture the settled original receipt rather than a translucent frame
      // from its client-side entrance animation.
      await booking.waitForTimeout(1200);

      await booking.screenshot({ path: path.join(output, 'original-booking-completed.png'), fullPage: true });
      const booked = (await database.query('SELECT id,total_price,total_duration_minutes,technician_id FROM appointment WHERE salon_id=$1 AND created_at >= $2', [fixture.salonId, startedAt])).rows;
      assert.equal(booked.length, 1, 'This customer submission must create exactly one appointment.');
      assert.equal(booked[0].total_price, service.price + (selectedExtra?.price_cents ?? 0));
      assert.equal(booked[0].total_duration_minutes, service.duration_minutes + (selectedExtra?.duration_minutes ?? 0));
      if (selectedExtra) {
        const snapshots = (await database.query('SELECT add_on_id,unit_price_cents_snapshot,line_total_cents_snapshot,line_duration_minutes_snapshot FROM appointment_add_on WHERE appointment_id=$1', [booked[0].id])).rows;
        assert.deepEqual(snapshots, [{ add_on_id: selectedExtra.id, unit_price_cents_snapshot: selectedExtra.price_cents, line_total_cents_snapshot: selectedExtra.price_cents, line_duration_minutes_snapshot: selectedExtra.duration_minutes }]);
      }
      assert((await database.query('SELECT 1 FROM technician_services WHERE service_id=$1 AND technician_id=$2', [service.id, booked[0].technician_id])).rowCount, 'The appointment artist must be assigned to the selected service.');
      if (profile.https) {
        assert(bookingBody);
        // Negative API probe only. Successful appointment creation above always
        // follows the original calendar, customer form and confirmation button.
        const virtualId = `setup_preview_${service.id}`;
        const data = { ...bookingBody, baseServiceId: virtualId, serviceIds: undefined, bookingBasket: undefined, selectedAddOns: [], expectedBasketReviewFingerprint: undefined, catalogAcknowledgment: undefined };
        if (data.bookingPolicyAcknowledgment) {
          data.bookingPolicyAcknowledgment = { ...data.bookingPolicyAcknowledgment, attemptId: randomUUID() };
        }
        const result = await booking.evaluate(async ({ data, key }) => {
          const response = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(data) });
          const payload = await response.json();
          return { status: response.status, code: typeof payload.error === 'string' ? payload.error : payload.error?.code ?? null };
        }, { data, key: randomUUID() });
        serverProbes.push({ kind: 'virtual-preview-service-rejected', ...result });
        assert.deepEqual(result, { status: 400, code: 'INVALID_SELECTION' }, 'The original server must reject the virtual service at its canonical selection validator.');
        assert.equal((await historicalAppointments()).length, historicalBefore.length + 1);
      }
    } catch (error) {
      await booking.screenshot({ path: path.join(output, 'original-booking-failure.png'), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await customer.close();
    }
  }
  const historicalAfter = await historicalAppointments();
  assert.deepEqual(historicalAfter.filter(row => historicalBefore.some(old => old.id === row.id)), historicalBefore, 'Drafts, publication and new bookings must preserve all existing appointment rows.');
  if (profile.https) {
    assert.equal(Number((await database.query('SELECT count(*) AS count FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count), modelCallCountBefore, 'An optimized saved-site check must not spend AI credits.');
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
  const evidence = { step, trialScope, browserName, origin, renderer, optimizedHttps: profile.https, salonSlug, lostPublishResponse: process.env.LUSTER_REAL_AI_LOSE_PUBLISH_RESPONSE === 'true', operationId, status: failure ? 'failed' : 'passed', failure, startedAt, elapsedMs: Date.now() - startedAt.getTime(), beforeRevision: before?.revision, afterRevision: after?.revision, artifactId: after?.document.website.config.customFrontendId ?? null, calls, artifacts, appointments, historicalBefore, liveServicePricesBefore, liveServicePricesAfter: await livePrices(), liveAddOnsBefore, liveAddOnsAfter: await liveExtras(), liveSettingsBefore, liveSettingsAfter: await liveSettingsFingerprint(), bookingResponseStatus, bookingSubmissionCount, serverProbes, contactChecks, interactionChecks, browserErrors: failures, funding: 'Synthetic CAD10 recovery grant; no Stripe payment or purchase is claimed.' };
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify({ step, status: evidence.status, revision: after?.revision, providerMicroUsd: calls.reduce((sum, item) => sum + (item.cost_micro_usd ?? 0), 0), output, ...(failure ? { failure } : {}) })}\n`);
  await context.close();
  await browser.close();
  await database.end();
}
