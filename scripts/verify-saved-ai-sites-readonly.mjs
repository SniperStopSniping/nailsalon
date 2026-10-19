/** Opt-in, anonymous, local-only compatibility check of retained real-AI sites. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, devices, expect as baseExpect, webkit } from '@playwright/test';
import pg from 'pg';

import { aiTrialOrigins, trialLoopbackRequest } from './lib/ai-trial-origins.mjs';

assert.equal(process.env.LUSTER_SAVED_AI_READONLY_CHECK, 'true');
for (const key of ['OPENAI_API_KEY', 'OPENAI_API_KEY_CUSTOM_SITES', 'OPENAI_API_KEY_OWNER_ASSISTANT', 'CLERK_SECRET_KEY', 'STRIPE_SECRET_KEY']) {
  // A failed equality assertion would print its actual secret value.
  assert(process.env[key] === undefined, 'This anonymous check must not receive real provider credentials.');
}
const directory = process.argv[2];
assert(/^\/tmp\/luster-ai-https-check-[a-zA-Z0-9-]+$/u.test(directory ?? ''), 'Use only a private local optimized build archive.');
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json')));
assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'build-result.json'))).code, 0);
assert.match(metadata.sha, /^[a-f0-9]{40}$/u);
const profile = aiTrialOrigins(true);
assert.equal(metadata.appOrigin, profile.origin);
assert.equal(metadata.rendererOrigin, profile.rendererOrigin);
const expect = baseExpect.configure({ timeout: 45_000 });
const output = fs.mkdtempSync('/tmp/luster-ai-saved-sites-readonly-');
fs.chmodSync(output, 0o700);
const cohort = [
  ['petal', 'paid-ai-petal-41bb1f28'],
  ['garden', 'paid-ai-garden-69d151c3'],
  ['nocturne', 'paid-ai-nocturne-6e9e1783'],
  ['velour', 'paid-ai-velourphoto-b66214f0'],
  ['fleur', 'paid-ai-fleur-69dcada7'],
  ['petite', 'paid-ai-petite-22ec2df6'],
  ['canva', 'paid-ai-solcanva-18f0bdda'],
];
const database = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', password: 'luster-e2e-ci-only-password', database: 'luster_ai_setup_development', connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const proof = { sourceSha: metadata.sha, startedAt: new Date().toISOString(), output, kind: 'saved-real-AI-output-compatibility', newGeneration: false, realAuthentication: false, appointmentCreation: false, cases: [], passed: false };
let browser;
let transaction = false;
try {
  await database.connect();
  await database.query('BEGIN READ ONLY');
  transaction = true;
  assert.deepEqual((await database.query('SELECT environment FROM luster_environment LIMIT 2')).rows, [{ environment: 'development' }]);
  const salons = (await database.query(`SELECT id,slug,name,address,settings#>>'{bookingPageContent,live,locationDisplayMode}' AS location_mode,
    settings#>>'{bookingPage,live,customFrontendId}' AS artifact_id FROM salon WHERE slug=ANY($1) AND publication_status='published'`, [cohort.map(([, slug]) => slug)])).rows;
  assert.equal(salons.length, cohort.length, 'Every explicitly selected saved synthetic site must exist and be published.');
  assert(salons.every(salon => /^paid_ai_trial_[a-f0-9]{32}$/u.test(salon.id)));
  const ids = salons.map(salon => salon.id);
  const fingerprint = async () => {
    const hashes = {};
    for (const table of ['salon', 'salon_location', 'service', 'technician', 'add_on', 'appointment', 'business_setup_workspace', 'business_setup_revision', 'business_setup_approval', 'business_setup_publication', 'custom_site_artifact']) {
      const column = table === 'salon' ? 'id' : 'salon_id';
      hashes[table] = (await database.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM ${table} t WHERE ${column}=ANY($1)`, [ids])).rows[0].hash;
    }
    for (const [table, parent, foreignKey] of [['technician_services', 'technician', 'technician_id'], ['service_add_on', 'service', 'service_id'], ['appointment_services', 'appointment', 'appointment_id']]) {
      hashes[table] = (await database.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM ${table} t JOIN ${parent} p ON t.${foreignKey}=p.id WHERE p.salon_id=ANY($1)`, [ids])).rows[0].hash;
    }
    hashes.usage = (await database.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(id,status,charged_micro_cad,input_tokens,output_tokens) ORDER BY id)::text,'[]')) AS hash FROM setup_ai_call`)).rows[0].hash;
    hashes.budget = (await database.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id)::text,'[]')) AS hash FROM setup_ai_budget b`)).rows[0].hash;
    return hashes;
  };
  const before = await fingerprint();
  proof.beforeFingerprint = before;
  // READ COMMITTED gives each comparison a fresh committed snapshot. No row,
  // customer record, source text, session or provider output is returned here.
  for (const [engine, device, viewport] of [
    ['chromium', {}, { width: 1440, height: 1000 }],
    ['webkit', devices['iPhone 13'], { width: 390, height: 844 }],
  ]) {
    browser = await (engine === 'chromium' ? chromium : webkit).launch({ headless: true, proxy: { server: profile.proxyServer } });
    for (const [label, slug] of cohort) {
      const salon = salons.find(item => item.slug === slug);
      const artifact = (await database.query('SELECT source_hash FROM custom_site_artifact WHERE salon_id=$1 AND id=$2', [salon.id, salon.artifact_id])).rows[0];
      assert(artifact, 'Only an artifact owned by the selected synthetic salon is accepted.');
      const ancestry = (await database.query(`WITH RECURSIVE chain AS (
        SELECT id,parent_id,operation_id,0 AS depth FROM custom_site_artifact WHERE salon_id=$1 AND id=$2
        UNION ALL SELECT p.id,p.parent_id,p.operation_id,c.depth+1 FROM custom_site_artifact p JOIN chain c ON p.id=c.parent_id WHERE p.salon_id=$1 AND c.depth<40
      ) SELECT id,parent_id,depth,EXISTS(SELECT 1 FROM custom_site_generation g JOIN setup_ai_call a ON a.operation_id=g.id AND a.salon_id=g.salon_id
        WHERE g.salon_id=$1 AND g.artifact_id=chain.id AND g.status='completed' AND a.status='completed') AS has_completed_model_generation FROM chain ORDER BY depth`, [salon.id, salon.artifact_id])).rows;
      assert(ancestry.some(item => item.has_completed_model_generation), 'Retain real model-generation provenance; no hand-authored substitute is allowed.');
      const services = (await database.query('SELECT id,name,price,duration_minutes FROM service WHERE salon_id=$1 AND is_active=true ORDER BY id', [salon.id])).rows;
      assert(services.length);
      const context = await browser.newContext({ ...device, viewport, ignoreHTTPSErrors: true });
      const blocked = [];
      await context.route('**/*', async (route) => {
        const request = route.request();
        const destination = trialLoopbackRequest(request.url(), profile);
        if (destination.kind === 'blocked' || !['GET', 'HEAD'].includes(request.method())) {
          const url = new URL(request.url());
          blocked.push({ origin: url.origin, path: url.pathname, method: request.method() });
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message.replace(/https?:\/\/\S+/gu, '[URL withheld]').slice(0, 300)));
      const result = { label, slug, engine, viewport, artifactId: salon.artifact_id, sourceHash: artifact.source_hash, ancestry, passed: false };
      proof.cases.push(result);
      try {
        await page.goto(`${profile.origin}/${slug}/book/service`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const frame = page.frameLocator(`iframe[src="${profile.rendererOrigin}/renderer"]`);
        const cards = frame.locator('[data-luster-services] > *');

        await expect(cards.first()).toBeAttached();

        const renderedIds = [];
        for (const card of await cards.all()) {
          const id = await card.locator('[data-luster-book]').getAttribute('data-luster-book');
          const service = services.find(item => item.id === id);
          assert(service, 'Every visible service must bind to a live service belonging to this salon.');

          await expect(card.locator('[data-luster-field="service.name"]')).toHaveText(service.name);
          await expect(card.locator('[data-luster-field="service.durationMinutes"]')).toHaveText(String(service.duration_minutes));

          const label = await card.locator('[data-luster-field="service.priceLabel"]').textContent();
          const amount = label.match(/\d+(?:,\d{3})*(?:\.\d{2})?/u)?.[0];
          assert.equal(Math.round(Number(amount?.replaceAll(',', '')) * 100), service.price);
          renderedIds.push(id);
        }
        assert.equal(new Set(renderedIds).size, renderedIds.length);

        await expect.poll(() => frame.locator('body').evaluate(body => [...body.querySelectorAll('img')].filter((image) => {
          const rectangle = image.getBoundingClientRect();
          return rectangle.width > 0 && rectangle.height > 0 && rectangle.top < body.ownerDocument.defaultView.innerHeight && rectangle.bottom > 0;
        }).every(image => image.complete && image.naturalWidth > 0))).toBe(true);

        await frame.locator('body').evaluate(body => body.ownerDocument.fonts.ready.then(() => true));
        // Capture the actual first screen before inspecting later lazy images.
        // The frontend scrolls inside its frame, so a parent full-page capture
        // alone does not represent the complete generated document.
        await page.screenshot({ path: path.join(output, `${label}-${engine}-top.png`), fullPage: false, animations: 'disabled' });
        for (const image of await frame.locator('img').all()) {
          const explicitlyHidden = await image.evaluate((item) => {
            for (let element = item; element; element = element.parentElement) {
              const style = getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return true;
              }
            }
            return false;
          });
          if (explicitlyHidden) {
            continue;
          }
          await image.scrollIntoViewIfNeeded();

          await expect.poll(() => image.evaluate(item => item.complete && item.naturalWidth > 0)).toBe(true);
        }
        const measurements = await frame.locator('body').evaluate((body) => {
          const all = [...body.querySelectorAll('img')];
          const visible = all.filter((image) => {
            for (let element = image; element; element = element.parentElement) {
              const style = getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
              }
            }
            return true;
          });
          return {
            viewportWidth: body.ownerDocument.documentElement.clientWidth,
            documentWidth: body.ownerDocument.documentElement.scrollWidth,
            imageCount: all.length,
            visibleImageCount: visible.length,
            explicitlyHiddenImageCount: all.length - visible.length,
            brokenImages: visible.filter(image => !image.complete || image.naturalWidth === 0).length,
            contactLinks: [...body.querySelectorAll('a[data-luster-link][href]')].map(anchor => ({ kind: anchor.getAttribute('data-luster-link'), protocol: new URL(anchor.href).protocol, host: new URL(anchor.href).hostname })),
          };
        });
        assert(measurements.documentWidth <= measurements.viewportWidth + 1, 'The generated frontend must fit the viewport.');
        assert.equal(measurements.brokenImages, 0);
        if (['city_only', 'hidden'].includes(salon.location_mode) && salon.address?.length > 8) {
          assert(!(await frame.locator('body').textContent() ?? '').includes(salon.address), 'A hidden exact address must not appear on the public site.');
        }
        for (const link of measurements.contactLinks) {
          assert(['instagram', 'email', 'phone'].includes(link.kind));
          assert.equal(link.protocol, link.kind === 'email' ? 'mailto:' : link.kind === 'phone' ? 'tel:' : 'https:');
          if (link.kind === 'instagram') {
            assert.equal(link.host.replace(/^www\./u, ''), 'instagram.com');
          }
        }
        await page.screenshot({ path: path.join(output, `${label}-${engine}.png`), fullPage: true, animations: 'disabled' });
        const selected = services.find(service => /BIAB/iu.test(service.name)) ?? services[0];
        const button = await frame.locator('.canva-page').count() ? frame.locator(`[data-luster-canva-area][data-luster-book="${selected.id}"]`).first() : frame.locator(`[data-luster-services] [data-luster-book="${selected.id}"]`).first();
        await button.scrollIntoViewIfNeeded();
        if (engine === 'webkit') {
          await button.tap();
        } else {
          await button.click();
        }

        await expect(page).toHaveURL(/nativeBooking=1.*baseServiceId=/u);

        const destination = new URL(page.url());
        assert.equal(destination.origin, profile.origin);
        assert.equal(destination.pathname, `/${slug}/book/service`);
        assert.equal(destination.searchParams.get('baseServiceId'), selected.id);

        await expect(page.getByTestId('service-continue-button')).toBeVisible();

        assert.equal(errors.length, 0, 'The saved generated website must not raise browser exceptions.');
        assert.equal(blocked.length, 0, 'The saved website must not request external resources or attempt writes.');
        Object.assign(result, { passed: true, servicesChecked: renderedIds.length, measurements, originalBookingServiceId: selected.id, blockedRequests: blocked, browserErrors: errors });
        process.stdout.write(`${JSON.stringify({ label, engine, passed: true })}\n`);
      } catch (error) {
        result.failure = 'The saved-site compatibility check did not pass; private screenshot and runtime logs retained.';
        fs.writeFileSync(path.join(output, `${label}-${engine}-failure.json`), JSON.stringify({ name: error?.name, message: String(error?.message).replace(/https?:\/\/\S+/gu, '[URL withheld]').slice(0, 2000) }), { mode: 0o600 });
        await page.screenshot({ path: path.join(output, `${label}-${engine}-failure.png`), fullPage: true }).catch(() => {});
        throw new Error(`Saved-site check failed for ${label}/${engine}; credentials and raw diagnostics withheld.`);
      } finally {
        await context.close();
      }
    }
    await browser.close();
    browser = null;
  }
  const after = await fingerprint();
  proof.afterFingerprint = after;
  assert.deepEqual(after, before, 'Rendering and navigating must not alter configuration, appointments, source history or AI accounting.');
  proof.authoritativeStateUnchanged = true;
  proof.passed = true;
} catch (error) {
  proof.failure = error instanceof Error && error.message.startsWith('Saved-site check failed') ? error.message : 'Read-only saved-site verification stopped safely; raw diagnostics withheld.';
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (transaction) {
    await database.query('ROLLBACK');
  }
  await database.end();
  proof.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output, passed: proof.passed, cases: proof.cases.length, failure: proof.failure })}\n`);
}
