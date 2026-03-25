import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  logReviewCreated,
  requireClientApiSession,
  requireClientSalonFromBody,
  requireClientSalonFromQuery,
  getAppointmentById,
  getSalonClientByPhone,
  checkEndpointRateLimit,
  getClientIp,
  rateLimitResponse,
  db,
} = vi.hoisted(() => {
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    logReviewCreated: vi.fn(),
    requireClientApiSession: vi.fn(),
    requireClientSalonFromBody: vi.fn(),
    requireClientSalonFromQuery: vi.fn(),
    getAppointmentById: vi.fn(),
    getSalonClientByPhone: vi.fn(),
    checkEndpointRateLimit: vi.fn(),
    getClientIp: vi.fn(),
    rateLimitResponse: vi.fn(),
    db: {
      select,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
    },
  };
});

vi.mock('@/libs/auditLog', () => ({
  logReviewCreated,
}));

vi.mock('@/libs/clientApiGuards', () => ({
  normalizeClientPhone: (phone: string) => phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'),
  requireClientApiSession,
  requireClientSalonFromBody,
  requireClientSalonFromQuery,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  getAppointmentById,
  getSalonClientByPhone,
}));

vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit,
  getClientIp,
  rateLimitResponse,
}));

import { GET, POST } from './route';

describe('/api/client/reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientIp.mockReturnValue('127.0.0.1');
    checkEndpointRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', reviewsEnabled: true },
    });
    requireClientSalonFromQuery.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', reviewsEnabled: true },
    });
  });

  it('rejects unauthenticated review creation through the shared client guard', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/client/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: 'appt_1',
          salonSlug: 'salon-a',
          rating: 5,
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(getAppointmentById).not.toHaveBeenCalled();
  });

  it('blocks review-status access for another clients appointment', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111', '+11111111111'],
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      clientPhone: '+12223334444',
      status: 'completed',
    });

    const response = await GET(
      new Request('http://localhost/api/client/reviews?appointmentId=appt_1&salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
