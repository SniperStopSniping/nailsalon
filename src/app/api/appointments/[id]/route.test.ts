import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAppointmentAccess,
  updateAppointmentStatus,
  getSalonById,
  getAppointmentServiceNames,
  getTechnicianById,
  sendBookingNotificationsForAppointmentCancelled,
  db,
} = vi.hoisted(() => ({
  requireAppointmentAccess: vi.fn(),
  updateAppointmentStatus: vi.fn(),
  getSalonById: vi.fn(),
  getAppointmentServiceNames: vi.fn(),
  getTechnicianById: vi.fn(),
  sendBookingNotificationsForAppointmentCancelled: vi.fn(),
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          then: (resolve: (value: unknown) => void) => resolve([]),
        })),
      })),
    })),
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess,
}));

vi.mock('@/libs/queries', () => ({
  updateAppointmentStatus,
  getSalonById,
  getAppointmentServiceNames,
  getTechnicianById,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/SMS', () => ({
  sendCancellationConfirmation: vi.fn(),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForAppointmentCancelled,
}));

import { GET, PATCH } from './route';

describe('appointment detail route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppointmentServiceNames.mockResolvedValue(['BIAB Fill']);
  });

  it('rejects unauthenticated appointment updates', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancelReason: 'client_request' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(401);
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
  });

  it('allows the owning client to cancel their own appointment', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'client',
      clientSession: {
        phone: '+15551234567',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: null,
        status: 'pending',
        clientPhone: '+15551234567',
        notes: null,
      },
    });
    updateAppointmentStatus.mockResolvedValue({
      id: 'appt_1',
      status: 'cancelled',
      cancelReason: 'client_request',
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancelReason: 'client_request' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateAppointmentStatus).toHaveBeenCalledWith(
      'appt_1',
      'salon_1',
      'cancelled',
      'client_request',
    );
    expect(body).toEqual({
      data: {
        appointment: {
          id: 'appt_1',
          status: 'cancelled',
          cancelReason: 'client_request',
        },
      },
      meta: {
        timestamp: expect.any(String),
      },
    });
  });

  it('rejects client attempts to set arbitrary statuses', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'client',
      clientSession: {
        phone: '+15551234567',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: null,
        status: 'pending',
        clientPhone: '+15551234567',
        notes: null,
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Clients can only cancel their own appointments',
      },
    });
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant appointment reads', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/appointments/appt_1'),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(403);
  });

  it('sends cancellation notifications with the assigned technician contact when cancelled', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'client',
      clientSession: {
        phone: '+15551234567',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        clientPhone: '+15551234567',
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        notes: null,
      },
    });
    updateAppointmentStatus.mockResolvedValue({
      id: 'appt_1',
      status: 'cancelled',
      cancelReason: 'client_request',
    });
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

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancelReason: 'client_request' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
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
