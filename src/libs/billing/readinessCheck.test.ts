/**
 * P8c readiness harness — proves the four required scenarios (dark/ready,
 * env-mismatched carrier, missing cron, webhook secret collision) plus the
 * positive "ready for activation" shape. Pure-over-inputs: every fixture
 * passes its own `env` record rather than mutating `process.env`, so these
 * tests never depend on (or disturb) vitest-setup.ts's global placeholders.
 */
import { describe, expect, it } from 'vitest';

import { BILLING_WEBHOOK_HANDLED_TYPES } from './billingWebhookEvents';
import type {
  BillingReadinessEndpointFacts,
  BillingReadinessEvaluation,
  BillingReadinessEvidence,
  BillingReadinessHealthFacts,
  BillingReadinessTarget,
} from './readinessCheck';
import { evaluateBillingReadiness, inspectEnvFileCarrier, runBillingReadinessCheck } from './readinessCheck';

const BOTH_CRONS = [
  { path: '/api/billing/windows/evaluate', schedule: '*/15 * * * *' },
  { path: '/api/billing/reconcile', schedule: '17 * * * *' },
];

const CORRECT_HANDLED_TYPES = [...BILLING_WEBHOOK_HANDLED_TYPES];
const ENDPOINT_URL = 'https://preview.example/api/webhooks/stripe-billing';
const completeEndpoint = {
  id: 'we_12345678',
  url: ENDPOINT_URL,
  livemode: false,
  status: 'enabled' as const,
  enabled_events: CORRECT_HANDLED_TYPES,
};

const completeCarrier = JSON.stringify({
  env: 'test',
  offers: Object.fromEntries([
    'starter_2026_08_monthly',
    'starter_2026_08_annual',
    'pro_2026_08_monthly',
    'pro_2026_08_annual',
    'elite_2026_08_monthly',
    'elite_2026_08_annual',
  ].map((key, index) => [key, `price_test${String(index).padStart(8, '0')}`])),
  topups: Object.fromEntries([
    'topup_100_free_2026_08',
    'topup_250_free_2026_08',
    'topup_500_free_2026_08',
    'topup_100_paid_2026_08',
    'topup_250_paid_2026_08',
    'topup_500_paid_2026_08',
    'topup_1000_paid_2026_08',
  ].map((key, index) => [key, `price_topup${String(index).padStart(8, '0')}`])),
  coupons: { founding_annual_2026: 'coupon_test12345678' },
});

function darkEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    BILLING_PLAN_ENV: 'test',
    ...overrides,
  };
}

function findCheck(result: ReturnType<typeof runBillingReadinessCheck>, id: string) {
  const check = result.checks.find(entry => entry.id === id);

  expect(check).toBeDefined();

  return check!;
}

describe('runBillingReadinessCheck — dark env', () => {
  it('a fully dark env with no crons registered is ready for dark deploy but not ready for activation', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: [],
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(true);
    expect(result.readyForActivation).toBe(false);
    expect(findCheck(result, 'dark_switches_unset').ok).toBe(true);
    expect(findCheck(result, 'billing_crons_registered').ok).toBe(false);
  });

  it('never includes a secret value in any check detail', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({
        STRIPE_WEBHOOK_SECRET: 'whsec_legacy_super_secret_value',
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect_super_secret_value',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_billing_super_secret_value',
      }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('super_secret_value');
  });
});

