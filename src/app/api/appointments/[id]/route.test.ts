/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAppointmentAccess,
  updateAppointmentStatus,
  getSalonById,
  getAppointmentServiceNames,
  getTechnicianById,
  sendCancellationConfirmation,
  sendBookingNotificationsForAppointmentCancelled,
  sendSalonNotificationEmail,
  deleteGoogleCalendarEventForAppointment,
  enqueueGoogleCalendarDelete,
  lockOperationalSalonClientContactWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  withClientLifecycleTransactionRetry,
  transitionReturning,
  transaction,
  mockDbState,
  updateSet,
  db,
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
    transitionWins: 0,
    concurrentBarrier: false,
    transitionAttempts: 0,
    releaseBarrier: null as (() => void) | null,
    barrier: null as Promise<void> | null,
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
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    return { from };
  });
  const transitionReturning = vi.fn(async () => {
    mockDbState.transitionAttempts += 1;
    if (mockDbState.concurrentBarrier && mockDbState.barrier) {
      if (mockDbState.transitionAttempts === 2) {
        mockDbState.releaseBarrier?.();
      }
      await mockDbState.barrier;
    }
    if (mockDbState.transitionApplied) {
      return [];
    }
    mockDbState.transitionApplied = true;
    mockDbState.transitionWins += 1;
    const updatedAt = new Date('2026-07-17T16:00:00.000Z');
    mockDbState.currentAppointmentRows = [{
      status: 'cancelled',
      cancelReason: 'client_request',
      updatedAt,
    }];
    return [{
      id: 'appt_1',
      status: 'cancelled',
      cancelReason: 'client_request',
      updatedAt,
    }];
  });
  const updateWhere = vi.fn((_condition: unknown) => ({
    returning: transitionReturning,
  }));
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({
    where: updateWhere,
  }));
  const update = vi.fn(() => ({ set: updateSet }));
  const transaction = vi.fn(async (
    callback: (tx: {
      select: typeof select;
      update: typeof update;
    }) => Promise<unknown>,
  ) => callback({ select, update }));

  return {
    requireAppointmentAccess: vi.fn(),
    updateAppointmentStatus: vi.fn(),
    getSalonById: vi.fn(),
    getAppointmentServiceNames: vi.fn(),
    getTechnicianById: vi.fn(),
    sendCancellationConfirmation: vi.fn(),
    sendBookingNotificationsForAppointmentCancelled: vi.fn(),
    sendSalonNotificationEmail: vi.fn(async () => ({ status: 'sent', deliveryId: 'delivery_1' })),
    deleteGoogleCalendarEventForAppointment: vi.fn(),
    enqueueGoogleCalendarDelete: vi.fn(),
    lockOperationalSalonClientContactWithHandle: vi.fn(),
    resolveOperationalSalonClientByPhoneWithHandle: vi.fn(),
    withClientLifecycleTransactionRetry: vi.fn(async (
      operation: (attempt: number) => Promise<unknown>,
    ) => operation(1)),
    transitionReturning,
    transaction,
    mockDbState,
    updateSet,
    db: {
      select,
      update,
      transaction,
    },
  };
});

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

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  lockOperationalSalonClientContactWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  withClientLifecycleTransactionRetry,
}));

vi.mock('@/libs/SMS', () => ({
  sendCancellationConfirmation,
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForAppointmentCancelled,
}));

vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment,
}));

vi.mock('@/libs/integrationOutbox', () => ({ enqueueGoogleCalendarDelete }));

vi.mock('@/libs/salonNotificationEmail', () => ({ sendSalonNotificationEmail }));

import { GET, PATCH } from './route';

