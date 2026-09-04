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
    if (patterns.some(pattern => pattern.includes('/onboarding-v1'))) {
      return (request: NextRequest) => /^\/(?:[a-z]{2}\/)?onboarding-v1(?:\/|$)/u.test(
        request.nextUrl.pathname,
      );
    }
    return () => false;
  },
}));

import middleware from './middleware';

const event = {} as never;

function request(path: string, cookies: Record<string, string> = {}) {
  const incoming = new NextRequest(new URL(path, 'http://192.168.2.10:4203'));
  for (const [name, value] of Object.entries(cookies)) {
    incoming.cookies.set(name, value);
  }
  return incoming;
}

describe('middleware — public Onboarding V1', () => {
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

  it.each(['/onboarding-v1', '/en/onboarding-v1'])(
    'renders the public value-first route without a Clerk handshake at %s',
    async (path) => {
      const response = await middleware(request(path), event);

      expect(response.status).toBe(200);
      expect(clerkMiddlewareFactory).not.toHaveBeenCalled();
      expect(intlMiddleware).toHaveBeenCalledTimes(1);
    },
  );

  it('establishes Clerk context when an owner session already exists', async () => {
    await middleware(request('/onboarding-v1', { __session: 'opaque-clerk-session' }), event);

    expect(clerkMiddlewareFactory).toHaveBeenCalledTimes(1);
    expect(intlMiddleware).toHaveBeenCalledTimes(1);
  });
});
