/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireStaffAppointmentAccess,
  logAppointmentChange,
  logAppointmentLocked,
  enqueueGoogleCalendarDelete,
  db,
  capturedUpdates,
} = vi.hoisted(() => {
  const capturedUpdates: Array<Record<string, unknown>> = [];
  return {
    requireStaffAppointmentAccess: vi.fn(),
    logAppointmentChange: vi.fn(async () => undefined),
    logAppointmentLocked: vi.fn(async () => undefined),
    enqueueGoogleCalendarDelete: vi.fn(async () => undefined),
    capturedUpdates,
    db: {
      query: {
        appointmentArtifactsSchema: { findFirst: vi.fn(async () => null) },
        salonPoliciesSchema: { findFirst: vi.fn(async () => null) },
        superAdminPoliciesSchema: { findFirst: vi.fn(async () => null) },
      },
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          capturedUpdates.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{
                id: 'appt_1',
                canvasState: values.canvasState,
                canvasStateUpdatedAt: values.canvasStateUpdatedAt,
                startedAt: values.startedAt ?? null,
                completedAt: values.completedAt ?? null,
                lockedAt: values.lockedAt ?? null,
                lockedBy: values.lockedBy ?? null,
              }]),
            })),
          };
        }),
      })),
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/staffApiGuards', () => ({ requireStaffAppointmentAccess }));
vi.mock('@/libs/appointmentAudit', () => ({ logAppointmentChange, logAppointmentLocked }));
vi.mock('@/libs/integrationOutbox', () => ({ enqueueGoogleCalendarDelete }));
vi.mock('@/libs/DB', () => ({ db }));

import { POST } from './route';

function makeAccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    session: { salonId: 'salon_1', technicianId: 'tech_1', technicianName: 'Daniela' },
    appointment: {
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      status: 'confirmed',
      canvasState: 'waiting',
      startedAt: null,
      completedAt: null,
      lockedAt: null,
      googleCalendarEventId: 'gevent_1',
      ...overrides,
    },
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
    capturedUpdates.length = 0;
    requireStaffAppointmentAccess.mockResolvedValue(makeAccess());
  });

  it('keeps the legacy status in sync when the tech starts working', async () => {
    const response = await POST(transitionRequest('working'), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);
    expect(capturedUpdates[0]).toMatchObject({
      canvasState: 'working',
      status: 'in_progress',
    });
    expect(enqueueGoogleCalendarDelete).not.toHaveBeenCalled();
  });

  it('marks the appointment completed for both models on complete', async () => {
    requireStaffAppointmentAccess.mockResolvedValue(makeAccess({ canvasState: 'wrap_up' }));

    const response = await POST(transitionRequest('complete'), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);
    expect(capturedUpdates[0]).toMatchObject({
      canvasState: 'complete',
      status: 'completed',
    });
  });

  it('records a real no_show status and releases the Google event', async () => {
    const response = await POST(transitionRequest('no_show'), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);
    expect(capturedUpdates[0]).toMatchObject({
      canvasState: 'no_show',
      status: 'no_show',
      cancelReason: 'no_show',
    });
    expect(enqueueGoogleCalendarDelete).toHaveBeenCalledWith({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      googleCalendarEventId: 'gevent_1',
    });
  });

  it('rejects transitions on already-terminal appointments', async () => {
    requireStaffAppointmentAccess.mockResolvedValue(makeAccess({ canvasState: 'complete' }));

    const response = await POST(transitionRequest('cancelled'), { params: { id: 'appt_1' } });

    expect(response.status).toBe(409);
    expect(capturedUpdates).toHaveLength(0);
  });
});
