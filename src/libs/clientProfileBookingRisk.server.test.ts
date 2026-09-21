import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getClientProfileBookingRisk } from './clientProfileBookingRisk.server';

const {
  getAdminSession,
  isNetworkNoShowPlatformActive,
  isNetworkNoShowPlatformActiveInTx,
  readNetworkNoShowRisk,
  db,
  selectResults,
  tx,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const tx = {
    execute: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const afterWhere = {
        limit: vi.fn(async () => result),
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
      };
      const where = vi.fn(() => afterWhere);
      return {
        from: vi.fn(() => ({
          where,
          innerJoin: vi.fn(() => ({ where })),
        })),
      };
    }),
  };
  return {
    getAdminSession: vi.fn(),
    isNetworkNoShowPlatformActive: vi.fn(),
    isNetworkNoShowPlatformActiveInTx: vi.fn(),
    readNetworkNoShowRisk: vi.fn(),
    db: { transaction: vi.fn(async (callback: (handle: typeof tx) => unknown) => callback(tx)) },
    selectResults,
    tx,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/adminAuth', () => ({ getAdminSession }));
vi.mock('@/libs/networkNoShow.server', () => ({
  isNetworkNoShowPlatformActive,
  isNetworkNoShowPlatformActiveInTx,
  readNetworkNoShowRisk,
}));
vi.mock('@/libs/DB', () => ({ db }));

const args = {
  salonId: 'salon_a',
  clientId: 'client_a',
  phone: '416-555-0101',
  email: 'ava@example.com',
  settings: { payments: { deposit: { noShowProtection: 'deposit_1' } } },
} as const;

describe('getClientProfileBookingRisk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');
    isNetworkNoShowPlatformActive.mockResolvedValue(true);
    isNetworkNoShowPlatformActiveInTx.mockResolvedValue(true);
    getAdminSession.mockResolvedValue({ id: 'admin_a' });
    readNetworkNoShowRisk.mockResolvedValue({
      state: 'available',
      activeNoShowCount: 1,
      windowMonths: 12,
    });
  });

  it('stays dark without reading identity evidence or risk data', async () => {
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'false');

    await expect(getClientProfileBookingRisk(args)).resolves.toBeUndefined();

    expect(getAdminSession).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(readNetworkNoShowRisk).not.toHaveBeenCalled();
  });

  it.each([
    ['before authentication', false, true],
    ['at transaction entry', true, false],
  ])('returns dark while the platform is disabled %s', async (_stage, beforeAuth, inTx) => {
    isNetworkNoShowPlatformActive.mockResolvedValue(beforeAuth);
    isNetworkNoShowPlatformActiveInTx.mockResolvedValue(inTx);

    await expect(getClientProfileBookingRisk(args)).resolves.toBeUndefined();

    expect(readNetworkNoShowRisk).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();

    if (!beforeAuth) {
      expect(getAdminSession).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    }
  });

  it('keeps a disabled platform dark before unbound-client and exhausted-budget branches', async () => {
    isNetworkNoShowPlatformActive.mockResolvedValue(false);
    selectResults.push(
      [{ tenant: 120, actor: 60 }],
      [],
    );

    await expect(getClientProfileBookingRisk(args)).resolves.toBeUndefined();

    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(readNetworkNoShowRisk).not.toHaveBeenCalled();
  });

  it('returns unavailable before opening a transaction when no owner/admin session exists', async () => {
    getAdminSession.mockResolvedValue(null);

    await expect(getClientProfileBookingRisk(args)).resolves.toEqual({ state: 'unavailable' });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(readNetworkNoShowRisk).not.toHaveBeenCalled();
  });

  it('does not read network risk when the client has no qualifying local booking evidence', async () => {
    selectResults.push(
      [{ tenant: 0, actor: 0 }],
      [],
    );

    await expect(getClientProfileBookingRisk(args)).resolves.toEqual({ state: 'unavailable' });

    expect(tx.insert).toHaveBeenCalledOnce();
    expect(readNetworkNoShowRisk).not.toHaveBeenCalled();
  });

  it('returns only the derived count, window, and this salon protection after local evidence passes', async () => {
    selectResults.push(
      [{ tenant: 0, actor: 0 }],
      [{ id: 'appointment_a' }],
    );

    await expect(getClientProfileBookingRisk(args)).resolves.toEqual({
      state: 'available',
      activeNoShowCount: 1,
      windowMonths: 12,
      protection: 'deposit_1',
    });

    expect(readNetworkNoShowRisk).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_a',
      phone: '416-555-0101',
      email: 'ava@example.com',
      handle: tx,
    }));
  });
});