describe('runBillingReadinessCheck — carrier env mismatch', () => {
  it('a carrier scoped to a different env than BILLING_PLAN_ENV is not ready (boot-fatal)', () => {
    const mismatchedCarrier = JSON.stringify({
      env: 'prod',
      offers: {},
      topups: {},
      coupons: {},
    });

    const result = runBillingReadinessCheck({
      env: darkEnv({ BILLING_STRIPE_PRICE_IDS: mismatchedCarrier }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(false);
    expect(result.readyForActivation).toBe(false);

    const carrierCheck = findCheck(result, 'stripe_price_carrier');

    expect(carrierCheck.ok).toBe(false);
    expect(carrierCheck.detail).toContain('prod');
  });

  it('a malformed carrier is not ready', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({ BILLING_STRIPE_PRICE_IDS: '{not valid json' }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(false);
    expect(findCheck(result, 'stripe_price_carrier').ok).toBe(false);
  });

  it('a well-formed carrier matching BILLING_PLAN_ENV is ready and reports the still-missing catalogue keys', () => {
    const carrier = JSON.stringify({
      env: 'test',
      offers: { starter_2026_08_monthly: 'price_test12345678' },
      topups: {},
      coupons: {},
    });

    const result = runBillingReadinessCheck({
      env: darkEnv({ BILLING_STRIPE_PRICE_IDS: carrier }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    const carrierCheck = findCheck(result, 'stripe_price_carrier');

    expect(carrierCheck.ok).toBe(true);
    expect(carrierCheck.detail).not.toContain('price_test12345678');
    expect(carrierCheck.detail).toContain('starter_2026_08_annual');
  });
});

describe('runBillingReadinessCheck — missing cron', () => {
  it('registering only one of the two billing crons is not ready for activation', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: [{ path: '/api/billing/windows/evaluate', schedule: '*/15 * * * *' }],
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(true);
    expect(result.readyForActivation).toBe(false);

    const cronCheck = findCheck(result, 'billing_crons_registered');

    expect(cronCheck.ok).toBe(false);
    expect(cronCheck.detail).toContain('/api/billing/reconcile');
  });

  it('registered crons and source-like event input alone are not activation evidence', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(true);
    expect(result.readyForActivation).toBe(false);
  });
});

describe('runBillingReadinessCheck — webhook secret collision', () => {
  it('the billing secret equal to the legacy secret is not ready', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({
        STRIPE_WEBHOOK_SECRET: 'whsec_shared',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_shared',
      }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(false);
    expect(result.readyForActivation).toBe(false);
    expect(findCheck(result, 'webhook_secret_distinctness').ok).toBe(false);
  });

  it('the billing secret equal to the connect secret is not ready', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_shared',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_shared',
      }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(false);
    expect(findCheck(result, 'webhook_secret_distinctness').ok).toBe(false);
  });

  it('three distinct present secrets are ready', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({
        STRIPE_WEBHOOK_SECRET: 'whsec_legacy',
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_billing',
      }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    // Note: this env is no longer "dark" (the billing secret is set), so
    // dark-readiness itself is expected to fail even though the secrets are
    // distinct — see the dedicated dark_switches_unset assertion below.
    expect(findCheck(result, 'webhook_secret_distinctness').ok).toBe(true);
    expect(findCheck(result, 'dark_switches_unset').ok).toBe(false);
  });

  it('allows the expected distinct billing secret for activation when all activation evidence is present', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({
        STRIPE_WEBHOOK_SECRET: 'whsec_legacy',
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_billing',
        STRIPE_SECRET_KEY: 'sk_test_abcdefgh',
        CRON_SECRET: 'cron-secret',
        BILLING_STRIPE_PRICE_IDS: completeCarrier,
      }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEndpoint: completeEndpoint,
      expectedWebhookUrl: ENDPOINT_URL,
    });

    expect(result.readyForDarkDeploy).toBe(false);
    expect(result.readyForActivation).toBe(true);
  });
});

describe('runBillingReadinessCheck — plan env / runtime mismatch', () => {
  it('BILLING_PLAN_ENV not matching the expected value for the runtime is not ready', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({ BILLING_PLAN_ENV: 'prod' }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(false);
    expect(findCheck(result, 'billing_plan_env').ok).toBe(false);
  });
});

describe('runBillingReadinessCheck — no live Stripe keys outside production', () => {
  it('a live secret key on a non-production runtime is not ready', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({ STRIPE_SECRET_KEY: 'sk_live_abcdefgh' }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.readyForDarkDeploy).toBe(false);
    expect(findCheck(result, 'no_live_stripe_keys_outside_production').ok).toBe(false);
  });

  it('a test secret key on a non-production runtime is ready', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({ STRIPE_SECRET_KEY: 'sk_test_abcdefgh' }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(findCheck(result, 'no_live_stripe_keys_outside_production').ok).toBe(true);
  });
});

