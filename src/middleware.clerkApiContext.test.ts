/* eslint-disable import/first */
/**
 * The middleware half of the Clerk-context contract.
 *
 * clerkApiContext.test.ts covers the predicate; this covers the wiring — that
 * `middleware()` actually calls clerkMiddleware for an owner-authenticated API
 * path and does not for a guest one. Deliberately does NOT mock
 * ./libs/clerkApiContext (middleware.manageRoute.test.ts does, which is why
 * nothing caught the /api/salon/add-ons gap).
 */
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

import { ACTIVE_SALON_COOKIE } from './libs/tenantSlug';
import middleware from './middleware';

function request(path: string) {
  return new NextRequest(new URL(path, 'https://salon-domain.example'));
}

const event = {} as never;

describe('middleware — Clerk context for owner-authenticated APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intlMiddleware.mockImplementation(() => NextResponse.next());
    clerkMiddlewareFactory.mockImplementation(() => async () => NextResponse.next());
  });

  it.each([
    '/api/salon/add-ons?salonSlug=isla-nail-studio1',
    '/api/salon/add-ons/addon_1',
    '/api/salon/services?salonSlug=isla-nail-studio1',
    '/api/salon/page-appearance?salonSlug=isla-nail-studio1',
    '/api/billing/portal',
    '/api/staff/time-off',
  ])('wraps %s in clerkMiddleware', async (path) => {
    await middleware(request(path), event);

    expect(clerkMiddlewareFactory).toHaveBeenCalled();
  });

  it.each([
    '/api/public/appointments/recovery',
    '/api/auth/otp',
    '/api/staff/me',
  ])('leaves %s without Clerk context', async (path) => {
    await middleware(request(path), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
  });

  it('preserves late Clerk cookies and request context when adding a salon cookie', async () => {
    // Clerk's handshake appends headers after constructing NextResponse. Its
    // cookies cache does not contain those headers, including duplicate names
    // whose different paths must survive unchanged.
    const response = NextResponse.redirect('https://identity.example/v1/client/handshake');
    const originalCookies = [
      'sdk_session=synthetic-session; Path=/; Secure; HttpOnly; SameSite=None',
      'sdk_redirect_count=1; Path=/; Max-Age=3; Secure; SameSite=Lax',
      'sdk_path_cookie=root; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
      'sdk_path_cookie=account; Path=/account; Secure; HttpOnly',
    ];
    originalCookies.forEach(cookie => response.headers.append('Set-Cookie', cookie));
    const originalCompanion = `existing=retained; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT,${ACTIVE_SALON_COOKIE}=previous-salon; Path=/`;
    response.headers.set('x-middleware-set-cookie', originalCompanion);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('x-middleware-override-headers', 'x-fixture-auth');
    response.headers.set('x-middleware-request-x-fixture-auth', 'existing-context');

    expect(response.cookies.getAll()).toEqual([]);

    clerkMiddlewareFactory.mockImplementation(() => async () => response);

    const result = await middleware(request('/api/admin/location?salonSlug=fixture-salon'), event);

    expect(result).toBe(response);
    expect(result.status).toBe(307);
    expect(result.headers.get('Location')).toBe('https://identity.example/v1/client/handshake');
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('x-middleware-override-headers')).toBe('x-fixture-auth');
    expect(result.headers.get('x-middleware-request-x-fixture-auth')).toBe('existing-context');

    const resultCookies = result.headers.getSetCookie();

    expect(resultCookies.slice(0, originalCookies.length)).toEqual(originalCookies);
    expect(resultCookies).toHaveLength(originalCookies.length + 1);

    const activeCookie = resultCookies.at(-1)!;

    expect(activeCookie.startsWith(`${ACTIVE_SALON_COOKIE}=fixture-salon;`)).toBe(true);
    expect(activeCookie).toContain('HttpOnly');
    expect(activeCookie).toContain('Secure');
    expect(activeCookie).toContain('SameSite=lax');
    expect(result.cookies.get(ACTIVE_SALON_COOKIE)?.value).toBe('fixture-salon');
    expect(result.headers.get('x-middleware-set-cookie')).toBe(`${originalCompanion},${activeCookie}`);
  });

  it('leaves late Clerk cookies untouched without salon context', async () => {
    const response = NextResponse.redirect('https://identity.example/v1/client/handshake');
    const cookie = 'sdk_session=synthetic-session; Path=/; Secure; HttpOnly';
    response.headers.append('Set-Cookie', cookie);
    response.headers.set('x-middleware-set-cookie', 'existing=retained; Path=/');
    clerkMiddlewareFactory.mockImplementation(() => async () => response);

    const result = await middleware(request('/api/admin/location'), event);

    expect(result).toBe(response);
    expect(result.headers.getSetCookie()).toEqual([cookie]);
    expect(result.headers.get('x-middleware-set-cookie')).toBe('existing=retained; Path=/');
  });

  it('preserves the response body and creates the salon request-cookie companion', async () => {
    const response = new NextResponse('body-kept', { status: 200 });
    response.headers.append('Set-Cookie', 'sdk_session=synthetic-session; Path=/; HttpOnly');
    const originalBody = response.body;
    clerkMiddlewareFactory.mockImplementation(() => async () => response);

    const result = await middleware(request('/api/admin/location?salonSlug=fixture-salon'), event);

    expect(result).toBe(response);
    expect(result.body).toBe(originalBody);
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('body-kept');

    const resultCookies = result.headers.getSetCookie();

    expect(resultCookies).toHaveLength(2);
    expect(resultCookies[0]).toBe('sdk_session=synthetic-session; Path=/; HttpOnly');
    expect(result.headers.get('x-middleware-set-cookie')).toBe(resultCookies[1]);
  });
});
