/**
 * ENV-2: the one livemode producer, and the Connect secret's isolation rules
 * (charter tests 18 (pure legs) and 23).
 */
import { describe, expect, it } from 'vitest';

import {
  assertProviderEnvironmentIsolation,
  computeExpectedLivemode,
  EnvironmentIsolationError,
} from './environmentIsolation';

const CI_PLACEHOLDER = 'ci-placeholder-not-a-secret';

/** The real CI fixture: every Stripe placeholder is the SAME literal. */
function ciFixture(overrides: Record<string, string | undefined> = {}) {
  return {
    GITHUB_ACTIONS: 'true',
    CI: 'true',
    BILLING_PLAN_ENV: 'test',
    CLERK_SECRET_KEY: CI_PLACEHOLDER,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2kubHVzdGVyLmludmFsaWQk',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: CI_PLACEHOLDER,
    STRIPE_SECRET_KEY: CI_PLACEHOLDER,
    STRIPE_WEBHOOK_SECRET: CI_PLACEHOLDER,
    STRIPE_CONNECT_WEBHOOK_SECRET: CI_PLACEHOLDER,
    ...overrides,
  };
}

/** A deployment-shaped fixture (preview), where real distinct secrets are required. */
function previewFixture(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    APP_ENV: 'preview',
    BILLING_PLAN_ENV: 'test',
    CLERK_SECRET_KEY: 'sk_test_clerk',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_clerk',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_stripe',
    STRIPE_SECRET_KEY: 'sk_test_stripe',
    STRIPE_WEBHOOK_SECRET: 'whsec_billing',
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
    ...overrides,
  };
}

/** A deployment-shaped fixture (production), with live providers + prod billing env. */
function productionFixture(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL: '1',
    VERCEL_ENV: 'production',
    APP_ENV: 'production',
    BILLING_PLAN_ENV: 'prod',
    CLERK_SECRET_KEY: 'sk_live_clerk',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_clerk',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_stripe',
    STRIPE_SECRET_KEY: 'sk_live_stripe',
    STRIPE_WEBHOOK_SECRET: 'whsec_billing',
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
    ...overrides,
  };
}

function isolationErrorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof EnvironmentIsolationError ? error.code : `unexpected:${String(error)}`;
  }
  return undefined;
}

// =============================================================================
// TEST 18 (pure legs) — computeExpectedLivemode
// =============================================================================

describe('test 18 — the single livemode producer', () => {
  it('production + a live key agree on livemode true', () => {
    expect(computeExpectedLivemode({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      APP_ENV: 'production',
      STRIPE_SECRET_KEY: 'sk_live_abc',
    })).toEqual({ ok: true, livemode: true });
  });

  it('preview + a test key agree on livemode false', () => {
    expect(computeExpectedLivemode({
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      APP_ENV: 'preview',
      STRIPE_SECRET_KEY: 'sk_test_abc',
    })).toEqual({ ok: true, livemode: false });
  });

  it('a production environment holding a TEST key is indeterminate', () => {
    // The misprovisioning that must never resolve to a guess.
    expect(computeExpectedLivemode({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      APP_ENV: 'production',
      STRIPE_SECRET_KEY: 'sk_test_abc',
    })).toEqual({ ok: false, code: 'MODE_INDETERMINATE' });
  });

  it('a non-production environment holding a LIVE key is indeterminate', () => {
    expect(computeExpectedLivemode({
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      APP_ENV: 'preview',
      STRIPE_SECRET_KEY: 'sk_live_abc',
    })).toEqual({ ok: false, code: 'MODE_INDETERMINATE' });
  });

  it('never throws, even on an environment that cannot be resolved', () => {
    // `resolveRuntimeEnvironment` rejects a marker conflict; the producer must
    // convert that into a value, not propagate it.
    expect(computeExpectedLivemode({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      APP_ENV: 'preview',
      STRIPE_SECRET_KEY: 'sk_live_abc',
    })).toEqual({ ok: false, code: 'MODE_INDETERMINATE' });

    expect(computeExpectedLivemode({ APP_ENV: 'not-an-environment' }))
      .toEqual({ ok: false, code: 'MODE_INDETERMINATE' });
  });
});

// =============================================================================
// TEST 23 — secret collision and the CI placeholder
// =============================================================================

describe('test 23 — Connect secret isolation', () => {
  it('(a) a deployment sharing one secret across both endpoints is rejected', () => {
    // Sharing means one endpoint verifies the other's deliveries — and the
    // billing handler never reads `event.account`.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        STRIPE_WEBHOOK_SECRET: 'whsec_same',
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_same',
      }),
    ))).toBe('STRIPE_WEBHOOK_SECRET_COLLISION');
  });

  it('(a) the same deployment with distinct secrets passes', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(previewFixture())))
      .toBeUndefined();
  });

  it('(b) a CI run whose Connect placeholder is wrong is rejected', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      ciFixture({ STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_not_the_placeholder' }),
    ))).toBe('CI_PROVIDER_PLACEHOLDER_REQUIRED');
  });

  it('(c) REGRESSION GUARD: the real CI fixture must pass', () => {
    // Both Stripe webhook secrets are the SAME placeholder here by design.
    // Hoisting the collision check above the ci/test early return would turn
    // this red — exactly as it would turn every CI job and every vitest run red.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(ciFixture())))
      .toBeUndefined();
  });

  it('(c) the same holds for a plain vitest-shaped environment', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      ciFixture({ GITHUB_ACTIONS: undefined, CI: undefined, NODE_ENV: 'test' }),
    ))).toBeUndefined();
  });

  it('an unset Connect secret is not a collision', () => {
    // The secret is optional so the app can boot before the endpoint exists.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({ STRIPE_CONNECT_WEBHOOK_SECRET: undefined }),
    ))).toBeUndefined();
  });
});

