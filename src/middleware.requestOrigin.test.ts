/* eslint-disable import/first */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { intlMiddleware, clerkMiddlewareFactory } = vi.hoisted(() => ({
  intlMiddleware: vi.fn(),
  clerkMiddlewareFactory: vi.fn(),
}));

vi.mock('next-intl/middleware', () => ({
  default: () => intlMiddleware,
}));

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: clerkMiddlewareFactory,
  createRouteMatcher: () => () => false,
}));

import middleware from './middleware';

const event = {} as never;

function request(
  url: string,
  options: { method?: string; origin?: string; cookies?: Record<string, string> } = {},
) {
  const headers = new Headers();
  if (options.origin !== undefined) {
    headers.set('origin', options.origin);
  }
  const incoming = new NextRequest(url, { method: options.method ?? 'POST', headers });
  for (const [name, value] of Object.entries(options.cookies ?? {})) {
    incoming.cookies.set(name, value);
  }
  return incoming;
}

describe('middleware — exact Origin guard before auth and bypass branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intlMiddleware.mockImplementation(() => NextResponse.next());
    clerkMiddlewareFactory.mockImplementation(() => async () => NextResponse.next());
  });

  it('rejects a cookie-authenticated owner mutation before Clerk or its handler can run', async () => {
    const response = await middleware(request(
      'https://app.example/api/salon/add-ons?salonSlug=isla',
      { cookies: { n5_admin_session: 'owner-session' } },
    ), event);

    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: { code: 'INVALID_ORIGIN' } });
    expect(response?.headers.get('cache-control')).toContain('no-store');
    expect(response?.headers.get('set-cookie')).toBeNull();
    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
  });

  it.each([undefined, 'null', 'https://foreign.example'])('does not change tenant context when rejecting Origin %s', async (origin) => {
    const response = await middleware(request(
      'https://app.example/api/appointments/123/cancel?salonSlug=other-salon',
      { origin, cookies: { n5_admin_session: 'owner-session', __active_salon_slug: 'current-salon' } },
    ), event);

    expect(response?.status).toBe(403);
    expect(response?.headers.get('set-cookie')).toBeNull();
    expect(intlMiddleware).not.toHaveBeenCalled();
    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
  });

  it.each([
    'https://isla.example/%61pi/salon/add-ons',
    'https://isla.example/api%2Fsalon/add-ons',
  ])('rejects an encoded API path before a tenant-host rewrite: %s', async (url) => {
    const response = await middleware(request(url, {
      cookies: { n5_admin_session: 'owner-session' },
    }), event);

    expect(response?.status).toBe(403);
    expect(intlMiddleware).not.toHaveBeenCalled();
    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
  });

  it('allows an exact same-origin owner mutation into the existing Clerk context path', async () => {
    const response = await middleware(request(
      'https://app.example/api/salon/add-ons?salonSlug=isla',
      { origin: 'https://app.example', cookies: { __session: 'owner-session' } },
    ), event);

    expect(response?.status).not.toBe(403);
    expect(clerkMiddlewareFactory).toHaveBeenCalledTimes(1);
  });

  it('uses the request URL origin for preview aliases, tenant hosts, and explicit ports', async () => {
    for (const origin of [
      'https://preview-123.example',
      'https://isla.example',
      'http://localhost:3101',
    ]) {
      const response = await middleware(request(
        `${origin}/api/appointments/123/cancel`,
        { origin, cookies: { staff_session: 'staff-session' } },
      ), event);

      expect(response?.status).not.toBe(403);
    }
  });

  it.each([
    'null',
    'https://attacker.example',
    'https://app.example.evil.example',
    'https://app.example/path',
    'https://app.example, https://app.example',
  ])('rejects malformed or foreign Origin %s', async (origin) => {
    const response = await middleware(request(
      'https://app.example/api/appointments/123/cancel',
      { origin, cookies: { staff_session: 'staff-session' } },
    ), event);

    expect(response?.status).toBe(403);
  });

  it('guards the development super-admin bypass before it can skip authentication', async () => {
    const denied = await middleware(request(
      'https://app.example/api/super-admin/organizations',
      { cookies: { __dev_role_override: 'super_admin' } },
    ), event);

    expect(denied?.status).toBe(403);

    const allowed = await middleware(request(
      'https://app.example/api/super-admin/organizations',
      { origin: 'https://app.example', cookies: { __dev_role_override: 'super_admin' } },
    ), event);

    expect(allowed?.status).not.toBe(403);
    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
  });

  it('guards cookie-establishing auth mutations even before a session cookie exists', async () => {
    const response = await middleware(request('https://app.example/api/admin/auth/password-login'), event);

    expect(response?.status).toBe(403);
  });

  it('preserves safe methods and exact machine-authenticated route exemptions', async () => {
    const safe = await middleware(request(
      'https://app.example/api/admin/salon/publish',
      { method: 'GET', cookies: { n5_admin_session: 'owner-session' } },
    ), event);

    expect(safe?.status).not.toBe(403);

    const webhook = await middleware(request(
      'https://app.example/api/webhooks/stripe',
      { method: 'POST', cookies: { n5_admin_session: 'owner-session' } },
    ), event);

    expect(webhook?.status).not.toBe(403);

    const neighboringOwnerRoute = await middleware(request(
      'https://app.example/api/integrations/google-calendar/events',
      { method: 'POST', cookies: { n5_admin_session: 'owner-session' } },
    ), event);

    expect(neighboringOwnerRoute?.status).toBe(403);
  });
});
