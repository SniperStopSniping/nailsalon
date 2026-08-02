/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  deleteGoogleCalendarEventForAppointment,
  syncGoogleCalendarEventForAppointment,
  listGoogleCalendarEventsForSalon,
  retryCustomerBookingConfirmationEmail,
  sendAppointmentOperationalEmailOnce,
  mintAppointmentManageLink,
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
    sendAppointmentOperationalEmailOnce: vi.fn(),
    mintAppointmentManageLink: vi.fn(),
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

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  sendAppointmentOperationalEmailOnce,
}));

vi.mock('@/libs/appointmentManageLink', () => ({
  mintAppointmentManageLink,
}));

import {
  enqueueStaffRescheduleNotification,
  processIntegrationOutbox,
} from './integrationOutbox';

const PREVIOUS_START = '2026-08-31T16:00:00.000Z';
const PREVIOUS_END = '2026-08-31T17:00:00.000Z';
const NEW_START = '2026-09-01T16:00:00.000Z';
const NEW_END = '2026-09-01T17:00:00.000Z';

function staffJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    salonId: 'salon_1',
    appointmentId: 'appt_1',
    provider: 'email',
    operation: 'staff_reschedule_notification',
    status: 'pending',
    attempts: 0,
    payload: {
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      previousStartTime: PREVIOUS_START,
      previousEndTime: PREVIOUS_END,
      newStartTime: NEW_START,
      newEndTime: NEW_END,
      timeZone: 'America/Toronto',
    },
    createdAt: new Date('2026-08-30T12:00:00.000Z'),
    updatedAt: new Date('2026-08-30T12:00:00.000Z'),
    availableAt: new Date('2026-08-30T12:00:00.000Z'),
    processedAt: null,
    lastError: null,
    ...overrides,
  };
}

function currentAppointment(overrides: Record<string, unknown> = {}) {
  return {
    startTime: new Date(NEW_START),
    endTime: new Date(NEW_END),
    status: 'confirmed',
    deletedAt: null,
    salonName: 'Salon A',
    ...overrides,
  };
}

function finishReadResults() {
  selectResults.push([], [], []);
}

