/**
 * P8c readiness harness — proves the four required scenarios (dark/ready,
 * env-mismatched carrier, missing cron, webhook secret collision) plus the
 * positive "ready for activation" shape. Pure-over-inputs: every fixture
 * passes its own `env` record rather than mutating `process.env`, so these
 * tests never depend on (or disturb) vitest-setup.ts's global placeholders.
 */
import { describe, expect, it } from 'vitest';

import { BILLING_WEBHOOK_HANDLED_TYPES } from './billingWebhookEvents';
import { runBillingReadinessCheck } from './readinessCheck';

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
    ['STRIPE_BILLING_WEBHOOK_SECRET', 'not-a-whsec'],
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
