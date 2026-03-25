import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAppointmentManagerAccess,
  db,
} = vi.hoisted(() => {
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    requireAppointmentManagerAccess: vi.fn(),
    db: {
      select,
      transaction: vi.fn(),
    },
  };
});

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  getAppointmentById: vi.fn(),
  getOrCreateSalonClient: vi.fn(),
  updateSalonClientStats: vi.fn(),
}));

vi.mock('@/libs/fraudDetection', () => ({
  evaluateAndFlagIfNeeded: vi.fn(),
}));

vi.mock('@/libs/pointsCalculation', () => ({
  computeEarnedPointsFromCents: vi.fn(() => 0),
}));

import { PATCH } from './route';

describe('PATCH /api/appointments/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('allows authorized staff through to business validation', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
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
      },
    });

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
      },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
