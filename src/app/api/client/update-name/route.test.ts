/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appointments,
  db,
  enqueueGoogleCalendarAppointmentMutation,
  requireClientApiSession,
  upsertClient,
} = vi.hoisted(() => {
  const appointments = [
    {
      id: 'appt_active',
      salonId: 'salon_1',
      clientPhone: '4165550100',
      clientName: 'Old',
      status: 'confirmed',
      deletedAt: null,
      updatedAt: new Date('2026-08-12T14:00:00.000Z'),
    },
    {
      id: 'appt_in_progress',
      salonId: 'salon_1',
      clientPhone: '4165550100',
      clientName: 'Old',
      status: 'in_progress',
      deletedAt: null,
      updatedAt: new Date('2026-08-12T13:30:00.000Z'),
    },
    {
      id: 'appt_history',
      salonId: 'salon_1',
      clientPhone: '+14165550100',
      clientName: 'Old',
      status: 'completed',
      deletedAt: null,
      updatedAt: new Date('2026-08-11T14:00:00.000Z'),
    },
  ];
  const enqueueGoogleCalendarAppointmentMutation = vi.fn();

  const transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
    const snapshot = appointments.map(appointment => ({ ...appointment }));
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              for: vi.fn(async () => appointments.map(appointment => ({ ...appointment }))),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              const current = appointments.find(appointment => (
                appointment.clientName !== values.clientName
                && appointment.updatedAt.getTime()
                < (values.updatedAt as Date).getTime()
              ));
              if (!current) {
                return [];
              }
              Object.assign(current, values);
              return [{ ...current }];
            }),
          })),
        })),
      })),
    };
    try {
      return await callback(tx);
    } catch (error) {
      appointments.splice(0, appointments.length, ...snapshot);
      throw error;
    }
  });

  return {
    appointments,
    db: { transaction },
    enqueueGoogleCalendarAppointmentMutation,
    requireClientApiSession: vi.fn(),
    upsertClient: vi.fn(),
  };
});

vi.mock('@/libs/clientApiGuards', () => ({ requireClientApiSession }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/integrationOutbox', () => ({ enqueueGoogleCalendarAppointmentMutation }));
vi.mock('@/libs/queries', () => ({ upsertClient }));

import { POST } from './route';

function request() {
  return new Request('http://localhost/api/client/update-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Ava' }),
  });
}

describe('POST /api/client/update-name Calendar ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appointments[0]!.clientName = 'Old';
    appointments[0]!.updatedAt = new Date('2026-08-12T14:00:00.000Z');
    appointments[1]!.clientName = 'Old';
    appointments[1]!.updatedAt = new Date('2026-08-12T13:30:00.000Z');
    appointments[2]!.clientName = 'Old';
    appointments[2]!.updatedAt = new Date('2026-08-11T14:00:00.000Z');
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165550100',
      session: { phone: '+14165550100' },
    });
    upsertClient.mockResolvedValue({
      id: 'client_1',
      firstName: 'Ava',
      phone: '+14165550100',
    });
  });

  it('updates history but enqueues exactly the live same-schedule mutation in its transaction', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(appointments.map(appointment => appointment.clientName)).toEqual(['Ava', 'Ava', 'Ava']);
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledTimes(2);
    expect(enqueueGoogleCalendarAppointmentMutation.mock.calls.map(([, input]) => input)).toEqual([
      expect.objectContaining({
        appointmentId: 'appt_active',
        mutationVersion: appointments[0]!.updatedAt,
        salonId: 'salon_1',
      }),
      expect.objectContaining({
        appointmentId: 'appt_in_progress',
        mutationVersion: appointments[1]!.updatedAt,
        salonId: 'salon_1',
      }),
    ]);

    consoleWarn.mockRestore();
  });

  it('rolls every name write back when durable Calendar enqueue fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enqueueGoogleCalendarAppointmentMutation.mockRejectedValueOnce(
      new Error('calendar intent failed'),
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(appointments.map(appointment => appointment.clientName)).toEqual(['Old', 'Old', 'Old']);

    consoleError.mockRestore();
  });
});
