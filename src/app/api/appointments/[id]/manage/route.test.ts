import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireAppointmentManagerAccess,
  getAppointmentManageDetail,
  runAppointmentManageMutation,
  db,
} = vi.hoisted(() => ({
  requireAppointmentManagerAccess: vi.fn(),
  getAppointmentManageDetail: vi.fn(),
  runAppointmentManageMutation: vi.fn(),
  db: {
    select: vi.fn(),
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess,
}));

vi.mock('@/libs/appointmentManage', () => ({
  AppointmentManageError: class AppointmentManageError extends Error {
    code: string;
    status: number;
    details?: Record<string, unknown>;

    constructor(code: string, message: string, status = 400, details?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
  getAppointmentManageDetail,
  runAppointmentManageMutation,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET, PATCH } from './route';

function makeSalonSelect(slug: string) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => [{ slug }]),
      })),
    })),
  };
}

describe('appointment manage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns quick-edit detail for assigned staff', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
      },
    });
    db.select.mockReturnValue(makeSalonSelect('salon-a'));
    getAppointmentManageDetail.mockResolvedValue({
      appointment: { id: 'appt_1' },
      serviceOptions: [],
      technicianOptions: [],
      services: [],
      addOns: [],
      permissions: {
        canMove: true,
        canChangeService: true,
        canCancel: true,
        canMarkCompleted: true,
        canStart: true,
        canReassignTechnician: false,
      },
      warnings: [],
    });

    const response = await GET(
      new Request('http://localhost/api/appointments/appt_1/manage'),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getAppointmentManageDetail).toHaveBeenCalledWith({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      canReassignTechnician: false,
      salonSlug: 'salon-a',
    });
    expect(body.data.appointment.id).toBe('appt_1');
  });

  it('blocks technician reassignment for staff users', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
      },
    });

    const response = await PATCH(new Request('http://localhost/api/appointments/appt_1/manage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'reassignTechnician',
        technicianId: 'tech_2',
      }),
    }), { params: { id: 'appt_1' } });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(runAppointmentManageMutation).not.toHaveBeenCalled();
  });

  it('forwards move requests for admins to the manage mutation', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
      },
    });
    runAppointmentManageMutation.mockResolvedValue({
      detail: { appointment: { id: 'appt_1' } },
      calendarEvent: { id: 'appt_1' },
      warnings: [],
    });

    const response = await PATCH(new Request('http://localhost/api/appointments/appt_1/manage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'move',
        startTime: '2026-03-29T15:00:00.000Z',
      }),
    }), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);
    expect(runAppointmentManageMutation).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      operation: 'move',
      canReassignTechnician: true,
    }));
  });
});
