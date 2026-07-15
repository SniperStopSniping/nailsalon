import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  areSuperAdminTestToolsEnabled,
  constantTimeSecretEqual,
  getSuperAdminPasswordConfig,
  isIsolatedLegacyOtpFixtureEnabled,
} from './authConfig.server';

vi.mock('server-only', () => ({}));

const originalEnv = { ...process.env };

describe('server authentication configuration', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = '+14165550123';
    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each([
    ['local development', { NODE_ENV: 'development' }],
    ['Vercel Preview', { NODE_ENV: 'production', VERCEL_ENV: 'preview' }],
    ['hosted staging', { NODE_ENV: 'production', APP_ENV: 'staging' }],
    ['production', { NODE_ENV: 'production', VERCEL_ENV: 'production' }],
  ])('enables password login in %s', (_name, environment) => {
    Object.assign(process.env, environment);

    expect(getSuperAdminPasswordConfig().enabled).toBe(true);
  });

  it('disables password login when configuration is incomplete or Twilio mode is selected', () => {
    process.env = { ...process.env, NODE_ENV: 'development' };
    delete process.env.SUPER_ADMIN_TEST_PASSWORD;

    expect(getSuperAdminPasswordConfig().enabled).toBe(false);

    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    process.env.SUPER_ADMIN_AUTH_MODE = 'twilio';

    expect(getSuperAdminPasswordConfig()).toMatchObject({ enabled: false, mode: 'twilio' });
  });

  it('uses constant-time digest comparisons for matching and non-matching values', () => {
    expect(constantTimeSecretEqual('same-value', 'same-value')).toBe(true);
    expect(constantTimeSecretEqual('short', 'a-much-longer-value')).toBe(false);
  });

  it('always disables staging tools in production', () => {
    process.env = { ...process.env, NODE_ENV: 'production', VERCEL_ENV: 'production' };
    process.env.SUPER_ADMIN_TEST_TOOLS_ENABLED = 'true';

    expect(areSuperAdminTestToolsEnabled()).toBe(false);
  });

  it('allows the legacy fixture only when both flags are explicit and the environment is isolated', () => {
    process.env = { ...process.env, NODE_ENV: 'test' };
    process.env.LEGACY_OTP_AUTH_ENABLED = 'true';
    process.env.LEGACY_OTP_TEST_FIXTURE_ENABLED = 'true';

    expect(isIsolatedLegacyOtpFixtureEnabled()).toBe(true);

    process.env.VERCEL_ENV = 'preview';

    expect(isIsolatedLegacyOtpFixtureEnabled()).toBe(false);
  });
});
