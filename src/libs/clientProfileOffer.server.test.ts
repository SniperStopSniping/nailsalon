import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getClientProfileNextVisitOffer } from './clientProfileOffer.server';

vi.mock('server-only', () => ({}));
const { latest, available } = vi.hoisted(() => ({ latest: vi.fn(), available: vi.fn() }));
vi.mock('@/libs/nextVisitOffer.server', () => ({
  getLatestNextVisitOfferForClient: latest,
  getAvailableNextVisitOfferForSourceAppointment: available,
}));
const now = new Date('2026-09-20T12:00:00Z');
const handle = {} as Parameters<typeof getClientProfileNextVisitOffer>[0];
const offer = { id: 'offer1', salonId: 'salon1', sourceAppointmentId: 'visit1', settingsSnapshot: { discountType: 'percent', value: 5 }, currency: 'CAD', deadlineDate: '2026-10-20', expiresAt: new Date('2026-10-21T04:00:00Z'), privateToken: 'must-not-leak' };

beforeEach(() => {
  vi.resetAllMocks();
  latest.mockResolvedValue(offer);
  available.mockResolvedValue(offer);
});

describe('client profile offer read model', () => {
  it('uses both client lineage and current authoritative visibility, projecting no capability', async () => {
    const result = await getClientProfileNextVisitOffer(handle, 'salon1', 'client1', now);

    expect(latest).toHaveBeenCalledWith(handle, 'salon1', 'client1');
    expect(available).toHaveBeenCalledWith(handle, { salonId: 'salon1', sourceAppointmentId: 'visit1', now });
    expect(result).toEqual({ state: 'available', discountType: 'percent', discountValue: 5, currency: 'CAD', expiresOn: '2026-10-20', expiresAt: '2026-10-21T04:00:00.000Z', sourceAppointmentId: 'visit1' });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('does not advertise a disabled, expired, blocked, invalid or unavailable offer', async () => {
    available.mockResolvedValue(null);

    expect(await getClientProfileNextVisitOffer(handle, 'salon1', 'client1', now)).toEqual({ state: 'none' });
  });

  it('does not read a source from a different salon', async () => {
    latest.mockResolvedValue({ ...offer, salonId: 'salon2' });

    expect(await getClientProfileNextVisitOffer(handle, 'salon1', 'client1', now)).toEqual({ state: 'none' });
    expect(available).not.toHaveBeenCalled();
  });

  it('rejects a mismatched second projection', async () => {
    available.mockResolvedValue({ ...offer, id: 'different' });

    expect(await getClientProfileNextVisitOffer(handle, 'salon1', 'client1', now)).toEqual({ state: 'none' });
  });

  it('distinguishes an optional read failure from no offer', async () => {
    latest.mockRejectedValue(new Error('unavailable'));

    expect(await getClientProfileNextVisitOffer(handle, 'salon1', 'client1', now)).toEqual({ state: 'unavailable' });
  });

  it('keeps an absent offer generic without requesting a campaign', async () => {
    latest.mockResolvedValue(null);

    expect(await getClientProfileNextVisitOffer(handle, 'salon1', 'client1', now)).toEqual({ state: 'none' });
    expect(available).not.toHaveBeenCalled();
  });
});
