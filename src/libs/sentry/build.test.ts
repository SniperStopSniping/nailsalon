import { describe, expect, it } from 'vitest';

import {
  assertProductionSentryBuildEnv,
  getMissingProductionSentryEnv,
  getPublicSentryRuntimeEnv,
  resolveSentryEnvironment,
  resolveSentryRelease,
  shouldEnableSentryWebpackPlugin,
} from './build';

describe('sentry build helpers', () => {
  it('resolves release using the requested fallback order', () => {
    expect(resolveSentryRelease({
      SENTRY_RELEASE: 'manual-release',
      VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
      GITHUB_SHA: 'github-sha',
    }, '1.4.0')).toBe('manual-release');

    expect(resolveSentryRelease({
      VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
      GITHUB_SHA: 'github-sha',
    }, '1.4.0')).toBe('vercel-sha');

    expect(resolveSentryRelease({
      GITHUB_SHA: 'github-sha',
    }, '1.4.0')).toBe('github-sha');

    expect(resolveSentryRelease({}, '1.4.0')).toBe('1.4.0');
  });

  it('resolves environment with explicit fallback order', () => {
    expect(resolveSentryEnvironment({
      SENTRY_ENVIRONMENT: 'staging',
      VERCEL_ENV: 'preview',
      NODE_ENV: 'production',
    })).toBe('staging');

    expect(resolveSentryEnvironment({
      VERCEL_ENV: 'preview',
      NODE_ENV: 'production',
    })).toBe('preview');

    expect(resolveSentryEnvironment({
      NODE_ENV: 'production',
    })).toBe('production');
  });

  it('returns missing required production vars', () => {
    expect(getMissingProductionSentryEnv({
      NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123',
      SENTRY_ORG: 'isla-org',
    })).toEqual(['SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN']);
  });

  it('throws an explicit production build error when required vars are missing', () => {
    expect(() => assertProductionSentryBuildEnv({
      NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123',
      SENTRY_ORG: 'isla-org',
    })).toThrowError(
      '[Sentry] Production build blocked. Missing required Sentry env vars: SENTRY_PROJECT, SENTRY_AUTH_TOKEN. These variables are required to initialize runtime Sentry, create releases, and upload source maps safely in production.',
    );
  });

  it('does not throw when the production build env is complete', () => {
    expect(() => assertProductionSentryBuildEnv({
      NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123',
      SENTRY_ORG: 'isla-org',
      SENTRY_PROJECT: 'nail-salon',
      SENTRY_AUTH_TOKEN: 'token',
    })).not.toThrow();
  });

  it('only enables the webpack plugin when all required values are present', () => {
    expect(shouldEnableSentryWebpackPlugin({})).toBe(false);
    expect(shouldEnableSentryWebpackPlugin({
      NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123',
      SENTRY_ORG: 'isla-org',
      SENTRY_PROJECT: 'nail-salon',
      SENTRY_AUTH_TOKEN: 'token',
    })).toBe(true);
  });

  it('exposes only public runtime release and environment values', () => {
    expect(getPublicSentryRuntimeEnv({
      SENTRY_RELEASE: 'manual-release',
      SENTRY_ENVIRONMENT: 'production',
      SENTRY_ORG: 'server-only-org',
      SENTRY_PROJECT: 'server-only-project',
      SENTRY_AUTH_TOKEN: 'server-only-token',
    }, '1.4.0')).toEqual({
      NEXT_PUBLIC_SENTRY_RELEASE: 'manual-release',
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'production',
    });
  });
});
