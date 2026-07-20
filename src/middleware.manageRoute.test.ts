/* eslint-disable import/first */
/**
 * Host-relative management links must reach the root `/manage/[...path]` route.
 *
 * Regression: the locale middleware rewrote `/manage/<token>` to
 * `/<locale>/manage/<token>`, which matches the tenant tree with slug="manage"
 * and 404s — so every salon on a custom domain or tenant subdomain got a dead
 * link from their booking email. Caught in production smoke-testing, not by
 * the build (the route compiled fine; it was simply never reached).
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { intlMiddleware } = vi.hoisted(() => ({ intlMiddleware: vi.fn() }));

vi.mock('next-intl/middleware', () => ({
  default: () => intlMiddleware,
}));

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: () => async () => undefined,
  createRouteMatcher: () => () => false,
}));

vi.mock('./libs/clerkApiContext', () => ({ apiPathNeedsClerkContext: () => false }));

import middleware from './middleware';

function request(path: string) {
  return new NextRequest(new URL(path, 'https://salon-domain.example'));
}

const event = {} as never;

describe('middleware — host-relative /manage links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intlMiddleware.mockImplementation(() => NextResponse.next());
  });

  it('lets /manage/<token> through without locale rewriting', async () => {
    const response = await middleware(request('/manage/TEST_TOKEN_NOT_REAL'), event);

    expect(intlMiddleware).not.toHaveBeenCalled();
    // A pass-through, not a redirect or rewrite to /<locale>/manage/...
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets deeper /manage sub-paths through too', async () => {
    await middleware(request('/manage/TEST_TOKEN_NOT_REAL/reschedule'), event);

    expect(intlMiddleware).not.toHaveBeenCalled();
  });

  it('still applies locale handling to the tenant path', async () => {
    await middleware(request('/en/isla-nail-studio1/manage/TEST_TOKEN_NOT_REAL'), event);

    expect(intlMiddleware).toHaveBeenCalled();
  });

  it('does not hijack unrelated paths that merely contain "manage"', async () => {
    await middleware(request('/en/isla-nail-studio1/manage-something'), event);

    expect(intlMiddleware).toHaveBeenCalled();
  });
});
