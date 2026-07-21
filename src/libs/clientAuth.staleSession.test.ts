/* eslint-disable import/first */
/**
 * Stale client sessions must never leak account identity into a booking.
 *
 * A `client_session` cookie survives 30 days and is what made a signed-in
 * browser inherit an account's phone. Everything that is NOT a live session —
 * an unknown id, an expired row, a deleted row, a malformed cookie — has to
 * degrade to "no session at all", so the same browser keeps working without
 * Incognito and without inheriting somebody else's identity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieStore, selectRows, getClientByPhone } = vi.hoisted(() => ({
  cookieStore: { value: undefined as string | undefined },
  selectRows: [] as unknown[][],
  getClientByPhone: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'client_session' && cookieStore.value !== undefined
      ? { name, value: cookieStore.value }
      : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = async () => selectRows.shift() ?? [];
      return chain;
    },
    update: () => ({ set: () => ({ where: async () => undefined, catch: () => undefined }) }),
  },
}));

vi.mock('./queries', () => ({ getClientByPhone }));

import { getClientSession } from './clientAuth';

describe('stale client sessions degrade to no session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    cookieStore.value = undefined;
    getClientByPhone.mockResolvedValue(null);
  });

  it('returns null when no cookie is present at all', async () => {
    await expect(getClientSession()).resolves.toBeNull();
  });

  it('returns null for a session id that does not exist', async () => {
    cookieStore.value = 'does-not-exist';
    selectRows.push([]);

    await expect(getClientSession()).resolves.toBeNull();
  });

  it('returns null for an expired session', async () => {
    cookieStore.value = 'expired-session';
    // The lookup filters on expiresAt > now, so an expired row comes back empty.
    selectRows.push([]);

    await expect(getClientSession()).resolves.toBeNull();
  });

  it('returns null for a revoked/deleted session row', async () => {
    cookieStore.value = 'deleted-session';
    selectRows.push([]);

    await expect(getClientSession()).resolves.toBeNull();
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['not a uuid', 'garbage-value'],
    ['sql-ish', '\' OR 1=1 --'],
    ['very long', 'x'.repeat(5000)],
  ])('returns null for a malformed cookie (%s)', async (_label, value) => {
    cookieStore.value = value;
    selectRows.push([]);

    await expect(getClientSession()).resolves.toBeNull();
  });

  it('never throws when the session lookup fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cookieStore.value = 'boom';
    selectRows.push(new Proxy([], {
      get() {
        throw new Error('db down');
      },
    }) as unknown as unknown[]);

    await expect(getClientSession()).resolves.toBeNull();

    errorSpy.mockRestore();
  });

  it('still resolves a genuinely live session', async () => {
    cookieStore.value = 'live-session';
    selectRows.push([{
      id: 'live-session',
      clientPhone: '+14165550101',
      expiresAt: new Date(Date.now() + 60_000),
    }]);
    getClientByPhone.mockResolvedValue({ firstName: 'Ava', email: 'ava@example.com' });

    await expect(getClientSession()).resolves.toMatchObject({
      phone: '+14165550101',
      sessionId: 'live-session',
    });
  });
});
