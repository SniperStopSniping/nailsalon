/** Opt-in genuine owner sign-in on the fixed, optimized local HTTPS build. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createClerkClient } from '@clerk/backend';
import { clerkSetup } from '@clerk/testing/playwright';
import { chromium, devices, expect as baseExpect, webkit } from '@playwright/test';
import pg from 'pg';

import { aiTrialAuth, assertClerkTrialActor, setupNativeClerkTestingToken } from './lib/ai-trial-auth.mjs';
import { aiTrialOrigins, restrictAiTrialNetwork } from './lib/ai-trial-origins.mjs';

assert.equal(process.env.LUSTER_REAL_CLERK_HTTPS, 'true', 'Explicit local genuine-auth verification opt-in is required.');
const directory = process.argv[2];
assert.match(directory ?? '', /^\/tmp\/luster-ai-https-check-[a-zA-Z0-9-]+$/u);
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'));
assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'build-result.json'), 'utf8')).code, 0);
assert.equal(metadata.authProfile, 'clerk-development');
const profile = aiTrialOrigins(true);
assert.equal(metadata.appOrigin, profile.origin);
assert.equal(metadata.rendererOrigin, profile.rendererOrigin);
assert(process.env.LUSTER_REAL_AI_FIXTURE, 'Use the private fixture created by genuine UI signup.');
const fixture = JSON.parse(fs.readFileSync(process.env.LUSTER_REAL_AI_FIXTURE, 'utf8'));
const auth = aiTrialAuth(fixture);
assert.equal(auth.kind, 'clerk-development');
assert.equal(auth.frontendApi, metadata.clerkFrontendApi);
assert.equal(typeof fixture.password, 'string');
const browserName = process.env.LUSTER_REAL_AI_BROWSER ?? 'chromium';
assert(['chromium', 'webkit'].includes(browserName));
const entryPath = process.env.LUSTER_REAL_CLERK_ENTRY_PATH ?? 'saved';
assert(['saved', 'more', 'ai-intro'].includes(entryPath));
const output = fs.mkdtempSync('/tmp/luster-real-clerk-https-');
fs.chmodSync(output, 0o700);
const database = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development', password: 'luster-e2e-ci-only-password' });
await database.connect();
assert.deepEqual((await database.query('SELECT current_database() AS name,inet_server_addr()::text AS host')).rows, [{ name: 'luster_ai_setup_development', host: '127.0.0.1/32' }]);
assert.deepEqual((await database.query('SELECT environment FROM luster_environment LIMIT 2')).rows, [{ environment: 'development' }]);
await assertClerkTrialActor(database, fixture);
const callsBefore = Number((await database.query('SELECT count(*) FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count);
await clerkSetup({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, dotenv: false });
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true, proxy: { server: profile.proxyServer } });
// No storageState and no added cookies: this is an actual new-device sign-in.
const context = await browser.newContext({ ...(browserName === 'webkit' ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }), baseURL: profile.origin, ignoreHTTPSErrors: true, recordVideo: { dir: output } });
await restrictAiTrialNetwork(context, profile, auth.frontendApi);
await setupNativeClerkTestingToken(context, auth.frontendApi);
const page = await context.newPage();
const errors = [];
const api = [];
const authenticationChecks = [];
const pendingChecks = [];
const cookieSnapshots = [];
const privateProviderValues = [process.env.CLERK_SECRET_KEY, process.env.OPENAI_API_KEY_CUSTOM_SITES].filter(value => typeof value === 'string' && value.length > 20);
const diagnosticText = (value) => {
  let safe = String(value ?? '');
  for (const privateValue of [...privateProviderValues, process.env.CLERK_TESTING_TOKEN, fixture.password, fixture.email]) {
    if (typeof privateValue === 'string' && privateValue) {
      safe = safe.replaceAll(privateValue, '[redacted]');
    }
  }
  return safe.slice(0, 60_000);
};
let checkedTextResponses = 0;
let credentialLeaks = 0;
let unreadableTextResponses = 0;
const unreadableTextResources = [];
const checkedDocuments = [];
const inspectDocuments = async (stage) => {
  for (const frame of page.frames()) {
    const url = new URL(frame.url());
    if (![profile.origin, profile.rendererOrigin].includes(url.origin)) {
      continue;
    }
    const html = await frame.content();
    assert(html.length <= 16 * 1024 * 1024, 'Bounded document inspection exceeded its limit.');
    credentialLeaks += Number(privateProviderValues.some(value => html.includes(value)));
    checkedDocuments.push({ stage, origin: url.origin, path: url.pathname });
  }
};
const cookieSnapshot = async (stage) => {
  cookieSnapshots.push({ stage, cookies: (await context.cookies()).map(({ name, domain, path, secure, sameSite, expires }) => ({ name, domain, path, secure, sameSite, expires })) });
};
const diagnosticClerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
page.on('request', (request) => {
  const url = new URL(request.url());
  const privatePage = /^(?:\/(?:en|fr))?\/admin\/business-setup$/u.test(url.pathname);
  if (url.origin !== profile.origin || (url.pathname !== '/api/admin/business-setup' && !privatePage)) {
    return;
  }
  pendingChecks.push((async () => {
    const headers = await request.allHeaders();
    const cookieNames = (headers.cookie ?? '').split(';').map(cookie => cookie.trim().split('=')[0]).filter(Boolean);
    // Read-only SDK authentication diagnostics. No request body, cookie value,
    // token, private key, account details or auth headers enter the report.
    const state = await diagnosticClerk.authenticateRequest(new Request(url, { method: request.method(), headers }));
    authenticationChecks.push({ method: request.method(), path: url.pathname, kind: privatePage ? 'page' : 'setup_api', rsc: headers.rsc, prefetch: headers['next-router-prefetch'], cookieNames, sdkStatus: state.status, sdkReason: state.reason, requestOrigin: url.origin, suppliedOrigin: headers.origin });
  })().catch(() => authenticationChecks.push({ path: url.pathname, diagnosticFailed: true })));
});
page.on('pageerror', error => errors.push(diagnosticText(error.message)));
page.on('response', (response) => {
  const url = new URL(response.url());
  if (url.origin === profile.origin && url.pathname.startsWith('/api/')) {
    api.push({ method: response.request().method(), path: url.pathname, status: response.status() });
  }
  // Navigation/prefetch bodies can be unavailable to browser instrumentation.
  // Inspect actual document DOM separately, and require every observed builder
  // API, static client asset and renderer text response to be readable.
  const criticalText = url.origin === profile.rendererOrigin || (url.origin === profile.origin && /^\/(?:_next\/static\/|api\/admin\/(?:business-setup|custom-sites)(?:\/|$))/u.test(url.pathname));
  if (criticalText && response.status() === 200 && /text\/|javascript|json|xml/iu.test(response.headers()['content-type'] ?? '')) {
    pendingChecks.push((async () => {
      let timer;
      const bytes = await Promise.race([response.body(), new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Text response did not finish within 15 seconds.')), 15_000);
      })]).finally(() => clearTimeout(timer));
      assert(bytes.length <= 16 * 1024 * 1024, 'Bounded runtime credential inspection exceeded its response limit.');
      checkedTextResponses += 1;
      credentialLeaks += Number(privateProviderValues.some(value => bytes.includes(value)));
    })().catch((error) => {
      unreadableTextResponses += 1;
      unreadableTextResources.push({ path: url.pathname, reason: diagnosticText(error.message) });
    }));
  }
});
const expect = baseExpect.configure({ timeout: 30_000 });
let failure;
try {
  await page.goto(entryPath === 'ai-intro' ? '/en/ai-website?account=sign-in#account' : '/en/owner-sign-in', { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await expect(page.getByPlaceholder('Enter your email address')).toBeVisible();

  await inspectDocuments('sign-in');
  await page.screenshot({ path: path.join(output, 'owner-sign-in.png'), fullPage: true });
  await page.getByPlaceholder('Enter your email address').fill(fixture.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="password"]').fill(fixture.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(entryPath === 'ai-intro' ? /\/admin\/business-setup(?:\?|$)/u : /\/admin(?:\/|\?|$)/u, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.Clerk?.loaded && window.Clerk.user?.id, undefined, { timeout: 60_000 });
  const identity = await page.evaluate(() => ({ id: window.Clerk.user.id, verified: window.Clerk.user.primaryEmailAddress.verification.status === 'verified', session: window.Clerk.session.status }));
  assert.equal(identity.id, fixture.clerkUserId);
  assert.equal(identity.verified, true);
  assert.equal(identity.session, 'active');
  assert(!(await context.cookies()).some(cookie => cookie.name === 'n5_admin_session'));

  if (entryPath !== 'ai-intro') {
    await expect(page.getByRole('tab', { name: 'More', exact: true })).toBeVisible({ timeout: 60_000 });
  }

  await cookieSnapshot('signed-in-dashboard');
  const dashboardPath = new URL(page.url()).pathname;
  await inspectDocuments('dashboard');
  await page.screenshot({ path: path.join(output, 'owner-dashboard.png'), fullPage: true });
  await Promise.all(pendingChecks);
  if (entryPath === 'more') {
    await page.getByRole('tab', { name: 'More', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'more-entry.png'), fullPage: true });
    await page.getByRole('button', { name: /^Luster AI/u }).click();
    await page.waitForURL(/\/admin\/business-setup(?:\?|$)/u, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } else if (entryPath === 'saved') {
    await page.goto(`/en/admin/business-setup?salon=${fixture.salonSlug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  assert.equal(new URL(page.url()).searchParams.get('salon'), fixture.salonSlug, 'Every entry path must reopen the same salon.');
  await cookieSnapshot('saved-builder');

  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const renderer = `${profile.rendererOrigin}/renderer`;

  await expect(page.locator(`iframe[src="${renderer}"]`)).toBeVisible();
  await expect(page.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-field="business.name"]').first()).toHaveText('Lumen Studio');

  await inspectDocuments('saved-preview');
  await page.screenshot({ path: path.join(output, 'saved-owner-preview.png'), fullPage: true });
  await Promise.all(pendingChecks);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  await inspectDocuments('refreshed-builder');
  const callsAfter = Number((await database.query('SELECT count(*) FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count);
  assert.equal(callsAfter, callsBefore, 'Optimized genuine-auth checks must not make a model request.');
  assert.deepEqual(errors, [], 'The genuine owner browser must not report an uncaught application error.');
  await Promise.all(pendingChecks);
  assert(checkedTextResponses > 0, 'Inspect actual optimized runtime responses before claiming credential isolation.');
  assert(checkedDocuments.length >= 5, 'Inspect rendered account, owner, preview and refreshed documents.');
  assert.equal(credentialLeaks, 0, 'A private provider value reached browser-visible output.');
  assert.equal(unreadableTextResponses, 0, 'Runtime credential inspection must complete without skipped text responses.');
  const credentialBoundary = { scope: 'Rendered documents, builder APIs, static client assets and renderer text responses.', checkedDocuments, checkedTextResponses, credentialLeaks, unreadableTextResponses, rawBodiesStored: false };
  const stateFile = path.join(output, 'storage-state.json');
  await context.storageState({ path: stateFile });
  fs.chmodSync(stateFile, 0o600);
  const fixtureFile = path.join(output, 'fixture.json');
  fs.writeFileSync(fixtureFile, JSON.stringify({ ...fixture, storageStateFile: stateFile, clerkStorageState: stateFile, optimizedHttpsAuthVerified: true, optimizedHttpsSourceSha: metadata.sha, httpsBuildDirectory: directory }, null, 2), { mode: 0o600 });
  const evidence = { passed: true, sourceSha: metadata.sha, browserName, entryPath, newBrowserContext: true, noRestoredCookies: true, actualPasswordSignIn: true, noLegacyAdminCookie: true, sameOwner: true, dashboardPath, savedWebsiteLoaded: true, refresh: true, providerCalls: 0, providerResponsesUnmodified: true, nativeBrowserCookies: true, credentialBoundary, api, authenticationChecks, browserErrors: errors };
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: 'passed', browserName, output, fixtureFile, providerCalls: 0 })}\n`);
} catch (error) {
  failure = error;
  await Promise.all(pendingChecks);
  await cookieSnapshot('failed');
  fs.writeFileSync(path.join(output, 'failure-private.json'), JSON.stringify({ message: diagnosticText(error.message), url: `${new URL(page.url()).origin}${new URL(page.url()).pathname}`, body: diagnosticText(await page.locator('body').textContent()), api, authenticationChecks, cookieSnapshots, checkedTextResponses, credentialLeaks, unreadableTextResources, browserErrors: errors }, null, 2), { mode: 0o600 });
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.stdout.write(`${JSON.stringify({ status: 'failed', browserName, output, reason: 'Private owner-UI diagnostics retained.' })}\n`);
} finally {
  await context.close();
  await browser.close();
  await database.end();
}
if (failure) {
  process.exitCode = 1;
}