describe('appointment detail route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppointmentServiceNames.mockResolvedValue(['BIAB Fill']);
    getSalonById.mockResolvedValue(null);
    getTechnicianById.mockResolvedValue(null);
    sendCancellationConfirmation.mockResolvedValue(undefined);
    sendBookingNotificationsForAppointmentCancelled.mockResolvedValue(undefined);
    sendSalonNotificationEmail.mockResolvedValue({
      status: 'sent',
      deliveryId: 'delivery_1',
    });
    deleteGoogleCalendarEventForAppointment.mockResolvedValue({ status: 'disabled' });
    enqueueGoogleCalendarDelete.mockResolvedValue(undefined);
    mockDbState.currentAppointmentRows = [{
      status: 'cancelled',
      cancelReason: 'client_request',
      updatedAt: new Date('2026-07-17T16:00:00.000Z'),
    }];
    mockDbState.rewardRows = [];
    mockDbState.transitionApplied = false;
    mockDbState.transitionWins = 0;
    mockDbState.concurrentBarrier = false;
    mockDbState.transitionAttempts = 0;
    mockDbState.releaseBarrier = null;
    mockDbState.barrier = null;
    resolveOperationalSalonClientByPhoneWithHandle.mockResolvedValue(null);
    lockOperationalSalonClientContactWithHandle.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: null,
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
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
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(body.data.appointment).toMatchObject({
      id: 'appt_1',
      status: 'cancelled',
      cancelReason: 'client_request',
    });
    expect(body.meta.timestamp).toEqual(expect.any(String));
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

  it('resolves a merged source before refunding points and sending cancellation SMS', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: 'merged_source',
        technicianId: null,
        status: 'confirmed',
        clientPhone: '4165550100',
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        notes: '[Points redeemed: 100 pts]',
        googleCalendarEventId: null,
      },
    });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      name: 'Salon A',
      ownerName: 'Owner',
      ownerPhone: null,
      ownerEmail: null,
      features: null,
      settings: null,
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancelReason: 'client_request',
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    expect(lockOperationalSalonClientContactWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'merged_source',
        allowArchived: true,
      },
    );
    expect(sendCancellationConfirmation).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      loyaltyPoints: expect.anything(),
    }));
  });

  it('rejects cancellation from a terminal appointment state without dependent mutations', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: 'client_1',
        technicianId: null,
        status: 'completed',
        cancelReason: null,
        clientPhone: '4165550100',
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        notes: '[Points redeemed: 100 pts]',
        googleCalendarEventId: null,
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancelReason: 'client_request',
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(409);
    expect(transaction).not.toHaveBeenCalled();
    expect(lockOperationalSalonClientContactWithHandle).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarDelete).not.toHaveBeenCalled();
    expect(sendCancellationConfirmation).not.toHaveBeenCalled();
  });

  it('resolves and locks a legacy phone client before the appointment CAS', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: null,
        technicianId: null,
        status: 'confirmed',
        cancelReason: null,
        clientPhone: '4165550100',
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        notes: '[Points redeemed: 100 pts]',
        googleCalendarEventId: null,
      },
    });
    resolveOperationalSalonClientByPhoneWithHandle.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: null,
      lineagePath: ['primary_client'],
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancelReason: 'client_request',
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    expect(resolveOperationalSalonClientByPhoneWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        phone: '4165550100',
        allowArchived: true,
      },
    );
    expect(lockOperationalSalonClientContactWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'primary_client',
        allowArchived: true,
      },
    );
    expect(
      resolveOperationalSalonClientByPhoneWithHandle.mock.invocationCallOrder[0],
    ).toBeLessThan(
      lockOperationalSalonClientContactWithHandle.mock.invocationCallOrder[0]!,
    );
    expect(
      lockOperationalSalonClientContactWithHandle.mock.invocationCallOrder[0],
    ).toBeLessThan(transitionReturning.mock.invocationCallOrder[0]!);
  });

  it('applies concurrent cancellation once without rewriting historical snapshots', async () => {
    const historicalAppointment = Object.freeze({
      id: 'appt_1',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'confirmed',
      cancelReason: null,
      clientPhone: '4165550100',
      clientEmail: 'historical@example.test',
      clientName: 'Ava',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      notes: '[Points redeemed: 100 pts]',
      googleCalendarEventId: 'calendar_event_1',
    });
    const historicalSnapshot = {
      clientPhone: historicalAppointment.clientPhone,
      clientEmail: historicalAppointment.clientEmail,
      clientName: historicalAppointment.clientName,
      notes: historicalAppointment.notes,
      startTime: historicalAppointment.startTime.toISOString(),
    };
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: historicalAppointment,
    });
    mockDbState.rewardRows = [{ id: 'reward_1', status: 'pending' }];
    mockDbState.concurrentBarrier = true;
    mockDbState.barrier = new Promise<void>((resolve) => {
      mockDbState.releaseBarrier = resolve;
    });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      name: 'Salon A',
      ownerName: 'Owner',
      ownerPhone: '4165550101',
      ownerEmail: 'owner@example.test',
      features: null,
      settings: null,
    });
    getTechnicianById.mockResolvedValue({
      id: 'tech_1',
      name: 'Taylor',
      phone: '4165550102',
      email: 'taylor@example.test',
    });

    const cancel = () => PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancelReason: 'client_request',
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    const [firstResponse, secondResponse] = await Promise.all([
      cancel(),
      cancel(),
    ]);
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
    expect(mockDbState.transitionWins).toBe(1);

    const loyaltyRefunds = updateSet.mock.calls.filter(([values]) => (
      values && typeof values === 'object' && 'loyaltyPoints' in values
    ));
    const rewardRestores = updateSet.mock.calls.filter(([values]) => (
      values
      && typeof values === 'object'
      && values.usedInAppointmentId === null
      && values.status === 'active'
    ));
    const snapshotWrites = updateSet.mock.calls.filter(([values]) => (
      values
      && typeof values === 'object'
      && (
        'clientPhone' in values
        || 'clientEmail' in values
        || 'destinationSnapshot' in values
      )
    ));

    expect(loyaltyRefunds).toHaveLength(1);
    expect(rewardRestores).toHaveLength(1);
    expect(snapshotWrites).toHaveLength(0);
    expect(lockOperationalSalonClientContactWithHandle).toHaveBeenCalledTimes(2);
    expect(sendCancellationConfirmation).toHaveBeenCalledTimes(1);
    expect(sendCancellationConfirmation).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
    expect(sendBookingNotificationsForAppointmentCancelled).toHaveBeenCalledTimes(1);
    expect(sendBookingNotificationsForAppointmentCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ clientPhone: '4165550100' }),
    );
    expect(sendSalonNotificationEmail).toHaveBeenCalledTimes(1);
    expect(enqueueGoogleCalendarDelete).toHaveBeenCalledTimes(1);
    expect(withClientLifecycleTransactionRetry).toHaveBeenCalledTimes(2);
    expect({
      clientPhone: historicalAppointment.clientPhone,
      clientEmail: historicalAppointment.clientEmail,
      clientName: historicalAppointment.clientName,
      notes: historicalAppointment.notes,
      startTime: historicalAppointment.startTime.toISOString(),
    }).toEqual(historicalSnapshot);
  });

  it('keeps the committed cancellation successful when post-commit delivery fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: 'client_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        cancelReason: null,
        clientPhone: '4165550100',
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        notes: null,
        googleCalendarEventId: 'calendar_event_1',
      },
    });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      name: 'Salon A',
      ownerName: 'Owner',
      ownerPhone: null,
      ownerEmail: null,
      features: null,
      settings: null,
    });
    enqueueGoogleCalendarDelete.mockRejectedValueOnce(new Error('outbox unavailable'));
    sendCancellationConfirmation.mockRejectedValueOnce(new Error('sms unavailable'));
    sendBookingNotificationsForAppointmentCancelled.mockRejectedValueOnce(
      new Error('booking notification unavailable'),
    );
    sendSalonNotificationEmail.mockRejectedValueOnce(new Error('email unavailable'));

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancelReason: 'client_request',
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    expect(mockDbState.transitionWins).toBe(1);
    expect(enqueueGoogleCalendarDelete).toHaveBeenCalledTimes(1);
    expect(sendCancellationConfirmation).toHaveBeenCalledTimes(1);
    expect(sendBookingNotificationsForAppointmentCancelled).toHaveBeenCalledTimes(1);
    expect(sendSalonNotificationEmail).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });
});
