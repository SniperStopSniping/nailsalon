import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PUT } from './route';

vi.mock('server-only', () => ({}));

const {
  requireAdminSalon,
  getAdminSession,
  logAdminOverride,
  logTechReassignment,
  selectResults,
  updateResults,
  enqueueGoogleCalendarAppointmentMutation,
  db,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updateResults: unknown[][] = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        const limit = vi.fn(async () => result);
        return {
          for: vi.fn(() => ({ limit })),
          limit,
          then: (resolve: (value: unknown) => void) => resolve(result),
        };
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => updateResults.shift() ?? []),
      })),
    })),
  }));

  return {
    requireAdminSalon: vi.fn(),
    getAdminSession: vi.fn(),
    logAdminOverride: vi.fn(),
    logTechReassignment: vi.fn(),
    enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
    selectResults,
    updateResults,
    db: {
      select,
      update,
      transaction: vi.fn(async (callback: (tx: { select: typeof select; update: typeof update }) => unknown) => callback({ select, update })),
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
  getAdminSession,
}));

vi.mock('@/libs/appointmentAudit', () => ({
  logAdminOverride,
  logTechReassignment,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));
vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarAppointmentMutation,
}));

describe('PUT /api/admin/appointments/[id]/reassign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    updateResults.length = 0;
  });

  it('rejects unauthenticated admins', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await PUT(
      new Request('http://localhost/api/admin/appointments/appt_1/reassign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          technicianId: 'tech_2',
          reason: 'Coverage change',
        }),
      }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(401);
    expect(getAdminSession).not.toHaveBeenCalled();
  });

  it('rejects an awaiting-payment hold without mutation or Calendar work', async () => {
    requireAdminSalon.mockResolvedValue({ error: null, salon: { id: 'salon_1' } });
    getAdminSession.mockResolvedValue({ id: 'admin_1', name: 'Owner' });
    selectResults.push([{
      id: 'appt_hold',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      status: 'awaiting_payment',
      canvasState: 'waiting',
      lockedAt: null,
      startTime: new Date('2026-03-14T10:00:00.000Z'),
      endTime: new Date('2026-03-14T11:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    }]);

    const response = await PUT(
      new Request('http://localhost/api/admin/appointments/appt_hold/reassign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          technicianId: 'tech_2',
          reason: 'Coverage change',
        }),
      }),
      { params: Promise.resolve({ id: 'appt_hold' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'HOLD_LOCKED' } });
    expect(db.update).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarAppointmentMutation).not.toHaveBeenCalled();
    expect(logTechReassignment).not.toHaveBeenCalled();
  });

  it('rejects a completed appointment even when its canvas state is not complete', async () => {
    requireAdminSalon.mockResolvedValue({ error: null, salon: { id: 'salon_1' } });
    getAdminSession.mockResolvedValue({ id: 'admin_1', name: 'Owner' });
    selectResults.push([{
      id: 'appt_completed',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      status: 'completed',
      canvasState: null,
      lockedAt: null,
      startTime: new Date('2026-03-14T10:00:00.000Z'),
      endTime: new Date('2026-03-14T11:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    }]);

    const response = await PUT(
      new Request('http://localhost/api/admin/appointments/appt_completed/reassign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          technicianId: 'tech_2',
          reason: 'Coverage change',
        }),
      }),
      { params: Promise.resolve({ id: 'appt_completed' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'APPOINTMENT_TERMINAL' },
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarAppointmentMutation).not.toHaveBeenCalled();
  });

  it('rechecks hold ownership under the appointment lock before updating', async () => {
    requireAdminSalon.mockResolvedValue({ error: null, salon: { id: 'salon_1' } });
    getAdminSession.mockResolvedValue({ id: 'admin_1', name: 'Owner' });
    selectResults.push(
      [{
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        canvasState: 'waiting',
        lockedAt: null,
        lockedBy: null,
        startTime: new Date('2026-03-14T10:00:00.000Z'),
        endTime: new Date('2026-03-14T11:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }],
      [{ id: 'tech_2', salonId: 'salon_1', name: 'New Tech', isActive: true }],
      [],
      [{ name: 'Old Tech' }],
      [{
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'awaiting_payment',
        canvasState: 'waiting',
        lockedAt: null,
        updatedAt: new Date('2026-03-01T00:00:01.000Z'),
      }],
    );

    const response = await PUT(
      new Request('http://localhost/api/admin/appointments/appt_1/reassign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          technicianId: 'tech_2',
          reason: 'Coverage change',
        }),
      }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'HOLD_LOCKED' } });
    expect(db.update).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarAppointmentMutation).not.toHaveBeenCalled();
    expect(logTechReassignment).not.toHaveBeenCalled();
  });

  it('allows authorized admins to reassign appointments inside their salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    selectResults.push(
      [{
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        canvasState: 'waiting',
        lockedAt: null,
        lockedBy: null,
        startTime: new Date('2026-03-14T10:00:00.000Z'),
        endTime: new Date('2026-03-14T11:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }],
      [{
        id: 'tech_2',
        salonId: 'salon_1',
        name: 'New Tech',
        isActive: true,
      }],
      [],
      [{ name: 'Old Tech' }],
      [{
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }],
    );
    updateResults.push([{
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_2',
      updatedAt: new Date('2026-03-01T00:00:00.001Z'),
    }]);

    const response = await PUT(
      new Request('http://localhost/api/admin/appointments/appt_1/reassign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          technicianId: 'tech_2',
          reason: 'Coverage change',
        }),
      }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(logTechReassignment).toHaveBeenCalledWith(
      'appt_1',
      'salon_1',
      'admin_1',
      'admin',
      'tech_1',
      'tech_2',
      'Coverage change',
      'Owner',
    );
    expect(logAdminOverride).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledTimes(1);
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledWith(
      expect.any(Object),
      {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        mutationVersion: new Date('2026-03-01T00:00:00.001Z'),
      },
    );
    expect(body).toEqual({
      data: {
        appointment: {
          id: 'appt_1',
          technicianId: 'tech_2',
          previousTechnicianId: 'tech_1',
          previousTechnicianName: 'Old Tech',
          newTechnicianName: 'New Tech',
          wasLocked: false,
          reason: 'Coverage change',
        },
      },
    });
  });

  it('rolls the reassignment back when its durable Calendar intent cannot be inserted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    requireAdminSalon.mockResolvedValue({ error: null, salon: { id: 'salon_1' } });
    getAdminSession.mockResolvedValue({ id: 'admin_1', name: 'Owner' });
    selectResults.push(
      [{
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        canvasState: 'waiting',
        lockedAt: null,
        lockedBy: null,
        startTime: new Date('2026-03-14T10:00:00.000Z'),
        endTime: new Date('2026-03-14T11:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }],
      [{ id: 'tech_2', salonId: 'salon_1', name: 'New Tech', isActive: true }],
      [],
      [{ name: 'Old Tech' }],
      [{
        id: 'appt_1',
        salonId: 'salon_1',
        technicianId: 'tech_1',
        status: 'confirmed',
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }],
    );
    updateResults.push([{
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_2',
      updatedAt: new Date('2026-03-01T00:00:00.001Z'),
    }]);
    enqueueGoogleCalendarAppointmentMutation.mockRejectedValueOnce(
      new Error('calendar intent failed'),
    );

    const response = await PUT(
      new Request('http://localhost/api/admin/appointments/appt_1/reassign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          technicianId: 'tech_2',
          reason: 'Coverage change',
        }),
      }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(500);
    expect(logTechReassignment).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
