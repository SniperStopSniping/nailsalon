import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAppointmentManagerAccess,
  updateWhere,
  updateSet,
  db,
  updateSalonClientStats,
} = vi.hoisted(() => {
  const limit = vi.fn(async () => []);
  const whereSelect = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    requireAppointmentManagerAccess: vi.fn(),
    updateWhere,
    updateSet,
    db: {
      select,
      update,
    },
    updateSalonClientStats: vi.fn(),
  };
});

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  updateSalonClientStats,
}));

import { PATCH } from './route';

describe('PATCH /api/appointments/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects wrong-role access', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/cancel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: 'client_request' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(403);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it('rejects wrong-tenant access', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/cancel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: 'no_show' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(403);
  });

  it('allows the assigned technician to cancel the appointment', async () => {
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
        notes: null,
        clientPhone: '+15551234567',
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/cancel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: 'client_request' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalled();
    expect(body).toEqual({
      data: {
        appointment: {
          id: 'appt_1',
          status: 'cancelled',
          cancelReason: 'client_request',
          cancelledAt: expect.any(String),
        },
      },
    });
    expect(updateSalonClientStats).not.toHaveBeenCalled();
  });
});
