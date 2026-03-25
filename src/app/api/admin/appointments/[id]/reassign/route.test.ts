import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  getAdminSession,
  logAdminOverride,
  logTechReassignment,
  selectResults,
  updateResults,
  db,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updateResults: unknown[][] = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        return {
          limit: vi.fn(async () => result),
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
    selectResults,
    updateResults,
    db: {
      select,
      update,
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

import { PUT } from './route';

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
      }],
      [{
        id: 'tech_2',
        salonId: 'salon_1',
        name: 'New Tech',
        isActive: true,
      }],
      [],
      [{ name: 'Old Tech' }],
    );
    updateResults.push([{
      id: 'appt_1',
      technicianId: 'tech_2',
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
});
