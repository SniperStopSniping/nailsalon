import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const { requireAdminSalonFromRequest } = vi.hoisted(() => ({ requireAdminSalonFromRequest: vi.fn() }));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalonFromRequest }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/appointmentAudit', () => ({ buildAppointmentAuditRow: vi.fn() }));
vi.mock('@/libs/networkNoShowAudit.server', () => ({ setNetworkNoShowAuditActorInTx: vi.fn() }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: vi.fn(() => ({ allowed: true })), rateLimitResponse: vi.fn() }));

describe('POST /api/admin/network-no-show/correct', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not correct an appointment when the signed-in owner has no access to the requested salon', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
      salon: null,
      admin: null,
    });
    const response = await POST(new Request('http://localhost/api/admin/network-no-show/correct?salonSlug=other-salon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId: 'appt_other', expectedUpdatedAt: '2026-09-29T12:00:00.000Z', reason: 'Client attended and this was marked by mistake.' }),
    }));

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated correction', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      salon: null,
      admin: null,
    });
    const response = await POST(new Request('http://localhost/api/admin/network-no-show/correct?salonSlug=salon-a', { method: 'POST' }));

    expect(response.status).toBe(401);
  });
});
