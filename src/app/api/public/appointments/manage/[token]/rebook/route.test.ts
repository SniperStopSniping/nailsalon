import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  available: vi.fn(),
  limit: vi.fn(() => ({ allowed: true })),
  mint: vi.fn(),
  sameOrigin: vi.fn(() => true),
  verify: vi.fn(),
}));

vi.mock('@/libs/appointmentAccess', () => ({ verifyAppointmentAccessToken: h.verify }));
vi.mock('@/libs/customerAssistant/http.server', () => ({
  CUSTOMER_NO_STORE: { 'Cache-Control': 'private, no-store' },
  isCustomerSameOrigin: h.sameOrigin,
}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/nextVisitOffer.server', () => ({
  getAvailableNextVisitOfferForSourceAppointment: h.available,
  mintNextVisitOfferLink: h.mint,
}));
vi.mock('@/libs/publicUrl', () => ({ buildSalonTenantPublicUrl: (path: string) => path }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: h.limit,
  getClientIp: () => 'test-ip',
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

const c = { params: Promise.resolve({ token: 'private-manage-token' }) };
const completed = {
  salonId: 'salon-a',
  salonSlug: 'salon-a',
  salonCustomDomain: null,
  appointmentId: 'appointment-a',
  salonSettings: { rebookingPrompt: { enabled: true } },
  appointment: {
    id: 'appointment-a',
    salonId: 'salon-a',
    status: 'completed',
    completedAt: new Date('2030-09-20T19:00:00.000Z'),
    deletedAt: null,
  },
};

const { GET, POST } = await import('./route');

describe('private completed-appointment rebooking prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.limit.mockReturnValue({ allowed: true });
    h.sameOrigin.mockReturnValue(true);
    h.verify.mockResolvedValue(completed);
    h.available.mockResolvedValue(null);
  });

  it('returns the enabled generic prompt without minting a campaign on GET', async () => {
    const response = await GET(new Request('https://salon.test/api/public/appointments/manage/token/rebook'), c);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      promptEnabled: true,
      promptKey: createHash('sha256').update('rebooking-prompt:v1:salon-a:appointment-a', 'utf8').digest('hex'),
      bookingUrl: '/book/service',
      offer: null,
    });
    expect(JSON.stringify(body)).not.toContain('private-manage-token');
    expect(h.mint).not.toHaveBeenCalled();
  });

  it('does not show offer language while the separate prompt setting is off', async () => {
    h.verify.mockResolvedValueOnce({ ...completed, salonSettings: { rebookingPrompt: { enabled: false } } });

    const response = await GET(new Request('https://salon.test/api/public/appointments/manage/token/rebook'), c);
    const body = await response.json();

    expect(body.data.promptEnabled).toBe(false);
    expect(body.data.offer).toBeNull();
    expect(h.available).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'confirmed', completedAt: null, deletedAt: null },
    { status: 'completed', completedAt: null, deletedAt: null },
    { status: 'completed', completedAt: new Date(), deletedAt: new Date() },
  ])('rejects a non-qualifying appointment state %#', async (appointment) => {
    h.verify.mockResolvedValueOnce({ ...completed, appointment: { ...completed.appointment, ...appointment } });

    const response = await GET(new Request('https://salon.test/api/public/appointments/manage/token/rebook'), c);

    expect(response.status).toBe(404);
    expect(h.available).not.toHaveBeenCalled();
  });

  it('requires same-origin before it mints an offer campaign', async () => {
    h.sameOrigin.mockReturnValueOnce(false);

    const response = await POST(new Request('https://salon.test/api/public/appointments/manage/token/rebook', { method: 'POST' }), c);

    expect(response.status).toBe(403);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.mint).not.toHaveBeenCalled();
  });

  it('mints only a current authoritative offer, otherwise opens a clean service flow', async () => {
    h.available.mockResolvedValueOnce({
      deadlineDate: '2030-10-20',
      currency: 'CAD',
      settingsSnapshot: { enabled: true },
    });
    h.mint.mockResolvedValueOnce({ token: 'campaign-token' });

    const offered = await POST(new Request('https://salon.test/api/public/appointments/manage/token/rebook', {
      method: 'POST',
      headers: { 'origin': 'https://salon.test', 'sec-fetch-site': 'same-origin' },
    }), c);

    expect((await offered.json()).data.bookingUrl).toBe('/book?campaign=campaign-token');
    expect(h.mint).toHaveBeenCalledWith({}, { salonId: 'salon-a', sourceAppointmentId: 'appointment-a' });

    h.available.mockResolvedValueOnce(null);
    const generic = await POST(new Request('https://salon.test/api/public/appointments/manage/token/rebook', {
      method: 'POST',
      headers: { 'origin': 'https://salon.test', 'sec-fetch-site': 'same-origin' },
    }), c);

    expect((await generic.json()).data.bookingUrl).toBe('/book/service');
    expect(h.mint).toHaveBeenCalledTimes(1);
  });
});
