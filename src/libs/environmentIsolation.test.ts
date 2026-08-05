import { describe, expect, it } from 'vitest';

import {
  assertEnvironmentIsolation,
  assertProviderEnvironmentIsolation,
  EnvironmentIsolationError,
  resolveRuntimeEnvironment,
} from './environmentIsolation';

const CI_PROVIDER_ENV = {
  BILLING_PLAN_ENV: 'test',
  CLERK_SECRET_KEY: 'ci-placeholder-not-a-secret',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2kubHVzdGVyLmludmFsaWQk',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'ci-placeholder-not-a-secret',
  STRIPE_SECRET_KEY: 'ci-placeholder-not-a-secret',
  STRIPE_WEBHOOK_SECRET: 'ci-placeholder-not-a-secret',
};

const TEST_PROVIDER_ENV = {
  CLERK_SECRET_KEY: 'sk_test_synthetic-clerk-secret',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic-clerk-public',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic-stripe-public',
  STRIPE_SECRET_KEY: 'sk_test_synthetic-stripe-secret',
  STRIPE_WEBHOOK_SECRET: 'synthetic-webhook-secret',
};

const LIVE_PROVIDER_ENV = {
  CLERK_SECRET_KEY: 'sk_live_synthetic-clerk-secret',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_synthetic-clerk-public',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_synthetic-stripe-public',
  STRIPE_SECRET_KEY: 'sk_live_synthetic-stripe-secret',
  STRIPE_WEBHOOK_SECRET: 'synthetic-webhook-secret',
};

function expectCode(
  operation: () => unknown,
  code: EnvironmentIsolationError['code'],
) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentIsolationError);
    expect((error as EnvironmentIsolationError).code).toBe(code);

    return;
  }
  throw new Error(`Expected environment isolation error ${code}.`);
}

describe('resolveRuntimeEnvironment', () => {
  it.each([
    ['development', 'development'],
    ['preview', 'preview'],
    ['production', 'production'],
  ] as const)('uses VERCEL_ENV=%s', (marker, expected) => {
    expect(resolveRuntimeEnvironment({
      APP_ENV: marker,
      CI: 'true',
      NODE_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: marker,
    })).toBe(expected);
  });

  it('maps the staging compatibility marker to Preview', () => {
    expect(resolveRuntimeEnvironment({ APP_ENV: 'staging' })).toBe('preview');
    expect(resolveRuntimeEnvironment({
      APP_ENV: 'staging',
      VERCEL: '1',
      VERCEL_ENV: 'preview',
    })).toBe('preview');
  });

  it.each([
    [{ NODE_ENV: 'test' }, 'test'],
    [{ VITEST: 'true' }, 'test'],
    [{ CI: '1' }, 'ci'],
    [{ GITHUB_ACTIONS: 'true' }, 'ci'],
    [{ NODE_ENV: 'development' }, 'development'],
    [{ NODE_ENV: 'production' }, 'unknown'],
    [{}, 'unknown'],
  ] as const)('uses safe fallback signals for %j', (environment, expected) => {
    expect(resolveRuntimeEnvironment(environment)).toBe(expected);
  });

  it('never lets deployment markers turn GitHub Actions or Vitest into Production', () => {
    expect(resolveRuntimeEnvironment({
      APP_ENV: 'production',
      GITHUB_ACTIONS: 'true',
      NODE_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'production',
    })).toBe('ci');
    expect(resolveRuntimeEnvironment({
      APP_ENV: 'production',
      NODE_ENV: 'test',
      VERCEL: '1',
      VERCEL_ENV: 'production',
    })).toBe('test');
  });

  it('rejects conflicting explicit environment markers', () => {
    expectCode(
      () => resolveRuntimeEnvironment({
        APP_ENV: 'production',
        VERCEL: '1',
        VERCEL_ENV: 'preview',
      }),
      'ENVIRONMENT_CONFLICT',
    );
  });

  it('rejects unsupported explicit marker values', () => {
    expectCode(
      () => resolveRuntimeEnvironment({ VERCEL_ENV: 'staging' }),
      'VERCEL_ENV_INVALID',
    );
    expectCode(
      () => resolveRuntimeEnvironment({ APP_ENV: 'qa' }),
      'APP_ENV_INVALID',
    );
  });

  it('never treats a pulled Production user-variable file as Production', () => {
    expectCode(
      () => resolveRuntimeEnvironment({
        APP_ENV: 'production',
        NODE_ENV: 'development',
      }),
      'PRODUCTION_PLATFORM_REQUIRED',
    );
    expectCode(
      () => resolveRuntimeEnvironment({
        APP_ENV: 'production',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      }),
      'VERCEL_APPLICATION_MARKER_REQUIRED',
    );
  });

  it('classifies non-Vercel CI as CI even if it receives a Vercel-shaped marker', () => {
    expect(resolveRuntimeEnvironment({
      APP_ENV: 'production',
      CI: 'true',
      VERCEL_ENV: 'production',
    })).toBe('ci');
  });
});

