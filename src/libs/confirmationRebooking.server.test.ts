import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  location: vi.fn(),
  selection: vi.fn(),
  technician: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({ db: { select: h.select } }));
vi.mock('@/libs/publicBookingSelection', () => ({ resolvePublicBookingSelection: h.selection }));
vi.mock('@/libs/publicBookingTechnicians', () => ({ resolvePublicBookingTechnicianContext: h.technician }));
vi.mock('@/libs/queries', () => ({ getLocationById: h.location }));

function query(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  return chain;
}

const { createConfirmationRebookingHandoff } = await import('./confirmationRebooking.server');

const input = {
  appointment: {
    id: 'appointment_a',
    salonId: 'salon_a',
    startTime: new Date('2026-09-23T16:00:00.000Z'),
    technicianId: 'technician_a',
    locationId: 'location_a',
  },
  salonSlug: 'isla',
  locale: 'en',
  salonTimeZone: 'America/Toronto',
  settings: { enabled: true, intervalWeeks: 3, message: 'Secure your next spot now.' },
};

describe('createConfirmationRebookingHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.select.mockReturnValueOnce(query([{ id: 'snapshot_service_a', serviceId: 'service_a' }]))
      .mockReturnValueOnce(query([{ appointmentServiceId: 'snapshot_service_a', addOnId: 'addon_a', quantity: 2 }]));
    h.location.mockResolvedValue({ id: 'location_a' });
    h.technician.mockResolvedValue({ hasValidExplicitTechnician: true });
  });

  it('uses scoped snapshot IDs and current validators before emitting a time handoff', async () => {
    const result = await createConfirmationRebookingHandoff(input);

    expect(result).toEqual({
      bookingUrl: expect.stringContaining('/en/isla/book/time?'),
    });
    expect(result.bookingUrl).toContain('date=2026-10-14');
    expect(result.bookingUrl).toContain('techId=technician_a');
    expect(result.bookingUrl).toContain('locationId=location_a');
    expect(result.bookingUrl).not.toContain('campaign');
    expect(result.bookingUrl).not.toContain('manageToken');
    expect(h.technician).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_a',
      bookingBasket: { version: 2, items: [{ serviceId: 'service_a', selectedAddOns: [{ addOnId: 'addon_a', quantity: 2 }] }] },
    }));
    expect(h.select.mock.results[0]?.value.innerJoin).toHaveBeenCalled();
    expect(h.select.mock.results[1]?.value.innerJoin).toHaveBeenCalled();
  });

  it('retains a current base service while sending a changed add-on through the review banner', async () => {
    h.technician.mockRejectedValueOnce(new Error('ADD_ON_REMOVED'));
    h.selection.mockRejectedValueOnce(new Error('ADD_ON_REMOVED'))
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('ADD_ON_REMOVED'));

    const result = await createConfirmationRebookingHandoff(input);

    expect(result.bookingUrl).toContain('/en/isla/book/service?');
    expect(result.bookingUrl).toContain('rebooking=catalogue_changed');
    expect(result.bookingUrl).toContain('bookingBasket=');
    expect(decodeURIComponent(result.bookingUrl)).toContain('"selectedAddOns":[]');
    expect(result.message).toContain('previous service has changed');
  });

  it('keeps a still-valid add-on when another old add-on was removed', async () => {
    h.select.mockReset();
    h.select.mockReturnValueOnce(query([{ id: 'snapshot_service_a', serviceId: 'service_a' }]))
      .mockReturnValueOnce(query([
        { appointmentServiceId: 'snapshot_service_a', addOnId: 'addon_valid', quantity: 1 },
        { appointmentServiceId: 'snapshot_service_a', addOnId: 'addon_removed', quantity: 1 },
      ]));
    h.technician.mockRejectedValueOnce(new Error('ADD_ON_REMOVED'));
    h.selection.mockRejectedValueOnce(new Error('ADD_ON_REMOVED'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('ADD_ON_REMOVED'));

    const result = await createConfirmationRebookingHandoff(input);

    expect(decodeURIComponent(result.bookingUrl)).toContain('"addOnId":"addon_valid"');
    expect(decodeURIComponent(result.bookingUrl)).not.toContain('addon_removed');
  });

  it('drops an inactive or wrong-tenant location and unavailable technician while retaining the suggested date', async () => {
    h.location.mockResolvedValueOnce(null);
    h.technician.mockResolvedValueOnce({ hasValidExplicitTechnician: false });

    const result = await createConfirmationRebookingHandoff(input);

    expect(result.bookingUrl).toContain('/en/isla/book/time?');
    expect(result.bookingUrl).toContain('date=2026-10-14');
    expect(result.bookingUrl).not.toContain('locationId=');
    expect(result.bookingUrl).not.toContain('techId=');
    expect(result.bookingUrl).not.toContain('catalogAcknowledgment');
  });
});