// =============================================================================
// G25 — the billing secret was never checked for a collision with either
// sibling, and the check runs at process boot (instrumentation.ts →
// assertEnvironmentIsolation), so a defective fix fails production boot.
// =============================================================================

describe('G25 — billing secret collision guard', () => {
  it('(a) billing == legacy is rejected', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        STRIPE_WEBHOOK_SECRET: 'whsec_shared',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_shared',
      }),
    ))).toBe('STRIPE_WEBHOOK_SECRET_COLLISION');
  });

  it('(b) billing == connect is rejected', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_shared',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_shared',
      }),
    ))).toBe('STRIPE_WEBHOOK_SECRET_COLLISION');
  });

  it('(c) billing absent, connect present passes', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
        STRIPE_BILLING_WEBHOOK_SECRET: undefined,
      }),
    ))).toBeUndefined();
  });

  it('(d) billing absent AND connect absent (today\'s production shape) passes', () => {
    // The mandatory truthiness guard: undefined === undefined must never reject.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        STRIPE_CONNECT_WEBHOOK_SECRET: undefined,
        STRIPE_BILLING_WEBHOOK_SECRET: undefined,
      }),
    ))).toBeUndefined();
  });

  it('(e) all three distinct passes', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        STRIPE_WEBHOOK_SECRET: 'whsec_legacy',
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_billing',
      }),
    ))).toBeUndefined();
  });

  it('(c) REGRESSION GUARD: the real CI fixture must pass with all three placeholders equal', () => {
    // Deliberately mirrors "(c) REGRESSION GUARD" above for the legacy/connect
    // pair: in ci/test the billing secret is never validated by this guard —
    // requireDistinctStripeWebhookSecrets sits in the deployment branch only.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      ciFixture({ STRIPE_BILLING_WEBHOOK_SECRET: CI_PLACEHOLDER }),
    ))).toBeUndefined();
  });
});

// =============================================================================
// G40/D19a — BILLING_STRIPE_PRICE_IDS boot check (P6b). Optional and UNSET
// MEANS IGNORED (today's shape); when set it must be well-formed AND scoped
// to this runtime's billing plan env. Catalogue-key membership is NOT
// checked here (environmentIsolation.ts stays import-free by construction —
// see stripeConnect.boundaries.test.ts "31(a)") — it is checked by
// parseStripePriceCarrier (stripePriceCarrier.test.ts) and by
// getStripePriceCarrier at real resolution time (stripePriceMap.test.ts).
// =============================================================================

describe('G40/D19a — BILLING_STRIPE_PRICE_IDS boot check', () => {
  it('absent is ignored — today\'s shape', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({ BILLING_STRIPE_PRICE_IDS: undefined }),
    ))).toBeUndefined();
  });

  it('a well-formed carrier scoped to the current runtime passes', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        BILLING_STRIPE_PRICE_IDS: JSON.stringify({
          env: 'test',
          offers: { starter_2026_08_monthly: 'price_abcd12345678' },
        }),
      }),
    ))).toBeUndefined();
  });

  it('a production-shaped carrier under a Preview runtime is rejected as an env mismatch', () => {
    // This is the implementable "prod-shaped map under test is rejected"
    // test the plan calls out (§3 G40) — the headline behaviour this boot
    // check restores.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        BILLING_STRIPE_PRICE_IDS: JSON.stringify({
          env: 'prod',
          offers: { starter_2026_08_monthly: 'price_liveabcd1234' },
        }),
      }),
    ))).toBe('BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH');
  });

  it('production with a matching env: \'prod\' carrier passes', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      productionFixture({
        BILLING_STRIPE_PRICE_IDS: JSON.stringify({
          env: 'prod',
          coupons: { founding_annual_2026: 'coupon_prodabcd1234' },
        }),
      }),
    ))).toBeUndefined();
  });

  it('malformed JSON is rejected as invalid', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({ BILLING_STRIPE_PRICE_IDS: '{not valid json' }),
    ))).toBe('BILLING_STRIPE_PRICE_IDS_INVALID');
  });

  it('an unrecognized top-level field is rejected as invalid', () => {
    // Stands in for "unknown key" at the boot-check layer: this module has
    // no catalogue to check individual map keys against (see the describe
    // block comment), but an unexpected shape is still generically invalid.
    // Real catalogue-key membership is asserted in stripePriceCarrier.test.ts.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        BILLING_STRIPE_PRICE_IDS: JSON.stringify({ env: 'test', bogusField: 1 }),
      }),
    ))).toBe('BILLING_STRIPE_PRICE_IDS_INVALID');
  });

  it('a malformed id shape is rejected as invalid', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        BILLING_STRIPE_PRICE_IDS: JSON.stringify({
          env: 'test',
          offers: { starter_2026_08_monthly: 'price_123' },
        }),
      }),
    ))).toBe('BILLING_STRIPE_PRICE_IDS_INVALID');
  });

  it('a duplicate id across maps is rejected as invalid', () => {
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      previewFixture({
        BILLING_STRIPE_PRICE_IDS: JSON.stringify({
          env: 'test',
          offers: { starter_2026_08_monthly: 'price_shared12345678' },
          topups: { topup_100_paid_2026_08: 'price_shared12345678' },
        }),
      }),
    ))).toBe('BILLING_STRIPE_PRICE_IDS_INVALID');
  });

  it('is never evaluated in ci/test — the carrier is ignorable/absent in CI', () => {
    // Even a clearly invalid value must not be reached: this boot check sits
    // strictly after the ci/test early return.
    expect(isolationErrorCode(() => assertProviderEnvironmentIsolation(
      ciFixture({ BILLING_STRIPE_PRICE_IDS: '{not valid json' }),
    ))).toBeUndefined();
  });
});
