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
import sharp from 'sharp';

import { aiTrialAuth, assertClerkTrialActor, privateClerkStorageState } from './lib/ai-trial-auth.mjs';
import { aiTrialOrigins, assertHttpsTrialStep, restrictAiTrialNetwork, trialApiTarget } from './lib/ai-trial-origins.mjs';

const profile = aiTrialOrigins(process.env.LUSTER_REAL_AI_HTTPS === 'true');
const { origin } = profile;
const renderer = `${profile.rendererOrigin}/renderer`;
const expect = baseExpect.configure({ timeout: 20_000 });
const { Client } = pg;
assert.equal(process.env.LUSTER_REAL_AI_TRIAL, 'true', 'Explicit isolated real-AI trial opt-in is required.');
assert(process.env.LUSTER_REAL_AI_FIXTURE, 'Set LUSTER_REAL_AI_FIXTURE to the private synthetic-owner JSON file.');
const fixture = JSON.parse(fs.readFileSync(process.env.LUSTER_REAL_AI_FIXTURE, 'utf8'));
const ownerAuth = aiTrialAuth(fixture);
assert(ownerAuth.kind !== 'clerk-development' || !profile.https, 'Use real Clerk signup only with the isolated Development app.');
const [step, messageOrArtifact, reference] = process.argv.slice(2);
const trialScope = process.env.LUSTER_REAL_AI_SCOPE ?? 'website';
assert(['website', 'business_and_website'].includes(trialScope));
const referencePurpose = process.env.LUSTER_REAL_AI_REFERENCE_PURPOSE ?? 'inspiration';
assert(['inspiration', 'own', 'keep_design'].includes(referencePurpose));
// Optional human-measured points from the reference, used only for acceptance.
// They never enter a model prompt or alter a generated artifact.
const landmarks = process.env.LUSTER_REAL_AI_CANVA_LANDMARKS ? JSON.parse(fs.readFileSync(process.env.LUSTER_REAL_AI_CANVA_LANDMARKS, 'utf8')) : [];
assert(Array.isArray(landmarks) && landmarks.length <= 40);
for (const point of landmarks) {
  assert(Number.isInteger(point.page) && point.page >= 0 && point.page < 6 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  assert(['instagram', 'email', 'phone', 'service', 'book'].includes(point.action));
}
assert(['unfunded', 'message', 'conversation', 'details', 'photos', 'logo', 'replace-photo', 'canva-upload', 'preview', 'public-preview', 'start-editing', 'manual-wording', 'service-price', 'contact-details', 'booking-link', 'restore', 'canva-review', 'publish', 'book', 'staff-eligibility', 'connection-recovery'].includes(step), 'Choose an owner workflow step.');
if (profile.https) {
  assertHttpsTrialStep(step);
}
if (step === 'message' || step === 'restore') {
  assert(messageOrArtifact, 'An owner message or saved design identity is required.');
}
const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${step}`;
const outputRoot = ownerAuth.kind === 'clerk-development' ? '/tmp/luster-real-clerk-runs' : 'artifacts/ai-credits/real-provider';
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
const output = path.resolve(outputRoot, fixture.salonSlug, runId);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const database = new Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development', password: 'luster-e2e-ci-only-password' });
await database.connect();
const identity = (await database.query('SELECT current_database() AS name, inet_server_addr()::text AS host')).rows[0];
const markers = (await database.query('SELECT environment FROM luster_environment LIMIT 2')).rows;
assert.equal(identity.name, 'luster_ai_setup_development');
assert.equal(identity.host, '127.0.0.1/32');
assert.deepEqual(markers, [{ environment: 'development' }]);
if (ownerAuth.kind === 'clerk-development') {
  await assertClerkTrialActor(database, fixture);
}
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
// Authentication state belongs only to the owner context. Public booking
// contexts below remain anonymous, including in genuine Clerk acceptance runs.
const context = await browser.newContext({ ...contextOptions, ...(ownerAuth.kind === 'clerk-development' ? { storageState: privateClerkStorageState(fixture.clerkStorageState) } : {}), viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output, size: { width: 1440, height: 1000 } } });
if (ownerAuth.kind === 'synthetic-session') {
  await context.addCookies([{ name: 'n5_admin_session', value: fixture.session, domain: profile.cookieDomain, path: '/', httpOnly: true, secure: profile.https, sameSite: 'Lax' }]);
}
const restrictNetwork = target => restrictAiTrialNetwork(target, profile, ownerAuth.frontendApi);
await restrictNetwork(context);
if (ownerAuth.kind === 'clerk-development') {
  const { clerkSetup, setupClerkTestingToken } = await import('@clerk/testing/playwright');
  await clerkSetup({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, dotenv: false });
  await setupClerkTestingToken({ context });
}
const page = await context.newPage();
let operationId;
const startedAt = new Date();
const failures = [];
const contactChecks = [];
const interactionChecks = [];
const serverProbes = [];
const privateAddressChecks = [];
const bookingNavigation = [];
let pdfUpload;
let mediaUpload;
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
const liveSettingsFingerprint = async () => {
  const salon = (await database.query('SELECT name,city,address,business_hours,settings->\'booking\' AS booking,settings->\'payments\' AS payments,settings->\'communications\' AS communications,settings#>\'{bookingPage,live}\' AS live_website,settings#>\'{bookingPageContent,live}\' AS live_content FROM salon WHERE id=$1', [fixture.salonId])).rows[0];
  const staff = (await database.query('SELECT id,name,is_active,weekly_schedule,work_days,start_time,end_time FROM technician WHERE salon_id=$1 ORDER BY id', [fixture.salonId])).rows;
  const assignments = (await database.query('SELECT ts.technician_id,ts.service_id,ts.enabled,ts.priority FROM technician_services ts JOIN technician t ON t.id=ts.technician_id WHERE t.salon_id=$1 ORDER BY ts.technician_id,ts.service_id', [fixture.salonId])).rows;
  return createHash('sha256').update(JSON.stringify({ salon, staff, assignments })).digest('hex');
};
const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
const staffChoice = (page, name) => page.getByRole('button').filter({ has: page.getByText(name, { exact: true }) });
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

  let expectedImages;
  let expectedPhotoUrls;
  if (process.env.LUSTER_REAL_AI_REQUIRE_SELECTED_IMAGES === 'true' && !canva) {
    const response = await context.request.get(`/api/admin/custom-sites?salonSlug=${salonSlug}`);
    assert.equal(response.status(), 200);
    const state = await response.json();
    expectedImages = state.payload.images;
    expectedPhotoUrls = Object.entries(expectedImages).filter(([id]) => state.assets.some(asset => asset.id === id && asset.role === 'photo')).map(([_id, url]) => url);
    assert.deepEqual(Object.keys(expectedImages).sort(), [...setupDocument.designBrief.websiteAssetIds].sort(), 'This owner asked to use all selected photos and the logo.');
  }

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

      if (process.env.LUSTER_REAL_AI_EXPECT_STAFF === 'true') {
        await preview.getByText('Proposed team and service choices', { exact: true }).click();
        const ava = preview.locator('.setup-team-summary p').filter({ hasText: /^Ava:/u });

        await expect(ava).toContainText('BIAB');
        await expect(ava).not.toContainText('Gel Manicure');
        await expect(ava).toContainText('friday: 11:00–16:00');

        await preview.getByText('Proposed booking setup', { exact: true }).click();

        await expect(preview.getByText(/180 minutes notice · 10 minutes extra buffer/u)).toBeVisible();
        await expect(preview.getByRole('region', { name: 'Proposed booking agreement' })).toContainText('Please come alone.');

        const simulated = preview.getByText(/^Simulated times for /u);

        await expect(simulated).toContainText(setupDocument.services.find(service => service.priceCents !== null && service.durationMinutes !== null).name);
        await expect(simulated).toContainText('Existing appointments, time off and external calendars are excluded');

        await preview.screenshot({ path: path.join(output, `${device}-proposed-booking-setup.png`), fullPage: true });
        await preview.getByText('Proposed team and service choices', { exact: true }).click();
        await preview.getByText('Proposed booking setup', { exact: true }).click();
        interactionChecks.push({ device, proposedStaffAssignments: true, proposedBookingRules: true, availabilityExplicitlySimulated: true });
      }

      const frame = preview.frames().find(item => item.url() === renderer);
      assert(frame);
      assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, `Generated ${device} layout overflows horizontally.`);
      if (process.env.LUSTER_REAL_AI_EXPECT_FONT_PACK === 'true') {
        const typography = await frame.evaluate(async () => {
          const families = ['Luster Serif v1', 'Luster Sans v1', 'Luster Script v1'];
          const used = [...document.querySelectorAll('h1,h2,h3,p,a,button,span')].flatMap((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            const family = families.find(family => style.fontFamily.includes(family));
            return family && node.textContent?.trim() && rect.width > 0 && rect.height > 0 ? [{ family, font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} "${family}"`, sample: node.textContent.slice(0, 80) }] : [];
          });
          const entries = [...new Map(used.map(item => [item.family, item])).values()];
          return Promise.all(entries.map(async entry => ({ family: entry.family, faces: (await document.fonts.load(entry.font, entry.sample)).map(face => ({ family: face.family.replaceAll('"', ''), status: face.status })) })));
        });
        for (const family of ['Luster Script v1', 'Luster Sans v1']) {
          const used = typography.find(item => item.family === family);
          assert(used?.faces.length && used.faces.every(face => face.status === 'loaded' && face.family === family), `The real generated ${device} design must display the bundled ${family}, not a fallback.`);
        }
        interactionChecks.push({ device, realGeneratedTypography: typography });
      }
      if (expectedImages) {
        // A real visitor scrolls before seeing below-fold lazy photography.
        // Do not mistake that browser optimization for a missing owner image.
        for (const url of Object.values(expectedImages)) {
          const indexes = await frame.locator('img').evaluateAll((nodes, url) => nodes.flatMap((node, index) => node.src === url ? [index] : []), url);
          for (const index of indexes) {
            const photo = frame.locator('img').nth(index);
            if (await photo.isVisible()) {
              await photo.scrollIntoViewIfNeeded();

              await expect.poll(() => photo.evaluate(image => image.complete && image.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
            }
          }
        }
        await frame.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        const images = await frame.evaluate(expected => Object.entries(expected).map(([id, url]) => {
          const nodes = [...document.querySelectorAll('img')].filter(image => image.src === url);
          return { id, count: nodes.length, loaded: nodes.every(image => image.complete && image.naturalWidth > 0), displayed: nodes.some(image => image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0), dimensions: nodes.map(image => ({ width: image.naturalWidth, height: image.naturalHeight })) };
        }), expectedImages);
        interactionChecks.push({ device, selectedOwnerImages: images });
        for (const image of images) {
          assert(image.count > 0 && image.loaded && image.displayed, `A selected owner image did not actually load/display on ${device}.`);
        }
      }
      const heroGeometry = await frame.evaluate(() => {
        const hero = document.querySelector('.hero,#hero,main>section');
        if (!hero) {
          return null;
        }
        const rect = hero.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      interactionChecks.push({ device, heroGeometry });
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
      if (expectedPhotoUrls?.length >= 2 && !canva) {
        const composition = await frame.evaluate((photos) => {
          const section = [...document.querySelectorAll('section')].find(section => [...section.querySelectorAll('img')].filter(image => photos.includes(image.src)).length >= 2);
          if (!section) {
            return null;
          }
          section.scrollIntoView({ block: 'start', behavior: 'instant' });
          const images = [...section.querySelectorAll('img')].filter(image => photos.includes(image.src)).slice(0, 2);
          const [a, b] = images.map(image => image.getBoundingClientRect());
          const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          return { section: section.id, images: images.length, overlapArea: overlap };
        }, expectedPhotoUrls);
        if (process.env.LUSTER_REAL_AI_REQUIRE_PHOTO_OVERLAP === 'true' && device === 'desktop') {
          assert(composition?.overlapArea > 0, 'The requested desktop photographs must actually overlap in the rendered design.');
        }
        interactionChecks.push({ device, photoComposition: composition });
        if (composition) {
          await preview.screenshot({ path: path.join(output, `${device}-photo-composition.png`), fullPage: true, animations: 'disabled' });
        }
      }
      if (canva) {
        const images = preview.frameLocator(`iframe[src="${renderer}"]`).locator('.canva-page > img');

        await expect(images).toHaveCount(canva.pages.length);

        for (const [index, artwork] of canva.pages.entries()) {
          await expect(images.nth(index)).toHaveAttribute('width', String(artwork.width));
          await expect(images.nth(index)).toHaveAttribute('height', String(artwork.height));
        }
        assert.equal(await frame.evaluate(() => [...document.querySelectorAll('.canva-page > img')].every(image => image.complete && image.naturalWidth > 0)), true, 'Every preserved Canva page must actually load.');
        interactionChecks.push({ device, preservedCanvaPages: canva.pages.length, areaCount: canva.areas.length });
        for (const point of landmarks) {
          const result = await frame.evaluate(async (point) => {
            const image = document.querySelectorAll('.canva-page > img')[point.page];
            const first = image.getBoundingClientRect();
            window.scrollBy({ top: first.top + first.height * point.y - innerHeight / 2, behavior: 'instant' });
            await new Promise(requestAnimationFrame);
            const rect = image.getBoundingClientRect();
            const target = document.elementFromPoint(rect.left + rect.width * point.x, rect.top + rect.height * point.y)?.closest('[data-luster-canva-area]');
            return { areaId: target?.getAttribute('data-luster-canva-area'), contact: target?.getAttribute('data-luster-link'), serviceId: target?.getAttribute('data-luster-book') };
          }, point);
          const expectedService = point.action === 'service' ? setupDocument.services.find(service => service.name === point.serviceName) : null;
          assert(point.action !== 'service' || expectedService, 'A reference service landmark must name a real draft service.');
          const expected = expectedService ? `setup_preview_${expectedService.id}` : point.action === 'book' ? '' : point.action;
          assert.equal(point.action === 'service' || point.action === 'book' ? result.serviceId : result.contact, expected, `The ${device} ${point.action} target does not cover its actual reference text/button.`);
          interactionChecks.push({ device, referenceLandmark: point.action, serviceName: point.serviceName, areaId: result.areaId, matched: true });
        }
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

        const rect = await anchor.boundingBox();
        assert(rect && rect.width >= 8 && rect.height >= 4, `The ${device} ${kind} link is too small to tap (${rect?.width}×${rect?.height}).`);
        const check = { device, kind, href, targetWidth: rect.width, targetHeight: rect.height, tapAttemptVerified: false };
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
        const candidate = preview.frameLocator(`iframe[src="${renderer}"]`).locator('button[aria-controls][aria-expanded]').filter({ hasText: /menu/iu }).first();
        if (await candidate.count() && await candidate.isVisible()) {
          const controlledId = await candidate.getAttribute('aria-controls');
          assert.match(controlledId ?? '', /^[a-z][\w-]*$/iu);
          // Generated controls may correctly rename Menu to Close. Follow the
          // stable relationship, not text that the interaction intentionally changes.
          const menu = preview.frameLocator(`iframe[src="${renderer}"]`).locator(`button[aria-controls="${controlledId}"]`).first();
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

  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled({ timeout: 120_000 });

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
  if (['message', 'photos', 'logo', 'replace-photo', 'manual-wording', 'service-price', 'booking-link', 'restore', 'publish'].includes(step)) {
    assert.equal(before.status, 'editing', 'Return through Edit with AI before changing a published salon.');
  }
  if (step === 'unfunded') {
    assert.equal(ownerAuth.kind, 'clerk-development', 'Run the unfunded check after genuine owner signup.');
    const balance = Number((await database.query('SELECT coalesce(sum(amount_micro_cad),0) AS amount FROM ai_credit_ledger WHERE salon_id=$1 AND plan_env=\'dev\'', [fixture.salonId])).rows[0].amount);
    assert.equal(balance, 0, 'Do not refund or reset a wallet to manufacture this check.');
    const credits = page.getByRole('dialog');

    await expect(credits).toBeVisible();
    await expect(credits).toContainText('Credit purchases are not available yet.');

    await screenshot('unfunded-owner');
    await credits.getByRole('button', { name: 'Close AI credits', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message Luster', exact: true }).fill('Create my website.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();

    await expect(page.getByText('Add AI credits to continue. Your saved website and bookings are safe.', { exact: true }).first()).toBeVisible();

    after = await head();
    assert.deepEqual(after.document, before.document);
    assert.equal(Number((await database.query('SELECT count(*) AS count FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count), modelCallCountBefore);
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
    await screenshot('unfunded-request-blocked');
    interactionChecks.push({ zeroBalance: true, purchasesDisabled: true, providerCalls: 0, draftUnchanged: true });
  } else if (step === 'details') {
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const moneyForms = page.locator('form.setup-service').filter({ has: page.locator('input[name="price"]') });
    const rows = await moneyForms.evaluateAll(forms => forms.map(form => ({ name: form.querySelector('input[name="name"]')?.value, text: form.textContent })));
    if (process.env.LUSTER_REAL_AI_EXPECT_VALUE_SOURCES === 'true') {
      const owner = before.document.services.find(service => /^BIAB\b/iu.test(service.name));
      const mixed = before.document.services.find(service => /Gel Manicure/iu.test(service.name));
      const extra = before.document.addOns.find(addOn => /Nail art/iu.test(addOn.name));
      assert(owner && mixed && extra, 'The owner supplied both services and the named add-on.');
      assert.deepEqual(before.document.serviceSources[owner.id], { name: 'owner', priceCents: 'owner', durationMinutes: 'owner' });
      assert.deepEqual(before.document.serviceSources[mixed.id], { name: 'owner', priceCents: 'owner', durationMinutes: 'suggested' });
      assert.deepEqual(before.document.addOnSources[extra.id], { name: 'owner', priceCents: 'owner', durationMinutes: 'owner' });
      assert(rows.find(row => row.name === owner.name)?.text.includes('Supplied by you · Needs your review'));
      assert(rows.find(row => row.name === mixed.name)?.text.includes('Price: Supplied by you · Time: AI suggestion'));
      assert(rows.find(row => row.name === extra.name)?.text.includes('Supplied by you · Needs your review'));
      assert([...before.document.services, ...before.document.addOns].every(item => !item.confirmed));
    }
    const moneyForm = moneyForms.first();
    if (!await moneyForm.isVisible()) {
      await page.locator('details').filter({ has: moneyForm }).first().locator(':scope > summary').click();
    }
    await moneyForm.scrollIntoViewIfNeeded();

    await expect(moneyForm).toBeVisible();

    if (process.env.LUSTER_REAL_AI_EXPECT_VALUE_SOURCES === 'true') {
      await expect(moneyForm.getByText(/Supplied by you.*Needs your review/u)).toBeVisible();
    }

    await screenshot('service-sources-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    if (!await moneyForm.isVisible()) {
      await page.locator('details').filter({ has: moneyForm }).first().locator(':scope > summary').click();
    }
    await moneyForm.scrollIntoViewIfNeeded();
    await screenshot('service-sources-mobile');
    if (process.env.LUSTER_REAL_AI_EXPECT_VALUE_SOURCES === 'true') {
      const mixedForm = page.locator('form.setup-service').filter({ has: page.locator('input[name="name"][value="Gel Manicure"]') });
      await mixedForm.scrollIntoViewIfNeeded();

      await expect(mixedForm.getByText(/Time: AI suggestion/u)).toBeVisible();

      await screenshot('mixed-sources-mobile');
    }
    await page.reload();
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    assert.deepEqual((await head()).document, before.document);
    assert.equal(Number((await database.query('SELECT count(*) AS count FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count), modelCallCountBefore);
    interactionChecks.push({ draftUnchanged: true, sourceLabelsVerified: process.env.LUSTER_REAL_AI_EXPECT_VALUE_SOURCES === 'true', ...(process.env.LUSTER_REAL_AI_EXPECT_VALUE_SOURCES === 'true' ? { unapprovedValuesRemainUnapproved: true, rows: rows.map(row => ({ name: row.name, label: row.text.includes('Time: AI suggestion') ? 'Mixed owner facts and AI duration suggestion' : 'Owner-supplied values' })) } : {}) });
    after = await head();
  } else if (step === 'conversation') {
    await expect(page.locator('.setup-owner').last()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.setup-assistant').last()).toContainText(/deposit|reminder/iu);

    await page.locator('.setup-owner').last().scrollIntoViewIfNeeded();
    await screenshot('saved-conversation');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.setup-owner').last().scrollIntoViewIfNeeded();
    await screenshot('saved-conversation-mobile');
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
  } else if (step === 'canva-upload') {
    assert(messageOrArtifact, 'Supply an original Canva image or PDF input.');
    const workerUrls = [];
    const unexpected = [];
    page.on('worker', worker => workerUrls.push(worker.url()));
    page.on('request', (request) => {
      if (request.url().includes('/pdf-open-action')) {
        unexpected.push(request.url());
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#setup-attach-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^My design or menu/u }).click();
    await dialog.getByRole('checkbox', { name: /^Keep my Canva design/u }).check();
    await page.locator('#setup-attachment-file').setInputFiles(messageOrArtifact);
    await dialog.getByRole('checkbox', { name: /^These are my files/u }).check();
    await screenshot('pdf-selected-in-owner-chat');
    await dialog.getByRole('button', { name: 'Add to chat', exact: true }).click();
    if (messageOrArtifact.endsWith('.pdf')) {
      await expect(dialog.getByRole('status')).toContainText(/Preparing|Uploading|Saving/u);

      await screenshot('pdf-preparation-progress');
    }

    await expect(dialog).not.toBeVisible({ timeout: 100_000 });

    after = await head();
    const previousReferences = before.document.designBrief?.referenceIds ?? [];
    const added = after.document.designBrief.referenceIds.filter(id => !previousReferences.includes(id));
    const selected = added.length ? added : after.document.designBrief.referenceIds;
    assert(selected.length > 0 && selected.length <= 6);
    assert.equal(after.document.designBrief.mode, 'keep_design');
    const prepared = [];
    for (const [index, id] of selected.entries()) {
      const record = (await database.query('SELECT mime_type,byte_size,name FROM custom_site_asset WHERE salon_id=$1 AND id=$2', [fixture.salonId, id])).rows[0];
      assert(record?.mime_type.startsWith('image/'));
      assert(after.document.designBrief.ownedReferenceIds.includes(id));
      const response = await context.request.get(`/api/admin/custom-sites?salonSlug=${salonSlug}&asset=${id}`);
      assert.equal(response.status(), 200);
      fs.writeFileSync(path.join(output, `prepared-page-${index + 1}.webp`), await response.body());
      prepared.push({ id, ...record });
    }
    assert.equal(await page.evaluate(() => globalThis.__lusterPdfScriptRan), undefined);
    assert.deepEqual(unexpected, []);
    if (messageOrArtifact.endsWith('.pdf')) {
      assert(workerUrls.some(url => url.endsWith('/pdf.worker.legacy.min.mjs')), 'The PDF must use the real packaged worker.');
    }
    assert.deepEqual(after.document.services, before.document.services);
    assert.deepEqual(await livePrices(), liveServicePricesBefore);
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
    pdfUpload = { workerUrls, prepared, reusedExistingAssets: added.length === 0, documentActionExecuted: false, source: 'Owner-selected input artwork; no AI source was seeded.' };
    await screenshot('pdf-pages-attached');
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
  } else if (step === 'photos' || step === 'logo') {
    assert(messageOrArtifact, 'Supply one or two synthetic test-image paths.');
    await page.locator('#setup-attach-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: step === 'logo' ? /^My logo/u : /^My photos/u }).click();
    await page.locator('#setup-attachment-file').setInputFiles([messageOrArtifact, reference].filter(Boolean));
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Add to chat', exact: true }).click();

    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    await screenshot('selected-test-images');
    after = await head();
    const beforeIds = before.document.designBrief?.websiteAssetIds ?? [];
    const ids = after.document.designBrief.websiteAssetIds;
    assert(ids.length >= beforeIds.length);
    assert.equal(new Set(ids).size, ids.length);
    const checked = [];
    for (const file of [messageOrArtifact, reference].filter(Boolean)) {
      const stem = path.parse(file).name;
      const record = (await database.query('SELECT id,name,role,mime_type,byte_size FROM custom_site_asset WHERE salon_id=$1 AND id=ANY($2::text[])', [fixture.salonId, ids])).rows.find(asset => path.parse(asset.name).name === stem && asset.role === (step === 'logo' ? 'logo' : 'photo'));
      assert(record, 'The actual uploaded photo/logo must be selected in this draft.');
      const response = await context.request.get(`/api/admin/custom-sites?salonSlug=${salonSlug}&asset=${record.id}`);
      assert.equal(response.status(), 200);
      const bytes = await response.body();
      const metadata = await sharp(bytes).metadata();
      if (step === 'logo') {
        assert(metadata.hasAlpha, 'The transparent input logo must keep its alpha channel.');
        const alpha = await sharp(bytes).ensureAlpha().raw().toBuffer();
        assert.equal(alpha[3], 0, 'The transparent logo corner must not become a painted background.');
      }
      fs.writeFileSync(path.join(output, `uploaded-${step}-${checked.length + 1}.webp`), bytes);
      checked.push({ ...record, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha, inputBytes: fs.statSync(file).size });
    }
    mediaUpload = { assets: checked, reusedExistingAssets: ids.length === beforeIds.length };
    assert.deepEqual(after.document.services, before.document.services);
  } else if (step === 'replace-photo') {
    assert(messageOrArtifact && reference, 'Choose an existing draft photo identity and a synthetic replacement input file.');
    await openPreview();
    const originalId = before.document.website.config.customFrontendId;
    const original = (await database.query('SELECT source FROM custom_site_artifact WHERE salon_id=$1 AND id=$2', [fixture.salonId, originalId])).rows[0];
    assert(original && !original.source.canva, 'This check edits a photograph in an editable website, not fixed Canva artwork.');
    await page.getByText('Photos & design settings', { exact: true }).click();
    const library = page.locator('.studio-photo-library');
    await library.getByRole('checkbox', { name: /^I own or have permission/u }).check();
    const card = library.locator('article').filter({ has: page.locator(`img[src*="&asset=${messageOrArtifact}"]`) });

    await expect(card).toHaveCount(1);

    await card.getByRole('button', { name: 'Replace photo', exact: true }).click();
    await library.getByLabel('Choose replacement photo', { exact: true }).setInputFiles(reference);

    await expect.poll(async () => (await head()).document.website.config.customFrontendId, { timeout: 45_000 }).not.toBe(originalId);

    after = await head();
    const edited = (await database.query('SELECT source FROM custom_site_artifact WHERE salon_id=$1 AND id=$2', [fixture.salonId, after.document.website.config.customFrontendId])).rows[0];
    assert.equal(edited.source.css, original.source.css);
    assert.equal(edited.source.javascript, original.source.javascript);
    assert(!edited.source.html.includes(messageOrArtifact), 'Every use of the replaced photo must change in the saved draft.');
    for (const field of ['business', 'services', 'hours', 'booking', 'staff', 'addOns', 'bookingPolicy', 'deposit', 'reminders']) {
      assert.deepEqual(after.document[field], before.document[field]);
    }
    assert.deepEqual(await livePrices(), liveServicePricesBefore);
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
    assert.equal(Number((await database.query('SELECT count(*) AS count FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count), modelCallCountBefore, 'Manual photo replacement must not call a model.');
    interactionChecks.push({ manualPhotoReplacement: true, originalArtifactId: originalId, savedArtifactId: after.document.website.config.customFrontendId, inputBytes: fs.statSync(reference).size, browserName });
    await screenshot('manual-photo-replaced');
    await openPreview();
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
  } else if (step === 'contact-details') {
    assert(/^@?[\w.]{1,30}$/iu.test(messageOrArtifact ?? ''), 'Supply the owner-confirmed Instagram handle.');
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const contact = page.getByRole('textbox', { name: 'Instagram handle', exact: true });
    if (!await contact.isVisible()) {
      await page.getByText('Contact details and website policies', { exact: true }).first().click();
    }
    await contact.fill(messageOrArtifact);
    await page.getByRole('button', { name: 'Save website details', exact: true }).click();

    await expect.poll(async () => (await head()).document.website.content.websiteDetails.instagram).toBe(messageOrArtifact);

    after = await head();
    assert.equal(after.document.website.config.customFrontendId, before.document.website.config.customFrontendId, 'A contact correction must not regenerate the design.');
    for (const field of ['business', 'services', 'hours', 'booking', 'staff', 'addOns', 'bookingPolicy', 'deposit', 'reminders', 'siteSlug']) {
      assert.deepEqual(after.document[field], before.document[field], `A contact correction must preserve ${field}.`);
    }
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
    assert.equal(Number((await database.query('SELECT count(*) AS count FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count), modelCallCountBefore);
    await screenshot('owner-confirmed-contact');
  } else if (step === 'canva-review') {
    await openPreview();
    await page.getByText('Check Canva links & artwork', { exact: true }).click();
    await page.getByRole('checkbox', { name: /^I checked all printed prices, times, policies, contact details and addresses/u }).check();
    await page.getByRole('button', { name: 'Artwork is correct', exact: true }).click();

    await expect.poll(async () => {
      const artifactId = (await head()).document.website.config.customFrontendId;
      return (await database.query('SELECT source FROM custom_site_artifact WHERE salon_id=$1 AND id=$2', [fixture.salonId, artifactId])).rows[0]?.source.canva?.ownerReviewed;
    }).toBe(true);

    after = await head();
    for (const field of ['business', 'services', 'hours', 'booking', 'staff', 'addOns', 'bookingPolicy', 'deposit', 'reminders', 'siteSlug']) {
      assert.deepEqual(after.document[field], before.document[field], `Checking artwork must preserve ${field}.`);
    }
    assert.equal(await liveSettingsFingerprint(), liveSettingsBefore);
    assert.equal(Number((await database.query('SELECT count(*) AS count FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count), modelCallCountBefore, 'Manual artwork review must not call a model.');
    await screenshot('artwork-owner-reviewed');
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
  } else if (step === 'staff-eligibility') {
    assert(process.env.LUSTER_REAL_AI_BOOK_SERVICE && process.env.LUSTER_REAL_AI_EXCLUDED_STAFF);
    const anonymous = await browser.newContext({ ...contextOptions, viewport: { width: 390, height: 844 } });
    await restrictNetwork(anonymous);
    const booking = await anonymous.newPage();
    try {
      await booking.goto(`/${salonSlug}/book/service`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const card = booking.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-services] > *').filter({ hasText: process.env.LUSTER_REAL_AI_BOOK_SERVICE }).first();

      await expect(card.locator('[data-luster-book]')).toBeVisible({ timeout: 45_000 });

      await card.locator('[data-luster-book]').click();
      await booking.getByTestId('service-continue-button').click();
      await booking.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/u);
      const autoSelected = new URL(booking.url()).pathname.endsWith('/book/time');
      if (autoSelected) {
        const id = new URL(booking.url()).searchParams.get('techId');
        const eligible = (await database.query('SELECT t.id,t.name FROM technician t JOIN technician_services ts ON ts.technician_id=t.id JOIN service s ON s.id=ts.service_id WHERE t.salon_id=$1 AND s.salon_id=$1 AND s.name=$2 AND t.is_active=true AND ts.enabled=true', [fixture.salonId, process.env.LUSTER_REAL_AI_BOOK_SERVICE])).rows;
        assert.deepEqual(eligible, [{ id, name: process.env.LUSTER_REAL_AI_BOOK_STAFF ?? 'Synthetic Owner' }], 'The original flow may skip the staff picker only for the sole eligible artist.');
      } else {
        await expect(staffChoice(booking, process.env.LUSTER_REAL_AI_BOOK_STAFF ?? 'Synthetic Owner')).toBeVisible();
        await expect(staffChoice(booking, process.env.LUSTER_REAL_AI_EXCLUDED_STAFF)).toHaveCount(0);
      }

      await booking.screenshot({ path: path.join(output, 'original-booking-staff-eligibility.png'), fullPage: true });
      interactionChecks.push({ originalBooking: true, service: process.env.LUSTER_REAL_AI_BOOK_SERVICE, eligibleStaff: process.env.LUSTER_REAL_AI_BOOK_STAFF ?? 'Synthetic Owner', excludedStaff: process.env.LUSTER_REAL_AI_EXCLUDED_STAFF, autoSelectedSoleEligibleArtist: autoSelected, noAppointmentSubmitted: true });
      assert.deepEqual(await historicalAppointments(), historicalBefore);
    } finally {
      await anonymous.close();
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
    const customer = await browser.newContext({ ...contextOptions, viewport: { width: 390, height: 844 }, recordVideo: { dir: output, size: { width: 390, height: 844 } } });
    await restrictNetwork(customer);
    const booking = await customer.newPage();
    booking.on('framenavigated', (frame) => {
      if (frame === booking.mainFrame()) {
        bookingNavigation.push({ event: 'navigated', path: new URL(frame.url()).pathname });
      }
    });
    booking.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.includes('/book/confirm')) {
        bookingNavigation.push({ event: 'confirm-response', status: response.status(), type: response.headers()['content-type'] });
        // Private diagnostics only: the opt-in run is scoped to synthetic
        // accounts, and genuine Clerk outputs stay outside the repository.
        if (ownerAuth.kind === 'clerk-development') {
          void response.text().then(body => fs.writeFileSync(path.join(output, `confirm-response-${bookingNavigation.length}.txt`), body, { mode: 0o600 })).catch(() => {});
        }
      }
    });
    let bookingBody;
    const privateAddress = process.env.LUSTER_REAL_AI_PRIVATE_ADDRESS;
    const privacyReads = [];
    let beforeCreation = true;
    if (privateAddress) {
      assert.equal(before.document.business.exactAddress, privateAddress);
      assert.notEqual(before.document.business.locationDisplayMode, 'full_address');
      const normalizedAddress = privateAddress.toLowerCase().replace(/[^a-z0-9]/gu, '');
      booking.on('response', (response) => {
        const url = new URL(response.url());
        const eligible = beforeCreation && url.origin === origin && ['document', 'fetch', 'xhr'].includes(response.request().resourceType())
          && /text|json|x-component/u.test(response.headers()['content-type'] ?? '');
        if (eligible) {
          privacyReads.push((async () => {
            let text;
            let fallbackRead = false;
            try {
              text = await response.text();
            } catch {
              // Chromium can discard a cancelled router-prefetch body. Verify
              // that exact anonymous GET separately, retaining its RSC headers;
              // never silently count an unread response as a privacy success.
              const headers = { ...response.request().headers() };
              delete headers['if-none-match'];
              delete headers['if-modified-since'];
              const verified = await customer.request.get(response.url(), { headers, maxRedirects: 0, timeout: 60_000 });
              assert(verified.ok(), 'The anonymous privacy response could not be verified.');
              text = await verified.text();
              fallbackRead = true;
            }
            let decoded = text;
            try {
              decoded = decodeURIComponent(text);
            } catch { /* Ordinary HTML need not be URL-encoded. */ }
            const leaked = decoded.toLowerCase().replace(/[^a-z0-9]/gu, '').includes(normalizedAddress);
            privateAddressChecks.push({ path: url.pathname, status: response.status(), beforeAppointmentCreation: true, leaked, ...(fallbackRead ? { anonymousGetFallback: true } : {}) });
          })().catch(() => {
            privateAddressChecks.push({ path: url.pathname, status: response.status(), beforeAppointmentCreation: true, readFailed: true });
          }));
        }
      });
    }
    booking.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/appointments') {
        beforeCreation = false;
        bookingSubmissionCount += 1;
        bookingBody = request.postDataJSON();
      }
    });
    try {
      await booking.goto(`/${salonSlug}/book/service`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const site = booking.frameLocator(`iframe[src="${renderer}"]`);

      await expect(site.locator('[data-luster-services] > *').first()).toBeAttached({ timeout: 45_000 });

      const isCanva = await site.locator('.canva-page').count() > 0;

      // Select a real bound service rather than an unconnected generic link.
      const biab = site.locator('[data-luster-services] > *').filter({ hasText: /BIAB/u }).first();
      const requested = process.env.LUSTER_REAL_AI_BOOK_SERVICE;
      const card = requested ? site.locator('[data-luster-services] > *').filter({ hasText: requested }).first() : await biab.count() ? biab : site.locator('[data-luster-services] > *').first();
      const serviceId = await card.locator('[data-luster-book]').getAttribute('data-luster-book');
      const bookButton = isCanva ? site.locator(`[data-luster-canva-area][data-luster-book="${serviceId}"]`).first() : card.locator('[data-luster-book]');
      const service = (await database.query('SELECT id,name,price,duration_minutes FROM service WHERE salon_id=$1 AND id=$2', [fixture.salonId, serviceId])).rows[0];
      assert(service, 'The generated button must bind to a real service from this salon.');

      await expect(card.locator('[data-luster-field="service.name"]')).toHaveText(service.name);
      await expect(card.locator('[data-luster-field="service.durationMinutes"]')).toHaveText(String(service.duration_minutes));

      const priceText = await card.locator('[data-luster-field="service.priceLabel"]').textContent() ?? '';
      const displayedAmount = priceText.match(/\d+(?:,\d{3})*(?:\.\d{2})?/u)?.[0];
      assert.equal(Math.round(Number(displayedAmount?.replaceAll(',', '')) * 100), service.price, 'The displayed service price must match the live booking amount.');
      await bookButton.scrollIntoViewIfNeeded();

      await expect(bookButton).toBeVisible();

      const rect = await bookButton.boundingBox();
      assert(rect && rect.width >= 8 && rect.height >= 4, 'The actual service button must be tappable.');
      interactionChecks.push({ originalBooking: true, preservedCanva: isCanva, serviceId, serviceName: service.name, targetWidth: rect.width, targetHeight: rect.height });
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
        await staffChoice(booking, process.env.LUSTER_REAL_AI_BOOK_STAFF ?? 'Synthetic Owner').click();
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
      await Promise.all(privacyReads);
      if (privateAddress) {
        assert(privateAddressChecks.length >= 4, 'Observe the actual website and original booking responses before claiming address privacy.');
        assert(privateAddressChecks.every(check => !check.leaked && !check.readFailed), 'The private address check failed before appointment creation.');
      }
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
      assert((await database.query('SELECT 1 FROM technician_services WHERE service_id=$1 AND technician_id=$2 AND enabled=true', [service.id, booked[0].technician_id])).rowCount, 'The appointment artist must be enabled for the selected service.');
      if (process.env.LUSTER_REAL_AI_BOOK_STAFF) {
        const selectedStaff = (await database.query('SELECT name FROM technician WHERE salon_id=$1 AND id=$2', [fixture.salonId, booked[0].technician_id])).rows[0];
        assert.equal(selectedStaff?.name, process.env.LUSTER_REAL_AI_BOOK_STAFF, 'The original booking must retain the exact artist selected by the customer.');
        interactionChecks.push({ originalBooking: true, selectedStaff: selectedStaff.name, staffEligibilityVerified: true });
      }
      if (privateAddress && before.document.business.locationDisplayMode === 'after_booking') {
        // Follow the real capability link issued by this booking. Never read or
        // log its token from the database, or turn a public page into a shortcut.
        await booking.getByRole('link', { name: 'Manage appointment', exact: true }).click();

        await expect(booking.getByText(privateAddress, { exact: false }).first()).toBeVisible({ timeout: 60_000 });

        privateAddressChecks.push({ confirmedCustomerManagePage: true, exactAddressVisibleAfterConfirmation: true });
        await booking.screenshot({ path: path.join(output, 'confirmed-customer-address.png'), fullPage: true });
      }
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
      bookingNavigation.push({ event: 'failed', path: new URL(booking.url()).pathname });
      if (ownerAuth.kind === 'clerk-development') {
        fs.writeFileSync(path.join(output, 'booking-page-private.txt'), await booking.locator('body').textContent() ?? '', { mode: 0o600 });
      }
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
  const evidence = { step, trialScope, browserName, ownerAuthentication: ownerAuth.kind, origin, renderer, optimizedHttps: profile.https, salonSlug, lostPublishResponse: process.env.LUSTER_REAL_AI_LOSE_PUBLISH_RESPONSE === 'true', operationId, status: failure ? 'failed' : 'passed', failure, startedAt, elapsedMs: Date.now() - startedAt.getTime(), beforeRevision: before?.revision, afterRevision: after?.revision, artifactId: after?.document.website.config.customFrontendId ?? null, calls, artifacts, appointments, historicalBefore, liveServicePricesBefore, liveServicePricesAfter: await livePrices(), liveAddOnsBefore, liveAddOnsAfter: await liveExtras(), liveSettingsBefore, liveSettingsAfter: await liveSettingsFingerprint(), bookingResponseStatus, bookingSubmissionCount, bookingNavigation, serverProbes, privateAddressChecks, contactChecks, interactionChecks, pdfUpload, mediaUpload, browserErrors: failures, funding: ownerAuth.kind === 'clerk-development' && !fixture.syntheticRecoveryCredit ? 'Unfunded real Development account; no Stripe payment or purchase.' : 'Synthetic CAD10 recovery grant; no Stripe payment or purchase is claimed.' };
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify({ step, status: evidence.status, revision: after?.revision, providerMicroUsd: calls.reduce((sum, item) => sum + (item.cost_micro_usd ?? 0), 0), output, ...(failure ? { failure } : {}) })}\n`);
  if (ownerAuth.kind === 'clerk-development') {
    await context.storageState({ path: privateClerkStorageState(fixture.clerkStorageState) });
  }
  await context.close();
  await browser.close();
  await database.end();
}
