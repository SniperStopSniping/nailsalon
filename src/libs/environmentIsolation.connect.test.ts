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
