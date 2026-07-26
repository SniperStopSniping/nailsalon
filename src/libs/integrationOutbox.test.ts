/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  deleteGoogleCalendarEventForAppointment,
  syncGoogleCalendarEventForAppointment,
  listGoogleCalendarEventsForSalon,
  retryCustomerBookingConfirmationEmail,
  selectResults,
  updates,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updates: Array<Record<string, unknown>> = [];
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
    set: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return {
        where: vi.fn(() => {
          const query = Promise.resolve(undefined) as Promise<undefined> & {
            returning: () => Promise<Array<{ id: string }>>;
          };
          query.returning = async () => [{ id: 'job_1' }];
          return query;
        }),
      };
    }),
  }));

  return {
    db: { select, update },
    deleteGoogleCalendarEventForAppointment: vi.fn(),
    syncGoogleCalendarEventForAppointment: vi.fn(),
    listGoogleCalendarEventsForSalon: vi.fn(),
    retryCustomerBookingConfirmationEmail: vi.fn(),
    selectResults,
    updates,
  };
});

vi.mock('@/libs/DB', () => ({ db }));

vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment,
  syncGoogleCalendarEventForAppointment,
  listGoogleCalendarEventsForSalon,
}));

vi.mock('@/libs/customerBookingEmail', () => ({
  retryCustomerBookingConfirmationEmail,
}));

import { processIntegrationOutbox } from './integrationOutbox';

