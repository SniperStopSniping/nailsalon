/* eslint-disable style/max-statements-per-line */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const h = vi.hoisted(() => ({ verify: vi.fn(), limit: vi.fn(() => ({ allowed: true })), same: vi.fn(() => true), mint: vi.fn() }));
vi.mock('@/libs/appointmentAccess', () => ({ verifyAppointmentAccessToken: h.verify })); vi.mock('@/libs/customerAssistant/http.server', () => ({ CUSTOMER_NO_STORE: { 'Cache-Control': 'no-store' }, isCustomerSameOrigin: h.same })); vi.mock('@/libs/DB', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } })); vi.mock('@/libs/nextVisitOffer.server', () => ({ mintNextVisitOfferLink: h.mint })); vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: h.limit, getClientIp: () => '', rateLimitResponse: () => Response.json({}, { status: 429 }) })); vi.mock('@/libs/publicUrl', () => ({ buildSalonTenantPublicUrl: (p: string) => p })); vi.mock('@/models/Schema', () => ({ nextVisitOfferSchema: { salonId: 'salonId', sourceAppointmentId: 'source' }, salonSchema: { id: 'id' } })); const c = { params: Promise.resolve({ token: 'private' }) };

describe('private next visit capability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not reveal an offer for an invalid capability', async () => {
    h.verify.mockResolvedValueOnce(null); const r = await GET(new Request('http://x'), c);

    expect((await r.json()).data.offer).toBeNull();
  });

  it('rejects cross-origin minting before capability use', async () => {
    h.same.mockReturnValueOnce(false); const r = await POST(new Request('http://x', { method: 'POST' }), c);

    expect(r.status).toBe(403); expect(h.verify).not.toHaveBeenCalled();
  });
});
