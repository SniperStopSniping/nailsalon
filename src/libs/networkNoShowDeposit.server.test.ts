import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveNetworkNoShowDepositRequirement } from './networkNoShowDeposit.server';

vi.mock('server-only', () => ({}));
const { risk } = vi.hoisted(() => ({ risk: vi.fn() }));
vi.mock('@/libs/networkNoShow.server', () => ({ readNetworkNoShowRisk: risk }));
const base = { salonId: 'salon-b', phone: '4165551212', email: 'customer@example.test' };

beforeEach(() => vi.resetAllMocks());

describe('authoritative no-show deposit applicability', () => {
  it('warn-only never requires a deposit or queries network history on the payment path', async () => {
    expect(await resolveNetworkNoShowDepositRequirement({ ...base, settings: {} })).toBe(false);
    expect(risk).not.toHaveBeenCalled();
  });

  it('passes the exact pair and caller transaction to the shared resolver', async () => {
    const handle = {} as NonNullable<Parameters<typeof resolveNetworkNoShowDepositRequirement>[0]['handle']>;
    const settings = { payments: { deposit: { noShowProtection: 'deposit_2' as const } } };
    risk.mockResolvedValue({ state: 'available', activeNoShowCount: 2, windowMonths: 12 });

    expect(await resolveNetworkNoShowDepositRequirement({ ...base, settings, handle })).toBe(true);
    expect(risk).toHaveBeenCalledWith({ ...base, settings, handle });
  });

  it.each(['unavailable', 'inactive'])('does not invent history for %s', async (state) => {
    risk.mockResolvedValue({ state });

    expect(await resolveNetworkNoShowDepositRequirement({ ...base, settings: { payments: { deposit: { noShowProtection: 'deposit_1' } } } })).toBe(false);
  });

  it('propagates infrastructure failure instead of booking under invented zero history', async () => {
    risk.mockRejectedValue(new Error('unavailable'));

    await expect(resolveNetworkNoShowDepositRequirement({ ...base, settings: { payments: { deposit: { noShowProtection: 'deposit_1' } } } })).rejects.toThrow('unavailable');
  });
});
