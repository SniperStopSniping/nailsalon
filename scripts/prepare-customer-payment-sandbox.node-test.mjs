import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareSandboxAccount } from './prepare-customer-payment-sandbox.mjs';

const environment = {
  VERCEL_ENV: 'preview',
  APP_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'codex/luster-payments-live-20261109',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
};
const account = {
  id: 'acct_synthetic',
  country: 'CA',
  default_currency: 'cad',
  type: 'standard',
  metadata: { luster_sandbox_purpose: 'customer_payments_release_20261109' },
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  requirements: { currently_due: ['business_type'], pending_verification: [] },
  controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' },
};

function fixture(options = {}) {
  const calls = [];
  let page = 0;
  const client = {
    accounts: {
      retrieve: async (id) => {
        calls.push(['retrieve', id]);
        return id ? options.account ?? account : { id: options.platform ?? 'acct_1SdpJKPOewmPdOib' };
      },
      list: async (params) => {
        calls.push(['list', params]);
        return options.pages?.[page++] ?? { data: [], has_more: false };
      },
      create: async (params, request) => {
        calls.push(['create', params, request]);
        if (options.createError) {
          throw new Error('synthetic lost response');
        }
        return account;
      },
    },
    balance: { retrieve: async () => {
      calls.push(['balance']);
      return { livemode: options.livemode ?? false };
    } },
  };
  return { client, calls };
}

test('rejects absent opt-in and wrong runtime, branch or live credential before any SDK access', async () => {
  for (const [env, confirm] of [
    [environment, false],
    [{ ...environment, VERCEL_ENV: 'production' }, true],
    [{ ...environment, APP_ENV: 'production' }, true],
    [{ ...environment, VERCEL_GIT_COMMIT_REF: 'main' }, true],
    [{ ...environment, STRIPE_SECRET_KEY: 'sk_live_fixture' }, true],
  ]) {
    const f = fixture();
    await assert.rejects(prepareSandboxAccount(f.client, env, confirm), /SANDBOX_SETUP_SCOPE_REJECTED/);
    assert.deepEqual(f.calls, []);
  }
});

test('rejects another platform or live balance before an account can be created', async () => {
  for (const options of [{ platform: 'acct_other' }, { livemode: true }]) {
    const f = fixture(options);
    await assert.rejects(prepareSandboxAccount(f.client, environment, true), /SANDBOX_PLATFORM_REJECTED/);
    assert.equal(f.calls.some(call => call[0] === 'list' || call[0] === 'create'), false);
  }
});

test('creates one labelled test account with a stable identity and no personal data or terms acceptance', async () => {
  const f = fixture();
  const result = await prepareSandboxAccount(f.client, environment, true);
  assert.equal(result.created, true);
  assert.equal(result.ready, false);
  assert.deepEqual(result.requiredFields, ['business_type']);
  const creation = f.calls.find(call => call[0] === 'create');
  assert.equal(creation[1].type, 'standard');
  assert.equal(creation[1].country, 'CA');
  assert.deepEqual(creation[2], { idempotencyKey: 'luster_customer_payments_sandbox_20261109_v1' });
  for (const forbidden of ['email', 'individual', 'company', 'external_account', 'tos_acceptance']) {
    assert.equal(forbidden in creation[1], false);
  }
  assert.deepEqual(f.calls.at(-1), ['retrieve', account.id]);
});

test('reuses the exact labelled account after a lost response instead of creating another', async () => {
  const failed = fixture({ createError: true });
  await assert.rejects(prepareSandboxAccount(failed.client, environment, true), /synthetic lost response/);
  assert.equal(failed.calls.filter(call => call[0] === 'create').length, 1);
  const retry = fixture({ pages: [{ data: [account], has_more: false }] });
  assert.equal((await prepareSandboxAccount(retry.client, environment, true)).created, false);
  assert.equal(retry.calls.some(call => call[0] === 'create'), false);
});

test('refuses ambiguous, malformed, nonprogressing and incomplete scans without a mutation', async () => {
  for (const pages of [
    [{ data: [account, { ...account, id: 'acct_second' }], has_more: false }],
    [{ data: [], has_more: 'no' }],
    [{ data: [], has_more: true }],
    [{ data: [{ id: 'acct_cursor' }], has_more: true }, { data: [{ id: 'acct_cursor' }], has_more: true }],
    [1, 2, 3].map(n => ({ data: [{ id: `acct_cursor${n}` }], has_more: true })),
  ]) {
    const f = fixture({ pages });
    await assert.rejects(prepareSandboxAccount(f.client, environment, true), /SANDBOX_ACCOUNT_SCAN_/);
    assert.equal(f.calls.some(call => call[0] === 'create'), false);
  }
});

test('only complete provider readiness is reported ready and private fields never enter the report', async () => {
  const ready = {
    ...account,
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: 'active' },
    requirements: {},
    email: 'synthetic@example.invalid',
  };
  const f = fixture({ pages: [{ data: [ready], has_more: false }], account: ready });
  const result = await prepareSandboxAccount(f.client, environment, true);
  assert.equal(result.ready, true);
  assert.equal(JSON.stringify(result).includes('synthetic@example.invalid'), false);
  const held = fixture({ pages: [{ data: [ready], has_more: false }], account: { ...ready, requirements: { pending_verification: ['individual.verification.document'] } } });
  assert.equal((await prepareSandboxAccount(held.client, environment, true)).ready, false);
});

test('refuses an existing account with mismatched ownership or account type', async () => {
  for (const change of [{ type: 'express' }, { country: 'US' }, { default_currency: 'usd' }, { metadata: {} }, { id: 'acct_wrong' }]) {
    const f = fixture({ pages: [{ data: [account], has_more: false }], account: { ...account, ...change } });
    await assert.rejects(prepareSandboxAccount(f.client, environment, true), /SANDBOX_ACCOUNT_SCOPE_REJECTED/);
    assert.equal(f.calls.some(call => call[0] === 'create'), false);
  }
});
