import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: vi.fn(), proposal: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/bookingConfig', () => ({ getBookingConfigForSalon: mocks.config }));
vi.mock('./catalogue.server', () => ({ buildCustomerProposal: mocks.proposal }));

const { lookupCustomerSlots, validateCustomerDatePreference } = await import('./slots.server');

const selection = { baseServiceId: 'gelx', selectedAddOns: [] };
const proposal = { selection, fingerprint: 'a'.repeat(64), service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 }, addOns: [], subtotalCents: 6000, durationMinutes: 60, currency: 'CAD', expiresAt: '2026-09-18T00:00:00Z' };

describe('bounded customer availability adapter', () => {
  it('rejects malformed, past, and out-of-horizon local dates before a lookup', () => {
    const today = '2026-09-18';

    expect(validateCustomerDatePreference({ today, preference: { date: '2026-02-30', earliest: '00:00', latest: '23:59' } })).toBe(false);
    expect(validateCustomerDatePreference({ today, preference: { date: '2026-09-17', earliest: '00:00', latest: '23:59' } })).toBe(false);
    expect(validateCustomerDatePreference({ today, preference: { date: '2026-12-18', earliest: '00:00', latest: '23:59' } })).toBe(false);
    expect(validateCustomerDatePreference({ today, preference: { date: '2026-09-20', earliest: '17:00', latest: '16:00' } })).toBe(false);
  });

  it('calls only the bound pure adapter and strips unavailable/private slot fields', async () => {
    mocks.config.mockResolvedValue({ timezone: 'America/Toronto' });
    mocks.proposal.mockResolvedValue(proposal);
    const lookup = vi.fn().mockResolvedValue(Response.json({
      slots: [
        { time: '15:00', startTime: '2026-09-20T19:00:00.000Z', availability: 'available', technicianId: 'private', appointmentCount: 99 },
        { time: '15:30', startTime: '2026-09-20T19:30:00.000Z', availability: 'schedule_conflict', bookedSlots: ['private'] },
      ],
    }));

    const result = await lookupCustomerSlots({
      salon: { id: 'salon-a', slug: 'isla-nail-studio' },
      features: null,
      selection,
      preference: { date: '2026-09-20', earliest: '14:00', latest: '17:00' },
      now: new Date('2026-09-18T12:00:00Z'),
      lookup,
    });

    expect(lookup).toHaveBeenCalledWith({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, date: '2026-09-20', baseServiceId: 'gelx', selectedAddOns: '[]' });
    expect(result?.slots).toEqual([{ time: '15:00', startTime: '2026-09-20T19:00:00.000Z' }]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('appointmentCount');
  });

  it('fails closed when the availability authority is unavailable', async () => {
    mocks.config.mockResolvedValue({ timezone: 'America/Toronto' });
    mocks.proposal.mockResolvedValue(proposal);
    const result = await lookupCustomerSlots({
      salon: { id: 'salon-a', slug: 'isla-nail-studio' },
      features: null,
      selection,
      preference: { date: '2026-09-20', earliest: '00:00', latest: '23:59' },
      now: new Date('2026-09-18T12:00:00Z'),
      lookup: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    });

    expect(result).toBeNull();
  });

  it('rechecks an offered slot outside the eight-slot display cap and discards slots after a quote change', async () => {
    mocks.config.mockResolvedValue({ timezone: 'America/Toronto' });
    const changedProposal = { ...proposal, fingerprint: 'b'.repeat(64) };
    mocks.proposal.mockResolvedValueOnce(proposal).mockResolvedValueOnce(changedProposal);
    const slots = Array.from({ length: 9 }, (_, index) => ({
      time: `${String(10 + index).padStart(2, '0')}:00`,
      startTime: new Date(Date.UTC(2026, 8, 20, 14 + index)).toISOString(),
      availability: 'available',
    }));

    const result = await lookupCustomerSlots({
      salon: { id: 'salon-a', slug: 'isla-nail-studio' },
      features: null,
      selection,
      preference: { date: '2026-09-20', earliest: '10:00', latest: '19:00' },
      now: new Date('2026-09-18T12:00:00Z'),
      lookup: vi.fn().mockResolvedValue(Response.json({ slots })),
      requiredStartTime: slots[8]!.startTime,
    });

    expect(result?.slots).toHaveLength(8);
    expect(result?.selected).toEqual({ time: '18:00', startTime: slots[8]!.startTime });
    expect(result?.quoteChanged).toBe(true);
    expect(result?.proposal.fingerprint).toBe('b'.repeat(64));
  });
});
