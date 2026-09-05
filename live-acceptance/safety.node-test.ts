import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertLocalAcceptanceEnvironment, localAcceptanceBaseURL, runCleanupIsConfirmed, runScopedEmail, runScopedPostgresName } from './safety';

const safe = {
  APP_ENV: 'development',
  CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
  CLERK_SECRET_KEY: 'sk_test_fixture',
  LIVE_BASE_URL: 'http://localhost:4211',
  LIVE_DISPOSABLE_LOCAL_CONFIRMED: 'true',
  LIVE_EVIDENCE_DIR: '/tmp/luster-live-acceptance-fixture/evidence',
  LIVE_RUN_SUFFIX: 'acceptance-00000000-0000-4000-8000-000000000000',
  LUSTER_ONBOARDING_MEDIA_DIR: '/tmp/luster-live-acceptance-fixture/media',
  LUSTER_PGLITE_DATA_DIR: '/tmp/luster-live-acceptance-fixture/database',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
};

test('accepts only an explicitly disposable loopback/test-provider scope', () => {
  assert.equal(assertLocalAcceptanceEnvironment(safe).baseURL, 'http://localhost:4211');
});

test('dedicated acceptance port can avoid an existing local server without allowing remote targets', () => {
  assert.equal(localAcceptanceBaseURL(), 'http://localhost:4211');
  assert.equal(localAcceptanceBaseURL('4212'), 'http://localhost:4212');
  for (const value of ['', '443', '4201', 'https://islanailsalon.com', '4212/path']) {
    assert.throws(() => localAcceptanceBaseURL(value));
  }
});

test('rejects remote targets, provider leaks, live keys, and repository storage', () => {
  for (const override of [
    { LIVE_BASE_URL: 'https://islanailsalon.com' },
    { LIVE_BASE_URL: 'http://localhost:4211/path' },
    { LIVE_DISPOSABLE_LOCAL_CONFIRMED: '' },
    { APP_ENV: 'production' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { CLERK_SECRET_KEY: 'sk_live_fixture' },
    { DATABASE_URL: 'postgres://fixture' },
    { RESEND_API_KEY: 'fixture' },
    { CLOUDINARY_API_SECRET: 'fixture' },
    { STRIPE_SECRET_KEY: 'sk_test_fixture' },
    { LUSTER_PGLITE_DATA_DIR: process.cwd() },
    { LUSTER_PGLITE_DATA_DIR: '/' },
    { LIVE_EVIDENCE_DIR: '/tmp/luster-live-acceptance-different/evidence' },
    { LIVE_RUN_SUFFIX: 'historical' },
  ]) {
    assert.throws(() => assertLocalAcceptanceEnvironment({ ...safe, ...override }));
  }
});

test('identity addresses are restricted to one declared run and supported browser', () => {
  assert.match(runScopedEmail(safe.LIVE_RUN_SUFFIX, 'chromium-live'), /\+clerk_test@example\.com$/);
  assert.ok(runScopedEmail(safe.LIVE_RUN_SUFFIX, 'chromium-live').split('@')[0]!.length <= 64);
  assert.notEqual(runScopedEmail(safe.LIVE_RUN_SUFFIX, 'chromium-live'), runScopedEmail(safe.LIVE_RUN_SUFFIX, 'webkit-live'));
  assert.throws(() => runScopedEmail('historical', 'chromium-live'));
  assert.throws(() => runScopedEmail(safe.LIVE_RUN_SUFFIX, 'production'));
});

test('permits only an explicitly confirmed exact run-scoped local PostgreSQL target', () => {
  const name = runScopedPostgresName(safe.LIVE_RUN_SUFFIX);
  const databaseURL = `postgresql://${name}@127.0.0.1:55441/${name}`;
  const postgres = { ...safe, DATABASE_URL: databaseURL, LIVE_LOCAL_POSTGRES_CONFIRMED: 'true' };

  assert.equal(assertLocalAcceptanceEnvironment(postgres).runId, safe.LIVE_RUN_SUFFIX);
  assert.throws(() => runScopedPostgresName('historical'));

  for (const override of [
    { LIVE_LOCAL_POSTGRES_CONFIRMED: undefined },
    { LIVE_RUN_SUFFIX: 'acceptance-different-run-000000000000' },
    { DATABASE_URL: databaseURL.replace('127.0.0.1', 'remote.example.com') },
    { DATABASE_URL: databaseURL.replace(':55441', ':5432') },
    { DATABASE_URL: databaseURL.replace(`/${name}`, '/production') },
    { DATABASE_URL: databaseURL.replace(`${name}@`, 'postgres@') },
    { DATABASE_URL: `${databaseURL}?options=unsafe` },
    { DATABASE_URL: `${databaseURL}#fragment` },
    { DATABASE_URL: '' },
  ]) {
    assert.throws(() => assertLocalAcceptanceEnvironment({ ...postgres, ...override }));
  }
});

test('retains Clerk identities unless irreversible cleanup was confirmed for this exact run', () => {
  assert.equal(runCleanupIsConfirmed({}, safe.LIVE_RUN_SUFFIX), false);
  assert.equal(runCleanupIsConfirmed({ LIVE_CLERK_CLEANUP_CONFIRMED: 'true' }, safe.LIVE_RUN_SUFFIX), false);
  assert.equal(runCleanupIsConfirmed({ LIVE_CLERK_CLEANUP_CONFIRMED: 'acceptance-other-run-00000000' }, safe.LIVE_RUN_SUFFIX), false);
  assert.equal(runCleanupIsConfirmed({ LIVE_CLERK_CLEANUP_CONFIRMED: safe.LIVE_RUN_SUFFIX }, safe.LIVE_RUN_SUFFIX), true);
  assert.equal(runCleanupIsConfirmed({ LIVE_CLERK_CLEANUP_CONFIRMED: 'historical' }, 'historical'), false);
});
