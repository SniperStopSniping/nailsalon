import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAppointmentManagerAccess,
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  sendBookingNotificationsForAppointmentCancelled,
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
    getAppointmentServiceNames: vi.fn(),
    getSalonById: vi.fn(),
    getTechnicianById: vi.fn(),
    sendBookingNotificationsForAppointmentCancelled: vi.fn(),
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
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  updateSalonClientStats,
}));

vi.mock('@/libs/SMS', () => ({
  sendCancellationConfirmation: vi.fn(),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForAppointmentCancelled,
}));

import { PATCH } from './route';

describe('PATCH /api/appointments/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppointmentServiceNames.mockResolvedValue(['BIAB Fill']);
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      name: 'Salon A',
      ownerName: 'Owner',
      ownerPhone: '4169021427',
      ownerEmail: 'owner@example.com',
      features: { marketing: { smsReminders: true } },
      settings: { modules: { smsReminders: true } },
    });
    getTechnicianById.mockResolvedValue({
      id: 'tech_1',
      name: 'Taylor',
      phone: '4169021427',
      email: 'taylor@example.com',
    });
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
        technicianId: 'tech_1',
        status: 'confirmed',
        notes: null,
        clientName: 'Ava',
        clientPhone: '+15551234567',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
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
    expect(sendBookingNotificationsForAppointmentCancelled).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      technician: expect.objectContaining({
        id: 'tech_1',
        phone: '4169021427',
      }),
      services: ['BIAB Fill'],
      cancelReason: 'client_request',
    }));
  });
});
