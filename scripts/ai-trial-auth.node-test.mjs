import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { aiTrialAuth, assertClerkTrialActor, privateClerkStorageState } from './lib/ai-trial-auth.mjs';
import { trialClerkRequest } from './lib/ai-trial-origins.mjs';

const host = 'synthetic-dev.clerk.accounts.dev';
const clerkUserId = 'user_syntheticowner';
const fixture = { clerkUserId, email: 'owner+clerk_test@example.com', emailVerified: true, sessionStatus: 'active', salonId: `ai_setup_${createHash('sha256').update(clerkUserId).digest('hex').slice(0, 32)}`, salonSlug: 'studio-synthetic', adminId: 'synthetic-admin', clerkStorageState: '/tmp/luster-real-clerk-example/state.json', clerkFrontendApi: host };
// Deliberately fake values: no provider calls or real credentials in unit tests.
const env = { APP_ENV: 'development', CLERK_SECRET_KEY: 'sk_test_synthetic_not_a_key', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${host}$`).toString('base64')}` };

test('existing explicitly seeded trials remain clearly identified', () => {
  assert.deepEqual(aiTrialAuth({ salonId: `paid_ai_trial_${'a'.repeat(32)}`, salonSlug: 'paid-ai-synthetic', session: 'synthetic' }), { kind: 'synthetic-session' });
});

test('genuine Clerk trials require verified account, real entry identity and matching Development config', () => {
  assert.deepEqual(aiTrialAuth(fixture, env), { kind: 'clerk-development', frontendApi: host });
  for (const change of [{ session: 'seeded-session' }, { emailVerified: false }, { sessionStatus: 'pending' }, { email: 'real-person@example.com' }, { salonId: `ai_setup_${'a'.repeat(32)}` }, { clerkFrontendApi: 'other.clerk.accounts.dev' }]) {
    assert.throws(() => aiTrialAuth({ ...fixture, ...change }, env));
  }
  for (const change of [{ APP_ENV: 'production' }, { CLERK_SECRET_KEY: 'sk_live_synthetic' }, { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_synthetic' }, { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('attacker.invalid$').toString('base64')}` }]) {
    assert.throws(() => aiTrialAuth(fixture, { ...env, ...change }));
  }
});

test('saved session must remain private and outside application files', () => {
  const dir = fs.mkdtempSync('/tmp/luster-real-clerk-unit-');
  const file = path.join(dir, 'state.json');
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(file, '{}', { mode: 0o600 });
  try {
    assert.equal(privateClerkStorageState(file), file);
    fs.chmodSync(file, 0o644);
    assert.throws(() => privateClerkStorageState(file), /private/u);
    fs.chmodSync(file, 0o600);
    fs.chmodSync(dir, 0o755);
    assert.throws(() => privateClerkStorageState(file), /private/u);
    assert.throws(() => privateClerkStorageState('state.json'), /absolute/u);
    assert.throws(() => privateClerkStorageState('/some/repository/state.json'), /outside/u);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('database attestation requires that same real Clerk owner on both records', async () => {
  const matching = { admin_id: fixture.adminId, clerk_user_id: clerkUserId, owner_clerk_user_id: clerkUserId, role: 'owner' };
  await assert.doesNotReject(() => assertClerkTrialActor({ query: async () => ({ rows: [matching] }) }, fixture));
  for (const rows of [[], [{ ...matching, role: 'staff' }], [{ ...matching, owner_clerk_user_id: 'user_other' }], [{ ...matching, clerk_user_id: 'user_other' }]]) {
    await assert.rejects(() => assertClerkTrialActor({ query: async () => ({ rows }) }, fixture), /genuine owner/u);
  }
});

test('real-auth network allowance is limited to the exact Development frontend', () => {
  assert.equal(trialClerkRequest(`https://${host}/v1/client`, host), true);
  for (const url of [`https://${host}.attacker.invalid/v1/client`, `https://${host}:444/v1/client`, `http://${host}/`, `https://user:password@${host}/`, 'https://api.clerk.com/', 'https://api.openai.com/', 'https://other.clerk.accounts.dev/']) {
    assert.equal(trialClerkRequest(url, host), false);
  }
  assert.equal(trialClerkRequest('https://attacker.invalid/', 'attacker.invalid'), false);
});
