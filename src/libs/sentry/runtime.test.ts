import { describe, expect, it } from 'vitest';

import { getPublicSentryRuntimeConfig } from './runtime';

describe('public sentry runtime config', () => {
  it('returns a disabled config when the public DSN is absent', () => {
    expect(getPublicSentryRuntimeConfig({})).toEqual({
      enabled: false,
    });
  });

  it('returns an enabled config when the public DSN is present', () => {
    expect(getPublicSentryRuntimeConfig({
      NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123',
      NEXT_PUBLIC_SENTRY_RELEASE: 'release-123',
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'production',
    })).toEqual({
      enabled: true,
      dsn: 'https://dsn.ingest.sentry.io/123',
      release: 'release-123',
      environment: 'production',
      tracesSampleRate: 1,
      debug: false,
    });
  });

  it('ignores non-public values and only depends on public runtime env', () => {
    expect(getPublicSentryRuntimeConfig({
      NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123',
      NEXT_PUBLIC_SENTRY_RELEASE: 'release-123',
    })).toMatchObject({
      enabled: true,
      dsn: 'https://dsn.ingest.sentry.io/123',
      release: 'release-123',
    });
  });
});
