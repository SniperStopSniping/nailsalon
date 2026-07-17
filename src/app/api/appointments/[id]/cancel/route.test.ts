/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAppointmentManagerAccess,
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  sendBookingNotificationsForAppointmentCancelled,
  deleteGoogleCalendarEventForAppointment,
  enqueueGoogleCalendarDelete,
  updateWhere,
  updateSet,
  transitionReturning,
  transaction,
  mockDbState,
  db,
  updateSalonClientStats,
} = vi.hoisted(() => {
  const mockDbState = {
    currentAppointmentRows: [] as Array<{
      status: string;
      cancelReason: string | null;
      updatedAt: Date;
    }>,
    rewardRows: [] as Array<{
      id: string;
      status: string;
    }>,
    transitionApplied: false,
  };
  const select = vi.fn((projection?: Record<string, unknown>) => {
    const readsCurrentAppointment = Boolean(
      projection
      && 'status' in projection
      && 'cancelReason' in projection
      && 'updatedAt' in projection,
    );
    const limit = vi.fn(async () => (
      readsCurrentAppointment
        ? mockDbState.currentAppointmentRows
        : mockDbState.rewardRows
    ));
    const whereSelect = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: whereSelect }));
    return { from };
  });
  const transitionReturning = vi.fn(async () => {
    if (mockDbState.transitionApplied) {
      return [];
    }
    mockDbState.transitionApplied = true;
    return [{ updatedAt: new Date('2026-07-17T16:00:00.000Z') }];
  });
  const updateWhere = vi.fn((_condition: unknown) => ({ returning: transitionReturning }));
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
  const update = vi.fn((_table: unknown) => ({ set: updateSet }));
  const transaction = vi.fn(async (callback: (tx: { select: typeof select; update: typeof update }) => unknown) => (
    callback({ select, update })
  ));

  return {
    requireAppointmentManagerAccess: vi.fn(),
    getAppointmentServiceNames: vi.fn(),
    getSalonById: vi.fn(),
    getTechnicianById: vi.fn(),
    sendBookingNotificationsForAppointmentCancelled: vi.fn(),
    deleteGoogleCalendarEventForAppointment: vi.fn(),
    enqueueGoogleCalendarDelete: vi.fn(),
    updateWhere,
    updateSet,
    transitionReturning,
    transaction,
    mockDbState,
    db: {
      select,
      update,
      transaction,
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

vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment,
}));

vi.mock('@/libs/integrationOutbox', () => ({ enqueueGoogleCalendarDelete }));

import { sendCancellationConfirmation } from '@/libs/SMS';

import { PATCH } from './route';

describe('PATCH /api/appointments/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.currentAppointmentRows = [{
      status: 'cancelled',
      cancelReason: 'client_request',
      updatedAt: new Date('2026-07-17T16:00:00.000Z'),
    }];
    mockDbState.rewardRows = [];
    mockDbState.transitionApplied = false;
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
    deleteGoogleCalendarEventForAppointment.mockResolvedValue({ status: 'disabled' });
    enqueueGoogleCalendarDelete.mockResolvedValue(undefined);
    updateSalonClientStats.mockResolvedValue(undefined);
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

  it('stores a no-show under the no_show status, keeps canvas state in sync, and skips the client cancellation message', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        notes: null,
        clientName: 'Ava',
        clientPhone: '+15551234567',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        googleCalendarEventId: 'gevent_1',
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1/cancel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: 'no_show' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'no_show',
      canvasState: 'no_show',
      cancelReason: 'no_show',
    }));
    expect(body.data.appointment.status).toBe('no_show');
    // A client who missed their appointment must not receive a
    // "your appointment was cancelled" confirmation.
    expect(vi.mocked(sendCancellationConfirmation)).not.toHaveBeenCalled();
    expect(sendBookingNotificationsForAppointmentCancelled).not.toHaveBeenCalled();
    expect(updateSalonClientStats).toHaveBeenCalledWith('salon_1', '+15551234567');
    expect(enqueueGoogleCalendarDelete).toHaveBeenCalled();
  });

  it('marks the legacy status cancelled together with the canvas state for normal cancellations', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        notes: null,
        clientName: 'Ava',
        clientPhone: '+15551234567',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        googleCalendarEventId: null,
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

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      canvasState: 'cancelled',
    }));
    expect(vi.mocked(sendCancellationConfirmation)).toHaveBeenCalled();
  });

  it('applies a concurrent double-cancel once and refunds loyalty points only once', async () => {
    const appointment = {
      id: 'appt_1',
      salonId: 'salon_1',
      salonClientId: 'client_1',
      technicianId: 'tech_1',
      status: 'confirmed',
      cancelReason: null,
      notes: '[Points redeemed: 1,000 pts]',
      clientName: 'Ava',
      clientPhone: '+15551234567',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      googleCalendarEventId: 'gevent_1',
      updatedAt: new Date('2026-07-17T15:00:00.000Z'),
    };
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment,
    });
    mockDbState.rewardRows = [{ id: 'reward_1', status: 'pending' }];

    const cancel = () => PATCH(
      new Request('http://localhost/api/appointments/appt_1/cancel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: 'client_request' }),
      }),
      { params: { id: 'appt_1' } },
    );

    const [firstResponse, secondResponse] = await Promise.all([cancel(), cancel()]);
    const [firstBody, secondBody] = await Promise.all([
      firstResponse.json(),
      secondResponse.json(),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.data.appointment.status).toBe('cancelled');
    expect(secondBody.data.appointment.status).toBe('cancelled');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transitionReturning).toHaveBeenCalledTimes(2);

    const loyaltyRefunds = updateSet.mock.calls.filter(([values]) => (
      values && typeof values === 'object' && 'loyaltyPoints' in values
    ));
    const rewardRestores = updateSet.mock.calls.filter(([values]) => (
      values
      && typeof values === 'object'
      && 'usedInAppointmentId' in values
      && 'status' in values
      && values.usedInAppointmentId === null
      && values.status === 'active'
    ));

    expect(loyaltyRefunds).toHaveLength(1);
    expect(rewardRestores).toHaveLength(1);
    expect(vi.mocked(sendCancellationConfirmation)).toHaveBeenCalledTimes(1);
    expect(sendBookingNotificationsForAppointmentCancelled).toHaveBeenCalledTimes(1);
  });

  it('returns success after commit when calendar or notification delivery fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: 'client_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        cancelReason: null,
        notes: null,
        clientName: 'Ava',
        clientPhone: '+15551234567',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        googleCalendarEventId: 'gevent_1',
        updatedAt: new Date('2026-07-17T15:00:00.000Z'),
      },
    });
    enqueueGoogleCalendarDelete.mockRejectedValueOnce(new Error('outbox unavailable'));
    vi.mocked(sendCancellationConfirmation).mockRejectedValueOnce(new Error('sms unavailable'));
    sendBookingNotificationsForAppointmentCancelled.mockRejectedValueOnce(new Error('email unavailable'));

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
    expect(body.data.appointment.status).toBe('cancelled');
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
