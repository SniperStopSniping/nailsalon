import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  getAppointmentById,
  getClientIp,
  getSalonClientByPhone,
  logReviewCreated,
  rateLimitResponse,
  requireClientApiSession,
  requireClientSalonFromBody,
  requireClientSalonFromQuery,
  setInsertPlan,
  setSelectPlan,
  setUpdatePlan,
  checkEndpointRateLimit,
  txInsertValuesSpy,
  txUpdateSetSpy,
} = vi.hoisted(() => {
  let selectPlan: unknown[] = [];
  let insertPlan: { type: 'resolve'; value: unknown[] } | { type: 'reject'; error: Error } = {
    type: 'resolve',
    value: [],
  };
  let updatePlan: { type: 'resolve'; value: unknown[] } | { type: 'reject'; error: Error } = {
    type: 'resolve',
    value: [],
  };

  const txInsertValuesSpy = vi.fn();
  const txUpdateSetSpy = vi.fn();

  const buildSelectChain = () => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectPlan.shift() ?? []),
      })),
    })),
  });

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => ({
      values: txInsertValuesSpy.mockImplementation(() => ({
        returning: vi.fn(async () => {
          if (insertPlan.type === 'reject') {
            throw insertPlan.error;
          }
          return insertPlan.value;
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: txUpdateSetSpy.mockImplementation(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (updatePlan.type === 'reject') {
              throw updatePlan.error;
            }
            return updatePlan.value;
          }),
        })),
      })),
    })),
  };

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
    setSelectPlan: (plan: unknown[]) => {
      selectPlan = [...plan];
    },
    setInsertPlan: (plan: { type: 'resolve'; value: unknown[] } | { type: 'reject'; error: Error }) => {
      insertPlan = plan;
    },
    setUpdatePlan: (plan: { type: 'resolve'; value: unknown[] } | { type: 'reject'; error: Error }) => {
      updatePlan = plan;
    },
    txInsertValuesSpy,
    txUpdateSetSpy,
    db: {
      select: vi.fn(() => buildSelectChain()),
      transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(tx)),
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
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getClientIp.mockReturnValue('127.0.0.1');
    checkEndpointRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111', '+11111111111'],
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', reviewsEnabled: true },
    });
    requireClientSalonFromQuery.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', reviewsEnabled: true },
    });
    getAppointmentById.mockResolvedValue({
      id: 'appt_1',
      salonId: 'salon_1',
      clientPhone: '+11111111111',
      clientName: 'Ava',
      status: 'completed',
      technicianId: 'tech_1',
    });
    getSalonClientByPhone.mockResolvedValue({
      id: 'salon_client_1',
      fullName: 'Ava',
    });
    setSelectPlan([[]]);
    setInsertPlan({
      type: 'resolve',
      value: [{
        id: 'review_1',
        rating: 5,
        comment: null,
        createdAt: new Date('2026-03-29T12:00:00.000Z'),
      }],
    });
    setUpdatePlan({
      type: 'resolve',
      value: [{ id: 'tech_1' }],
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

  it('creates the review and updates the technician aggregate inside the same transaction', async () => {
    const response = await POST(
      new Request('http://localhost/api/client/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: 'appt_1',
          salonSlug: 'salon-a',
          rating: 5,
          comment: 'Loved it',
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txInsertValuesSpy).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonClientId: 'salon_client_1',
      technicianId: 'tech_1',
      rating: 5,
      comment: 'Loved it',
    }));
    expect(txUpdateSetSpy).toHaveBeenCalledWith(expect.objectContaining({
      reviewCount: expect.anything(),
      rating: expect.anything(),
      updatedAt: expect.any(Date),
    }));
    expect(logReviewCreated).toHaveBeenCalledWith(
      'salon_1',
      expect.stringMatching(/^review_/),
      'appt_1',
      5,
      'salon_client_1',
      '127.0.0.1',
    );
    expect(body.success).toBe(true);
  });

  it('returns a conflict before inserting when the appointment already has a review', async () => {
    setSelectPlan([[{ id: 'review_existing' }]]);

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

    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('ALREADY_REVIEWED');
    expect(txInsertValuesSpy).not.toHaveBeenCalled();
    expect(txUpdateSetSpy).not.toHaveBeenCalled();
  });

  it('returns a conflict on duplicate review races without incrementing the technician aggregate twice', async () => {
    setInsertPlan({
      type: 'reject',
      error: new Error('duplicate key value violates unique constraint'),
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

    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('ALREADY_REVIEWED');
    expect(txUpdateSetSpy).not.toHaveBeenCalled();
    expect(logReviewCreated).not.toHaveBeenCalled();
  });

  it('does not update the technician aggregate when the review insert fails', async () => {
    setInsertPlan({
      type: 'reject',
      error: new Error('insert failed'),
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

    expect(response.status).toBe(500);
    expect(txInsertValuesSpy).toHaveBeenCalledTimes(1);
    expect(txUpdateSetSpy).not.toHaveBeenCalled();
    expect(logReviewCreated).not.toHaveBeenCalled();
  });

  it('rolls the request back when the technician aggregate update fails after the review insert', async () => {
    setUpdatePlan({
      type: 'resolve',
      value: [],
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

    expect(response.status).toBe(500);
    expect(txInsertValuesSpy).toHaveBeenCalledTimes(1);
    expect(txUpdateSetSpy).toHaveBeenCalledTimes(1);
    expect(logReviewCreated).not.toHaveBeenCalled();
  });
});
