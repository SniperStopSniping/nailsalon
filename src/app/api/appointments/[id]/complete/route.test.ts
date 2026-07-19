import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH, POST } from './route';

const {
  requireAppointmentManagerAccess,
  getSalonPolicy,
  getSuperAdminPolicy,
  getSalonById,
  db,
} = vi.hoisted(() => {
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    requireAppointmentManagerAccess: vi.fn(),
    getSalonPolicy: vi.fn(),
    getSuperAdminPolicy: vi.fn(),
    getSalonById: vi.fn(),
    db: {
      select,
      transaction: vi.fn(),
    },
  };
});

vi.mock('server-only', () => ({}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  getAppointmentById: vi.fn(),
  getOrCreateSalonClient: vi.fn(),
  getSalonById,
  updateSalonClientStats: vi.fn(),
}));

vi.mock('@/libs/fraudDetection', () => ({
  evaluateAndFlagIfNeeded: vi.fn(),
}));

vi.mock('@/libs/pointsCalculation', () => ({
  computeEarnedPointsFromCents: vi.fn(() => 0),
}));

vi.mock('@/core/appointments/policyRepo', () => ({
  getSalonPolicy,
  getSuperAdminPolicy,
}));

const STAFF_ACCESS = {
  ok: true,
  actorRole: 'staff',
  session: {
    technicianId: 'tech_1',
    technicianName: 'Taylor',
    salonId: 'salon_1',
    salonSlug: 'salon-a',
    phone: '+15551234567',
  },
  appointment: {
    id: 'appt_1',
    salonId: 'salon_1',
    status: 'confirmed',
    clientPhone: '+15551234567',
    totalPrice: 4500,
  },
};

describe('PATCH /api/appointments/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default photo policy: off (today's soft gate).
    getSalonPolicy.mockResolvedValue({
      salonId: 'salon_1',
      requireBeforePhotoToStart: 'off',
      requireAfterPhotoToFinish: 'off',
      requireAfterPhotoToPay: 'off',
      isDefault: true,
    });
    getSuperAdminPolicy.mockResolvedValue({
      id: 'singleton',
      requireBeforePhotoToStart: null,
      requireAfterPhotoToFinish: null,
      requireAfterPhotoToPay: null,
      isDefault: true,
    });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      settings: null, // tax off by default — never inferred
    });
  });

  it('rejects unauthenticated start attempts', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'POST',
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated completion attempts', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'PATCH',
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(401);
  });

  it('rejects wrong-tenant completion attempts', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'PATCH',
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(403);
  });

  it('allows authorized staff through to business validation (soft photo gate preserved)', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'PHOTOS_REQUIRED',
        message: 'At least one "after" photo must be uploaded before completing the appointment. Upload photos via POST /api/appointments/[id]/photos',
        details: { policy: 'optional' },
      },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('hard-blocks completion without an after photo when the policy requires one, even with skipPhotoValidation', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);
    getSalonPolicy.mockResolvedValue({
      salonId: 'salon_1',
      requireBeforePhotoToStart: 'off',
      requireAfterPhotoToFinish: 'required',
      requireAfterPhotoToPay: 'off',
      isDefault: false,
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipPhotoValidation: true }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('PHOTOS_REQUIRED');
    expect(body.error.details).toEqual({ policy: 'required' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('blocks staff from admin-only checkout fields (tax exempt, complimentary)', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);

    for (const payload of [
      { taxExempt: true },
      { paymentStatusIntent: 'comp' },
    ]) {
      const response = await PATCH(
        new Request('http://localhost/api/appointments/appt_1/complete', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        { params: { id: 'appt_1' } },
      );

      expect(response.status).toBe(403);
      expect(db.transaction).not.toHaveBeenCalled();
    }
  });

  it('rejects an actual finish before the actual start', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualStartAt: '2026-07-18T15:00:00Z',
          actualEndAt: '2026-07-18T14:00:00Z',
        }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_ACTUAL_TIMES');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a complimentary completion that also records payments', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ...STAFF_ACCESS,
      actorRole: 'admin',
      admin: { id: 'admin_1', name: 'Olive Owner' },
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentStatusIntent: 'comp',
          payments: [{ amountCents: 1000, method: 'cash' }],
        }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('COMP_WITH_PAYMENTS');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
