/* eslint-disable import/first */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ clerk: vi.fn(), intl: vi.fn() }));
vi.mock('next-intl/middleware', () => ({ default: () => state.intl }));
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: state.clerk,
  createRouteMatcher: (patterns: string[]) => patterns.some(pattern => pattern.includes('/ai-website'))
    ? (request: NextRequest) => /^\/(?:[a-z]{2}\/)?ai-website(?:\/|$|-test)/u.test(request.nextUrl.pathname)
    : () => false,
}));
import middleware from './middleware';

beforeEach(() => {
  vi.clearAllMocks();
  state.intl.mockImplementation(() => NextResponse.next());
  state.clerk.mockImplementation(handler => async (request: NextRequest) => handler(vi.fn(), request));
});

const run = (path: string, cookie?: { name: string; value: string }) => {
  const request = new NextRequest(new URL(path, 'http://localhost:3197'));
  if (cookie) {
    request.cookies.set(cookie.name, cookie.value);
  }
  return middleware(request, {} as never);
};

it.each(['/ai-website', '/en/ai-website', '/fr/ai-website/', '/ai-website?account='])('shows the public introduction without an authentication handshake at %s', async (path) => {
  expect((await run(path)).status).toBe(200);
  expect(state.clerk).not.toHaveBeenCalled();
  expect(state.intl).toHaveBeenCalledOnce();
});

it.each(['/ai-website?account=sign-up', '/en/ai-website?account=sign-in', '/ai-website?account=other', '/ai-website-test', '/ai-website/unknown'])('retains Clerk context for accounts and other invitation paths at %s', async (path) => {
  await run(path);

  expect(state.clerk).toHaveBeenCalledOnce();
});

it.each(['__session', '__session_instance'])('requires SDK validation for an existing %s token', async (name) => {
  await run('/ai-website', { name, value: 'unverified-token' });

  expect(state.clerk).toHaveBeenCalledOnce();
});
