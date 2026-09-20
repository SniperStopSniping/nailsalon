/* eslint-disable style/max-statements-per-line */
import { describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const h = vi.hoisted(() => ({ requireAdminSalon: vi.fn(), mint: vi.fn(), latest: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: h.requireAdminSalon })); vi.mock('@/libs/DB', () => ({ db: {} })); vi.mock('@/libs/nextVisitOffer.server', () => ({ mintNextVisitOfferLink: h.mint, getLatestNextVisitOfferForClient: h.latest })); vi.mock('@/libs/publicUrl', () => ({ buildSalonTenantPublicUrl: (p: string) => `https://tenant.test${p}` }));
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('next visit admin link', () => {
  it('rejects malformed dual IDs before auth', async () => {
    const r = await POST(req({ salonSlug: 'a', appointmentId: 'x', clientId: 'y' }));

    expect(r.status).toBe(400); expect(h.requireAdminSalon).not.toHaveBeenCalled();
  });

  it('does not mint across an unauthorized salon', async () => {
    h.requireAdminSalon.mockResolvedValueOnce({ error: Response.json({}, { status: 403 }) }); const r = await POST(req({ salonSlug: 'other', appointmentId: 'x' }));

    expect(r.status).toBe(403); expect(h.mint).not.toHaveBeenCalled();
  });

  it('mints only an existing authorized offer', async () => {
    h.requireAdminSalon.mockResolvedValueOnce({ salon: { id: 's', slug: 'a' } }); h.mint.mockResolvedValueOnce({ token: 'opaque', offer: { deadlineDate: '2026-10-20', settingsSnapshot: { enabled: true } } }); const r = await POST(req({ salonSlug: 'a', appointmentId: 'x' }));

    expect(r.status).toBe(200); expect(h.mint).toHaveBeenCalledWith(expect.anything(), { salonId: 's', sourceAppointmentId: 'x' }); expect((await r.json()).data.offer.bookingUrl).toContain('campaign=opaque');
  });
});
