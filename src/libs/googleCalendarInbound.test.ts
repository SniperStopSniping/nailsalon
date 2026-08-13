/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  db,
  insertValues,
  insertResults,
  selectResults,
  updateSet,
  updateResults,
  listGoogleCalendarEventsForSalon,
  listGoogleCalendarsForSalon,
  AppointmentManageError,
  inboundGoogleFeedbackIsSupersededInTx,
  runAppointmentManageMutation,
  getAppointmentCalendarEventForSync,
  enqueueGoogleCalendarDeleteInTx,
  enqueueGoogleCalendarSnapshotInTx,
  acquireGoogleCalendarEventPairMutationBarrierInTx,
  resolveAppointmentOperationalEmailRecipient,
  sendAppointmentOperationalEmailOnce,
  sendTransactionalEmail,
  logAppointmentChange,
  updateReturning,
} = vi.hoisted(() => {
  class AppointmentManageError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  const selectResults: unknown[][] = [];
  const createSelectQuery = () => {
    let consumed = false;
    let value: unknown[] = [];
    const consume = () => {
      if (!consumed) {
        value = selectResults.shift() ?? [];
        consumed = true;
      }
      return value;
    };
    const query = {
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      for: vi.fn(),
      then: (
        resolve: (result: unknown[]) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(consume()).then(resolve, reject),
    };
    query.where.mockImplementation(() => query);
    query.orderBy.mockImplementation(() => query);
    query.limit.mockImplementation(() => query);
    query.for.mockImplementation(() => query);
    return query;
  };
  const select = vi.fn(() => ({
    from: vi.fn(() => createSelectQuery()),
  }));
  const updateResults: Array<
    unknown[] | ((values: Record<string, unknown>) => unknown[])
  > = [];
  const updateReturning = vi.fn(async (values: Record<string, unknown>) => {
    const result = updateResults.shift();
    return typeof result === 'function' ? result(values) : result ?? [];
  });
  const updateSet = vi.fn((values: Record<string, unknown>) => {
    const updateResult = {
      returning: () => updateReturning(values),
      then: (
        resolve: (value: undefined) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    return { where: vi.fn(() => updateResult) };
  });
  const update = vi.fn(() => ({ set: updateSet }));
  const insertResults: unknown[][] = [];
  const insertReturning = vi.fn(async () => insertResults.shift() ?? []);
  const onConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
  const insertValues = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const inboundGoogleFeedbackIsSupersededInTx = vi.fn(async (
    database: {
      select: () => {
        from: (table?: unknown) => {
          where: (condition?: unknown) => PromiseLike<Array<{
            mutationVersion?: string | null;
            status?: string;
          }>>;
        };
      };
    },
    input: {
      appointmentId: string;
      salonId: string;
      remoteMutationVersion?: Date | null;
    },
  ) => {
    const intents = await database.select().from().where();
    const runnableStatuses = ['pending', 'retry', 'processing'];
    if (!input.remoteMutationVersion) {
      return intents.some(intent => (
        intent.status && runnableStatuses.includes(intent.status)
      ));
    }
    const remoteRevision = input.remoteMutationVersion.getTime();
    return intents.some((intent) => {
      if (!intent.mutationVersion) {
        return false;
      }
      const parsed = new Date(intent.mutationVersion);

      return !Number.isNaN(parsed.getTime())
        && parsed.toISOString() === intent.mutationVersion
        && (
          parsed.getTime() > remoteRevision
          || (
            parsed.getTime() === remoteRevision
            && Boolean(intent.status && runnableStatuses.includes(intent.status))
          )
        );
    });
  });

  return {
    db: {
      select,
      update,
      insert,
      transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        select,
        update,
        insert,
      })),
    },
    insertValues,
    insertResults,
    selectResults,
    updateSet,
    updateResults,
    listGoogleCalendarEventsForSalon: vi.fn(),
    listGoogleCalendarsForSalon: vi.fn(),
    AppointmentManageError,
    inboundGoogleFeedbackIsSupersededInTx,
    runAppointmentManageMutation: vi.fn(),
    getAppointmentCalendarEventForSync: vi.fn(),
    enqueueGoogleCalendarDeleteInTx: vi.fn(),
    enqueueGoogleCalendarSnapshotInTx: vi.fn(),
    acquireGoogleCalendarEventPairMutationBarrierInTx: vi.fn(async () => true),
    resolveAppointmentOperationalEmailRecipient: vi.fn(),
    sendAppointmentOperationalEmailOnce: vi.fn(),
    sendTransactionalEmail: vi.fn(),
    logAppointmentChange: vi.fn(),
    updateReturning,
  };
});

vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/googleCalendar', () => ({ listGoogleCalendarEventsForSalon, listGoogleCalendarsForSalon }));
vi.mock('@/libs/appointmentManage', () => ({
  AppointmentManageError,
  getAppointmentCalendarEventForSync,
  inboundGoogleFeedbackIsSupersededInTx,
  runAppointmentManageMutation,
}));
vi.mock('@/libs/integrationOutbox', () => ({
  acquireGoogleCalendarEventPairMutationBarrierInTx,
  enqueueGoogleCalendarDeleteInTx,
  enqueueGoogleCalendarSnapshotInTx,
}));
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  resolveAppointmentOperationalEmailRecipient,
  sendAppointmentOperationalEmailOnce,
}));
vi.mock('@/libs/email', () => ({ sendTransactionalEmail }));
vi.mock('@/libs/appointmentAudit', () => ({ logAppointmentChange }));
import { processGoogleCalendarInboundSync } from './googleCalendarInbound';

const connection = {
  salonId: 'salon_1',
  inboundSyncedAt: new Date('2026-07-15T15:00:00.000Z'),
  destinationCalendarId: 'calendar_1',
  busyCalendarIds: ['calendar_1'],
};

const salon = {
  name: 'Best Nails',
  settings: { booking: { timezone: 'America/Toronto' } },
};

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  status: 'confirmed',
  startTime: new Date('2026-07-16T14:00:00.000Z'),
  endTime: new Date('2026-07-16T15:30:00.000Z'),
  clientEmail: 'client@example.com',
  clientName: 'Ava',
  notes: null,
  updatedAt: new Date('2026-07-15T15:00:00.000Z'),
};

const mirrorUpdatedAt = new Date('2026-07-15T14:00:00.000Z');

function linkedMirror(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gce_1',
    salonId: 'salon_1',
    calendarId: 'calendar_1',
    googleEventId: 'google_1',
    appointmentId: 'appt_1',
    reviewStatus: 'appointment',
    syncMode: 'bidirectional',
    sourceAccessRole: 'owner',
    googleUpdatedAt: new Date('2026-07-15T14:00:00.000Z'),
    deletedAt: null,
    updatedAt: mirrorUpdatedAt,
    ...overrides,
  };
}

function remoteMove(overrides: Record<string, unknown> = {}) {
  return {
    id: 'google_1',
    calendarId: 'calendar_1',
    appointmentId: 'appt_1',
    salonId: 'salon_1',
    status: 'confirmed',
    summary: 'Ava appointment',
    description: null,
    location: null,
    recurringEventId: null,
    transparency: 'busy',
    isAllDay: false,
    updatedAt: new Date('2026-07-15T16:00:00.000Z'),
    startTime: new Date('2026-07-16T16:00:00.000Z'),
    endTime: new Date('2026-07-16T17:45:00.000Z'),
    ...overrides,
  };
}

function remoteCancellation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'google_1',
    calendarId: 'calendar_1',
    appointmentId: 'appt_1',
    salonId: 'salon_1',
    status: 'cancelled',
    summary: null,
    description: null,
    location: null,
    recurringEventId: null,
    transparency: 'busy',
    isAllDay: false,
    updatedAt: new Date('2026-07-15T16:00:00.000Z'),
    startTime: null,
    endTime: null,
    ...overrides,
  };
}

describe('processGoogleCalendarInboundSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    updateResults.length = 0;
    insertResults.length = 0;
    listGoogleCalendarEventsForSalon.mockResolvedValue([]);
    listGoogleCalendarsForSalon.mockResolvedValue([{ id: 'calendar_1', accessRole: 'owner' }]);
    runAppointmentManageMutation.mockResolvedValue({
      appointment: {
        updatedAt: new Date('2026-07-15T16:00:00.000Z'),
      },
      warnings: [],
    });
    resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'terminal_current',
      email: 'current@example.com',
      terminalClientId: 'client_1',
    });
    sendTransactionalEmail.mockResolvedValue(true);
    sendAppointmentOperationalEmailOnce.mockImplementation(async (input) => {
      const content = await input.prepare();
      const recipient = await resolveAppointmentOperationalEmailRecipient({
        salonId: input.salonId,
        appointmentId: input.appointmentId,
      });
      if (recipient.status === 'unavailable') {
        return { status: 'unavailable', deliveryId: 'delivery_1' };
      }
      const sent = await sendTransactionalEmail({
        to: recipient.email,
        ...content,
      });
      return {
        status: sent ? 'sent' : 'failed',
        deliveryId: 'delivery_1',
      };
    });
    updateReturning.mockImplementation(async (values: Record<string, unknown>) => {
      const result = updateResults.shift();
      return typeof result === 'function' ? result(values) : result ?? [];
    });
  });

  it('initializes a bounded calendar import without flooding historical review', async () => {
    selectResults.push([{ ...connection, inboundSyncedAt: null }], [salon]);

    const result = await processGoogleCalendarInboundSync();

    expect(result.initializedConnections).toBe(1);
    expect(listGoogleCalendarEventsForSalon).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      startTime: expect.any(Date),
      endTime: expect.any(Date),
    }), { signal: undefined });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      inboundSyncedAt: expect.any(Date),
      inboundSyncError: null,
    }));
  });

  it('does not dispatch Google work when the parent budget is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('INTEGRATION_WORKER_BUDGET_EXCEEDED'));

    await expect(processGoogleCalendarInboundSync(
      2,
      undefined,
      { signal: controller.signal },
    )).rejects.toThrow('INTEGRATION_WORKER_BUDGET_EXCEEDED');

    expect(listGoogleCalendarsForSalon).not.toHaveBeenCalled();
    expect(listGoogleCalendarEventsForSalon).not.toHaveBeenCalled();
  });

  it('passes the parent budget signal through both Google list calls', async () => {
    selectResults.push([connection], [salon]);
    const controller = new AbortController();

    await processGoogleCalendarInboundSync(1, undefined, {
      signal: controller.signal,
    });

    expect(listGoogleCalendarsForSalon).toHaveBeenCalledWith('salon_1', {
      signal: controller.signal,
    });
    expect(listGoogleCalendarEventsForSalon).toHaveBeenCalledWith(
      expect.objectContaining({ salonId: 'salon_1' }),
      { signal: controller.signal },
    );
  });

  it('moves and resizes a tenant appointment changed in Google Calendar', async () => {
    const remoteUpdatedAt = new Date('2026-07-15T16:00:00.000Z');
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [],
    );
    updateResults.push(values => [{ ...mirror, ...values }]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'confirmed',
      summary: 'Ava appointment',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: remoteUpdatedAt,
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      endTime: new Date('2026-07-16T17:45:00.000Z'),
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(runAppointmentManageMutation).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      operation: 'move',
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      durationMinutes: 105,
      canReassignTechnician: false,
      sourceEventFence: {
        rowId: 'gce_1',
        calendarId: 'calendar_1',
        googleEventId: 'google_1',
        googleUpdatedAt: remoteUpdatedAt,
        remoteMutationVersion: null,
      },
    }));
    expect(result.movedAppointments).toBe(1);
    expect(logAppointmentChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'time_changed',
      salonId: 'salon_1',
      performedBy: 'google-calendar-sync',
    }));
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'current@example.com',
      subject: 'Best Nails appointment rescheduled',
    }));
    expect(runAppointmentManageMutation.mock.invocationCallOrder[0])
      .toBeLessThan(sendAppointmentOperationalEmailOnce.mock.invocationCallOrder[0]!);
    expect(logAppointmentChange.mock.invocationCallOrder[0])
      .toBeLessThan(sendAppointmentOperationalEmailOnce.mock.invocationCallOrder[0]!);
  });

  it.each(['pending', 'retry', 'processing'] as const)(
    'does not apply unattributed provider feedback over a %s local Google intent',
    async (intentStatus) => {
      const mirror = linkedMirror();
      const manageApplied = vi.fn();
      selectResults.push(
        [connection],
        [salon],
        [mirror],
        [mirror],
        [appointment],
        [{
          mutationVersion: appointment.updatedAt.toISOString(),
          status: intentStatus,
        }],
      );
      updateResults.push(values => [{ ...mirror, ...values }]);
      listGoogleCalendarEventsForSalon.mockResolvedValue([remoteMove()]);
      runAppointmentManageMutation.mockImplementationOnce(async (input) => {
        const superseded = await inboundGoogleFeedbackIsSupersededInTx(db, {
          appointmentId: input.appointmentId,
          salonId: input.salonId,
          remoteMutationVersion: input.sourceEventFence?.remoteMutationVersion,
        });
        if (superseded) {
          throw new AppointmentManageError(
            'STALE_GOOGLE_FEEDBACK',
            'A newer local Google Calendar operation owns this appointment.',
          );
        }
        manageApplied();
        return { appointment: {}, warnings: [] };
      });

      const result = await processGoogleCalendarInboundSync();

      expect(runAppointmentManageMutation).toHaveBeenCalledOnce();
      expect(manageApplied).not.toHaveBeenCalled();
      expect(inboundGoogleFeedbackIsSupersededInTx).toHaveBeenCalledWith(
        expect.anything(),
        {
          appointmentId: 'appt_1',
          salonId: 'salon_1',
          remoteMutationVersion: null,
        },
      );
      expect(result.movedAppointments).toBe(0);
      expect(result.conflicts).toBe(0);
      expect(logAppointmentChange).not.toHaveBeenCalled();
      expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
    },
  );

  it('hands an immutable source fence to the manage transaction when newer local state wins the race', async () => {
    const remoteUpdatedAt = new Date('2026-07-15T16:00:00.000Z');
    const newerRevision = new Date('2026-07-15T16:30:00.000Z');
    const mirror = linkedMirror();
    const expectedFence = {
      rowId: 'gce_1',
      calendarId: 'calendar_1',
      googleEventId: 'google_1',
      googleUpdatedAt: remoteUpdatedAt,
      remoteMutationVersion: appointment.updatedAt,
    };
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [{ mutationVersion: newerRevision.toISOString(), status: 'completed' }],
    );
    updateResults.push(values => [{ ...mirror, ...values }]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([remoteMove({
      mutationVersion: appointment.updatedAt.toISOString(),
      updatedAt: remoteUpdatedAt,
    })]);
    runAppointmentManageMutation.mockImplementationOnce(async (input) => {
      expect(input.sourceEventFence).toEqual(expectedFence);

      const superseded = await inboundGoogleFeedbackIsSupersededInTx(db, {
        appointmentId: input.appointmentId,
        salonId: input.salonId,
        remoteMutationVersion: input.sourceEventFence?.remoteMutationVersion,
      });
      if (superseded) {
        throw new AppointmentManageError(
          'STALE_GOOGLE_FEEDBACK',
          'A newer local Google Calendar operation owns this appointment.',
        );
      }
      return { appointment: {}, warnings: [] };
    });

    const result = await processGoogleCalendarInboundSync();

    expect(runAppointmentManageMutation).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      sourceEventFence: expectedFence,
    }));
    expect(inboundGoogleFeedbackIsSupersededInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        remoteMutationVersion: appointment.updatedAt,
      },
    );
    expect(enqueueGoogleCalendarSnapshotInTx).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
      googleCalendarSyncStatus: 'failed',
    }));
    expect(result).toMatchObject({ conflicts: 0, movedAppointments: 0 });
    expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
  });

  it('accepts a legitimate move after unrelated appointment bookkeeping', async () => {
    const remoteRevision = appointment.updatedAt;
    const bookkeepingAppointment = {
      ...appointment,
      updatedAt: new Date('2026-07-15T16:30:00.000Z'),
    };
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [bookkeepingAppointment],
      [],
    );
    updateResults.push(values => [{ ...mirror, ...values }]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([remoteMove({
      mutationVersion: remoteRevision.toISOString(),
    })]);
    runAppointmentManageMutation.mockImplementationOnce(async (input) => {
      const superseded = await inboundGoogleFeedbackIsSupersededInTx(db, {
        appointmentId: input.appointmentId,
        salonId: input.salonId,
        remoteMutationVersion: input.sourceEventFence?.remoteMutationVersion,
      });
      if (superseded) {
        throw new AppointmentManageError(
          'STALE_GOOGLE_FEEDBACK',
          'A newer local Google Calendar operation owns this appointment.',
        );
      }
      return { appointment: {}, warnings: [] };
    });

    const result = await processGoogleCalendarInboundSync();

    expect(inboundGoogleFeedbackIsSupersededInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        remoteMutationVersion: remoteRevision,
      },
    );
    expect(result.movedAppointments).toBe(1);
    expect(logAppointmentChange).toHaveBeenCalledOnce();
    expect(sendAppointmentOperationalEmailOnce).toHaveBeenCalledOnce();
  });

  it('deduplicates repeated customer email delivery for the same inbound move', async () => {
    const remote = {
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'confirmed',
      summary: 'Ava appointment',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: new Date('2026-07-15T16:00:00.000Z'),
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      endTime: new Date('2026-07-16T17:45:00.000Z'),
    };
    const firstMirror = linkedMirror();
    const secondMirror = linkedMirror({ googleUpdatedAt: remote.updatedAt });
    selectResults.push(
      [connection],
      [salon],
      [firstMirror],
      [firstMirror],
      [appointment],
      [connection],
      [salon],
      [secondMirror],
      [secondMirror],
      [appointment],
      [],
    );
    updateResults.push(
      values => [{ ...firstMirror, ...values }],
      values => [{ ...secondMirror, ...values }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValue([remote]);
    sendAppointmentOperationalEmailOnce
      .mockImplementationOnce(async (input) => {
        const content = await input.prepare();
        await sendTransactionalEmail({
          to: 'current@example.com',
          ...content,
        });
        return { status: 'sent', deliveryId: 'delivery_1' };
      })
      .mockResolvedValueOnce({ status: 'duplicate', deliveryId: 'delivery_1' });

    await processGoogleCalendarInboundSync();
    await processGoogleCalendarInboundSync();

    expect(sendAppointmentOperationalEmailOnce).toHaveBeenCalledTimes(2);

    const [first, second] = sendAppointmentOperationalEmailOnce.mock.calls;

    expect(first![0].eventVersion).toBe(second![0].eventVersion);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it('imports a current Google event separately from CRM appointments', async () => {
    // Relative dates: the import path marks events ending before "now" as
    // already reviewed, so a hardcoded date would rot into a false failure.
    const upcomingStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const upcomingEnd = new Date(upcomingStart.getTime() + 90 * 60 * 1000);

    selectResults.push([connection], [salon], [], []);
    insertResults.push([linkedMirror({
      id: 'gce_external_1',
      googleEventId: 'google_external_1',
      appointmentId: null,
      reviewStatus: 'needs_review',
    })]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_external_1',
      calendarId: 'calendar_1',
      appointmentId: null,
      salonId: null,
      status: 'confirmed',
      summary: 'Maya nails',
      description: 'Bring colour sample',
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      startTime: upcomingStart,
      endTime: upcomingEnd,
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      googleEventId: 'google_external_1',
      title: 'Maya nails',
      reviewStatus: 'needs_review',
      appointmentId: null,
    }));
    expect(result.importedEvents).toBe(1);
    expect(runAppointmentManageMutation).not.toHaveBeenCalled();
    expect(acquireGoogleCalendarEventPairMutationBarrierInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        expectedMirrorId: null,
        expectedSalonId: 'salon_1',
        targetCalendarId: 'calendar_1',
        googleCalendarEventId: 'google_external_1',
      },
    );
  });

  it('cancels a matching appointment when its connected Google event is deleted', async () => {
    const remoteUpdatedAt = new Date('2026-07-15T16:00:00.000Z');
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [appointment],
      [mirror],
      [],
    );
    updateResults.push(
      values => [{ ...mirror, ...values }],
      values => [{ ...appointment, ...values }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: remoteUpdatedAt,
      mutationVersion: remoteUpdatedAt.toISOString(),
      startTime: null,
      endTime: null,
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      googleCalendarEventId: null,
    }));
    expect(result.cancelledAppointments).toBe(1);
    expect(logAppointmentChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'cancelled',
      salonId: 'salon_1',
    }));
    expect(enqueueGoogleCalendarDeleteInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        mutationVersion: expect.any(Date),
        googleCalendarEventId: 'google_1',
        targetCalendarId: 'calendar_1',
        authoritativeTerminalDelete: true,
      },
    );

    const terminalUpdate = updateSet.mock.calls.find(
      ([values]) => values.status === 'cancelled',
    )?.[0];

    expect(enqueueGoogleCalendarDeleteInTx.mock.calls[0]?.[1].mutationVersion)
      .toBe(terminalUpdate?.updatedAt);
    expect(updateReturning.mock.invocationCallOrder[0])
      .toBeLessThan(sendAppointmentOperationalEmailOnce.mock.invocationCallOrder[0]!);
    expect(logAppointmentChange.mock.invocationCallOrder[0])
      .toBeLessThan(sendAppointmentOperationalEmailOnce.mock.invocationCallOrder[0]!);
  });

  it('does not cancel when a later durable Google intent supersedes the outbound tombstone', async () => {
    const remoteRevision = appointment.updatedAt;
    const laterIntentRevision = new Date('2026-07-15T16:30:00.000Z');
    const mirror = linkedMirror();
    const beforeCancellationTransaction = vi.fn(async () => undefined);
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [appointment],
      [mirror],
      [{
        mutationVersion: laterIntentRevision.toISOString(),
        status: 'completed',
      }],
    );
    updateResults.push(
      values => [{ ...mirror, ...values }],
      values => [{ ...appointment, ...values }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValue([remoteCancellation({
      mutationVersion: remoteRevision.toISOString(),
    })]);

    const result = await processGoogleCalendarInboundSync(
      25,
      undefined,
      { beforeCancellationTransaction },
    );

    expect(beforeCancellationTransaction).toHaveBeenCalledWith('appt_1');
    expect(inboundGoogleFeedbackIsSupersededInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        remoteMutationVersion: remoteRevision,
      },
    );
    expect(result).toMatchObject({
      cancelledAppointments: 0,
      failedConnections: 0,
    });
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
    }));
    expect(enqueueGoogleCalendarDeleteInTx).not.toHaveBeenCalled();
    expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
  });

  it('rechecks a runnable local reactivation intent under the cancellation lock', async () => {
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [appointment],
      [mirror],
      [{ mutationVersion: null, status: 'processing' }],
    );
    updateResults.push(
      values => [{ ...mirror, ...values }],
      values => [{ ...appointment, ...values }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValue([remoteCancellation()]);

    const result = await processGoogleCalendarInboundSync();

    expect(inboundGoogleFeedbackIsSupersededInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        remoteMutationVersion: null,
      },
    );
    expect(result).toMatchObject({
      cancelledAppointments: 0,
      failedConnections: 0,
    });
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
    }));
    expect(enqueueGoogleCalendarDeleteInTx).not.toHaveBeenCalled();
    expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
  });

  it('accepts a legitimate delete after unrelated appointment bookkeeping', async () => {
    const remoteRevision = appointment.updatedAt;
    const bookkeepingAppointment = {
      ...appointment,
      updatedAt: new Date('2026-07-15T16:30:00.000Z'),
    };
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [bookkeepingAppointment],
      [bookkeepingAppointment],
      [mirror],
      [],
    );
    updateResults.push(
      values => [{ ...mirror, ...values }],
      values => [{ ...bookkeepingAppointment, ...values }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValue([remoteCancellation({
      mutationVersion: remoteRevision.toISOString(),
    })]);

    const result = await processGoogleCalendarInboundSync();

    expect(inboundGoogleFeedbackIsSupersededInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        remoteMutationVersion: remoteRevision,
      },
    );
    expect(result.cancelledAppointments).toBe(1);
    expect(enqueueGoogleCalendarDeleteInTx).toHaveBeenCalledOnce();
  });

  it('keeps a moved appointment successful when its audit fails afterward', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [],
    );
    updateResults.push(values => [{ ...mirror, ...values }]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'confirmed',
      summary: 'Ava appointment',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: new Date('2026-07-15T16:00:00.000Z'),
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      endTime: new Date('2026-07-16T17:45:00.000Z'),
    }]);
    logAppointmentChange.mockRejectedValueOnce(new Error('audit unavailable'));

    const result = await processGoogleCalendarInboundSync();

    expect(result.movedAppointments).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(sendAppointmentOperationalEmailOnce).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('keeps a Google move committed when current-recipient delivery fails', async () => {
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
    );
    updateResults.push(values => [{ ...mirror, ...values }]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'confirmed',
      summary: 'Ava appointment',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: new Date('2026-07-15T16:00:00.000Z'),
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      endTime: new Date('2026-07-16T17:45:00.000Z'),
    }]);
    resolveAppointmentOperationalEmailRecipient.mockRejectedValue(
      new Error('database unavailable'),
    );

    const result = await processGoogleCalendarInboundSync();

    expect(result.movedAppointments).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('durably schedules a stable restore when an inbound move conflicts', async () => {
    const remoteUpdatedAt = new Date('2026-07-15T16:00:00.000Z');
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [salon],
      [{ updatedAt: appointment.updatedAt }],
    );
    updateResults.push(values => [{ ...mirror, ...values }]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'confirmed',
      summary: 'Ava appointment',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: remoteUpdatedAt,
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      endTime: new Date('2026-07-16T17:45:00.000Z'),
    }]);
    runAppointmentManageMutation.mockRejectedValueOnce(new Error('slot conflict'));
    getAppointmentCalendarEventForSync.mockResolvedValue({
      id: appointment.id,
      clientName: appointment.clientName,
      clientPhone: '4165550100',
      endTime: appointment.endTime.toISOString(),
      googleCalendarEventId: 'google_1',
      locationAddress: null,
      locationName: null,
      notes: null,
      serviceLabel: 'Manicure',
      startTime: appointment.startTime.toISOString(),
      technicianName: 'Taylor',
      timeZone: 'America/Toronto',
      totalDurationMinutes: 90,
      totalPrice: 5000,
      updatedAt: appointment.updatedAt.toISOString(),
    });

    const result = await processGoogleCalendarInboundSync();

    expect(result.conflicts).toBe(1);
    expect(enqueueGoogleCalendarSnapshotInTx).toHaveBeenCalledTimes(1);
    expect(enqueueGoogleCalendarSnapshotInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appointmentId: 'appt_1',
        startTime: appointment.startTime,
        endTime: appointment.endTime,
      }),
      {
        cause: {
          kind: 'inbound_restore',
          sourceEventId: 'calendar_1:google_1',
          sourceVersion: remoteUpdatedAt.toISOString(),
        },
        mutationVersion: appointment.updatedAt,
      },
    );
  });

  it('keeps a Google cancellation committed when recipient state is unsupported', async () => {
    const remoteUpdatedAt = new Date('2026-07-15T16:00:00.000Z');
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
      [appointment],
      [appointment],
      [mirror],
      [],
    );
    updateResults.push(
      values => [{ ...mirror, ...values }],
      values => [{ ...appointment, ...values }],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: remoteUpdatedAt,
      mutationVersion: remoteUpdatedAt.toISOString(),
      startTime: null,
      endTime: null,
    }]);
    resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'unavailable',
      reason: 'unsupported_client_identity',
    });

    const result = await processGoogleCalendarInboundSync();

    expect(result.cancelledAppointments).toBe(1);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('ignores an event whose private salon marker does not match the connection', async () => {
    selectResults.push([connection], [salon]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_1',
      salonId: 'salon_2',
      status: 'confirmed',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: new Date(),
      startTime: new Date(),
      endTime: new Date(),
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(runAppointmentManageMutation).not.toHaveBeenCalled();
    expect(result.movedAppointments).toBe(0);
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
      googleStatus: 'cancelled',
    }));
    expect(enqueueGoogleCalendarDeleteInTx).not.toHaveBeenCalled();
  });

  it('ignores remote metadata that conflicts with the exact stored appointment owner', async () => {
    const mirror = linkedMirror();
    selectResults.push(
      [connection],
      [salon],
      [mirror],
      [mirror],
    );
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      calendarId: 'calendar_1',
      appointmentId: 'appt_other',
      salonId: 'salon_1',
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      updatedAt: new Date(),
      startTime: null,
      endTime: null,
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(result).toMatchObject({
      cancelledAppointments: 0,
      movedAppointments: 0,
      failedConnections: 0,
    });
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
      googleStatus: 'cancelled',
    }));
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
    }));
    expect(enqueueGoogleCalendarDeleteInTx).not.toHaveBeenCalled();
    expect(runAppointmentManageMutation).not.toHaveBeenCalled();
  });
});