describe('runBillingReadinessCheck — handled event types', () => {
  it('refuses to call activation ready when Stripe endpoint evidence is omitted', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv({
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_billing',
        BILLING_STRIPE_PRICE_IDS: completeCarrier,
      }),
      vercelCrons: BOTH_CRONS,
    });

    expect(result.readyForActivation).toBe(false);
    expect(findCheck(result, 'provisioned_webhook_endpoint').detail).toContain('not supplied');
  });

  it('a truncated handled-type list is not ready for activation', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES.slice(0, 10),
    });

    expect(result.readyForDarkDeploy).toBe(true);
    expect(result.readyForActivation).toBe(false);

    const check = findCheck(result, 'provisioned_webhook_endpoint');

    expect(check.ok).toBe(false);
    expect(check.detail).toContain('not supplied');
  });

  it('an event type beyond the contracted 13 is not ready for activation', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: [...CORRECT_HANDLED_TYPES, 'payment_intent.succeeded'],
    });

    expect(result.readyForActivation).toBe(false);
    expect(findCheck(result, 'provisioned_webhook_endpoint').detail).toContain('not supplied');
  });

  it('asserts the contracted list is exactly the 13 event types the contract requires', () => {
    expect(BILLING_WEBHOOK_HANDLED_TYPES).toHaveLength(13);
  });
});

describe('runBillingReadinessCheck — optional health cross-check', () => {
  it('is omitted from checks when healthBilling is not supplied', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
    });

    expect(result.checks.some(check => check.id === 'health_endpoint_consistency')).toBe(false);
  });

  it('flags a mismatch between the reported health block and local expectations', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
      healthBilling: { dark: false, planEnvMatchesRuntime: true, schemaDrift: 'ready' },
    });

    const check = findCheck(result, 'health_endpoint_consistency');

    expect(check.ok).toBe(false);
    expect(check.detail).toContain('billing.dark');
    expect(result.readyForDarkDeploy).toBe(false);
  });

  it('passes when the reported health block agrees with local expectations', () => {
    const result = runBillingReadinessCheck({
      env: darkEnv(),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEventTypes: CORRECT_HANDLED_TYPES,
      healthBilling: { dark: true, planEnvMatchesRuntime: true, schemaDrift: 'ready' },
    });

    expect(findCheck(result, 'health_endpoint_consistency').ok).toBe(true);
  });
});

