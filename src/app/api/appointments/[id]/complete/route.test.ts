import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH, POST } from './route';

const {
  requireAppointmentManagerAccess,
  getSalonPolicy,
  getSuperAdminPolicy,
  getSalonById,
  getActiveAppointmentsForCanonicalClientWithHandle,
  lockOperationalSalonClientContactWithHandle,
  lockTechnicianAndAssertSlotFree,
  resolveCanonicalSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveTerminalSalonClient,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
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
    getActiveAppointmentsForCanonicalClientWithHandle: vi.fn(),
    lockOperationalSalonClientContactWithHandle: vi.fn(),
    lockTechnicianAndAssertSlotFree: vi.fn(),
    resolveCanonicalSalonClientIdentity: vi.fn(),
    resolveCanonicalSalonClientIdentityWithHandle: vi.fn(),
    resolveTerminalSalonClient: vi.fn(),
    resolveTerminalSalonClientWithHandle: vi.fn(),
    withClientLifecycleTransactionRetry: vi.fn(),
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

vi.mock('@/libs/activeAppointments', () => ({
  getActiveAppointmentsForCanonicalClientWithHandle,
}));

vi.mock('@/libs/bookingConflictGuard', () => ({
  lockTechnicianAndAssertSlotFree,
  SlotConflictError: class SlotConflictError extends Error {},
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError:
    class ClientLifecycleStabilizationError extends Error {},
  lockOperationalSalonClientContactWithHandle,
  resolveCanonicalSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveTerminalSalonClient,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
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
    clientEmail: 'historical@example.com',
    salonClientId: 'client_source',
    technicianId: 'tech_1',
    startTime: new Date('2026-07-18T15:00:00Z'),
    endTime: new Date('2026-07-18T16:00:00Z'),
    totalDurationMinutes: 60,
    bufferMinutes: 0,
    blockedDurationMinutes: 60,
    deletedAt: null,
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
    getActiveAppointmentsForCanonicalClientWithHandle.mockResolvedValue([]);
    lockOperationalSalonClientContactWithHandle.mockResolvedValue({
      id: 'client_primary',
      salonId: 'salon_1',
      phone: '5559990000',
      email: 'current@example.com',
      archivedAt: null,
      redirectedFromClientId: 'client_source',
      lineagePath: ['client_source', 'client_primary'],
    });
    lockTechnicianAndAssertSlotFree.mockResolvedValue(undefined);
    resolveCanonicalSalonClientIdentity.mockResolvedValue(null);
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue(null);
    resolveTerminalSalonClient.mockResolvedValue({
      id: 'client_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'client_source',
      lineagePath: ['client_source', 'client_primary'],
    });
    resolveTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'client_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'client_source',
      lineagePath: ['client_source', 'client_primary'],
    });
    withClientLifecycleTransactionRetry.mockImplementation(
      async operation => operation(1),
    );
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

  it('starts through the terminal client with client-first locking and compare-and-set', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);
    const events: string[] = [];
    lockOperationalSalonClientContactWithHandle.mockImplementation(async () => {
      events.push('client');
      return {
        id: 'client_primary',
        salonId: 'salon_1',
        phone: '5559990000',
        email: 'current@example.com',
        archivedAt: null,
        redirectedFromClientId: 'client_source',
        lineagePath: ['client_source', 'client_primary'],
      };
    });
    lockTechnicianAndAssertSlotFree.mockImplementation(async () => {
      events.push('technician');
    });
    getActiveAppointmentsForCanonicalClientWithHandle.mockImplementation(
      async () => {
        events.push('lineage-active-check');
        return [];
      },
    );

    const lockedAppointment = { ...STAFF_ACCESS.appointment };
    const startedAt = new Date('2026-07-18T14:55:00Z');
    const returning = vi.fn(async () => [{
      id: 'appt_1',
      startedAt,
    }]);
    const updateWhere = vi.fn(() => ({ returning }));
    const updateSet = vi.fn((values: Record<string, unknown>) => {
      events.push('compare-and-set');

      expect(values).not.toHaveProperty('clientPhone');
      expect(values).not.toHaveProperty('clientEmail');
      expect(values).not.toHaveProperty('salonClientId');

      return { where: updateWhere };
    });
    const appointmentLimit = vi.fn(async () => {
      events.push('appointment');
      return [lockedAppointment];
    });
    const appointmentForUpdate = vi.fn(() => ({ limit: appointmentLimit }));
    const appointmentWhere = vi.fn(() => ({ for: appointmentForUpdate }));
    const appointmentFrom = vi.fn(() => ({ where: appointmentWhere }));
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => ({ from: appointmentFrom })),
      update: vi.fn(() => ({ set: updateSet })),
    };
    db.transaction.mockImplementation(
      async (operation: (handle: typeof tx) => Promise<unknown>) => operation(tx),
    );

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'POST',
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.appointment).toEqual({
      id: 'appt_1',
      status: 'in_progress',
      startedAt: startedAt.toISOString(),
    });
    expect(events).toEqual([
      'client',
      'technician',
      'appointment',
      'lineage-active-check',
      'compare-and-set',
    ]);
    expect(resolveTerminalSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'client_source',
      allowArchived: true,
    });
    expect(resolveTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      tx,
      {
        salonId: 'salon_1',
        clientId: 'client_source',
        allowArchived: true,
      },
    );
    expect(
      lockOperationalSalonClientContactWithHandle.mock.invocationCallOrder[0],
    ).toBeLessThan(
      resolveTerminalSalonClientWithHandle.mock.invocationCallOrder[0]!,
    );
    expect(
      resolveTerminalSalonClientWithHandle.mock.invocationCallOrder[0],
    ).toBeLessThan(
      lockTechnicianAndAssertSlotFree.mock.invocationCallOrder[0]!,
    );
    expect(getActiveAppointmentsForCanonicalClientWithHandle)
      .toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          salonId: 'salon_1',
          terminalClientId: 'client_primary',
          horizon: 'lineage-active',
          excludeAppointmentId: 'appt_1',
        }),
      );
    expect(updateWhere).toHaveBeenCalledOnce();
  });

  it('returns a conflict without dependent effects when the start compare-and-set loses', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);
    const returning = vi.fn(async () => []);
    const updateWhere = vi.fn(() => ({ returning }));
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({
              limit: vi.fn(async () => [{ ...STAFF_ACCESS.appointment }]),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    };
    db.transaction.mockImplementation(
      async (operation: (handle: typeof tx) => Promise<unknown>) => operation(tx),
    );

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'POST',
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('APPOINTMENT_STATE_CHANGED');
    expect(returning).toHaveBeenCalledOnce();
  });

  it('rejects blocked-window drift before the start compare-and-set', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);
    const update = vi.fn();
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({
              limit: vi.fn(async () => [{
                ...STAFF_ACCESS.appointment,
                blockedDurationMinutes: 90,
              }]),
            })),
          })),
        })),
      })),
      update,
    };
    db.transaction.mockImplementation(
      async (operation: (handle: typeof tx) => Promise<unknown>) => operation(tx),
    );

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'POST',
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('APPOINTMENT_STATE_CHANGED');
    expect(update).not.toHaveBeenCalled();
    expect(getActiveAppointmentsForCanonicalClientWithHandle)
      .not.toHaveBeenCalled();
  });

  it('rejects a competing lineage appointment before the start compare-and-set', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(STAFF_ACCESS);
    getActiveAppointmentsForCanonicalClientWithHandle.mockResolvedValue([{
      id: 'appt_other',
    }]);
    const update = vi.fn();
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({
              limit: vi.fn(async () => [{ ...STAFF_ACCESS.appointment }]),
            })),
          })),
        })),
      })),
      update,
    };
    db.transaction.mockImplementation(
      async (operation: (handle: typeof tx) => Promise<unknown>) => operation(tx),
    );

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/complete', {
        method: 'POST',
      }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('EXISTING_APPOINTMENT');
    expect(update).not.toHaveBeenCalled();
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
