import { describe, expect, it } from 'vitest';

import type { ScrubbableSentryEvent } from './runtime';
import { getPublicSentryRuntimeConfig, scrubSentryEvent, scrubSentrySpan } from './runtime';

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
      beforeSendTransaction: scrubSentryEvent,
      beforeSendSpan: scrubSentrySpan,
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

describe('trace privacy', () => {
  it.each([
    '/api/public/customer-booking/submit',
    '/api/public/customer-assistant/message',
    '/api/admin/owner-assistant/chat',
  ])('applies the existing request privacy rules to transactions on %s', (route) => {
    const config = getPublicSentryRuntimeConfig({ NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123' });

    expect(config.enabled).toBe(true);

    if (!config.enabled) {
      throw new Error('The synthetic monitoring config should be enabled');
    }
    const event = config.beforeSendTransaction({
      request: {
        url: `https://example.invalid${route}?salon=synthetic`,
        data: { message: 'synthetic-private-body' },
        cookies: { session: 'synthetic-private-cookie' },
        headers: { Authorization: 'synthetic-private-auth', Cookie: 'synthetic-private-cookie', Accept: 'application/json' },
      },
    });

    expect(event.request.data).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('synthetic-private-');
    expect(event.request.url).toBe(route.startsWith('/api/public/')
      ? `https://example.invalid${route}`
      : `https://example.invalid${route}?salon=synthetic`);
  });

  it('removes database users from root and child trace attributes without dropping useful diagnostics', () => {
    const rootData = { 'db.user': 'synthetic-user', 'db.system': 'postgresql', 'db.statement': 'SELECT 1' };
    const childData = { 'db.user': 'synthetic-user', 'db.system': 'postgresql', 'http.status_code': 200 };
    const event = scrubSentryEvent({
      contexts: { trace: { data: rootData } },
      spans: [{ data: childData, op: 'db', span_id: 'synthetic-span' }],
    });

    expect(event.contexts.trace.data).toEqual({ 'db.system': 'postgresql', 'db.statement': 'SELECT 1' });
    expect(event.spans).toEqual([{ data: { 'db.system': 'postgresql', 'http.status_code': 200 }, op: 'db', span_id: 'synthetic-span' }]);
  });

  it('scrubs protected public URLs in standalone spans and preserves ordinary URL attributes', () => {
    const span = scrubSentrySpan({
      data: {
        'db.user': 'synthetic-user',
        'http.url': 'https://example.invalid/api/public/customer-booking/submit?token=synthetic-token',
        'url.full': 'https://example.invalid/api/public/customer-assistant/message?token=synthetic-token',
        'http.target': '/api/public/customer-booking/submit?token=synthetic-token',
        'url.query': 'token=synthetic-token',
        'http.status_code': 200,
      },
      op: 'http.client',
    });

    expect(span.data).toEqual({
      'http.url': 'https://example.invalid/api/public/customer-booking/submit',
      'url.full': 'https://example.invalid/api/public/customer-assistant/message',
      'http.target': '/api/public/customer-booking/submit',
      'http.status_code': 200,
    });

    const ordinary = { data: { 'http.url': 'https://example.invalid/api/salon/services?category=gel', 'url.query': 'category=gel' } };

    expect(scrubSentrySpan(structuredClone(ordinary))).toEqual(ordinary);
  });

  it('removes a query-only attribute when the transaction identifies a protected public request', () => {
    const event = scrubSentryEvent({
      request: { url: 'https://example.invalid/api/public/customer-booking/submit?token=synthetic-token' },
      contexts: { trace: { data: { 'url.query': 'token=synthetic-token', 'http.status_code': 200 } } },
      spans: [{ data: { 'url.query': 'token=synthetic-token', 'db.system': 'postgresql' } }],
    });

    expect(event.contexts.trace.data).toEqual({ 'http.status_code': 200 });
    expect(event.spans[0]?.data).toEqual({ 'db.system': 'postgresql' });
    expect(JSON.stringify(event)).not.toContain('synthetic-token');
  });

  it('accepts spans without data and wires both trace hooks without disabling monitoring', () => {
    expect(scrubSentrySpan({ op: 'http.server' })).toEqual({ op: 'http.server' });

    const config = getPublicSentryRuntimeConfig({ NEXT_PUBLIC_SENTRY_DSN: 'https://dsn.ingest.sentry.io/123' });

    expect(config).toMatchObject({ enabled: true, tracesSampleRate: 1, beforeSendTransaction: scrubSentryEvent, beforeSendSpan: scrubSentrySpan });
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

  it('leaves other request payloads unchanged', () => {
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
