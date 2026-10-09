import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PublicBookingLayout from '@/app/(unauth)/book/layout';
import LocalizedBookingLayout from '@/app/[locale]/(unauth)/book/layout';
import { ADMIN_SESSION_COOKIE } from '@/libs/adminSessionCookie';

import { withPublicOwnerSession } from './withPublicOwnerSession';

vi.mock('server-only', () => ({}));

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  }),
}));
vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="clerk-session-renewal">{children}</div>
  ),
}));

beforeEach(() => cookieJar.clear());

describe('public owner session renewal', () => {
  it.each(['__session', '__session_instance-one'])('mounts the SDK for an existing %s session', async (name) => {
    cookieJar.set(name, 'opaque-test-token');
    render(await withPublicOwnerSession(<p>Public booking</p>));

    expect(screen.getAllByTestId('clerk-session-renewal')).toHaveLength(1);
    expect(screen.getByText('Public booking')).toBeInTheDocument();
  });

  it.each(([
    [],
    [['__session', '']],
    [['__session_instance', '   ']],
    [['unrelated_cookie', 'value']],
    [['__session_bad.suffix', 'value']],
    [[ADMIN_SESSION_COOKIE, 'legacy-session']],
    [[ADMIN_SESSION_COOKIE, 'legacy-session'], ['__session', 'stale-clerk-token']],
  ] as [string, string][][]).map(cookies => ({ cookies })))('preserves guests and legacy sessions without mounting the SDK ($cookies)', async ({ cookies }) => {
    for (const [name, value] of cookies) {
      cookieJar.set(name, value);
    }
    const child = <p>Public booking</p>;

    expect(await withPublicOwnerSession(child)).toBe(child);
  });

  it.each([
    ['shared', PublicBookingLayout],
    ['localized shared', LocalizedBookingLayout],
  ] as const)('wires the %s booking layout to one SDK provider', async (_, Layout) => {
    cookieJar.set('__session', 'opaque-test-token');
    render(await Layout({ children: <p>Public booking</p> }));

    expect(screen.getAllByTestId('clerk-session-renewal')).toHaveLength(1);
    expect(screen.getByText('Public booking')).toBeInTheDocument();
  });
});