describe('processIntegrationOutbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    updates.length = 0;
    deleteGoogleCalendarEventForAppointment.mockResolvedValue({ status: 'deleted' });
    syncGoogleCalendarEventForAppointment.mockResolvedValue({
      status: 'synced',
      eventId: 'google_event_1',
    });
    listGoogleCalendarEventsForSalon.mockResolvedValue([]);
    retryCustomerBookingConfirmationEmail.mockResolvedValue({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      providerMessageId: null,
    });
  });

  it('completes a terminal confirmation retry once without advancing it again', async () => {
    selectResults.push(
      [{
        id: 'job_1',
        salonId: 'salon_1',
        appointmentId: 'appt_1',
        provider: 'email',
        operation: 'retry_booking_confirmation',
        status: 'retry',
        attempts: 0,
        payload: { deliveryId: 'delivery_1' },
        createdAt: new Date('2026-07-26T12:00:00.000Z'),
        updatedAt: new Date('2026-07-26T12:00:00.000Z'),
        availableAt: new Date('2026-07-26T12:00:00.000Z'),
        processedAt: null,
        lastError: 'BOOKING_EMAIL_PREPARATION_FAILED',
      }],
      [],
      [],
      [],
    );

    const first = await processIntegrationOutbox();

    expect(first).toMatchObject({
      scanned: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
    });
    expect(retryCustomerBookingConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(retryCustomerBookingConfirmationEmail).toHaveBeenCalledWith({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      deliveryId: 'delivery_1',
    });
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'processing',
      attempts: 1,
    }));
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'completed',
      lastError: null,
    }));

    selectResults.push([], [], [], []);
    const second = await processIntegrationOutbox();

    expect(second).toMatchObject({
      scanned: 0,
      succeeded: 0,
      retried: 0,
      failed: 0,
    });
    expect(retryCustomerBookingConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(updates.filter(update => 'attempts' in update)).toEqual([
      expect.objectContaining({ attempts: 1 }),
    ]);
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
      [],
    );

    const result = await processIntegrationOutbox();

    expect(result).toEqual({
      scanned: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
      cancelledEventCandidates: 0,
      remoteAppointmentMirrorsScanned: 0,
      remoteCancelledEventCandidates: 0,
      reconciledCancelledEvents: 0,
      skippedCancelledEvents: 0,
      failedCancelledEvents: 0,
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
      [],
    );

    const result = await processIntegrationOutbox();

    expect(result).toEqual({
      scanned: 0,
      succeeded: 0,
      retried: 0,
      failed: 0,
      cancelledEventCandidates: 1,
      remoteAppointmentMirrorsScanned: 0,
      remoteCancelledEventCandidates: 0,
      reconciledCancelledEvents: 1,
      skippedCancelledEvents: 0,
      failedCancelledEvents: 0,
    });
    expect(deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith({
      appointmentId: 'appt_old_cancel',
      salonId: 'salon_1',
      googleCalendarEventId: 'google_event_stuck',
    });
  });

  it('reports a future cancelled mirror that cannot be safely deleted', async () => {
    selectResults.push(
      [],
      [],
      [{
        appointmentId: 'appt_read_only',
        salonId: 'salon_1',
        googleCalendarEventId: 'google_event_read_only',
      }],
      [],
    );
    deleteGoogleCalendarEventForAppointment.mockResolvedValueOnce({ status: 'disabled' });

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({
      cancelledEventCandidates: 1,
      reconciledCancelledEvents: 0,
      skippedCancelledEvents: 1,
      failedCancelledEvents: 0,
    });
  });

  it('repairs an orphaned remote mirror from private appointment metadata', async () => {
    selectResults.push(
      [],
      [],
      [],
      [{ salonId: 'salon_1', destinationCalendarId: 'primary' }],
      [{ id: 'appt_orphan', status: 'cancelled', canvasState: 'cancelled', deletedAt: null }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValueOnce([{
      id: 'google_event_orphan',
      calendarId: 'primary',
      status: 'confirmed',
      summary: 'Manicure',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: new Date('2026-08-31T16:00:00.000Z'),
      endTime: new Date('2026-08-31T17:00:00.000Z'),
      updatedAt: new Date('2026-07-22T16:00:00.000Z'),
      appointmentId: 'appt_orphan',
      salonId: 'salon_1',
    }]);

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({
      cancelledEventCandidates: 1,
      remoteAppointmentMirrorsScanned: 1,
      remoteCancelledEventCandidates: 1,
      reconciledCancelledEvents: 1,
    });
    expect(listGoogleCalendarEventsForSalon).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      privateExtendedProperties: ['salonId=salon_1'],
    }));
    expect(deleteGoogleCalendarEventForAppointment).toHaveBeenCalledWith({
      appointmentId: 'appt_orphan',
      salonId: 'salon_1',
      googleCalendarEventId: 'google_event_orphan',
    });
  });

  it('repairs a legacy canvas cancellation whose status was left active', async () => {
    selectResults.push(
      [],
      [],
      [],
      [{ salonId: 'salon_1', destinationCalendarId: 'primary' }],
      [{ id: 'appt_legacy', status: 'confirmed', canvasState: 'cancelled', deletedAt: null }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValueOnce([{
      id: 'google_event_legacy',
      calendarId: 'primary',
      status: 'confirmed',
      summary: 'Manicure',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: new Date('2026-08-31T16:00:00.000Z'),
      endTime: new Date('2026-08-31T17:00:00.000Z'),
      updatedAt: new Date('2026-07-22T16:00:00.000Z'),
      appointmentId: 'appt_legacy',
      salonId: 'salon_1',
    }]);

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({
      remoteAppointmentMirrorsScanned: 1,
      remoteCancelledEventCandidates: 1,
      reconciledCancelledEvents: 1,
    });
  });

  it('repairs an app-owned mirror whose appointment row no longer exists', async () => {
    selectResults.push(
      [],
      [],
      [],
      [{ salonId: 'salon_1', destinationCalendarId: 'primary' }],
      [],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValueOnce([{
      id: 'google_event_missing_appointment',
      calendarId: 'primary',
      status: 'confirmed',
      summary: 'Manicure',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: new Date('2026-08-31T16:00:00.000Z'),
      endTime: new Date('2026-08-31T17:00:00.000Z'),
      updatedAt: new Date('2026-07-22T16:00:00.000Z'),
      appointmentId: 'appt_missing',
      salonId: 'salon_1',
    }]);

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({
      remoteAppointmentMirrorsScanned: 1,
      remoteCancelledEventCandidates: 1,
      reconciledCancelledEvents: 1,
    });
  });
});