describe('activation evidence rejects incomplete or wrong provider state', () => {
  function activationInput(overrides: Record<string, string | undefined> = {}) {
    return {
      env: darkEnv({
        STRIPE_WEBHOOK_SECRET: 'whsec_legacy',
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_billing',
        STRIPE_SECRET_KEY: 'sk_test_abcdefgh',
        CRON_SECRET: 'cron-secret',
        BILLING_STRIPE_PRICE_IDS: completeCarrier,
        ...overrides,
      }),
      vercelCrons: BOTH_CRONS,
      provisionedWebhookEndpoint: completeEndpoint,
      expectedWebhookUrl: ENDPOINT_URL,
    };
  }

  it.each([
    ['unknown carrier key', JSON.stringify({ env: 'test', offers: { rogue: 'price_test12345678' }, topups: {}, coupons: {} })],
    ['duplicate carrier id', completeCarrier.replace('price_test00000001', 'price_test00000000')],
  ])('rejects a %s that the runtime parser rejects', (_label, carrier) => {
    expect(runBillingReadinessCheck(activationInput({ BILLING_STRIPE_PRICE_IDS: carrier })).readyForActivation).toBe(false);
  });

  it.each([
    ['STRIPE_SECRET_KEY', undefined],
    ['STRIPE_SECRET_KEY', ''],
    ['STRIPE_SECRET_KEY', 'sk_test_'],
    ['STRIPE_SECRET_KEY', 'sk_test_has space'],
    ['CRON_SECRET', undefined],
    ['CRON_SECRET', '   '],
    ['STRIPE_BILLING_WEBHOOK_SECRET', undefined],
    ['STRIPE_BILLING_WEBHOOK_SECRET', '   '],
    // NOTE (PR-4, handoff §5.3): the former `['STRIPE_BILLING_WEBHOOK_SECRET',
    // 'not-a-whsec']` row is deliberately gone. It asserted a `whsec_` VALUE
    // regex, which required the operator's local shell to hold the
    // deployment's webhook secret — an evidence source handoff §5.2 rules out
    // — while proving nothing about the deployed endpoint. Presence is still
    // required (the two rows above); whether the deployed secret is the RIGHT
    // one is now proven by the readiness endpoint's
    // `webhookSecretConfigured`/`webhookSecretDistinct` booleans and the
    // unsigned-POST probe, neither of which reads a value.
  ])('rejects a missing or blank %s', (key, value) => {
    expect(runBillingReadinessCheck(activationInput({ [key]: value })).readyForActivation).toBe(false);
  });

  it.each([
    ['disabled', { ...completeEndpoint, status: 'disabled' }],
    ['live-mode mismatch', { ...completeEndpoint, livemode: true }],
    ['wrong origin', { ...completeEndpoint, url: 'https://wrong.example/api/webhooks/stripe-billing' }],
    ['wrong path', { ...completeEndpoint, url: 'https://preview.example/api/webhooks/stripe' }],
    ['non-HTTPS URL', { ...completeEndpoint, url: 'http://preview.example/api/webhooks/stripe-billing' }],
    ['invalid URL', { ...completeEndpoint, url: 'not a URL' }],
  ])('rejects a %s endpoint export', (_label, endpoint) => {
    expect(runBillingReadinessCheck({ ...activationInput(), provisionedWebhookEndpoint: endpoint }).readyForActivation).toBe(false);
  });
});

// ===========================================================================
// Per-target readiness (PR-4 — handoff §5.1/§5.3). RD-1/2/3/4/6.
// ===========================================================================

const REHEARSAL_ORIGIN = 'https://preview.example';
const REHEARSAL_CARRIER = inspectEnvFileCarrier(completeCarrier, 'test');
// Same catalogue, scoped to the production plan env — the ids are identical,
// so the digest is too: what differs is the env the carrier declares.
const PRODUCTION_CARRIER = inspectEnvFileCarrier(completeCarrier.replace('"env":"test"', '"env":"prod"'), 'prod');

function healthFacts(overrides: Partial<BillingReadinessHealthFacts> = {}): BillingReadinessHealthFacts {
  return {
    httpStatus: 503,
    status: 'degraded',
    dark: false,
    planEnvMatchesRuntime: true,
    schemaDrift: 'ready',
    gitSha: 'abc1234',
    ...overrides,
  };
}

