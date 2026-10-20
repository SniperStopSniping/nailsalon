import { describe, expect, it } from 'vitest';

import { hasExactRequestOrigin, shouldRequireApiRequestOrigin } from './requestOriginGuard';

describe('hasExactRequestOrigin', () => {
  it.each([
    ['same canonical origin', 'https://app.example', 'https://app.example/api/test'],
    ['default port normalization', 'https://app.example', 'https://app.example:443/api/test'],
    ['tenant host', 'https://isla.example', 'https://isla.example/api/test'],
    ['preview alias', 'https://preview-123.example', 'https://preview-123.example/api/test'],
    ['non-default port', 'http://localhost:3101', 'http://localhost:3101/api/test'],
  ])('accepts %s', (_label, origin, url) => {
    expect(hasExactRequestOrigin(new Request(url, { method: 'POST', headers: { origin } }))).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['null opaque origin', 'null'],
    ['unparseable origin', 'not an origin'],
    ['path suffix', 'https://app.example/path'],
    ['trailing slash', 'https://app.example/'],
    ['userinfo', 'https://user@app.example'],
    ['comma-joined duplicate values', 'https://app.example, https://app.example'],
    ['wrong scheme', 'http://app.example'],
    ['wrong host', 'https://evil.example'],
    ['wrong port', 'https://app.example:444'],
    ['subdomain suffix spoof', 'https://app.example.evil.example'],
  ])('rejects %s', (_label, origin) => {
    const headers = origin === undefined ? undefined : { origin };

    expect(hasExactRequestOrigin(new Request('https://app.example/api/test', { method: 'POST', headers }))).toBe(false);
  });

  it('rejects duplicated Origin headers after Fetch header normalization', () => {
    const headers = new Headers();
    headers.append('origin', 'https://app.example');
    headers.append('origin', 'https://app.example');

    expect(hasExactRequestOrigin(new Request('https://app.example/api/test', { method: 'POST', headers }))).toBe(false);
  });
});

describe('shouldRequireApiRequestOrigin', () => {
  const cookie = (name: string) => [{ name, value: 'session-value' }];
  const should = (pathname: string, method = 'POST', cookies = cookie('n5_admin_session')) => (
    shouldRequireApiRequestOrigin({ pathname, method, cookies })
  );

  it.each([
    '/api/admin/salon/publish',
    '/api/staff/appointments/1/notes',
    '/api/super-admin/organizations/1',
    '/api/salon/add-ons',
    '/api/appointments/1/cancel',
    '/api/onboarding/v1/claim',
    '/api/billing/checkout',
    '/api/integrations/google-calendar/events',
  ])('protects cookie-authenticated mutation %s', (pathname) => {
    expect(should(pathname)).toBe(true);
  });

  it.each([
    '/%61pi/admin/salon/publish',
    '/api%2Fadmin/salon/publish',
    '/%61pi%2Fadmin/salon/publish',
    '/%61pi%2Fadmin%2Fsalon%2Fpublish',
  ])('protects encoded API path alias %s', (pathname) => {
    expect(should(pathname)).toBe(true);
  });

  it('protects malformed encoded API-like paths with a session cookie', () => {
    expect(should('/%61pi%2Fadmin%2Fpublish%')).toBe(true);
  });

  it('does not transfer machine-route exemptions to encoded path aliases', () => {
    expect(should('/api/webhooks/stripe')).toBe(false);
    expect(should('/%61pi/webhooks/stripe')).toBe(true);
    expect(should('/api%2Fwebhooks/stripe')).toBe(true);
  });

  it('protects encoded session-establishing API aliases without an existing cookie', () => {
    expect(should('/%61pi/auth/send-otp', 'POST', [])).toBe(true);
    expect(should('/api%2Fauth%2Fverify-otp', 'POST', [])).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not require Origin for safe %s requests', (method) => {
    expect(should('/api/admin/salon/publish', method)).toBe(false);
  });

  it.each([
    '/api/admin/auth/password-login',
    '/api/admin/auth/%70assword-login',
    '/api/admin/%61uth/password-login',
    '/api/admin/auth/verify-otp',
    '/api/admin/auth/set-active-salon',
    '/api/auth/verify-otp',
    '/api/staff/send-otp',
    '/api/staff/verify-otp',
    '/api/staff/logout',
    '/api/dev/role',
  ])('protects session-establishing mutation %s without an existing session', (pathname) => {
    expect(should(pathname, 'POST', [])).toBe(true);
  });

  it.each([
    '/api/auth/send-%6Ftp',
    '/api/staff/%76erify-otp',
  ])('protects encoded session-establishing suffix %s without an existing session', (pathname) => {
    expect(should(pathname, 'POST', [])).toBe(true);
  });

  it.each([
    'n5_admin_session',
    'staff_session',
    'client_session',
    'sa_impersonate',
    '__session',
    '__session_XxiNjKcO',
    '__dev_role_override',
  ])('recognizes %s as an auth cookie', (name) => {
    expect(should('/api/appointments/1/cancel', 'PATCH', cookie(name))).toBe(true);
  });

  it('ignores empty and lookalike cookies', () => {
    expect(should('/api/admin/salon/publish', 'POST', [{ name: '__sessionOther', value: 'x' }])).toBe(false);
    expect(should('/api/admin/salon/publish', 'POST', [{ name: '__session', value: '  ' }])).toBe(false);
    expect(should('/api/admin/salon/publish', 'POST', [{ name: '__active_salon_slug', value: 'isla' }])).toBe(false);
  });

  it.each([
    '/api/webhooks/stripe',
    '/api/webhooks/stripe-billing',
    '/api/webhooks/stripe-connect',
    '/api/billing/reconcile',
    '/api/billing/windows/evaluate',
    '/api/communications/dispatch',
    '/api/deposits/reconcile',
    '/api/integrations/twilio/inbound',
    '/api/integrations/twilio/status',
    '/api/voice/twilio/dial-ended',
    '/api/voice/twilio/inbound',
    '/api/voice/twilio/status',
  ])('leaves exact machine-auth route %s to its own authentication', (pathname) => {
    expect(should(pathname)).toBe(false);
  });

  it('does not exempt all of /api/integrations or broaden to lookalike machine paths', () => {
    expect(should('/api/integrations/google-calendar/events')).toBe(true);
    expect(should('/api/billing/reconcile/extra')).toBe(true);
    expect(should('/api/webhooks/stripe-extra')).toBe(true);
  });

  it('does not scope non-API routes', () => {
    expect(should('/admin/salon/publish')).toBe(false);
  });
});
