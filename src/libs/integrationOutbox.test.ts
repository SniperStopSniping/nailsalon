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
  insertedValues,
  insertResults,
  selectResults,
  updates,
} = vi.hoisted(() => {
  const insertedValues: Array<Record<string, unknown>> = [];
  const insertResults: unknown[][] = [];
  const selectResults: unknown[][] = [];
  const updates: Array<Record<string, unknown>> = [];
  const select = vi.fn(() => {
    const rows = selectResults.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.groupBy = () => chain;
    chain.orderBy = () => chain;
    chain.for = () => chain;
    chain.limit = async () => rows;
    chain.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  });
  const insert = vi.fn(() => ({
    values: vi.fn((values: Record<string, unknown>) => {
      insertedValues.push(values);
      const rows = insertResults.length > 0
        ? insertResults.shift()!
        : [{ id: `inserted_job_${insertedValues.length}` }];
      const conflictChain = {
        returning: vi.fn(async () => rows),
      };
      return {
        onConflictDoNothing: vi.fn(() => conflictChain),
        returning: vi.fn(async () => rows),
      };
    }),
  }));
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

  const db = {
    execute: vi.fn(async () => undefined),
    insert,
    select,
    update,
  } as {
    execute: ReturnType<typeof vi.fn>;
    insert: typeof insert;
    select: typeof select;
    transaction?: ReturnType<typeof vi.fn>;
    update: typeof update;
  };
  db.transaction = vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db));

  return {
    db,
    deleteGoogleCalendarEventForAppointment: vi.fn(),
    syncGoogleCalendarEventForAppointment: vi.fn(),
    listGoogleCalendarEventsForSalon: vi.fn(),
    retryCustomerBookingConfirmationEmail: vi.fn(),
    sendAppointmentOperationalEmailOnce: vi.fn(),
    mintAppointmentManageLink: vi.fn(),
    insertedValues,
    insertResults,
    selectResults,
    updates,
  };
});

vi.mock('@/libs/DB', () => ({
  db,
  usesRuntimePostgres: false,
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: async (work: (database: typeof db) => unknown) => work(db),
}));

vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment: (
    input: unknown,
    options: { dispatchFence?: <T>(operation: () => Promise<T>) => Promise<T> } = {},
  ) => {
    const operation = () => deleteGoogleCalendarEventForAppointment(input, options);
    return options.dispatchFence ? options.dispatchFence(operation) : operation();
  },
  deterministicGoogleCalendarEventId: vi.fn((input: {
    appointmentId: string;
    idempotencyKey: string;
    salonId: string;
  }) => `deterministic:${input.salonId}:${input.appointmentId}:${input.idempotencyKey}`),
  syncGoogleCalendarEventForAppointment: (
    input: unknown,
    options: { dispatchFence?: <T>(operation: () => Promise<T>) => Promise<T> } = {},
  ) => {
    const operation = () => syncGoogleCalendarEventForAppointment(input, options);
    return options.dispatchFence ? options.dispatchFence(operation) : operation();
  },
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
const MUTATION_VERSION = '2026-08-30T12:00:00.001Z';
const RECONCILIATION_VERSION = '2026-08-30T12:00:00.002Z';

function staffPayload() {
  return {
    appointmentId: 'appt_1',
    salonId: 'salon_1',
    previousStartTime: PREVIOUS_START,
    previousEndTime: PREVIOUS_END,
    newStartTime: NEW_START,
    newEndTime: NEW_END,
    mutationVersion: MUTATION_VERSION,
    timeZone: 'America/Toronto',
  };
}

function staffJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    salonId: 'salon_1',
    appointmentId: 'appt_1',
    provider: 'email',
    operation: 'staff_reschedule_notification',
    status: 'pending',
    attempts: 0,
    payload: staffPayload(),
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
  selectResults.push([], []);
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
      mutationVersion: new Date(MUTATION_VERSION),
      timeZone: 'America/Toronto',
    });

    expect(database.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'email',
      operation: 'staff_reschedule_notification',
      dedupeKey: `email:appt_1:staff_reschedule:${PREVIOUS_START}:${NEW_START}:${MUTATION_VERSION}`,
      payload: {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        previousStartTime: PREVIOUS_START,
        previousEndTime: PREVIOUS_END,
        newStartTime: NEW_START,
        newEndTime: NEW_END,
        mutationVersion: MUTATION_VERSION,
        timeZone: 'America/Toronto',
      },
    }));
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