function readinessFacts(overrides: Partial<BillingReadinessEndpointFacts> = {}): BillingReadinessEndpointFacts {
  return {
    planEnv: 'test',
    planEnvMatchesRuntime: true,
    vercelEnv: 'preview',
    gitSha: 'abc1234',
    appOrigin: REHEARSAL_ORIGIN,
    switches: { subscriptions: true, topups: true, publicPricing: false, taxCollection: false },
    webhookSecretConfigured: true,
    webhookSecretDistinct: true,
    stripeKeyMode: 'test',
    cronSecretConfigured: true,
    identityHmacConfigured: true,
    identityHmacVersion: 1,
    carrier: {
      present: true,
      env: 'test',
      offers: 6,
      topups: 7,
      coupons: 1,
      digest: REHEARSAL_CARRIER.digest,
      parse: 'ok',
    },
    deploymentMarker: true,
    timestamp: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

function rehearsalEvidence(overrides: Partial<BillingReadinessEvidence> = {}): BillingReadinessEvidence {
  return {
    source: 'deployed',
    environment: 'preview',
    origin: REHEARSAL_ORIGIN,
    health: healthFacts(),
    readiness: readinessFacts(),
    envFileNames: ['BILLING_PLAN_ENV', 'BILLING_STRIPE_PRICE_IDS', 'STRIPE_BILLING_WEBHOOK_SECRET'],
    envFileCarrier: REHEARSAL_CARRIER,
    vercelCrons: BOTH_CRONS,
    cronProof: {
      recordedAt: '2026-09-16T00:00:00.000Z',
      invocations: [
        { path: '/api/billing/windows/evaluate', status: 200, body: { skipped: 'BILLING_DISABLED' } },
        { path: '/api/billing/reconcile', status: 200, body: { skipped: 'BILLING_DISABLED', purged: 0 } },
      ],
    },
    webhookEndpoint: completeEndpoint,
    portalConfigurations: [{ id: 'bpc_test', is_default: true, livemode: false, features: { subscription_update: { enabled: false } } }],
    integrityReport: { exitCode: 0, violations: [] },
    ...overrides,
  };
}

/** The same bundle in production/live shape, for the two activation targets. */
function productionEvidence(
  switches: Partial<BillingReadinessEndpointFacts['switches']> = {},
): BillingReadinessEvidence {
  return rehearsalEvidence({
    environment: 'production',
    envFileCarrier: PRODUCTION_CARRIER,
    readiness: readinessFacts({
      planEnv: 'prod',
      vercelEnv: 'production',
      stripeKeyMode: 'live',
      switches: { subscriptions: false, topups: false, publicPricing: false, taxCollection: false, ...switches },
      carrier: {
        present: true,
        env: 'prod',
        offers: 6,
        topups: 7,
        coupons: 1,
        digest: PRODUCTION_CARRIER.digest,
        parse: 'ok',
      },
    }),
    webhookEndpoint: { ...completeEndpoint, livemode: true },
    portalConfigurations: [{ id: 'bpc_live', is_default: true, livemode: true, features: { subscription_update: { enabled: false } } }],
  });
}

function evaluation(target: BillingReadinessTarget, evidence: BillingReadinessEvidence) {
  return evaluateBillingReadiness({ target, evidence });
}

function checkOf(result: BillingReadinessEvaluation, id: string) {
  const check = result.checks.find(entry => entry.id === id);

  expect(check).toBeDefined();

  return check!;
}

describe('evaluateBillingReadiness — the complete rehearsal bundle', () => {
  it('is met, with nothing missing', () => {
    const result = evaluation('rehearsal', rehearsalEvidence());

    expect(result.missingEvidence).toEqual([]);
    expect(result.met).toBe(true);
    expect(result.target).toBe('rehearsal');
    expect(result.evidenceSource).toBe('deployed');
  });

  it('never reproduces a secret, an id, or the raw carrier in any detail', () => {
    const serialized = JSON.stringify(evaluation('rehearsal', rehearsalEvidence()));

    for (const shape of ['whsec_', 'sk_', 'price_', 'coupon_']) {
      expect(serialized).not.toContain(shape);
    }
  });

  it('reports a degraded Preview health status without failing the billing verdict (X7)', () => {
    const result = evaluation('rehearsal', rehearsalEvidence());

    expect(checkOf(result, 'health_aggregate_status_reported').ok).toBe(true);
    expect(checkOf(result, 'health_schema_drift_ready').ok).toBe(true);
    expect(result.met).toBe(true);
  });
});

describe('RD-1 — carrier parity between the pulled env file and the deployment', () => {
  it('is met when the SHA-256 id digests agree', () => {
    expect(checkOf(evaluation('rehearsal', rehearsalEvidence()), 'carrier_digest_parity').ok).toBe(true);
  });

  it('fails when the deployment runs a different carrier than the file shows', () => {
    const result = evaluation('rehearsal', rehearsalEvidence({
      readiness: readinessFacts({
        carrier: { ...readinessFacts().carrier, digest: 'f'.repeat(64) },
      }),
    }));

    expect(checkOf(result, 'carrier_digest_parity').ok).toBe(false);
    expect(result.met).toBe(false);
  });

  it('fails an incomplete catalogue and names the missing KEYS, never an id', () => {
    const partial = JSON.stringify({
      env: 'test',
      offers: { starter_2026_08_monthly: 'price_test12345678' },
      topups: {},
      coupons: {},
    });
    const carrier = inspectEnvFileCarrier(partial, 'test');
    const result = evaluation('rehearsal', rehearsalEvidence({
      envFileCarrier: carrier,
      readiness: readinessFacts({
        carrier: { present: true, env: 'test', offers: 1, topups: 0, coupons: 0, digest: carrier.digest, parse: 'ok' },
      }),
    }));
    const check = checkOf(result, 'carrier_complete');

    expect(check.ok).toBe(false);
    expect(check.detail).toContain('starter_2026_08_annual');
    expect(check.detail).not.toContain('price_test12345678');
  });

  it('reports the missing pulled env file rather than passing on the deployment alone', () => {
    const { envFileCarrier: _unused, ...rest } = rehearsalEvidence();
    const result = evaluation('rehearsal', rest as BillingReadinessEvidence);

    expect(result.missingEvidence).toContain('pulled env file (--env-file)');
    expect(result.met).toBe(false);
  });
});

describe('RD-2 — secret presence is never itself a rehearsal/activation failure', () => {
  it('a configured, distinct billing secret is what rehearsal REQUIRES', () => {
    const result = evaluation('rehearsal', rehearsalEvidence());

    expect(checkOf(result, 'readiness_webhook_secret').ok).toBe(true);
    expect(result.met).toBe(true);
  });

  it.each(['activate-topups', 'activate-subscriptions'] as const)('%s is not failed by the secret being present', (target) => {
    const result = evaluation(target, productionEvidence());

    expect(checkOf(result, 'readiness_webhook_secret').ok).toBe(true);
    expect(result.met).toBe(true);
  });

  it('a secret shared with the legacy/Connect endpoint fails, presence alone does not', () => {
    const result = evaluation('rehearsal', rehearsalEvidence({
      readiness: readinessFacts({ webhookSecretDistinct: false }),
    }));

    expect(checkOf(result, 'readiness_webhook_secret').ok).toBe(false);
  });

  it('dark is NOT met once the billing secret is configured on the deployment', () => {
    const result = evaluation('dark', {
      source: 'deployed',
      environment: 'production',
      origin: 'https://www.lustergel.app',
      health: healthFacts({ httpStatus: 200, status: 'ok', dark: false }),
      readiness: readinessFacts({
        planEnv: 'prod',
        vercelEnv: 'production',
        stripeKeyMode: 'live',
        switches: { subscriptions: false, topups: false, publicPricing: false, taxCollection: false },
      }),
    });

    expect(checkOf(result, 'readiness_webhook_secret_absent').ok).toBe(false);
    expect(checkOf(result, 'health_billing_dark').ok).toBe(false);
    expect(result.met).toBe(false);
  });

  it('dark IS met on a dark deployment, and the env-file leg checks NAMES only', () => {
    const result = evaluation('dark', {
      source: 'env-file',
      environment: 'production',
      origin: 'https://www.lustergel.app',
      health: healthFacts({ httpStatus: 200, status: 'ok', dark: true }),
      readiness: readinessFacts({
        planEnv: 'prod',
        vercelEnv: 'production',
        stripeKeyMode: 'live',
        webhookSecretConfigured: false,
        switches: { subscriptions: false, topups: false, publicPricing: false, taxCollection: false },
        carrier: { present: false, env: null, offers: 0, topups: 0, coupons: 0, digest: null, parse: 'absent' },
      }),
      envFileNames: ['BILLING_PLAN_ENV', 'STRIPE_SECRET_KEY', 'CRON_SECRET'],
    });

    expect(result.met).toBe(true);
    expect(checkOf(result, 'env_file_billing_secret_absent').ok).toBe(true);
    expect(checkOf(result, 'env_file_switches_unset').ok).toBe(true);
  });

  it('dark fails when the pulled env file declares the billing secret NAME', () => {
    const result = evaluation('dark', {
      source: 'env-file',
      environment: 'preview',
      origin: REHEARSAL_ORIGIN,
      health: healthFacts({ dark: true }),
      envFileNames: ['STRIPE_BILLING_WEBHOOK_SECRET'],
    });

    expect(checkOf(result, 'env_file_billing_secret_absent').ok).toBe(false);
    expect(result.met).toBe(false);
  });
});

describe('RD-3 — target-aware switch expectations (D11)', () => {
  it('activate-subscriptions is MET with top-ups already enabled (the documented order)', () => {
    const result = evaluation('activate-subscriptions', productionEvidence({ topups: true }));

    expect(checkOf(result, 'readiness_switches').ok).toBe(true);
    expect(result.met).toBe(true);
  });

  it('activate-topups is NOT met once top-ups are already enabled', () => {
    expect(evaluation('activate-topups', productionEvidence({ topups: true })).met).toBe(false);
  });

  it.each(['publicPricing', 'taxCollection'] as const)('%s=true blocks activate-subscriptions (D11)', (key) => {
    const result = evaluation('activate-subscriptions', productionEvidence({ topups: true, [key]: true }));

    expect(checkOf(result, 'readiness_switches').ok).toBe(false);
    expect(result.met).toBe(false);
  });

  it('activate-subscriptions is NOT met when subscriptions are already on', () => {
    expect(evaluation('activate-subscriptions', productionEvidence({ subscriptions: true })).met).toBe(false);
  });

  it('rehearsal requires BOTH rehearsal switches on and both D11 switches off', () => {
    expect(evaluation('rehearsal', rehearsalEvidence({
      readiness: readinessFacts({ switches: { subscriptions: true, topups: false, publicPricing: false, taxCollection: false } }),
    })).met).toBe(false);
    expect(evaluation('rehearsal', rehearsalEvidence({
      readiness: readinessFacts({ switches: { subscriptions: true, topups: true, publicPricing: true, taxCollection: false } }),
    })).met).toBe(false);
  });
});

describe('RD-4 (library half) — supplied endpoint/portal exports that are wrong', () => {
  it.each([
    ['disabled endpoint', { ...completeEndpoint, status: 'disabled' }],
    ['live-mode endpoint for a Preview rehearsal', { ...completeEndpoint, livemode: true }],
    ['wrong origin', { ...completeEndpoint, url: 'https://wrong.example/api/webhooks/stripe-billing' }],
    ['wrong path', { ...completeEndpoint, url: `${REHEARSAL_ORIGIN}/api/webhooks/stripe` }],
    ['truncated event list', { ...completeEndpoint, enabled_events: CORRECT_HANDLED_TYPES.slice(0, 10) }],
  ])('fails the endpoint check for a %s', (_label, endpoint) => {
    const result = evaluation('rehearsal', rehearsalEvidence({ webhookEndpoint: endpoint }));

    expect(checkOf(result, 'provisioned_webhook_endpoint').ok).toBe(false);
    expect(result.met).toBe(false);
  });

  it('reports an omitted endpoint export as MISSING evidence, not as a failure of content', () => {
    const { webhookEndpoint: _unused, ...rest } = rehearsalEvidence();
    const result = evaluation('rehearsal', rest as BillingReadinessEvidence);

    expect(result.missingEvidence).toContain('Stripe endpoint export (--webhook-endpoint-file)');
  });

  it('fails a portal default configuration that still allows plan switching (D16)', () => {
    const result = evaluation('rehearsal', rehearsalEvidence({
      portalConfigurations: [{ id: 'bpc_test', is_default: true, livemode: false, features: { subscription_update: { enabled: true } } }],
    }));

    expect(checkOf(result, 'portal_subscription_update_disabled').ok).toBe(false);
  });

  it('fails an integrity report with a non-zero exit or any violation', () => {
    expect(evaluation('rehearsal', rehearsalEvidence({ integrityReport: { exitCode: 1, violations: [] } })).met).toBe(false);
    expect(evaluation('rehearsal', rehearsalEvidence({ integrityReport: { exitCode: 0, violations: ['duplicate lot'] } })).met).toBe(false);
  });
});

describe('RD-6 — Preview crons and CRON_SECRET', () => {
  it('registration at the deployed sha alone is not proof: the invocation file is required', () => {
    const { cronProof: _unused, ...rest } = rehearsalEvidence();
    const result = evaluation('rehearsal', rest as BillingReadinessEvidence);

    expect(checkOf(result, 'billing_crons_registered').ok).toBe(true);
    expect(result.missingEvidence).toContain('cron invocation proof (--cron-proof-file)');
    expect(result.met).toBe(false);
  });

  it('a recorded non-200, or a missing path, fails the proof', () => {
    expect(evaluation('rehearsal', rehearsalEvidence({
      cronProof: {
        recordedAt: '2026-09-16T00:00:00.000Z',
        invocations: [
          { path: '/api/billing/windows/evaluate', status: 401 },
          { path: '/api/billing/reconcile', status: 200 },
        ],
      },
    })).met).toBe(false);
    expect(evaluation('rehearsal', rehearsalEvidence({
      cronProof: {
        recordedAt: '2026-09-16T00:00:00.000Z',
        invocations: [{ path: '/api/billing/windows/evaluate', status: 200 }],
      },
    })).met).toBe(false);
  });

  it('a cron missing from vercel.json AT THE DEPLOYED SHA fails', () => {
    const result = evaluation('rehearsal', rehearsalEvidence({
      vercelCrons: [{ path: '/api/billing/windows/evaluate', schedule: '*/15 * * * *' }],
    }));

    expect(checkOf(result, 'billing_crons_registered').ok).toBe(false);
    expect(checkOf(result, 'billing_crons_registered').detail).toContain('/api/billing/reconcile');
  });

  it('cronSecretConfigured false on the deployment is not met', () => {
    const result = evaluation('rehearsal', rehearsalEvidence({
      readiness: readinessFacts({ cronSecretConfigured: false }),
    }));

    expect(checkOf(result, 'readiness_cron_secret').ok).toBe(false);
    expect(result.met).toBe(false);
  });
});

describe('evaluateBillingReadiness — evidence source and origin coupling', () => {
  it.each(['env-file', 'local'] as const)('%s cannot prove a rehearsal target', (source) => {
    const result = evaluation('rehearsal', rehearsalEvidence({ source }));

    expect(checkOf(result, 'evidence_source').ok).toBe(false);
    expect(result.met).toBe(false);
  });

  it('local cannot prove even the dark target', () => {
    const result = evaluation('dark', {
      source: 'local',
      environment: null,
      origin: null,
      health: healthFacts({ httpStatus: 200, status: 'ok', dark: true }),
    });

    expect(checkOf(result, 'evidence_source').ok).toBe(false);
    expect(result.met).toBe(false);
  });

  it('a localhost appOrigin fallback on a hosted deployment fails (X5)', () => {
    const result = evaluation('rehearsal', rehearsalEvidence({
      readiness: readinessFacts({ appOrigin: 'http://localhost:3000' }),
    }));

    expect(checkOf(result, 'readiness_app_origin').ok).toBe(false);
  });

  it('an unreachable readiness endpoint is missing evidence, never a pass', () => {
    const { readiness: _unused, ...rest } = rehearsalEvidence();
    const result = evaluation('rehearsal', rest as BillingReadinessEvidence);

    expect(result.missingEvidence).toContain('deployed readiness endpoint (--readiness-url/--readiness-file)');
    expect(result.met).toBe(false);
  });

  it('dark without any deployed health is missing evidence, never a pass', () => {
    const result = evaluation('dark', { source: 'env-file', environment: 'production', origin: null, envFileNames: [] });

    expect(result.missingEvidence).toContain('deployed health (--health-url/--health-file)');
    expect(result.met).toBe(false);
  });
});
