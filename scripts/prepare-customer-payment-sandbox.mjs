// Explicit release setup only. Never imported by the app or its normal build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Stripe from 'stripe';

const PLATFORM = 'acct_1SdpJKPOewmPdOib';
const BRANCH = 'codex/luster-payments-live-20261109';
const PURPOSE = 'customer_payments_release_20261109';
const IDEMPOTENCY_KEY = 'luster_customer_payments_sandbox_20261109_v1';

function requireSetupScope(environment, createAccount) {
  if (createAccount !== true || environment.VERCEL_ENV !== 'preview'
    || environment.APP_ENV !== 'preview' || environment.VERCEL_GIT_COMMIT_REF !== BRANCH
    || !(environment.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_')) {
    throw new Error('SANDBOX_SETUP_SCOPE_REJECTED');
  }
}

function accountSummary(account, created) {
  if (!/^acct_[A-Za-z0-9]+$/.test(account.id) || account.metadata?.luster_sandbox_purpose !== PURPOSE
    || account.country !== 'CA' || account.default_currency !== 'cad' || account.type !== 'standard') {
    throw new Error('SANDBOX_ACCOUNT_SCOPE_REJECTED');
  }
  const controllerMatches = account.controller?.stripe_dashboard?.type === 'full'
    && account.controller?.fees?.payer === 'account' && account.controller?.losses?.payments === 'stripe'
    && account.controller?.requirement_collection === 'stripe';
  const requirements = account.requirements;
  const ready = controllerMatches && account.charges_enabled === true && account.payouts_enabled === true
    && account.details_submitted === true && account.capabilities?.card_payments === 'active'
    && !!requirements && !requirements.disabled_reason && !requirements.currently_due?.length
    && !requirements.past_due?.length && !requirements.pending_verification?.length && !requirements.errors?.length;
  return {
    platformAccountId: PLATFORM,
    connectedAccountId: account.id,
    livemode: false,
    created,
    ready,
    controllerMatches,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    cardPaymentsActive: account.capabilities?.card_payments === 'active',
    // Field names only; never customer, representative, bank or credential data.
    requiredFields: requirements?.currently_due ?? [],
    pendingVerificationFields: requirements?.pending_verification ?? [],
  };
}

export async function prepareSandboxAccount(client, environment, createAccount = false) {
  requireSetupScope(environment, createAccount);
  const platform = await client.accounts.retrieve();
  const balance = await client.balance.retrieve();
  if (platform.id !== PLATFORM || balance.livemode !== false) {
    throw new Error('SANDBOX_PLATFORM_REJECTED');
  }
  const matches = new Map();
  let cursor;
  let exhausted = false;
  for (let page = 0; page < 3; page++) {
    const result = await client.accounts.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean') {
      throw new TypeError('SANDBOX_ACCOUNT_SCAN_INVALID');
    }
    for (const account of result.data) {
      if (account.metadata?.luster_sandbox_purpose === PURPOSE) {
        matches.set(account.id, account);
      }
    }
    if (matches.size > 1) {
      throw new Error('SANDBOX_ACCOUNT_SCAN_AMBIGUOUS');
    }
    if (!result.has_more) {
      exhausted = true;
      break;
    }
    const next = result.data.at(-1)?.id;
    if (!next || next === cursor) {
      throw new Error('SANDBOX_ACCOUNT_SCAN_INVALID');
    }
    cursor = next;
  }
  if (!exhausted) {
    throw new Error('SANDBOX_ACCOUNT_SCAN_INCOMPLETE');
  }
  let account = [...matches.values()][0];
  const created = !account;
  if (!account) {
    // No email, identity, bank details or terms acceptance. This creates only
    // a test account; onboarding is a separate step if Stripe requires it.
    account = await client.accounts.create({
      type: 'standard',
      country: 'CA',
      default_currency: 'cad',
      business_profile: {
        name: 'Luster customer payment sandbox',
        url: 'https://www.lustergel.app',
        product_description: 'Synthetic appointment payment validation. No live customers.',
      },
      metadata: { luster_sandbox_purpose: PURPOSE },
    }, { idempotencyKey: IDEMPOTENCY_KEY });
  }
  // Read current provider state independently of the mutation/list response.
  const verified = await client.accounts.retrieve(account.id);
  if (verified.id !== account.id) {
    throw new Error('SANDBOX_ACCOUNT_SCOPE_REJECTED');
  }
  return accountSummary(verified, created);
}

async function main() {
  const createAccount = process.argv.length === 3 && process.argv[2] === '--create-account';
  requireSetupScope(process.env, createAccount);
  const client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
    maxNetworkRetries: 0,
    timeout: 10000,
    telemetry: false,
  });
  const result = await prepareSandboxAccount(client, process.env, createAccount);
  process.stdout.write(`CUSTOMER_PAYMENT_SANDBOX_SETUP ${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const localCode = /^SANDBOX_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'SANDBOX_PROVIDER_SETUP_FAILED';
    // A failed/unknown write is recovered by the same identity on the next run.
    // Never serialize the SDK error (it may carry request or account data).
    console.error(JSON.stringify({ code: localCode, httpStatus: error?.statusCode ?? null, providerCode: error?.code ?? null }));
    process.exitCode = 1;
  });
}
