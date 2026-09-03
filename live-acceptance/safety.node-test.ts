import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertLocalAcceptanceEnvironment, runScopedEmail } from './safety';

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
