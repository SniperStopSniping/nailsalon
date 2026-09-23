import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handoff: vi.fn(),
  limit: vi.fn(() => ({ allowed: true })),
  resolveBookingConfig: vi.fn(() => ({ timezone: 'America/Toronto' })),
  resolveSettings: vi.fn(() => ({ enabled: true, intervalWeeks: 3 })),
  verify: vi.fn(),
}));

vi.mock('@/libs/appointmentAccess', () => ({ verifyAppointmentAccessToken: h.verify }));
vi.mock('@/libs/confirmationRebooking.server', () => ({ createConfirmationRebookingHandoff: h.handoff }));
vi.mock('@/libs/bookingConfig', () => ({ resolveBookingConfigFromSettings: h.resolveBookingConfig }));
vi.mock('@/libs/customerAssistant/http.server', () => ({ CUSTOMER_NO_STORE: { 'Cache-Control': 'private, no-store' } }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: h.limit,
  getClientIp: () => 'test-ip',
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
vi.mock('@/libs/rebookingPromptSettings', () => ({ resolveRebookingPromptSettings: h.resolveSettings }));

const context = { params: Promise.resolve({ token: 'private-token' }) };
const capability = {
  salonId: 'salon_a',
  salonSlug: 'isla',
  appointmentId: 'appointment_a',
  salonSettings: { rebookingPrompt: { enabled: true, intervalWeeks: 3 } },
  appointment: {
    id: 'appointment_a',
    salonId: 'salon_a',
    status: 'confirmed',
    deletedAt: null,
    startTime: new Date('2026-09-23T16:00:00.000Z'),
    technicianId: 'technician_a',
    locationId: 'location_a',
  },
};

const { GET } = await import('./route');

describe('confirmation next-booking handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.limit.mockReturnValue({ allowed: true });
    h.verify.mockResolvedValue(capability);
    h.resolveSettings.mockReturnValue({ enabled: true, intervalWeeks: 3 });
    h.handoff.mockResolvedValue({ bookingUrl: '/en/isla/book/time?bookingBasket=x' });
  });

  it('returns a tenant-relative, server-derived handoff for a confirmed booking', async () => {
    const response = await GET(new Request('https://luster.test/api/public/appointments/manage/private-token/next-booking?locale=fr'), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { bookingUrl: '/en/isla/book/time?bookingBasket=x' } });
    expect(h.handoff).toHaveBeenCalledWith(expect.objectContaining({
      appointment: capability.appointment,
      salonSlug: 'isla',
      locale: 'fr',
      salonTimeZone: 'America/Toronto',
    }));
  });

  it.each([
    ['disabled setting', { enabled: false, intervalWeeks: 3 }, capability],
    ['pending appointment', { enabled: true, intervalWeeks: 3 }, { ...capability, appointment: { ...capability.appointment, status: 'pending' } }],
    ['payment hold', { enabled: true, intervalWeeks: 3 }, { ...capability, appointment: { ...capability.appointment, status: 'awaiting_payment' } }],
    ['mismatched capability tenant', { enabled: true, intervalWeeks: 3 }, { ...capability, appointment: { ...capability.appointment, salonId: 'salon_b' } }],
  ])('rejects %s without resolving booking details', async (_label, settings, access) => {
    h.resolveSettings.mockReturnValueOnce(settings);
    h.verify.mockResolvedValueOnce(access);

    const response = await GET(new Request('https://luster.test/api/public/appointments/manage/private-token/next-booking'), context);

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NEXT_BOOKING_UNAVAILABLE');
    expect(h.handoff).not.toHaveBeenCalled();
  });
});
