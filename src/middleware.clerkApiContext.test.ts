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
});
