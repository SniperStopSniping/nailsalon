/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  deleteGoogleCalendarEventForAppointment,
  syncGoogleCalendarEventForAppointment,
  selectResults,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const select = vi.fn(() => {
    const rows = selectResults.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = async () => rows;
    return chain;
  });
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => {
        const query = Promise.resolve(undefined) as Promise<undefined> & {
          returning: () => Promise<Array<{ id: string }>>;
        };
        query.returning = async () => [{ id: 'job_1' }];
        return query;
      }),
    })),
  }));

  return {
    db: { select, update },
    deleteGoogleCalendarEventForAppointment: vi.fn(),
    syncGoogleCalendarEventForAppointment: vi.fn(),
    selectResults,
  };
});

vi.mock('@/libs/DB', () => ({ db }));

vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment,
  syncGoogleCalendarEventForAppointment,
}));

import { processIntegrationOutbox } from './integrationOutbox';

describe('processIntegrationOutbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    deleteGoogleCalendarEventForAppointment.mockResolvedValue({ status: 'deleted' });
    syncGoogleCalendarEventForAppointment.mockResolvedValue({
      status: 'synced',
      eventId: 'google_event_1',
    });
  });

  it('turns a delayed upsert into a delete after the appointment is cancelled', async () => {
    selectResults.push(
      [{
        id: 'job_1',
        salonId: 'salon_1',
        appointmentId: 'appt_1',
        provider: 'google_calendar',
        operation: 'upsert_event',
        status: 'pending',
        attempts: 0,
        payload: {
          appointmentId: 'appt_1',
          salonId: 'salon_1',
          salonName: 'Salon A',
          clientName: 'Ava',
          clientPhone: '4165550100',
          serviceNames: ['Manicure'],
          technicianName: 'Taylor',
          startTime: '2026-08-31T16:00:00.000Z',
          endTime: '2026-08-31T17:00:00.000Z',
          totalPrice: 5000,
          totalDurationMinutes: 60,
          timeZone: 'America/Toronto',
          googleCalendarEventId: null,
        },
        createdAt: new Date('2026-07-22T16:00:00.000Z'),
        updatedAt: new Date('2026-07-22T16:00:00.000Z'),
        availableAt: new Date('2026-07-22T16:00:00.000Z'),
        processedAt: null,
        lastError: null,
      }],
      [{
        googleCalendarEventId: 'google_event_late',
        status: 'cancelled',
        deletedAt: null,
      }],
      [],
      [],
    );

    const result = await processIntegrationOutbox();

    expect(result).toEqual({
      scanned: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
      reconciledCancelledEvents: 0,
    });
    expect(syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      googleCalendarEventId: 'google_event_late',
    });
  });

  it('repairs a cancelled appointment from its active linked event row', async () => {
    selectResults.push(
      [],
      [],
      [{
        appointmentId: 'appt_old_cancel',
        salonId: 'salon_1',
        googleCalendarEventId: 'google_event_stuck',
      }],
    );

    const result = await processIntegrationOutbox();

    expect(result).toEqual({
      scanned: 0,
      succeeded: 0,
      retried: 0,
      failed: 0,
      reconciledCancelledEvents: 1,
    });
    expect(deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith({
      appointmentId: 'appt_old_cancel',
      salonId: 'salon_1',
      googleCalendarEventId: 'google_event_stuck',
    });
  });
});
