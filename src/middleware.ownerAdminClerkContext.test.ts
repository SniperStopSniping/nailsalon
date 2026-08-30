/* eslint-disable import/first */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clerkMiddlewareFactory, intlMiddleware } = vi.hoisted(() => ({
  clerkMiddlewareFactory: vi.fn(),
  intlMiddleware: vi.fn(),
}));

vi.mock('next-intl/middleware', () => ({
  default: () => intlMiddleware,
}));

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: clerkMiddlewareFactory,
  createRouteMatcher: (patterns: string[]) => {
    if (patterns.includes('/admin(.*)')) {
      return (request: NextRequest) => /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(
        request.nextUrl.pathname,
      );
    }
    if (patterns.some(pattern => pattern.includes('/admin/booking-page/preview/'))) {
      return (request: NextRequest) => /^\/(?:[a-z]{2}\/)?admin\/booking-page\/preview\//.test(
        request.nextUrl.pathname,
      );
    }
    return () => false;
  },
}));

import middleware from './middleware';

const event = {} as never;

function request(path: string, cookies: Record<string, string> = {}) {
  const incoming = new NextRequest(new URL(path, 'https://dashboard.example'));
  for (const [name, value] of Object.entries(cookies)) {
    incoming.cookies.set(name, value);
  }
  return incoming;
}

describe('middleware — Owner Workspace Clerk context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intlMiddleware.mockImplementation(() => NextResponse.next());
    clerkMiddlewareFactory.mockImplementation((handler: (
      auth: unknown,
      request: NextRequest,
    ) => NextResponse | Promise<NextResponse>) => async (incoming: NextRequest) => (
      handler(vi.fn(), incoming)
    ));
  });

  it.each([
    '/en/admin',
    '/fr/admin?app=services',
    '/en/admin/website/preview/22222222-2222-4222-8222-222222222222',
  ])('establishes Clerk context for a signed-in owner on %s', async (path) => {
    await middleware(request(path, { __session: 'opaque-clerk-session' }), event);

    expect(clerkMiddlewareFactory).toHaveBeenCalledTimes(1);
    expect(intlMiddleware).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['anonymous', {}],
    ['legacy session', { n5_admin_session: 'opaque-server-session' }],
    ['signed impersonation', {
      n5_admin_session: 'opaque-server-session',
      sa_impersonate: 'opaque-signed-impersonation',
    }],
  ])('preserves the existing %s Workspace auth path', async (_label, cookies) => {
    await middleware(request('/en/admin', cookies), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(intlMiddleware).toHaveBeenCalledTimes(1);
  });

  it('does not broaden Clerk context to a public customer site', async () => {
    await middleware(request('/en/isla-nail-studio'), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(intlMiddleware).toHaveBeenCalledTimes(1);
  });
});
