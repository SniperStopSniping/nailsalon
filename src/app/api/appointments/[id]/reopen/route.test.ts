/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  callOrder,
  requireAppointmentManagerAccess,
  resolveCheckoutActor,
  resolveTerminalSalonClientWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  lockOperationalSalonClientContactWithHandle,
  getActiveAppointmentsForCanonicalClientWithHandle,
  lockTechnicianAndAssertSlotFree,
  updateSalonClientStats,
  lockedAppointment,
  appointmentUpdateResult,
  dependentUpdate,
  auditInsert,
  tx,
  db,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const requireAppointmentManagerAccess = vi.fn();
  const resolveCheckoutActor = vi.fn(() => ({
    performedBy: 'admin_1',
    performedByRole: 'admin',
    performedByName: 'Owner',
  }));
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
  const updateSalonClientStats = vi.fn(async () => undefined);
  const lockedAppointment = { current: null as Record<string, unknown> | null };
  const appointmentUpdateResult = { current: [] as Record<string, unknown>[] };
  const dependentUpdate = vi.fn(async () => undefined);
  const auditInsert = vi.fn(async (_value?: unknown) => undefined);

  const tx = {
    execute: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
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
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          if (values.status === 'in_progress') {
            return {
              returning: vi.fn(async () => {
                callOrder.push('appointment-cas');
                return appointmentUpdateResult.current;
              }),
            };
          }
          callOrder.push('dependent-update');
          return dependentUpdate();
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        callOrder.push('audit-insert');
        return auditInsert(value);
      }),
    })),
  };
  const db = {
    transaction: vi.fn(async (callback: (handle: typeof tx) => unknown) =>
      callback(tx)),
  };

  return {
    callOrder,
    requireAppointmentManagerAccess,
    resolveCheckoutActor,
    resolveTerminalSalonClientWithHandle,
    resolveCanonicalSalonClientIdentityWithHandle,
    lockOperationalSalonClientContactWithHandle,
    getActiveAppointmentsForCanonicalClientWithHandle,
    lockTechnicianAndAssertSlotFree,
    updateSalonClientStats,
    lockedAppointment,
    appointmentUpdateResult,
    dependentUpdate,
    auditInsert,
    tx,
    db,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));
vi.mock('@/libs/appointmentCheckoutServer', () => ({ resolveCheckoutActor }));
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
vi.mock('@/libs/queries', () => ({ updateSalonClientStats }));
vi.mock('@/libs/appointmentAudit', () => ({
  buildAppointmentAuditRow: vi.fn((value: unknown) => value),
}));
vi.mock('@/libs/DB', () => ({ db }));

import { POST } from './route';

const completedAppointment = {
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
  status: 'completed',
  completedAt: new Date('2026-08-01T15:00:00.000Z'),
};

function request(): Request {
  return new Request('http://localhost/api/appointments/appt_1/reopen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Correction' }),
  });
}

describe('POST /api/appointments/:id/reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    lockedAppointment.current = { ...completedAppointment };
    appointmentUpdateResult.current = [{
      ...completedAppointment,
      status: 'in_progress',
      completedAt: null,
    }];
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: { ...completedAppointment },
    });
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue(null);
    getActiveAppointmentsForCanonicalClientWithHandle.mockImplementation(
      async () => {
        callOrder.push('active-check');
        return [];
      },
    );
  });

  it('locks source lineage, technician, and appointment before the active check and CAS', async () => {
    const response = await POST(request(), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);
    expect(callOrder).toEqual([
      'resolve',
      'client-lock',
      'technician-lock',
      'appointment-lock',
      'resolve',
      'active-check',
      'appointment-cas',
      'dependent-update',
      'audit-insert',
    ]);
    expect(lockOperationalSalonClientContactWithHandle).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ clientId: 'client_primary' }),
    );
    expect(getActiveAppointmentsForCanonicalClientWithHandle).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        terminalClientId: 'client_primary',
        excludeAppointmentId: 'appt_1',
      }),
    );
    expect(updateSalonClientStats).toHaveBeenCalledWith(
      'salon_1',
      '4165550100',
    );
  });

  it('fails closed when another lineage appointment is active', async () => {
    getActiveAppointmentsForCanonicalClientWithHandle.mockImplementation(
      async () => {
        callOrder.push('active-check');
        return [{ id: 'appt_other' }];
      },
    );

    const response = await POST(request(), { params: { id: 'appt_1' } });

    expect(response.status).toBe(409);
    expect(callOrder).not.toContain('appointment-cas');
    expect(dependentUpdate).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
    expect(updateSalonClientStats).not.toHaveBeenCalled();
  });

  it('lets only the compare-and-set winner mutate dependent state', async () => {
    appointmentUpdateResult.current = [];

    const response = await POST(request(), { params: { id: 'appt_1' } });

    expect(response.status).toBe(409);
    expect(dependentUpdate).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
    expect(updateSalonClientStats).not.toHaveBeenCalled();
  });
});
