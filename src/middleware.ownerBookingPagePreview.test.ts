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
    if (patterns.some(pattern => pattern.includes('/admin/booking-page/preview/'))) {
      return (request: NextRequest) => /^\/(?:[a-z]{2}\/)?admin\/booking-page\/preview\/[^/]+\/?$/.test(
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

describe('middleware — private Owner booking-page preview', () => {
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
    '/admin/booking-page/preview/isla-nail-studio',
    '/fr/admin/booking-page/preview/isla-nail-studio',
  ])('establishes Clerk context for an Owner session on %s and marks the response private', async (path) => {
    const response = await middleware(request(path, { __session: 'opaque-clerk-session' }), event);

    expect(clerkMiddlewareFactory).toHaveBeenCalledTimes(1);
    expect(intlMiddleware).toHaveBeenCalledTimes(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it.each([
    ['anonymous', {}],
    ['signed legacy impersonation', {
      n5_admin_session: 'opaque-server-session',
      sa_impersonate: 'opaque-signed-impersonation',
    }],
  ])('avoids a Clerk handshake for %s while preserving the private server gate', async (_label, cookies) => {
    const response = await middleware(
      request('/admin/booking-page/preview/isla-nail-studio', cookies),
      event,
    );

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(intlMiddleware).toHaveBeenCalledTimes(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('does not broaden Clerk context to the anonymous public booking route', async () => {
    await middleware(request('/en/isla-nail-studio/book/service?builderPreview=9'), event);

    expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
    expect(intlMiddleware).toHaveBeenCalledTimes(1);
  });
});
