import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

export type SuperAdminAuthMode = 'password' | 'twilio';

export type SuperAdminPasswordConfig = {
  enabled: boolean;
  mode: SuperAdminAuthMode;
  phone: string | null;
  password: string | null;
};

function enabled(value: string | undefined): boolean {
  return value === 'true';
}

export function getDeploymentEnvironment(): string {
  if (process.env.VERCEL_ENV) {
    return `vercel:${process.env.VERCEL_ENV}`;
  }
  if (process.env.APP_ENV) {
    return `app:${process.env.APP_ENV}`;
  }
  return process.env.NODE_ENV ?? 'unknown';
}

export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === 'production'
    || process.env.APP_ENV === 'production';
}

export function isHostedDeployment(): boolean {
  return Boolean(process.env.VERCEL_ENV)
    || process.env.APP_ENV === 'staging'
    || process.env.APP_ENV === 'production'
    || (
      process.env.NODE_ENV === 'production'
      && process.env.APP_ENV !== 'development'
      && process.env.CI !== 'true'
    );
}

export function isPasswordEnvironmentPermitted(): boolean {
  if (isProductionDeployment()) {
    return true;
  }

  return process.env.NODE_ENV === 'development'
    || process.env.NODE_ENV === 'test'
    || process.env.APP_ENV === 'development'
    || process.env.VERCEL_ENV === 'preview'
    || process.env.APP_ENV === 'staging'
    || enabled(process.env.ALLOW_STAGING_SUPER_ADMIN_PASSWORD);
}

/** Read credentials only when handling a server request. */
export function getSuperAdminPasswordConfig(): SuperAdminPasswordConfig {
  const mode = process.env.SUPER_ADMIN_AUTH_MODE === 'twilio'
    ? 'twilio'
    : 'password';
  const phone = process.env.SUPER_ADMIN_TEST_PHONE?.trim() || null;
  const password = process.env.SUPER_ADMIN_TEST_PASSWORD || null;

  return {
    mode,
    phone,
    password,
    enabled: mode === 'password'
      && enabled(process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED)
      && isPasswordEnvironmentPermitted()
      && Boolean(phone && password),
  };
}

export function isLegacyOtpAuthEnabled(): boolean {
  return enabled(process.env.LEGACY_OTP_AUTH_ENABLED);
}

export function isIsolatedLegacyOtpFixtureEnabled(): boolean {
  return isLegacyOtpAuthEnabled()
    && enabled(process.env.LEGACY_OTP_TEST_FIXTURE_ENABLED)
    && !isHostedDeployment()
    && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development');
}

export function areSuperAdminTestToolsEnabled(): boolean {
  if (isProductionDeployment() || process.env.VERCEL_ENV === 'production') {
    return false;
  }

  const allowedEnvironment = process.env.NODE_ENV === 'development'
    || process.env.NODE_ENV === 'test'
    || process.env.APP_ENV === 'development'
    || process.env.VERCEL_ENV === 'preview'
    || process.env.APP_ENV === 'staging';

  return allowedEnvironment && enabled(process.env.SUPER_ADMIN_TEST_TOOLS_ENABLED);
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Always compares equal-length digests so mismatch timing does not reveal length. */
export function constantTimeSecretEqual(submitted: string, configured: string): boolean {
  return timingSafeEqual(digest(submitted), digest(configured));
}

export function hashRateLimitIdentifier(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
