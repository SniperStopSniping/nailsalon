/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireAppointmentAccess,
  requireClientApiSession,
  requireClientSalonFromBody,
  guardModuleOr403,
  updateAppointmentStatus,
  getSalonById,
  getAppointmentServiceNames,
  getTechnicianById,
  sendCancellationConfirmation,
  sendBookingNotificationsForAppointmentCancelled,
  sendSalonNotificationEmail,
  deleteGoogleCalendarEventForAppointment,
  enqueueGoogleCalendarDelete,
  enqueueGoogleCalendarDeleteInTx,
  enqueueGoogleCalendarAppointmentMutation,
  lockOperationalSalonClientContactWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
  getActiveAppointmentsForCanonicalClientWithHandle,
  lockTechnicianAndAssertSlotFree,
  loadAppointmentDepositCreditRows,
  transactionExecute,
  transitionReturning,
  appointmentForUpdate,
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
    lockedAppointmentRows: [] as Array<{
      id: string;
      salonId: string;
      salonClientId: string | null;
      technicianId: string | null;
      clientPhone: string;
      clientEmail: string | null;
      status: string;
      cancelReason: string | null;
      notes: string | null;
      totalPrice: number;
      discountType: string | null;
      startTime: Date;
      endTime: Date;
      totalDurationMinutes: number;
      blockedDurationMinutes: number | null;
      bufferMinutes: number | null;
      invoiceCurrency: string | null;
      bookingTaxSnapshot: { currency: string } | null;
      rescheduleTaxSnapshot: { currency: string } | null;
      finalTaxSnapshot: { currency: string } | null;
      updatedAt: Date;
    }>,
    appointmentRows: [] as Array<{
      id: string;
      salonId: string;
      clientPhone: string;
      status: string;
      cancelReason: string | null;
      notes: string | null;
      totalPrice: number;
      discountType: string | null;
      invoiceCurrency: string | null;
      updatedAt: Date;
    }>,
    salonClientRows: [] as Array<{
      id: string;
      loyaltyPoints: number | null;
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
    lastUpdateValues: {} as Record<string, unknown>,
  };
  const appointmentForUpdate = vi.fn();
  const select = vi.fn((projection?: Record<string, unknown>) => {
    const readsCurrentAppointment = Boolean(
      projection
      && 'status' in projection
      && 'cancelReason' in projection
      && 'updatedAt' in projection,
    );
    const from = vi.fn((table: Record<string, unknown>) => {
      const readsAppointmentTable = 'startTime' in table;
      const readsSalonClientTable = 'loyaltyPoints' in table;
      const limit = vi.fn(async () => (
        readsCurrentAppointment
          ? mockDbState.currentAppointmentRows
          : readsAppointmentTable
            ? mockDbState.appointmentRows
            : readsSalonClientTable
              ? mockDbState.salonClientRows
              : mockDbState.rewardRows
      ));
      const lockedLimit = vi.fn(async () => (
        readsAppointmentTable
          ? mockDbState.lockedAppointmentRows
          : limit()
      ));
      const forLock = vi.fn(() => {
        appointmentForUpdate();
        return { limit: lockedLimit };
      });
      const where = vi.fn(() => ({ for: forLock, limit }));
      return { where };
    });
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
    const requestedStatus = typeof mockDbState.lastUpdateValues.status === 'string'
      ? mockDbState.lastUpdateValues.status
      : 'cancelled';
    const requestedCancelReason
      = mockDbState.lastUpdateValues.cancelReason === undefined
        ? 'client_request'
        : mockDbState.lastUpdateValues.cancelReason as string | null;
    mockDbState.currentAppointmentRows = [{
      status: requestedStatus,
      cancelReason: requestedCancelReason,
      updatedAt,
    }];
    mockDbState.appointmentRows = mockDbState.appointmentRows.map(row => ({
      ...row,
      status: requestedStatus,
      cancelReason: requestedCancelReason,
      updatedAt,
    }));
    mockDbState.lockedAppointmentRows = mockDbState.lockedAppointmentRows.map(
      row => ({
        ...row,
        status: requestedStatus,
        cancelReason: requestedCancelReason,
        updatedAt,
      }),
    );
    return [{
      id: 'appt_1',
      ...mockDbState.lockedAppointmentRows[0],
      status: requestedStatus,
      cancelReason: requestedCancelReason,
      updatedAt,
    }];
  });
  const updateWhere = vi.fn((_condition: unknown) => ({
    returning: transitionReturning,
  }));
  const updateSet = vi.fn((values: Record<string, unknown>) => {
    mockDbState.lastUpdateValues = values;
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set: updateSet }));
  const transactionExecute = vi.fn(async () => ({ rows: [] }));
  const transaction = vi.fn(async (
    callback: (tx: {
      select: typeof select;
      update: typeof update;
      execute: typeof transactionExecute;
    }) => Promise<unknown>,
  ) => callback({ select, update, execute: transactionExecute }));

  return {
    requireAppointmentAccess: vi.fn(),
    requireClientApiSession: vi.fn(),
    requireClientSalonFromBody: vi.fn(),
    guardModuleOr403: vi.fn(),
    updateAppointmentStatus: vi.fn(),
    getSalonById: vi.fn(),
    getAppointmentServiceNames: vi.fn(),
    getTechnicianById: vi.fn(),
    sendCancellationConfirmation: vi.fn(),
    sendBookingNotificationsForAppointmentCancelled: vi.fn(),
    sendSalonNotificationEmail: vi.fn(async () => ({ status: 'sent', deliveryId: 'delivery_1' })),
    deleteGoogleCalendarEventForAppointment: vi.fn(),
    enqueueGoogleCalendarDelete: vi.fn(),
    enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
    enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
    lockOperationalSalonClientContactWithHandle: vi.fn(),
    resolveCanonicalSalonClientIdentityWithHandle: vi.fn(),
    resolveOperationalSalonClientByPhoneWithHandle: vi.fn(),
    resolveTerminalSalonClientWithHandle: vi.fn(),
    withClientLifecycleTransactionRetry: vi.fn(async (
      operation: (attempt: number) => Promise<unknown>,
    ) => operation(1)),
    getActiveAppointmentsForCanonicalClientWithHandle: vi.fn(),
    lockTechnicianAndAssertSlotFree: vi.fn(),
    loadAppointmentDepositCreditRows: vi.fn(),
    transactionExecute,
    transitionReturning,
    appointmentForUpdate,
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

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromBody,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
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

vi.mock('@/libs/depositCredit.server', () => ({
  loadAppointmentDepositCreditRows,
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError:
    class ClientLifecycleStabilizationError extends Error {},
  lockOperationalSalonClientContactWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
}));

vi.mock('@/libs/activeAppointments', () => ({
  ACTIVE_APPOINTMENT_STATUSES: ['pending', 'confirmed', 'in_progress'],
  getActiveAppointmentsForCanonicalClientWithHandle,
}));

vi.mock('@/libs/bookingConflictGuard', () => ({
  lockTechnicianAndAssertSlotFree,
  SlotConflictError: class SlotConflictError extends Error {},
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

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarDelete,
  enqueueGoogleCalendarDeleteInTx,
  enqueueGoogleCalendarAppointmentMutation,
}));

vi.mock('@/libs/salonNotificationEmail', () => ({ sendSalonNotificationEmail }));
import { buildForfeitureTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';

import { POST as redeemPointsPOST } from '../../rewards/redeem-points/route';
import { GET, PATCH } from './route';

function forfeitedDepositRow(overrides: Record<string, unknown> = {}) {
  const forfeitedAt = new Date('2099-03-13T16:05:00.000Z');
  return {
    id: 'dep_forfeited',
    status: 'paid',
    amountCents: 2500,
    currency: 'cad',
    stripePaymentIntentId: 'pi_forfeited',
    stripeRefundId: null,
    refundedAt: null,
    refundStatus: null,
    refundStatusChangedAt: null,
    refundAmountCents: null,
    refundRequestedAt: null,
    refundTrigger: null,
    refundLastErrorCode: null,
    refundFailureReason: null,
    externalRefundObservedCents: null,
    refundConflictFlag: false,
    refundTerminalFailureCount: 0,
    priorRefundIds: [],
    forfeitedAt,
    forfeitureTaxSnapshot: buildForfeitureTaxSnapshot({
      taxConfig: DISABLED_TAX_CONFIG,
      grossForfeitedCents: 2500,
      capturedAt: forfeitedAt,
      currency: 'CAD',
      estimateTaxIncluded: false,
    }),
    createdAt: new Date('2099-03-01T12:00:00.000Z'),
    ...overrides,
  };
}

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
    mockDbState.lockedAppointmentRows = [{
      id: 'appt_1',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      technicianId: null,
      clientPhone: '+14165551234',
      clientEmail: 'historical@example.test',
      status: 'confirmed',
      cancelReason: null,
      notes: null,
      totalPrice: 5000,
      discountType: null,
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:00:00.000Z'),
      totalDurationMinutes: 60,
      blockedDurationMinutes: 70,
      bufferMinutes: 10,
      invoiceCurrency: 'CAD',
      bookingTaxSnapshot: null,
      rescheduleTaxSnapshot: null,
      finalTaxSnapshot: null,
      updatedAt: new Date('2026-07-17T15:00:00.000Z'),
    }];
    mockDbState.appointmentRows = [{
      ...mockDbState.lockedAppointmentRows[0]!,
    }];
    mockDbState.salonClientRows = [{
      id: 'primary_client',
      loyaltyPoints: 5000,
    }];
    mockDbState.rewardRows = [];
    mockDbState.transitionApplied = false;
    mockDbState.transitionWins = 0;
    mockDbState.concurrentBarrier = false;
    mockDbState.transitionAttempts = 0;
    mockDbState.releaseBarrier = null;
    mockDbState.barrier = null;
    mockDbState.lastUpdateValues = {};
    transactionExecute.mockResolvedValue({ rows: [] });
    getActiveAppointmentsForCanonicalClientWithHandle.mockResolvedValue([]);
    lockTechnicianAndAssertSlotFree.mockResolvedValue(undefined);
    loadAppointmentDepositCreditRows.mockResolvedValue([]);
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue(null);
    resolveOperationalSalonClientByPhoneWithHandle.mockResolvedValue(null);
    resolveTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
    lockOperationalSalonClientContactWithHandle.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: null,
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165551234',
      session: { phone: '+14165551234' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        rewardsEnabled: true,
      },
    });
    guardModuleOr403.mockResolvedValue(null);
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

  it('rejects direct completion before status or reward writes', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'CHECKOUT_COMPLETION_REQUIRED',
        message: 'Use the appointment checkout to finalize the invoice and complete this appointment.',
      },
    });
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['admin', 'staff'] as const)(
    'rejects generic %s reactivation of a completed appointment before any write',
    async (actorRole) => {
      requireAppointmentAccess.mockResolvedValue({
        ok: true,
        actorRole,
        appointment: {
          id: 'appt_1',
          salonId: 'salon_1',
          salonClientId: 'primary_client',
          technicianId: actorRole === 'staff' ? 'tech_1' : null,
          status: 'completed',
          cancelReason: null,
          clientPhone: '4165550100',
          clientEmail: 'historical@example.test',
          clientName: 'Ava',
          startTime: new Date('2099-03-13T15:00:00.000Z'),
          endTime: new Date('2099-03-13T16:00:00.000Z'),
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

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'ADMIN_REOPEN_REQUIRED' },
      });
      expect(transaction).not.toHaveBeenCalled();
      expect(updateAppointmentStatus).not.toHaveBeenCalled();
      expect(updateSet).not.toHaveBeenCalled();
    },
  );

  it('reactivates a terminal appointment in canonical lock order with a CAS', async () => {
    const historicalAppointment = Object.freeze({
      id: 'appt_1',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'cancelled',
      cancelReason: 'client_request',
      clientPhone: '4165550100',
      clientEmail: 'historical@example.test',
      clientName: 'Ava',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:00:00.000Z'),
      notes: null,
    });
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: historicalAppointment,
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'cancelled',
      cancelReason: 'client_request',
    };
    mockDbState.appointmentRows = [{
      ...mockDbState.lockedAppointmentRows[0]!,
    }];

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.appointment).toMatchObject({
      id: 'appt_1',
      status: 'confirmed',
      cancelReason: null,
    });
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
    expect(resolveCanonicalSalonClientIdentityWithHandle).not.toHaveBeenCalled();
    expect(lockOperationalSalonClientContactWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'merged_source',
        allowArchived: true,
      },
    );
    expect(getActiveAppointmentsForCanonicalClientWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        terminalClientId: 'primary_client',
        horizon: 'lineage-active',
        excludeAppointmentId: 'appt_1',
        allowArchived: true,
      },
    );
    expect(lockTechnicianAndAssertSlotFree).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        salonId: 'salon_1',
        technicianId: 'tech_1',
        excludedAppointmentId: 'appt_1',
      }),
    );
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'confirmed',
      cancelReason: null,
      canvasState: 'waiting',
      completedAt: null,
    }));
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledTimes(1);
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        mutationVersion: expect.any(Date),
      }),
    );
    expect(
      lockOperationalSalonClientContactWithHandle.mock.invocationCallOrder[0],
    ).toBeLessThan(transactionExecute.mock.invocationCallOrder[0]!);
    expect(transactionExecute.mock.invocationCallOrder[0]).toBeLessThan(
      appointmentForUpdate.mock.invocationCallOrder[0]!,
    );
    expect(appointmentForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      getActiveAppointmentsForCanonicalClientWithHandle.mock.invocationCallOrder[0]!,
    );
    expect(
      getActiveAppointmentsForCanonicalClientWithHandle.mock.invocationCallOrder[0],
    ).toBeLessThan(
      lockTechnicianAndAssertSlotFree.mock.invocationCallOrder[0]!,
    );
    expect(
      lockTechnicianAndAssertSlotFree.mock.invocationCallOrder[0],
    ).toBeLessThan(transitionReturning.mock.invocationCallOrder[0]!);
  });

  it('blocks no-show reactivation while immutable deposit forfeiture evidence exists', async () => {
    const noShowAppointment = Object.freeze({
      id: 'appt_1',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'no_show',
      cancelReason: 'no_show',
      clientPhone: '4165550100',
      clientEmail: 'historical@example.test',
      clientName: 'Ava',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:00:00.000Z'),
      notes: null,
    });
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: noShowAppointment,
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'no_show',
      cancelReason: 'no_show',
    };
    mockDbState.appointmentRows = [{ ...mockDbState.lockedAppointmentRows[0]! }];
    loadAppointmentDepositCreditRows.mockResolvedValue([forfeitedDepositRow()]);

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('DEPOSIT_FORFEITURE_REACTIVATION_BLOCKED');
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('allows no-show reactivation after the retained deposit is fully refunded', async () => {
    const noShowAppointment = Object.freeze({
      id: 'appt_1',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'no_show',
      cancelReason: 'no_show',
      clientPhone: '4165550100',
      clientEmail: 'historical@example.test',
      clientName: 'Ava',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:00:00.000Z'),
      notes: null,
    });
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: noShowAppointment,
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'no_show',
      cancelReason: 'no_show',
    };
    mockDbState.appointmentRows = [{ ...mockDbState.lockedAppointmentRows[0]! }];
    const refundedAt = new Date('2099-03-14T12:00:00.000Z');
    loadAppointmentDepositCreditRows.mockResolvedValue([forfeitedDepositRow({
      status: 'refunded',
      stripeRefundId: 're_forfeited_full',
      refundedAt,
      refundStatus: 'succeeded',
      refundStatusChangedAt: refundedAt,
      refundAmountCents: 2500,
      refundRequestedAt: new Date('2099-03-14T11:59:00.000Z'),
      refundTrigger: 'owner',
    })]);

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'confirmed',
      cancelReason: null,
      canvasState: 'waiting',
      completedAt: null,
    }));
  });

  it('uses canonical current/source/alias resolution only for null stable ownership', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: null,
        technicianId: null,
        status: 'cancelled',
        cancelReason: 'client_request',
        clientPhone: '4165550100',
        clientEmail: 'old-alias@example.test',
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        endTime: new Date('2099-03-13T16:00:00.000Z'),
        notes: null,
      },
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: null,
      technicianId: null,
      status: 'cancelled',
      cancelReason: 'client_request',
    };
    mockDbState.appointmentRows = [{
      ...mockDbState.lockedAppointmentRows[0]!,
    }];
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue({
      terminal: {
        id: 'primary_client',
        salonId: 'salon_1',
        mergedIntoClientId: null,
        archivedAt: null,
      },
      clientIds: ['merged_source', 'primary_client'],
      phones: ['4165550100', '4165550198'],
      emails: ['old-alias@example.test'],
      externalClientId: null,
      matchedBy: [{ kind: 'email', value: 'old-alias@example.test' }],
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    expect(resolveCanonicalSalonClientIdentityWithHandle).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        salonId: 'salon_1',
        phone: '4165550100',
        email: 'old-alias@example.test',
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
  });

  it('rejects an active authorization snapshot that became terminal before locking', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: 'primary_client',
        technicianId: null,
        status: 'confirmed',
        cancelReason: null,
        clientPhone: '4165550198',
        clientEmail: null,
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        endTime: new Date('2099-03-13T16:00:00.000Z'),
        notes: null,
      },
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: 'primary_client',
      status: 'cancelled',
      cancelReason: 'client_request',
    };

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(409);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('rejects locked stable ownership that resolves to another terminal', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: 'merged_source',
        technicianId: null,
        status: 'cancelled',
        cancelReason: null,
        clientPhone: '4165550198',
        clientEmail: null,
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        endTime: new Date('2099-03-13T16:00:00.000Z'),
        notes: null,
      },
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: 'other_client',
      technicianId: null,
      status: 'cancelled',
      cancelReason: null,
    };
    resolveTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'other_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'other_client',
      lineagePath: ['other_client', 'other_primary'],
    });

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(409);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('rejects reactivation when another lineage appointment is active', async () => {
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        salonClientId: 'merged_source',
        technicianId: 'tech_1',
        status: 'cancelled',
        cancelReason: null,
        clientPhone: '4165550100',
        clientEmail: 'historical@example.test',
        clientName: 'Ava',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
        endTime: new Date('2099-03-13T16:00:00.000Z'),
        notes: null,
      },
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'cancelled',
    };
    getActiveAppointmentsForCanonicalClientWithHandle.mockResolvedValue([{
      id: 'appt_other',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      clientPhone: '4165550198',
      clientEmail: null,
      status: 'confirmed',
      startTime: new Date('2099-04-01T15:00:00.000Z'),
      endTime: new Date('2099-04-01T16:00:00.000Z'),
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('INVALID_STATE');
    expect(transitionReturning).not.toHaveBeenCalled();
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarDelete).not.toHaveBeenCalled();
    expect(sendCancellationConfirmation).not.toHaveBeenCalled();
  });

  it('allows exactly one of two concurrent generic reactivations to win', async () => {
    const historicalAppointment = Object.freeze({
      id: 'appt_1',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'cancelled',
      cancelReason: 'client_request',
      clientPhone: '4165550100',
      clientEmail: 'historical@example.test',
      clientName: 'Ava',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:00:00.000Z'),
      notes: null,
    });
    requireAppointmentAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: historicalAppointment,
    });
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      salonClientId: 'merged_source',
      technicianId: 'tech_1',
      status: 'cancelled',
    };
    mockDbState.appointmentRows = [{
      ...mockDbState.lockedAppointmentRows[0]!,
    }];
    mockDbState.concurrentBarrier = true;
    mockDbState.barrier = new Promise<void>((resolve) => {
      mockDbState.releaseBarrier = resolve;
    });

    const reactivate = () => PATCH(
      new Request('http://localhost/api/appointments/appt_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: { id: 'appt_1' } },
    );

    const responses = await Promise.all([reactivate(), reactivate()]);
    const statuses = responses.map(response => response.status).sort();

    expect(statuses).toEqual([200, 409]);
    expect(mockDbState.transitionWins).toBe(1);
    expect(transitionReturning).toHaveBeenCalledTimes(2);
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarDelete).not.toHaveBeenCalled();
    expect(sendCancellationConfirmation).not.toHaveBeenCalled();
    expect(sendBookingNotificationsForAppointmentCancelled).not.toHaveBeenCalled();
    expect(sendSalonNotificationEmail).not.toHaveBeenCalled();

    const snapshotWrites = updateSet.mock.calls.filter(([values]) => (
      values
      && typeof values === 'object'
      && (
        'clientPhone' in values
        || 'clientEmail' in values
        || 'salonClientId' in values
      )
    ));

    expect(snapshotWrites).toHaveLength(0);
    expect({
      clientPhone: historicalAppointment.clientPhone,
      clientEmail: historicalAppointment.clientEmail,
      clientName: historicalAppointment.clientName,
    }).toEqual({
      clientPhone: '4165550100',
      clientEmail: 'historical@example.test',
      clientName: 'Ava',
    });
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
    mockDbState.lockedAppointmentRows[0]!.notes = '[Points redeemed: 100 pts]';
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
    mockDbState.lockedAppointmentRows[0]!.notes = '[Points redeemed: 100 pts]';
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
    mockDbState.lockedAppointmentRows[0]!.notes = '[Points redeemed: 100 pts]';
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
    expect(enqueueGoogleCalendarDeleteInTx).toHaveBeenCalledTimes(1);
    expect(withClientLifecycleTransactionRetry).toHaveBeenCalledTimes(2);
    expect({
      clientPhone: historicalAppointment.clientPhone,
      clientEmail: historicalAppointment.clientEmail,
      clientName: historicalAppointment.clientName,
      notes: historicalAppointment.notes,
      startTime: historicalAppointment.startTime.toISOString(),
    }).toEqual(historicalSnapshot);
  });

  it('executes points redemption with terminal-client-first locking', async () => {
    mockDbState.salonClientRows = [{
      id: 'merged_source',
      loyaltyPoints: 5000,
    }];
    mockDbState.appointmentRows[0] = {
      ...mockDbState.appointmentRows[0]!,
      status: 'pending',
      notes: null,
      invoiceCurrency: null,
    };
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      status: 'confirmed',
      notes: 'Locked appointment note',
      invoiceCurrency: null,
    };

    const response = await redeemPointsPOST(new Request(
      'http://localhost/api/rewards/redeem-points',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardTitle: 'Service credit',
          rewardPoints: 2500,
          appointmentId: 'appt_1',
          salonSlug: 'salon-a',
        }),
      },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      appointmentId: 'appt_1',
      pointsSpent: 2500,
      newPointsBalance: 2500,
      newTotalPrice: 45,
    });
    expect(lockOperationalSalonClientContactWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'merged_source',
        allowArchived: true,
      },
    );
    expect(
      lockOperationalSalonClientContactWithHandle.mock.invocationCallOrder[0],
    ).toBeLessThan(appointmentForUpdate.mock.invocationCallOrder[0]!);
    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      totalPrice: 4500,
      notes: 'Locked appointment note\n[Points redeemed: Service credit - 2,500 pts for $5.00 off]',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      loyaltyPoints: expect.anything(),
    }));
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledTimes(1);
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        mutationVersion: expect.any(Date),
      }),
    );
    expect(withClientLifecycleTransactionRetry).toHaveBeenCalledTimes(1);
  });

  it('leaves points and appointment untouched when cancellation wins first', async () => {
    mockDbState.salonClientRows = [{
      id: 'merged_source',
      loyaltyPoints: 5000,
    }];
    mockDbState.appointmentRows[0] = {
      ...mockDbState.appointmentRows[0]!,
      status: 'pending',
    };
    mockDbState.lockedAppointmentRows[0] = {
      ...mockDbState.lockedAppointmentRows[0]!,
      status: 'cancelled',
      cancelReason: 'client_request',
    };

    const response = await redeemPointsPOST(new Request(
      'http://localhost/api/rewards/redeem-points',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardTitle: 'Service credit',
          rewardPoints: 2500,
          appointmentId: 'appt_1',
          salonSlug: 'salon-a',
        }),
      },
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_APPOINTMENT_STATUS');
    expect(lockOperationalSalonClientContactWithHandle).toHaveBeenCalledTimes(1);
    expect(appointmentForUpdate).toHaveBeenCalledTimes(1);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('rolls back cancellation when its atomic calendar intent fails', async () => {
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
        updatedAt: new Date('2026-07-17T15:00:00.000Z'),
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
    enqueueGoogleCalendarDeleteInTx.mockRejectedValueOnce(new Error('outbox unavailable'));
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

    expect(response.status).toBe(500);
    expect(enqueueGoogleCalendarDeleteInTx).toHaveBeenCalledTimes(1);
    expect(sendCancellationConfirmation).not.toHaveBeenCalled();
    expect(sendBookingNotificationsForAppointmentCancelled).not.toHaveBeenCalled();
    expect(sendSalonNotificationEmail).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