describe('enqueueStaffRescheduleNotification', () => {
  it('uses only the passed transaction and writes the exact versioned payload', async () => {
    const onConflictDoNothing = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const database = { insert: vi.fn(() => ({ values })) };

    await enqueueStaffRescheduleNotification(database as never, {
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      previousStartTime: new Date(PREVIOUS_START),
      previousEndTime: new Date(PREVIOUS_END),
      newStartTime: new Date(NEW_START),
      newEndTime: new Date(NEW_END),
      timeZone: 'America/Toronto',
    });

    expect(database.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'email',
      operation: 'staff_reschedule_notification',
      dedupeKey: `email:appt_1:staff_reschedule:${PREVIOUS_START}:${NEW_START}`,
      payload: {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        previousStartTime: PREVIOUS_START,
        previousEndTime: PREVIOUS_END,
        newStartTime: NEW_START,
        newEndTime: NEW_END,
        timeZone: 'America/Toronto',
      },
    }));
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

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
    mintAppointmentManageLink.mockResolvedValue('https://app.luster.test/en/salon-a/manage/test-capability');
    sendAppointmentOperationalEmailOnce.mockResolvedValue({
      status: 'sent',
      deliveryId: 'delivery_staff_1',
      claimed: true,
    });
  });

  it('cancels a superseded event without preparing or sending it', async () => {
    selectResults.push(
      [staffJob()],
      [currentAppointment({ startTime: new Date('2026-09-01T18:00:00.000Z') })],
    );
    finishReadResults();

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({ scanned: 1, succeeded: 1, retried: 0 });
    expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
    expect(mintAppointmentManageLink).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'cancelled',
      lastError: 'SUPERSEDED',
    }));
  });

  it('delivers the payload version and marks provider success processed', async () => {
    selectResults.push([staffJob()], [currentAppointment()]);
    finishReadResults();

    const result = await processIntegrationOutbox();
    const input = sendAppointmentOperationalEmailOnce.mock.calls[0]![0];
    const content = await input.prepare();

    expect(result).toMatchObject({ scanned: 1, succeeded: 1, retried: 0 });
    expect(input).toMatchObject({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      purpose: 'client_appointment_rescheduled',
      eventVersion: [PREVIOUS_START, PREVIOUS_END, NEW_START, NEW_END].join(':'),
      retryFailed: true,
      validationErrorCode: 'SUPERSEDED',
    });
    expect(content).toMatchObject({
      subject: 'Salon A appointment rescheduled',
      text: expect.stringContaining('View, reschedule, or cancel: https://app.luster.test/'),
      html: expect.stringContaining('View, reschedule, or cancel'),
    });
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'completed',
      processedAt: expect.any(Date),
      lastError: null,
    }));
  });

  it('rechecks the version immediately before delivery and cancels a late supersession', async () => {
    const providerCall = vi.fn();
    sendAppointmentOperationalEmailOnce.mockImplementationOnce(async (input) => {
      await input.prepare();
      const valid = await input.validateBeforeDelivery!();
      if (valid) {
        providerCall();
      }
      return valid
        ? { status: 'sent', deliveryId: 'delivery_staff_1', claimed: true }
        : { status: 'failed', deliveryId: 'delivery_staff_1', claimed: true };
    });
    selectResults.push(
      [staffJob()],
      [currentAppointment()],
      [currentAppointment({ startTime: new Date('2026-09-01T18:00:00.000Z') })],
    );
    finishReadResults();

    await processIntegrationOutbox();

    expect(providerCall).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'cancelled',
      lastError: 'SUPERSEDED',
    }));
  });

  it('backs off a retryable provider failure through the existing retry path', async () => {
    sendAppointmentOperationalEmailOnce.mockResolvedValueOnce({
      status: 'failed',
      deliveryId: 'delivery_staff_1',
      claimed: true,
    });
    selectResults.push([staffJob()], [currentAppointment()]);
    finishReadResults();
    const before = Date.now();

    const result = await processIntegrationOutbox();
    const retry = updates.find(
      update => update.lastError === 'STAFF_RESCHEDULE_EMAIL_FAILED',
    );

    expect(result).toMatchObject({ scanned: 1, retried: 1, failed: 0 });
    expect(retry).toEqual(expect.objectContaining({
      status: 'retry',
      lastError: 'STAFF_RESCHEDULE_EMAIL_FAILED',
      availableAt: expect.any(Date),
    }));
    expect((retry!.availableAt as Date).getTime() - before).toBeGreaterThan(110_000);
  });

  it('does not repeat a provider call after an ambiguous first outcome', async () => {
    const providerCall = vi.fn();
    sendAppointmentOperationalEmailOnce
      .mockImplementationOnce(async () => {
        providerCall();
        return { status: 'failed', deliveryId: 'delivery_staff_1', claimed: true };
      })
      .mockResolvedValueOnce({
        status: 'duplicate',
        deliveryId: 'delivery_staff_1',
        claimed: false,
      });
    selectResults.push([staffJob()], [currentAppointment()]);
    finishReadResults();
    await processIntegrationOutbox();

    selectResults.push(
      [staffJob({ status: 'retry', attempts: 1, lastError: 'EMAIL_DELIVERY_STATE_UNKNOWN' })],
      [currentAppointment()],
    );
    finishReadResults();
    await processIntegrationOutbox();

    expect(providerCall).toHaveBeenCalledTimes(1);
    expect(sendAppointmentOperationalEmailOnce).toHaveBeenCalledTimes(2);
    expect(updates).toContainEqual(expect.objectContaining({ status: 'completed' }));
  });

  it('terminates an unavailable recipient without retry', async () => {
    sendAppointmentOperationalEmailOnce.mockResolvedValueOnce({
      status: 'unavailable',
      deliveryId: 'delivery_staff_1',
      claimed: true,
    });
    selectResults.push([staffJob()], [currentAppointment()]);
    finishReadResults();

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({ scanned: 1, retried: 0, failed: 1 });
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      lastError: 'RECIPIENT_UNAVAILABLE',
      processedAt: expect.any(Date),
    }));
    expect(updates.filter(update => update.status === 'retry')).toHaveLength(1);
  });

  it('refuses a cross-salon appointment identity before delivery', async () => {
    selectResults.push([staffJob({ appointmentId: 'appt_other_salon' })], []);
    finishReadResults();

    await processIntegrationOutbox();

    expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'cancelled',
      lastError: 'SUPERSEDED',
    }));
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
