/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forfeitAppointmentDepositInTx = vi.hoisted(() => vi.fn(async () => ({
  disposition: 'no_deposit',
  depositIds: [],
  forfeitedCents: 0,
})));

const {
  callOrder,
  requireStaffAppointmentAccess,
  logAppointmentChange,
  logAppointmentLocked,
  enqueueGoogleCalendarDelete,
  enqueueGoogleCalendarDeleteInTx,
  resolveTerminalSalonClientWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  lockOperationalSalonClientContactWithHandle,
  getActiveAppointmentsForCanonicalClientWithHandle,
  lockTechnicianAndAssertSlotFree,
  lockedAppointment,
  updateResult,
  capturedUpdates,
  tx,
  db,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const capturedUpdates: Array<Record<string, unknown>> = [];
  const requireStaffAppointmentAccess = vi.fn();
  const logAppointmentChange = vi.fn(async () => undefined);
  const logAppointmentLocked = vi.fn(async () => undefined);
  const enqueueGoogleCalendarDelete = vi.fn(async () => undefined);
  const enqueueGoogleCalendarDeleteInTx = vi.fn(async () => ({ inserted: true }));
  const resolveTerminalSalonClientWithHandle = vi.fn(async () => {
    callOrder.push('resolve');
    return {
      id: 'client_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'client_source',
      lineagePath: ['client_source', 'client_primary'],
    };
  });
  const resolveCanonicalSalonClientIdentityWithHandle = vi.fn();
  const lockOperationalSalonClientContactWithHandle = vi.fn(async () => {
    callOrder.push('client-lock');
    return {
      id: 'client_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'client_source',
      lineagePath: ['client_source', 'client_primary'],
      phone: '4165550100',
      email: 'current@example.com',
    };
  });
  const getActiveAppointmentsForCanonicalClientWithHandle = vi.fn(
    async (): Promise<Array<{ id: string }>> => {
      callOrder.push('active-check');
      return [];
    },
  );
  const lockTechnicianAndAssertSlotFree = vi.fn(async () => {
    callOrder.push('technician-lock');
  });
  const lockedAppointment = { current: null as Record<string, unknown> | null };
  const updateResult = { current: null as Record<string, unknown> | null };

  const tx = {
    execute: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          for: vi.fn(() => ({
            limit: vi.fn(async () => {
              callOrder.push('appointment-lock');
              return lockedAppointment.current ? [lockedAppointment.current] : [];
            }),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        capturedUpdates.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              callOrder.push('appointment-cas');
              return updateResult.current ? [updateResult.current] : [];
            }),
          })),
        };
      }),
    })),
  };
  const db = {
    query: {
      appointmentArtifactsSchema: { findFirst: vi.fn(async () => null) },
      salonPoliciesSchema: { findFirst: vi.fn(async () => null) },
      superAdminPoliciesSchema: { findFirst: vi.fn(async () => null) },
    },
    transaction: vi.fn(async (callback: (handle: typeof tx) => unknown) =>
      callback(tx)),
  };
  return {
    callOrder,
    requireStaffAppointmentAccess,
    logAppointmentChange,
    logAppointmentLocked,
    enqueueGoogleCalendarDelete,
    enqueueGoogleCalendarDeleteInTx,
    resolveTerminalSalonClientWithHandle,
    resolveCanonicalSalonClientIdentityWithHandle,
    lockOperationalSalonClientContactWithHandle,
    getActiveAppointmentsForCanonicalClientWithHandle,
    lockTechnicianAndAssertSlotFree,
    lockedAppointment,
    updateResult,
    capturedUpdates,
    tx,
    db,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/staffApiGuards', () => ({ requireStaffAppointmentAccess }));
vi.mock('@/libs/appointmentAudit', () => ({
  logAppointmentChange,
  logAppointmentLocked,
}));
vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarDelete,
  enqueueGoogleCalendarDeleteInTx,
}));
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError: class extends Error {},
  resolveTerminalSalonClientWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  lockOperationalSalonClientContactWithHandle,
  withClientLifecycleTransactionRetry: vi.fn(
    async (operation: () => Promise<unknown>) => operation(),
  ),
}));
vi.mock('@/libs/activeAppointments', () => ({
  getActiveAppointmentsForCanonicalClientWithHandle,
}));
vi.mock('@/libs/bookingConflictGuard', () => ({
  SlotConflictError: class extends Error {},
  lockTechnicianAndAssertSlotFree,
}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/deposits/depositForfeiture', () => ({
  DepositForfeitureBlockedError: class DepositForfeitureBlockedError extends Error {},
  forfeitAppointmentDepositInTx,
}));
import { POST } from './route';

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  salonClientId: 'client_source',
  technicianId: 'tech_1',
  clientPhone: '4165550000',
  clientEmail: 'historical@example.com',
  startTime: new Date('2026-08-01T14:00:00.000Z'),
  endTime: new Date('2026-08-01T15:00:00.000Z'),
  blockedDurationMinutes: 60,
  totalDurationMinutes: 60,
  bufferMinutes: 0,
  status: 'confirmed',
  canvasState: 'waiting',
  startedAt: null,
  completedAt: null,
  lockedAt: null,
  googleCalendarEventId: 'gevent_1',
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

function makeAccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    session: {
      salonId: 'salon_1',
      technicianId: 'tech_1',
      technicianName: 'Daniela',
    },
    appointment: { ...appointment, ...overrides },
  };
}

function transitionRequest(to: string) {
  return new Request('http://localhost/api/appointments/appt_1/transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  });
}

describe('POST /api/appointments/:id/transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    capturedUpdates.length = 0;
    lockedAppointment.current = { ...appointment };
    updateResult.current = { ...appointment, canvasState: 'working', status: 'in_progress' };
    requireStaffAppointmentAccess.mockResolvedValue(makeAccess());
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue(null);
    getActiveAppointmentsForCanonicalClientWithHandle.mockImplementation(
      async () => {
        callOrder.push('active-check');
        return [];
      },
    );
  });

  it('serializes an active transition behind the terminal client and technician', async () => {
    const response = await POST(transitionRequest('working'), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(200);
    expect(capturedUpdates[0]).toMatchObject({
      canvasState: 'working',
      status: 'in_progress',
    });
    expect(callOrder).toEqual([
      'resolve',
      'client-lock',
      'technician-lock',
      'appointment-lock',
      'resolve',
      'active-check',
      'appointment-cas',
    ]);
    expect(getActiveAppointmentsForCanonicalClientWithHandle).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        terminalClientId: 'client_primary',
        excludeAppointmentId: 'appt_1',
      }),
    );
    expect(logAppointmentChange).toHaveBeenCalledTimes(1);
    expect(logAppointmentLocked).toHaveBeenCalledTimes(1);
  });

  it('fails closed before CAS and side effects when the lineage is already active', async () => {
    getActiveAppointmentsForCanonicalClientWithHandle.mockImplementation(
      async () => {
        callOrder.push('active-check');
        return [{ id: 'appt_other' }];
      },
    );

    const response = await POST(transitionRequest('working'), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(409);
    expect(callOrder).not.toContain('appointment-cas');
    expect(logAppointmentChange).not.toHaveBeenCalled();
    expect(logAppointmentLocked).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarDelete).not.toHaveBeenCalled();
  });

  it('lets only the compare-and-set winner emit audit and notification side effects', async () => {
    updateResult.current = null;

    const response = await POST(transitionRequest('working'), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(409);
    expect(logAppointmentChange).not.toHaveBeenCalled();
    expect(logAppointmentLocked).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarDelete).not.toHaveBeenCalled();
  });

  it('rejects direct completion so checkout owns every financial write', async () => {
    const completing = {
      ...appointment,
      canvasState: 'wrap_up',
      status: 'in_progress',
    };
    requireStaffAppointmentAccess.mockResolvedValue(makeAccess(completing));
    lockedAppointment.current = completing;
    updateResult.current = {
      ...completing,
      canvasState: 'complete',
      status: 'completed',
    };

    const response = await POST(transitionRequest('complete'), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'CHECKOUT_COMPLETION_REQUIRED',
        message: 'Open checkout to finalize the invoice before completing this appointment.',
      },
    });
    expect(capturedUpdates).toEqual([]);
    expect(lockOperationalSalonClientContactWithHandle).not.toHaveBeenCalled();
    expect(callOrder).toEqual([]);
    expect(logAppointmentChange).not.toHaveBeenCalled();
    expect(logAppointmentLocked).not.toHaveBeenCalled();
  });

  it('keeps an already-active working to wrap-up transition lifecycle-lock free', async () => {
    const working = {
      ...appointment,
      canvasState: 'working',
      status: 'in_progress',
    };
    requireStaffAppointmentAccess.mockResolvedValue(makeAccess(working));
    lockedAppointment.current = working;
    updateResult.current = {
      ...working,
      canvasState: 'wrap_up',
    };

    const response = await POST(
      transitionRequest('wrap_up'),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(200);
    expect(capturedUpdates[0]).toMatchObject({
      canvasState: 'wrap_up',
      status: 'in_progress',
    });
    expect(lockOperationalSalonClientContactWithHandle).not.toHaveBeenCalled();
    expect(getActiveAppointmentsForCanonicalClientWithHandle)
      .not.toHaveBeenCalled();
    expect(callOrder).toEqual(['appointment-lock', 'appointment-cas']);
  });

  it('records a real no_show status and releases the Google event only after CAS', async () => {
    updateResult.current = {
      ...appointment,
      canvasState: 'no_show',
      status: 'no_show',
    };

    const response = await POST(transitionRequest('no_show'), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(200);
    expect(capturedUpdates[0]).toMatchObject({
      canvasState: 'no_show',
      status: 'no_show',
      cancelReason: 'no_show',
    });
    expect(forfeitAppointmentDepositInTx).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      appointmentLockHeld: true,
    }));
    expect(enqueueGoogleCalendarDeleteInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        googleCalendarEventId: 'gevent_1',
        mutationVersion: expect.any(Date),
      }),
    );
  });

  it('rejects transitions on already-terminal appointments before transaction work', async () => {
    requireStaffAppointmentAccess.mockResolvedValue(makeAccess({ canvasState: 'complete' }));

    const response = await POST(transitionRequest('cancelled'), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(409);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
