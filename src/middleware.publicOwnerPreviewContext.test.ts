/* eslint-disable import/first */
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { clerkMiddlewareFactory, intlMiddleware, protect } = vi.hoisted(() => ({
  clerkMiddlewareFactory: vi.fn(),
  intlMiddleware: vi.fn(),
  protect: vi.fn(),
}));

vi.mock('next-intl/middleware', () => ({ default: () => intlMiddleware }));
vi.mock('@clerk/nextjs/server', async importOriginal => ({
  ...await importOriginal<typeof import('@clerk/nextjs/server')>(),
  clerkMiddleware: clerkMiddlewareFactory,
}));

import middleware from './middleware';

const event = {} as never;
const paths = [
  '/en/isla-nail-studio',
  '/fr/isla-nail-studio/book/service',
  '/isla-nail-studio',
  '/isla-nail-studio/book/time',
  '/en/isla-nail-studio/book/confirm',
  '/en/isla-nail-studio/find-booking',
  '/isla-nail-studio/manage/SYNTHETIC',
  '/fr/isla-nail-studio/gallery',
  '/book/service?salonSlug=isla-nail-studio',
  '/book/tech?salonSlug=isla-nail-studio',
  '/fr/book/time?salonSlug=isla-nail-studio',
  '/en/book/confirm?salonSlug=isla-nail-studio',
];

function request(path: string, cookies: Record<string, string | undefined> = {}, origin = 'https://www.lustergel.app') {
  const incoming = new NextRequest(new URL(path, origin));
  for (const [name, value] of Object.entries(cookies)) {
    if (value !== undefined) {
      incoming.cookies.set(name, value);
    }
  }
  return incoming;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('LUSTER_ROOT_DOMAIN', 'lustergel.app');
  vi.stubEnv('TENANT_SUBDOMAINS_ENABLED', 'false');
  vi.stubEnv('TENANT_SUBDOMAIN_ALLOWLIST', '');
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', '');
  intlMiddleware.mockImplementation(() => NextResponse.next({ headers: { 'x-test-locale': 'retained' } }));
  clerkMiddlewareFactory.mockImplementation((handler: (auth: unknown, req: NextRequest) => NextResponse | Promise<NextResponse>) => async (incoming: NextRequest) => {
    const response = await handler({ protect }, incoming);
    response.headers.set('x-test-clerk-context', 'fixture-only');
    return response;
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('No external requests in middleware tests');
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('public salon owner-preview context', () => {
  it.each(paths.flatMap(path => ['__session', '__session_XxiNjKcO'].map(cookie => ({ path, cookie }))))('sets up verification, without protecting $path, for $cookie', async ({ path, cookie }) => {
    const incoming = request(path, { [cookie]: 'opaque-synthetic-token' });
    const response = await middleware(incoming, event);

    expect(clerkMiddlewareFactory).toHaveBeenCalledOnce();
    expect(protect).not.toHaveBeenCalled();
    expect(intlMiddleware).toHaveBeenCalledOnce();
    expect(intlMiddleware).toHaveBeenCalledWith(incoming);
    expect(response.headers.get('x-test-clerk-context')).toBe('fixture-only');
    expect(response.headers.get('x-test-locale')).toBe('retained');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  it.each(paths)('preserves anonymous locale routing without a Clerk handshake on %s', async (path) => {
    const response = await middleware(request(path), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(intlMiddleware).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it.each([
    { __session: '' },
    { __session_XxiNjKcO: '' },
    { __sessionOther: 'not-a-session' },
    { __active_salon_slug: 'isla-nail-studio' },
    { sa_impersonate: 'no-admin-session' },
  ])('does not infer an owner session from %j', async (cookies) => {
    const response = await middleware(request('/isla-nail-studio/find-booking', cookies), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it.each([
    { n5_admin_session: 'server-session' },
    { n5_admin_session: 'server-session', sa_impersonate: 'signed-impersonation' },
    { n5_admin_session: 'server-session', __session: 'stale-clerk-cookie' },
  ])('preserves legacy-first server authentication and private caching for %j', async (cookies) => {
    const response = await middleware(request('/en/isla-nail-studio', cookies), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(intlMiddleware).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  it('retains configured Clerk authorized parties', async () => {
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', 'https://www.lustergel.app, https://lustergel.app');
    await middleware(request('/isla-nail-studio', { __session: 'opaque' }), event);

    expect(clerkMiddlewareFactory).toHaveBeenCalledWith(expect.any(Function), {
      authorizedParties: ['https://www.lustergel.app', 'https://lustergel.app'],
    });
  });

  it.each(['/privacy', '/fr/terms', '/', '/en', '/pricing', '/a/SYNTHETIC', '/manage/SYNTHETIC', '/book/unknown'])('does not broaden context to the unrelated route %s', async (path) => {
    await middleware(request(path, { __session: 'opaque' }), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
  });

  it.each(['/a/SYNTHETIC', '/manage/SYNTHETIC/reschedule'])('keeps root token route %s as a pass-through', async (path) => {
    const response = await middleware(request(path, { __session: 'opaque' }), event);

    expect(intlMiddleware).not.toHaveBeenCalled();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('public tenant-subdomain rewrite', () => {
  it.each([
    { path: '/', target: '/en/isla-nail-studio' },
    { path: '/book/service?source=fixture', target: '/en/isla-nail-studio/book/service?source=fixture' },
    { path: '/fr/find-booking', target: '/fr/isla-nail-studio/find-booking' },
  ].flatMap(route => [
    { ...route, cookies: {}, clerk: false, private: false },
    { ...route, cookies: { __session: 'opaque' }, clerk: true, private: true },
    { ...route, cookies: { n5_admin_session: 'legacy' }, clerk: false, private: true },
  ]))('preserves $path → $target, Clerk=$clerk, private=$private', async ({ path, target, cookies, clerk, private: isPrivate }) => {
    vi.stubEnv('TENANT_SUBDOMAIN_ALLOWLIST', 'isla-nail-studio');
    const response = await middleware(request(path, cookies, 'https://isla-nail-studio.lustergel.app'), event);

    expect(clerkMiddlewareFactory).toHaveBeenCalledTimes(clerk ? 1 : 0);
    expect(protect).not.toHaveBeenCalled();
    expect(intlMiddleware).not.toHaveBeenCalled();
    expect(response.headers.get('x-middleware-rewrite')).toBe(`https://isla-nail-studio.lustergel.app${target}`);
    expect(response.cookies.get('__active_salon_slug')?.value).toBe('isla-nail-studio');
    expect(response.headers.get('cache-control')).toBe(isPrivate ? 'private, no-store, max-age=0' : null);
  });

  it('keeps owner URLs on the canonical origin instead of rewriting them as tenant pages', async () => {
    vi.stubEnv('TENANT_SUBDOMAIN_ALLOWLIST', 'isla-nail-studio');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.lustergel.app');
    const response = await middleware(request('/en/admin?tab=more', { __session: 'opaque' }, 'https://isla-nail-studio.lustergel.app'), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://www.lustergel.app/en/admin?tab=more');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