describe('processIntegrationOutbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedValues.length = 0;
    insertResults.length = 0;
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

  it('uses the immutable payload version after a later appointment-row update', async () => {
    selectResults.push([staffJob()], [currentAppointment({
      updatedAt: new Date('2026-08-30T12:05:00.000Z'),
    })]);
    finishReadResults();

    const result = await processIntegrationOutbox();
    const input = sendAppointmentOperationalEmailOnce.mock.calls[0]![0];
    const content = await input.prepare();

    expect(result).toMatchObject({ scanned: 1, succeeded: 1, retried: 0 });
    expect(input).toMatchObject({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      purpose: 'client_appointment_rescheduled',
      eventVersion: [
        PREVIOUS_START,
        PREVIOUS_END,
        NEW_START,
        NEW_END,
        MUTATION_VERSION,
      ].join(':'),
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

  it.each([
    ['missing', { ...staffPayload(), mutationVersion: undefined }],
    ['malformed', { ...staffPayload(), mutationVersion: 'not-a-timestamp' }],
    ['noncanonical', { ...staffPayload(), mutationVersion: '2026-08-30T12:00:00Z' }],
    ['invalid-timezone', { ...staffPayload(), timeZone: 'Not/A_Time_Zone' }],
  ])('fails a %s staff payload without retry or delivery', async (_label, payload) => {
    selectResults.push([staffJob({ payload })]);
    finishReadResults();

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({ scanned: 1, retried: 0, failed: 1 });
    expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
    expect(mintAppointmentManageLink).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      lastError: 'INVALID_PAYLOAD',
      processedAt: expect.any(Date),
    }));
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

    expect(result).toMatchObject({ scanned: 1, succeeded: 0, retried: 0, failed: 1 });
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      lastError: 'RECIPIENT_UNAVAILABLE',
      processedAt: expect.any(Date),
    }));
    expect(updates.filter(update => update.status === 'retry')).toHaveLength(1);
  });

  it('refuses a cross-salon appointment identity before delivery', async () => {
    selectResults.push([staffJob({
      appointmentId: 'appt_other_salon',
      payload: {
        ...staffPayload(),
        appointmentId: 'appt_other_salon',
      },
    })], []);
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
      attempts: expect.anything(),
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
    expect(updates.filter(update => 'attempts' in update)).toHaveLength(1);
  });

  it('retires a legacy delayed upsert without guessing the calendar of a scalar-only event', async () => {
    const terminalAppointment = {
      id: 'appt_1',
      salonId: 'salon_1',
      googleCalendarEventId: 'google_event_late',
      status: 'cancelled',
      deletedAt: null,
      updatedAt: new Date(MUTATION_VERSION),
    };
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
      [],
      [terminalAppointment],
      [terminalAppointment],
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
      queuedCancelledEvents: 0,
      skippedCancelledEvents: 0,
      failedCancelledEvents: 0,
    });
    expect(syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(insertedValues).toEqual([]);
  });

  it('queues a durable reconciliation delete for a cancelled linked event', async () => {
    selectResults.push(
      [],
      [{
        reconciliationMirrorId: 'gce_old_cancel',
        appointmentId: 'appt_old_cancel',
        salonId: 'salon_1',
        googleCalendarEventId: 'google_event_stuck',
        observedVersion: new Date(RECONCILIATION_VERSION),
        appointmentExists: true,
        targetCalendarId: 'primary',
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
      queuedCancelledEvents: 1,
      skippedCancelledEvents: 0,
      failedCancelledEvents: 0,
    });
    expect(deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(insertedValues).toContainEqual(expect.objectContaining({
      appointmentId: 'appt_old_cancel',
      salonId: 'salon_1',
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: `google:salon_1:appt_old_cancel:delete:reconciliation:primary:google_event_stuck:${RECONCILIATION_VERSION}`,
      payload: {
        appointmentId: 'appt_old_cancel',
        salonId: 'salon_1',
        mutationVersion: RECONCILIATION_VERSION,
        googleCalendarEventId: 'google_event_stuck',
        targetCalendarId: 'primary',
        reconciliation: true,
        reconciliationMirrorId: 'gce_old_cancel',
        reconciliationExpectedAppointmentId: 'appt_old_cancel',
      },
    }));
  });

  it('reports a deduplicated reconciliation delete without calling the provider', async () => {
    insertResults.push([]);
    selectResults.push(
      [],
      [{
        reconciliationMirrorId: 'gce_read_only',
        appointmentId: 'appt_read_only',
        salonId: 'salon_1',
        googleCalendarEventId: 'google_event_read_only',
        observedVersion: new Date(RECONCILIATION_VERSION),
        appointmentExists: true,
        targetCalendarId: 'primary',
      }],
      [],
    );

    const result = await processIntegrationOutbox();

    expect(result).toMatchObject({
      cancelledEventCandidates: 1,
      queuedCancelledEvents: 0,
      skippedCancelledEvents: 1,
      failedCancelledEvents: 0,
    });
    expect(deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(insertedValues).toHaveLength(1);
  });

  it('queues a durable delete for an orphaned remote mirror from private appointment metadata', async () => {
    selectResults.push(
      [],
      [],
      [{ salonId: 'salon_1', destinationCalendarId: 'primary' }],
      [],
      [{
        id: 'appt_orphan',
        status: 'cancelled',
        canvasState: 'cancelled',
        deletedAt: null,
        updatedAt: new Date(RECONCILIATION_VERSION),
      }],
      [],
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
      queuedCancelledEvents: 1,
    });
    expect(listGoogleCalendarEventsForSalon).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      privateExtendedProperties: ['salonId=salon_1'],
    }), expect.objectContaining({ signal: undefined }));
    expect(deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(insertedValues).toContainEqual(expect.objectContaining({
      appointmentId: 'appt_orphan',
      dedupeKey: `google:salon_1:appt_orphan:delete:reconciliation:primary:google_event_orphan:${RECONCILIATION_VERSION}`,
      payload: expect.objectContaining({
        appointmentId: 'appt_orphan',
        mutationVersion: RECONCILIATION_VERSION,
        reconciliation: true,
      }),
    }));
  });

  it('queues a durable delete for a legacy canvas cancellation whose status was left active', async () => {
    selectResults.push(
      [],
      [],
      [{ salonId: 'salon_1', destinationCalendarId: 'primary' }],
      [],
      [{
        id: 'appt_legacy',
        status: 'confirmed',
        canvasState: 'cancelled',
        deletedAt: null,
        updatedAt: new Date(RECONCILIATION_VERSION),
      }],
      [],
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
      queuedCancelledEvents: 1,
    });
    expect(deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(insertedValues).toContainEqual(expect.objectContaining({
      appointmentId: 'appt_legacy',
      dedupeKey: `google:salon_1:appt_legacy:delete:reconciliation:primary:google_event_legacy:${RECONCILIATION_VERSION}`,
    }));
  });

  it('queues orphan cleanup without a foreign-key appointment link when the row no longer exists', async () => {
    selectResults.push(
      [],
      [],
      [{ salonId: 'salon_1', destinationCalendarId: 'primary' }],
      [],
      [],
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
      queuedCancelledEvents: 1,
    });
    expect(deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(insertedValues).toContainEqual(expect.objectContaining({
      appointmentId: null,
      dedupeKey: 'google:salon_1:appt_missing:delete:reconciliation:primary:google_event_missing_appointment:2026-07-22T16:00:00.000Z',
      payload: {
        appointmentId: 'appt_missing',
        salonId: 'salon_1',
        mutationVersion: null,
        googleCalendarEventId: 'google_event_missing_appointment',
        targetCalendarId: 'primary',
        reconciliation: true,
      },
    }));
  });
});