describe('provider environment isolation', () => {
  it('accepts test-mode providers and dev billing only in Development', () => {
    expect(assertProviderEnvironmentIsolation({
      ...TEST_PROVIDER_ENV,
      APP_ENV: 'development',
      BILLING_PLAN_ENV: 'dev',
    })).toBe('development');
  });

  it('accepts test-mode providers and test billing only in Preview', () => {
    expect(assertEnvironmentIsolation({
      ...TEST_PROVIDER_ENV,
      APP_ENV: 'preview',
      BILLING_PLAN_ENV: 'test',
      NODE_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'preview',
    })).toBe('preview');
  });

  it('accepts live-mode providers and prod billing only in Production', () => {
    expect(assertEnvironmentIsolation({
      ...LIVE_PROVIDER_ENV,
      APP_ENV: 'production',
      BILLING_PLAN_ENV: 'prod',
      VERCEL: '1',
      VERCEL_ENV: 'production',
    })).toBe('production');
  });

  it('rejects live provider keys outside Production', () => {
    expectCode(
      () => assertEnvironmentIsolation({
        ...LIVE_PROVIDER_ENV,
        APP_ENV: 'preview',
        BILLING_PLAN_ENV: 'test',
      }),
      'CLERK_KEY_MODE_INVALID',
    );
  });

  it('rejects test provider keys in Production', () => {
    expectCode(
      () => assertEnvironmentIsolation({
        ...TEST_PROVIDER_ENV,
        APP_ENV: 'production',
        BILLING_PLAN_ENV: 'prod',
        VERCEL: '1',
        VERCEL_ENV: 'production',
      }),
      'CLERK_KEY_MODE_INVALID',
    );
  });

  it('rejects mismatched provider key pairs', () => {
    expectCode(
      () => assertEnvironmentIsolation({
        ...TEST_PROVIDER_ENV,
        APP_ENV: 'development',
        BILLING_PLAN_ENV: 'dev',
        CLERK_SECRET_KEY: LIVE_PROVIDER_ENV.CLERK_SECRET_KEY,
      }),
      'CLERK_KEY_MODE_MISMATCH',
    );
    expectCode(
      () => assertEnvironmentIsolation({
        ...TEST_PROVIDER_ENV,
        APP_ENV: 'development',
        BILLING_PLAN_ENV: 'dev',
        STRIPE_SECRET_KEY: LIVE_PROVIDER_ENV.STRIPE_SECRET_KEY,
      }),
      'STRIPE_KEY_MODE_MISMATCH',
    );
  });

  it('couples billing configuration to each runtime environment', () => {
    expectCode(
      () => assertEnvironmentIsolation({
        ...TEST_PROVIDER_ENV,
        APP_ENV: 'preview',
        BILLING_PLAN_ENV: 'dev',
      }),
      'BILLING_PLAN_ENV_INVALID',
    );
  });

  it('accepts only the repository synthetic provider fixtures in CI and tests', () => {
    expect(assertEnvironmentIsolation({
      ...CI_PROVIDER_ENV,
      CI: 'true',
      NODE_ENV: 'production',
    })).toBe('ci');
    expect(assertEnvironmentIsolation({
      ...CI_PROVIDER_ENV,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'ci-placeholder-not-a-secret',
      NODE_ENV: 'test',
    })).toBe('test');

    expectCode(
      () => assertEnvironmentIsolation({
        ...CI_PROVIDER_ENV,
        CI: 'true',
        CLERK_SECRET_KEY: TEST_PROVIDER_ENV.CLERK_SECRET_KEY,
      }),
      'CI_PROVIDER_PLACEHOLDER_REQUIRED',
    );
    expectCode(
      () => assertEnvironmentIsolation({
        ...CI_PROVIDER_ENV,
        CI: 'true',
        STRIPE_SECRET_KEY: LIVE_PROVIDER_ENV.STRIPE_SECRET_KEY,
      }),
      'CI_PROVIDER_PLACEHOLDER_REQUIRED',
    );
  });

  it('rejects an implicit NODE_ENV=production environment', () => {
    expectCode(
      () => assertEnvironmentIsolation({
        ...LIVE_PROVIDER_ENV,
        BILLING_PLAN_ENV: 'prod',
        NODE_ENV: 'production',
      }),
      'RUNTIME_ENVIRONMENT_UNKNOWN',
    );
  });

  it('never includes credential values in an error', () => {
    const credential = 'sk_live_do-not-print-this-value';
    try {
      assertEnvironmentIsolation({
        ...TEST_PROVIDER_ENV,
        APP_ENV: 'preview',
        BILLING_PLAN_ENV: 'test',
        CLERK_SECRET_KEY: credential,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentIsolationError);
      expect((error as Error).message).not.toContain(credential);

      return;
    }
    throw new Error('Expected environment isolation to reject the credential.');
  });
});
