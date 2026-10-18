/** Opt-in genuine owner sign-in on the fixed, optimized local HTTPS build. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createClerkClient } from '@clerk/backend';
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { chromium, devices, expect as baseExpect, webkit } from '@playwright/test';
import pg from 'pg';

import { aiTrialAuth, assertClerkTrialActor } from './lib/ai-trial-auth.mjs';
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
await setupClerkTestingToken({ context });
const page = await context.newPage();
const errors = [];
const api = [];
const authenticationChecks = [];
const pendingChecks = [];
const cookieSnapshots = [];
const cookieSnapshot = async (stage) => {
  cookieSnapshots.push({ stage, cookies: (await context.cookies()).map(({ name, domain, path, secure, sameSite, expires }) => ({ name, domain, path, secure, sameSite, expires })) });
};
const diagnosticClerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin !== profile.origin || url.pathname !== '/api/admin/business-setup') {
    return;
  }
  pendingChecks.push((async () => {
    const headers = await request.allHeaders();
    const cookieNames = (headers.cookie ?? '').split(';').map(cookie => cookie.trim().split('=')[0]).filter(Boolean);
    // Read-only SDK authentication diagnostics. No request body, cookie value,
    // token, private key, account details or auth headers enter the report.
    const state = await diagnosticClerk.authenticateRequest(new Request(url, { method: request.method(), headers }));
    authenticationChecks.push({ method: request.method(), path: url.pathname, cookieNames, sdkStatus: state.status, sdkReason: state.reason, requestOrigin: url.origin, suppliedOrigin: headers.origin });
  })().catch(() => authenticationChecks.push({ path: url.pathname, diagnosticFailed: true })));
});
page.on('pageerror', error => errors.push(error.message));
page.on('response', (response) => {
  const url = new URL(response.url());
  if (url.origin === profile.origin && url.pathname.startsWith('/api/')) {
    api.push({ method: response.request().method(), path: url.pathname, status: response.status() });
  }
});
const expect = baseExpect.configure({ timeout: 30_000 });
let failure;
try {
  await page.goto('/en/owner-sign-in', { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await expect(page.getByPlaceholder('Enter your email address')).toBeVisible();

  await page.screenshot({ path: path.join(output, 'owner-sign-in.png'), fullPage: true });
  await page.getByPlaceholder('Enter your email address').fill(fixture.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="password"]').fill(fixture.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(/\/admin(?:\/|\?|$)/u, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.Clerk?.loaded && window.Clerk.user?.id, undefined, { timeout: 60_000 });
  const identity = await page.evaluate(() => ({ id: window.Clerk.user.id, verified: window.Clerk.user.primaryEmailAddress.verification.status === 'verified', session: window.Clerk.session.status }));
  assert.equal(identity.id, fixture.clerkUserId);
  assert.equal(identity.verified, true);
  assert.equal(identity.session, 'active');
  assert(!(await context.cookies()).some(cookie => cookie.name === 'n5_admin_session'));
  await cookieSnapshot('signed-in-dashboard');
  const dashboardPath = new URL(page.url()).pathname;
  await page.screenshot({ path: path.join(output, 'owner-dashboard.png'), fullPage: true });
  await page.goto(`/en/admin/business-setup?salon=${fixture.salonSlug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cookieSnapshot('saved-builder');

  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const renderer = `${profile.rendererOrigin}/renderer`;

  await expect(page.locator(`iframe[src="${renderer}"]`)).toBeVisible();
  await expect(page.frameLocator(`iframe[src="${renderer}"]`).locator('[data-luster-field="business.name"]').first()).toHaveText('Lumen Studio');

  await page.screenshot({ path: path.join(output, 'saved-owner-preview.png'), fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  const callsAfter = Number((await database.query('SELECT count(*) FROM setup_ai_call WHERE salon_id=$1', [fixture.salonId])).rows[0].count);
  assert.equal(callsAfter, callsBefore, 'Optimized genuine-auth checks must not make a model request.');
  assert.deepEqual(errors, [], 'The genuine owner browser must not report an uncaught application error.');
  const stateFile = path.join(output, 'storage-state.json');
  await context.storageState({ path: stateFile });
  fs.chmodSync(stateFile, 0o600);
  const fixtureFile = path.join(output, 'fixture.json');
  fs.writeFileSync(fixtureFile, JSON.stringify({ ...fixture, storageStateFile: stateFile, clerkStorageState: stateFile, optimizedHttpsAuthVerified: true, optimizedHttpsSourceSha: metadata.sha, httpsBuildDirectory: directory }, null, 2), { mode: 0o600 });
  await Promise.all(pendingChecks);
  const evidence = { passed: true, sourceSha: metadata.sha, browserName, newBrowserContext: true, noRestoredCookies: true, actualPasswordSignIn: true, noLegacyAdminCookie: true, sameOwner: true, dashboardPath, savedWebsiteLoaded: true, refresh: true, providerCalls: 0, api, authenticationChecks, browserErrors: errors };
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: 'passed', browserName, output, fixtureFile, providerCalls: 0 })}\n`);
} catch (error) {
  failure = error;
  await Promise.all(pendingChecks);
  await cookieSnapshot('failed');
  fs.writeFileSync(path.join(output, 'failure-private.json'), JSON.stringify({ message: error.message, url: page.url(), body: await page.locator('body').textContent(), api, authenticationChecks, cookieSnapshots, browserErrors: errors }, null, 2), { mode: 0o600 });
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
