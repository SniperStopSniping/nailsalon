import { describe, expect, it } from 'vitest';

import type { ScrubbableSentryEvent } from './runtime';
import { getPublicSentryRuntimeConfig, scrubSentryEvent } from './runtime';

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
      beforeSend: scrubSentryEvent,
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

describe('owner-assistant event scrubbing', () => {
  it('drops the body and cookies of an owner-assistant request', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://app.test/api/admin/owner-assistant/chat',
        method: 'POST',
        data: { message: 'what services do I offer?' },
        cookies: { n5_admin_session: 'admin_session_1' },
      },
      exception: { values: [] },
    });

    expect(event.request).toEqual({
      url: 'https://app.test/api/admin/owner-assistant/chat',
      method: 'POST',
    });
    expect(event.exception).toEqual({ values: [] });
  });

  it('drops the raw Cookie and Authorization headers of an owner-assistant request', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://www.lustergel.app/api/admin/owner-assistant/chat',
        headers: { Cookie: 'n5_admin_session=abc', Authorization: 'Bearer x', Accept: 'application/json' },
      },
    });

    expect(event.request?.headers).toEqual({ Accept: 'application/json' });
  });

  it('scrubs the context route too', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://app.test/api/admin/owner-assistant/context?salonSlug=isla',
        data: { any: 'thing' },
        cookies: { a: 'b' },
      },
    });

    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
  });

  it('leaves every other route untouched', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://app.test/api/salon/services',
        data: { name: 'Gel manicure' },
        cookies: { n5_admin_session: 'admin_session_1' },
      },
    });

    expect(event.request?.data).toEqual({ name: 'Gel manicure' });
    expect(event.request?.cookies).toEqual({ n5_admin_session: 'admin_session_1' });
  });

  it('tolerates an event with no request at all', () => {
    const event: ScrubbableSentryEvent & { message: string } = { message: 'boom' };

    expect(scrubSentryEvent(event)).toEqual({ message: 'boom' });
  });

  it('is wired into the enabled config', () => {
    const config = getPublicSentryRuntimeConfig({ NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123' });

    expect(config.enabled).toBe(true);

    if (config.enabled) {
      expect(config.beforeSend).toBe(scrubSentryEvent);
    }
  });
});
