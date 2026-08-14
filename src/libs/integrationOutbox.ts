import * as Sentry from '@sentry/nextjs';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';

import {
  type DatabaseSessionHandle,
  DatabaseSessionReleaseError,
  db,
  usesRuntimePostgres,
  withDedicatedDatabaseSession,
} from '@/libs/DB';
import { Env } from '@/libs/Env';
import {
  deleteGoogleCalendarEventForAppointment,
  deterministicGoogleCalendarEventId,
  type GoogleCalendarAppointmentEventInput,
  listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment,
} from '@/libs/googleCalendar';
import type {
  SalonNotificationCancellation,
  SalonNotificationEventKey,
  SalonNotificationPreviousSchedule,
  SalonNotificationRefundMetadata,
  SalonNotificationSource,
} from '@/libs/salonNotificationEmail';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import {
  appointmentSchema,
  googleCalendarEventSchema,
  integrationOutboxSchema,
  notificationDeliverySchema,
  salonGoogleCalendarConnectionSchema,
  salonSchema,
} from '@/models/Schema';

type SerializedGoogleEvent = Omit<
  GoogleCalendarAppointmentEventInput,
  'startTime' | 'endTime'
> & {
  startTime: string;
  endTime: string;
};

type StaffRescheduleNotificationInput<T extends Date | string>
  = Record<'appointmentId' | 'salonId' | 'timeZone', string>
  & Record<'previousStartTime' | 'previousEndTime' | 'newStartTime' | 'newEndTime' | 'mutationVersion', T>;
type OutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type OutboxDatabase = OutboxTransaction | DatabaseSessionHandle;
type IntegrationOutboxRow = typeof integrationOutboxSchema.$inferSelect;

type AppointmentMutationCalendarInput = {
  appointmentId: string;
  salonId: string;
  mutationVersion: Date;
};

type GoogleCalendarMutationPayload = {
  appointmentId: string;
  salonId: string;
  mutationVersion?: string | null;
  googleCalendarEventId?: string | null;
  adminCopySourceEventId?: string;
  adminCopyGeneration?: number;
  /** Raw provider idempotency identity chosen once for this lifecycle. */
  providerEventIdentity?: string;
  /** True only after execution reaches the provider boundary for this row. */
  providerDispatchStarted?: true;
  providerEventLane?: string;
  targetCalendarId?: string;
  reconciliationMirrorId?: string;
  reconciliationExpectedAppointmentId?: string | null;
  authoritativeTerminalDelete?: boolean;
};

function queryResultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  const withRows = result as { rows?: unknown } | null;
  return Array.isArray(withRows?.rows) ? withRows.rows as T[] : [];
}

function isGoogleCalendarDispatchFenceError(
  error: unknown,
): error is Error & { cause: unknown } {
  return error instanceof Error
    && error.name === 'GoogleCalendarDispatchFenceError'
    && 'cause' in error;
}

class GoogleCalendarDispatchBusyError extends Error {
  constructor() {
    super('GOOGLE_CALENDAR_DISPATCH_BUSY');
    this.name = 'GoogleCalendarDispatchBusyError';
  }
}

export function isGoogleCalendarDispatchBusyError(error: unknown) {
  return error instanceof GoogleCalendarDispatchBusyError;
}

class GoogleCalendarPreparedInputStaleError extends Error {
  constructor() {
    super('GOOGLE_CALENDAR_PREPARED_INPUT_STALE');
    this.name = 'GoogleCalendarPreparedInputStaleError';
  }
}

const AUTHORITATIVE_GOOGLE_INTENT_STATUSES: Array<IntegrationOutboxRow['status']> = [
  'pending',
  'retry',
  'processing',
  'completed',
  'failed',
  'cancelled',
];

/**
 * The two D5-owned operations whose exhaustion is a money-visible event.
 * Runbook query 5b selects exactly these rows in `status='failed'`.
 */
const DEPOSIT_OUTBOX_OPERATIONS = new Set([
  'booking_confirmed_side_effects',
  'deposit_refund_notices',
]);

function parseStaffRescheduleNotificationPayload(
  value: unknown,
): StaffRescheduleNotificationInput<string> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const stringFields = ['appointmentId', 'salonId', 'timeZone'] as const;
  const timestampFields = [
    'previousStartTime',
    'previousEndTime',
    'newStartTime',
    'newEndTime',
    'mutationVersion',
  ] as const;
  if (
    stringFields.some(
      field => typeof payload[field] !== 'string' || !payload[field],
    )
  ) {
    return null;
  }
  try {
    new Intl.DateTimeFormat('en', {
      timeZone: payload.timeZone as string,
    }).format(0);
  } catch {
    return null;
  }
  for (const field of timestampFields) {
    const timestamp = payload[field];
    if (typeof timestamp !== 'string') {
      return null;
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
      return null;
    }
  }
  return payload as StaffRescheduleNotificationInput<string>;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#039;');
}

function safeJobError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(
      /(authorization|cookie|password|secret|token|code)=([^&\s]+)/gi,
      '$1=[redacted]',
    )
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);
}

async function markAppointmentCalendarPending(
  database: OutboxTransaction,
  input: AppointmentMutationCalendarInput,
) {
  await database
    .update(appointmentSchema)
    .set({
      googleCalendarSyncStatus: 'pending',
      googleCalendarSyncError: null,
      // Calendar delivery state is not an appointment mutation. Preserve the
      // persisted revision used to order this operation.
      updatedAt: input.mutationVersion,
    })
    .where(and(
      eq(appointmentSchema.id, input.appointmentId),
      eq(appointmentSchema.salonId, input.salonId),
      eq(appointmentSchema.updatedAt, input.mutationVersion),
    ));
}

async function resolveGoogleCalendarTargetInTx(
  database: OutboxTransaction,
  input: {
    appointmentId: string;
    salonId: string;
    googleCalendarEventId?: string | null;
    mutationVersion?: Date;
    useDestinationCalendar?: boolean;
  },
) {
  if (!input.useDestinationCalendar) {
    const linked = await database.select({
      calendarId: googleCalendarEventSchema.calendarId,
      googleEventId: googleCalendarEventSchema.googleEventId,
    }).from(googleCalendarEventSchema).where(and(
      eq(googleCalendarEventSchema.salonId, input.salonId),
      eq(googleCalendarEventSchema.appointmentId, input.appointmentId),
      isNull(googleCalendarEventSchema.deletedAt),
      ne(googleCalendarEventSchema.syncMode, 'superseded'),
    ));
    if (linked.length > 1) {
      throw new Error('GOOGLE_CALENDAR_MIRROR_AMBIGUOUS');
    }
    let siblingTargets: string[] = [];
    let siblingEventIds: string[] = [];
    if (input.mutationVersion) {
      const revision = input.mutationVersion.toISOString();
      const siblingIntents = await database.select({
        payload: integrationOutboxSchema.payload,
      }).from(integrationOutboxSchema).where(and(
        eq(integrationOutboxSchema.salonId, input.salonId),
        eq(integrationOutboxSchema.appointmentId, input.appointmentId),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        inArray(integrationOutboxSchema.operation, ['sync_appointment', 'upsert_event']),
        inArray(integrationOutboxSchema.status, AUTHORITATIVE_GOOGLE_INTENT_STATUSES),
        sql`${integrationOutboxSchema.payload}->>'mutationVersion' = ${revision}`,
      ));
      siblingTargets = [...new Set(siblingIntents.flatMap(({ payload }) => {
        const target = (payload as Partial<GoogleCalendarMutationPayload>)?.targetCalendarId;
        return typeof target === 'string' && target ? [target] : [];
      }))];
      siblingEventIds = [...new Set(siblingIntents.flatMap(({ payload }) => {
        const eventId = (payload as Partial<GoogleCalendarMutationPayload>)
          ?.googleCalendarEventId;
        return typeof eventId === 'string' && eventId ? [eventId] : [];
      }))];
      const candidateTargets = [...new Set([
        ...linked.flatMap(mirror => [mirror.calendarId]),
        ...siblingTargets,
      ])];
      const candidateEventIds = [...new Set([
        ...linked.flatMap(mirror => [mirror.googleEventId]),
        ...siblingEventIds,
      ])];
      if (candidateTargets.length > 1) {
        throw new Error('GOOGLE_CALENDAR_TARGET_AMBIGUOUS');
      }
      if (candidateEventIds.length > 1) {
        throw new Error('GOOGLE_CALENDAR_EVENT_ID_AMBIGUOUS');
      }
      if (
        input.googleCalendarEventId
        && candidateEventIds[0]
        && input.googleCalendarEventId !== candidateEventIds[0]
      ) {
        throw new Error('GOOGLE_CALENDAR_EVENT_ID_CONFLICT');
      }
      if (candidateTargets[0]) {
        return {
          googleCalendarEventId: candidateEventIds[0]
            ?? input.googleCalendarEventId
            ?? null,
          targetCalendarId: candidateTargets[0],
        };
      }
    }
    if (linked[0]) {
      if (
        input.googleCalendarEventId
        && input.googleCalendarEventId !== linked[0].googleEventId
      ) {
        throw new Error('GOOGLE_CALENDAR_EVENT_ID_CONFLICT');
      }
      return {
        googleCalendarEventId: linked[0].googleEventId,
        targetCalendarId: linked[0].calendarId,
      };
    }
    if (input.googleCalendarEventId) {
      throw new Error('GOOGLE_CALENDAR_TARGET_UNATTRIBUTED');
    }
  }
  const [connection] = await database.select({
    destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId,
  }).from(salonGoogleCalendarConnectionSchema).where(
    eq(salonGoogleCalendarConnectionSchema.salonId, input.salonId),
  ).limit(1);
  return {
    googleCalendarEventId: input.googleCalendarEventId ?? null,
    targetCalendarId:
      connection?.destinationCalendarId ?? Env.GOOGLE_CALENDAR_ID?.trim() ?? null,
  };
}

/**
 * Every transaction that publishes a Calendar-visible appointment revision
 * joins the same appointment ordering domain as provider dispatch. The worker
 * holds the matching session advisory lock through its synchronized final
 * check and the concrete provider transport. No database transaction spans
 * provider I/O.
 */
async function acquireGoogleCalendarAppointmentMutationLock(
  database: OutboxTransaction,
  input: { appointmentId: string; salonId: string },
) {
  const leaseKey = googleCalendarAppointmentLeaseKey(
    input.salonId,
    input.appointmentId,
  );
  if (!usesRuntimePostgres) {
    return;
  }
  const result = await database.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${leaseKey}, 0)) AS acquired`,
  );
  if (!queryResultRows<{ acquired: boolean }>(result)[0]?.acquired) {
    throw new GoogleCalendarDispatchBusyError();
  }
}

async function loadGoogleCalendarTerminalRevisionsInTx(
  database: OutboxTransaction,
  input: Pick<AppointmentMutationCalendarInput, 'appointmentId' | 'salonId'>,
) {
  const priorDeletes = await database.select({
    payload: integrationOutboxSchema.payload,
  }).from(integrationOutboxSchema).where(and(
    eq(integrationOutboxSchema.salonId, input.salonId),
    eq(integrationOutboxSchema.appointmentId, input.appointmentId),
    eq(integrationOutboxSchema.provider, 'google_calendar'),
    eq(integrationOutboxSchema.operation, 'delete_event'),
    inArray(integrationOutboxSchema.status, AUTHORITATIVE_GOOGLE_INTENT_STATUSES),
  ));
  return priorDeletes.flatMap(({ payload }) => {
    const candidate = payload as GoogleCalendarMutationPayload & {
      cleanup?: boolean;
      reconciliation?: boolean;
    };
    if (candidate.cleanup || candidate.reconciliation) {
      return [];
    }
    if (typeof candidate.mutationVersion !== 'string') {
      return [];
    }
    const parsed = new Date(candidate.mutationVersion);
    return !Number.isNaN(parsed.getTime())
      && parsed.toISOString() === candidate.mutationVersion
      ? [candidate.mutationVersion]
      : [];
  }).sort();
}

async function resolveGoogleCalendarProviderEventLaneInTx(
  database: OutboxTransaction,
  input: AppointmentMutationCalendarInput,
): Promise<string> {
  const currentRevision = input.mutationVersion.toISOString();
  const terminalRevisions = await loadGoogleCalendarTerminalRevisionsInTx(
    database,
    input,
  );
  return terminalRevisions.filter(revision => revision < currentRevision).at(-1)
    ?? 'initial';
}

/**
 * Enqueue the current appointment revision on the caller's transaction. The
 * revision is the winning appointment row's persisted, monotonic `updatedAt`;
 * retries of that write collide, while a later A -> B -> A transition has a
 * new revision and therefore new runnable work.
 */
export async function enqueueGoogleCalendarAppointmentMutation(
  database: OutboxTransaction,
  input: AppointmentMutationCalendarInput & {
    adminCopySourceEventId?: string;
  },
) {
  await acquireGoogleCalendarAppointmentMutationLock(database, input);
  const revision = input.mutationVersion.toISOString();
  const [appointmentIdentity] = input.adminCopySourceEventId
    ? []
    : await database.select({
      googleCalendarEventId: appointmentSchema.googleCalendarEventId,
    }).from(appointmentSchema).where(and(
      eq(appointmentSchema.id, input.appointmentId),
      eq(appointmentSchema.salonId, input.salonId),
      eq(appointmentSchema.updatedAt, input.mutationVersion),
    )).limit(1);
  const resolvedTarget = input.adminCopySourceEventId
    ? { googleCalendarEventId: null, targetCalendarId: null }
    : await resolveGoogleCalendarTargetInTx(database, {
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      googleCalendarEventId: appointmentIdentity?.googleCalendarEventId,
      mutationVersion: input.mutationVersion,
    });
  // The remote create identity belongs to the appointment lifecycle, not to an
  // individual local revision. This is required even while a known Google event
  // id is linked: PATCH may return 404 and fall back to deterministic POST, and
  // every revision in that lane must then contend on the same remote identity.
  const providerEventLane = !input.adminCopySourceEventId
    ? await resolveGoogleCalendarProviderEventLaneInTx(database, input)
    : undefined;
  let targetCalendarId = resolvedTarget.targetCalendarId;
  const kind = input.adminCopySourceEventId ? 'admin-copy' : 'appointment-mutation';
  const dedupeKey = `google:${input.salonId}:${input.appointmentId}:sync:${kind}:${input.adminCopySourceEventId ?? revision}`;
  const payload: GoogleCalendarMutationPayload = {
    appointmentId: input.appointmentId,
    salonId: input.salonId,
    mutationVersion: revision,
    ...(input.adminCopySourceEventId
      ? { adminCopyGeneration: 0, adminCopySourceEventId: input.adminCopySourceEventId }
      : {}),
    ...(resolvedTarget.googleCalendarEventId
      ? { googleCalendarEventId: resolvedTarget.googleCalendarEventId }
      : {}),
    ...(providerEventLane ? { providerEventLane } : {}),
    ...(targetCalendarId ? { targetCalendarId } : {}),
  };
  const inserted = await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'google_calendar',
      operation: 'sync_appointment',
      dedupeKey,
      payload,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0 && !input.adminCopySourceEventId) {
    await markAppointmentCalendarPending(database, input);
    return {
      inserted: true as const,
      rearmed: false as const,
      jobId: inserted[0]!.id,
      status: 'pending' as const,
    };
  }

  // Ordinary appointment-mutation keys are immutable revision identities.
  // Only the explicit admin-copy action may rearm its stable source-event key.
  if (!input.adminCopySourceEventId) {
    return {
      inserted: false as const,
      rearmed: false as const,
      jobId: null,
      status: 'duplicate' as const,
    };
  }

  // The insert is the first possible row lock. On conflict, lock the durable
  // operation before any appointment or source-event row. The worker finalizer
  // uses the same outbox -> appointment -> source order, so a replay can wait
  // for provider-result bookkeeping without forming a lock cycle.
  const [existing] = inserted.length > 0
    ? inserted
    : await database
      .select()
      .from(integrationOutboxSchema)
      .where(and(
        eq(integrationOutboxSchema.dedupeKey, dedupeKey),
        eq(integrationOutboxSchema.salonId, input.salonId),
        eq(integrationOutboxSchema.appointmentId, input.appointmentId),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        eq(integrationOutboxSchema.operation, 'sync_appointment'),
      ))
      .for('update')
      .limit(1);
  const existingPayload = existing?.payload as Partial<GoogleCalendarMutationPayload> | undefined;
  if (
    !existing
    || existingPayload?.appointmentId !== input.appointmentId
    || existingPayload.salonId !== input.salonId
    || existingPayload.adminCopySourceEventId !== input.adminCopySourceEventId
    || !Number.isInteger(existingPayload.adminCopyGeneration)
    || (existingPayload.adminCopyGeneration ?? -1) < 0
  ) {
    throw new Error('INVALID_GOOGLE_CALENDAR_ADMIN_COPY_CONFLICT');
  }

  // A cancelled row may already own a remote result whose cleanup is pending.
  // Without proof that cleanup completed, changing or reusing its provider
  // identity can either duplicate the copy or delete the new authoritative
  // event. Keep it terminal and require explicit operator reconciliation.
  if (existing.status === 'cancelled') {
    return {
      inserted: false as const,
      rearmed: false as const,
      jobId: existing.id,
      status: 'cancelled' as const,
    };
  }

  const [appointment] = await database
    .select({
      id: appointmentSchema.id,
      status: appointmentSchema.status,
      deletedAt: appointmentSchema.deletedAt,
      updatedAt: appointmentSchema.updatedAt,
      googleCalendarEventId: appointmentSchema.googleCalendarEventId,
    })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.id, input.appointmentId),
      eq(appointmentSchema.salonId, input.salonId),
    ))
    .for('update')
    .limit(1);
  const [source] = await database
    .select({
      id: googleCalendarEventSchema.id,
      appointmentId: googleCalendarEventSchema.appointmentId,
      reviewStatus: googleCalendarEventSchema.reviewStatus,
      syncMode: googleCalendarEventSchema.syncMode,
      supersededByEventId: googleCalendarEventSchema.supersededByEventId,
    })
    .from(googleCalendarEventSchema)
    .where(and(
      eq(googleCalendarEventSchema.id, input.adminCopySourceEventId),
      eq(googleCalendarEventSchema.salonId, input.salonId),
    ))
    .for('update')
    .limit(1);

  const failClosed = async () => {
    // Leave the speculative row terminal rather than deleting its immutable
    // identity. Deletion would reopen the same dedupe key to a later request
    // and make a crash/replay window indistinguishable from "never queued".
    if (inserted.length > 0) {
      await database.update(integrationOutboxSchema).set({
        payload: { ...existing.payload, mutationVersion: null },
        status: 'cancelled',
        processedAt: new Date(),
        lastError: 'ADMIN_COPY_PRECONDITION_CHANGED',
      }).where(and(
        eq(integrationOutboxSchema.id, existing.id),
        eq(integrationOutboxSchema.salonId, input.salonId),
        eq(integrationOutboxSchema.status, 'pending'),
      ));
    }
    return {
      inserted: false as const,
      rearmed: false as const,
      jobId: existing.id,
      status: 'inconsistent' as const,
    };
  };

  if (
    !appointment
    || appointment.updatedAt.getTime() !== input.mutationVersion.getTime()
    || appointment.deletedAt
    || appointment.status === 'awaiting_payment'
    || ['cancelled', 'no_show'].includes(appointment.status)
    || !source
    || source.reviewStatus !== 'appointment'
  ) {
    return failClosed();
  }

  targetCalendarId = existingPayload.targetCalendarId ?? (await resolveGoogleCalendarTargetInTx(
    database,
    {
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      useDestinationCalendar: true,
    },
  )).targetCalendarId;
  if (!targetCalendarId) {
    return failClosed();
  }
  payload.targetCalendarId = targetCalendarId;

  if (existing.status === 'completed') {
    if (
      source.syncMode !== 'superseded'
      || !source.supersededByEventId
      || appointment.googleCalendarEventId !== source.supersededByEventId
    ) {
      return failClosed();
    }
    const destinationMirrors = await database
      .select({ id: googleCalendarEventSchema.id })
      .from(googleCalendarEventSchema)
      .where(and(
        eq(googleCalendarEventSchema.salonId, input.salonId),
        eq(googleCalendarEventSchema.appointmentId, input.appointmentId),
        eq(googleCalendarEventSchema.calendarId, targetCalendarId),
        eq(googleCalendarEventSchema.googleEventId, source.supersededByEventId),
        eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
        isNull(googleCalendarEventSchema.deletedAt),
        inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
      ))
      .for('update');
    if (destinationMirrors.length !== 1) {
      return failClosed();
    }
    return {
      inserted: false as const,
      rearmed: false as const,
      jobId: existing.id,
      status: 'completed' as const,
    };
  }

  if (
    source.appointmentId !== input.appointmentId
    || source.syncMode !== 'inbound_only'
  ) {
    return failClosed();
  }

  if (inserted.length > 0) {
    await database.update(integrationOutboxSchema).set({ payload }).where(and(
      eq(integrationOutboxSchema.id, existing.id),
      eq(integrationOutboxSchema.salonId, input.salonId),
      eq(integrationOutboxSchema.status, 'pending'),
    ));
    await markAppointmentCalendarPending(database, input);
    return {
      inserted: true as const,
      rearmed: false as const,
      jobId: existing.id,
      status: 'pending' as const,
    };
  }
  if (['pending', 'retry', 'processing'].includes(existing.status)) {
    if (!existingPayload.targetCalendarId && existing.status !== 'processing') {
      await database.update(integrationOutboxSchema).set({ payload }).where(and(
        eq(integrationOutboxSchema.id, existing.id),
        eq(integrationOutboxSchema.salonId, input.salonId),
        inArray(integrationOutboxSchema.status, ['pending', 'retry']),
      ));
    }
    return {
      inserted: false as const,
      rearmed: false as const,
      jobId: existing.id,
      status: existing.status as 'pending' | 'retry' | 'processing',
    };
  }
  if (existing.status !== 'failed') {
    throw new Error('INVALID_GOOGLE_CALENDAR_ADMIN_COPY_STATUS');
  }

  const rearmed = await database
    .update(integrationOutboxSchema)
    .set({
      payload: {
        ...payload,
        // A failed attempt can mean Google committed while every response was
        // lost. Preserve the exact generation so rearm targets the same
        // deterministic remote event instead of creating a second one.
        adminCopyGeneration: existingPayload.adminCopyGeneration!,
      },
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
      processedAt: null,
      lastError: null,
    })
    .where(and(
      eq(integrationOutboxSchema.id, existing.id),
      eq(integrationOutboxSchema.salonId, input.salonId),
      eq(integrationOutboxSchema.dedupeKey, dedupeKey),
      eq(integrationOutboxSchema.status, 'failed'),
    ))
    .returning();
  if (rearmed.length !== 1) {
    throw new Error('GOOGLE_CALENDAR_ADMIN_COPY_REARM_CONFLICT');
  }
  await markAppointmentCalendarPending(database, input);
  return {
    inserted: false as const,
    rearmed: true as const,
    jobId: existing.id,
    status: 'pending' as const,
  };
}

/**
 * Enqueues one immutable deposit-confirmation snapshot. Confirmation identity
 * belongs to its durable parent job, independently of later appointment
 * mutations. A completed-key conflict is a complete no-write.
 */
type GoogleCalendarSnapshotOptions = {
  cause:
    | { kind: 'deposit_confirmation'; parentJobId: string }
    | { kind: 'inbound_restore'; sourceEventId: string; sourceVersion: string };
  mutationVersion: Date;
};

export async function enqueueGoogleCalendarSnapshotInTx(
  database: OutboxTransaction,
  input: GoogleCalendarAppointmentEventInput,
  options: GoogleCalendarSnapshotOptions,
) {
  await acquireGoogleCalendarAppointmentMutationLock(database, input);
  const resolvedTarget = await resolveGoogleCalendarTargetInTx(database, {
    appointmentId: input.appointmentId,
    salonId: input.salonId,
    googleCalendarEventId: input.googleCalendarEventId,
    mutationVersion: options.mutationVersion,
  });
  const providerEventLane = await resolveGoogleCalendarProviderEventLaneInTx(
    database,
    {
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      mutationVersion: options.mutationVersion,
    },
  );
  const dedupeKey = options.cause.kind === 'deposit_confirmation'
    ? `google:${input.salonId}:${input.appointmentId}:upsert:deposit-confirmation:${options.cause.parentJobId}`
    : `google:${input.salonId}:${input.appointmentId}:upsert:inbound-restore:${options.cause.sourceEventId}:${options.cause.sourceVersion}`;

  const inserted = await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'google_calendar',
      operation: 'upsert_event',
      dedupeKey,
      payload: {
        ...input,
        googleCalendarEventId: resolvedTarget.googleCalendarEventId,
        startTime: input.startTime.toISOString(),
        endTime: input.endTime.toISOString(),
        mutationVersion: options.mutationVersion.toISOString(),
        ...(providerEventLane ? { providerEventLane } : {}),
        ...(resolvedTarget.targetCalendarId
          ? { targetCalendarId: resolvedTarget.targetCalendarId }
          : {}),
      },
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    return { inserted: false as const };
  }

  await markAppointmentCalendarPending(database, {
    appointmentId: input.appointmentId,
    salonId: input.salonId,
    mutationVersion: options.mutationVersion,
  });
  return { inserted: true as const, jobId: inserted[0]!.id };
}

export async function enqueueGoogleCalendarUpsert(
  input: GoogleCalendarAppointmentEventInput,
  options: GoogleCalendarSnapshotOptions,
) {
  return db.transaction(tx => enqueueGoogleCalendarSnapshotInTx(tx, input, options));
}

/**
 * The durable confirmation side-effect batch for a paid deposit (D5, TX-B).
 *
 * The eight post-commit effects a deposit hold skipped at booking time are not
 * run inline at confirmation: the confirm may be driven by a Stripe webhook,
 * whose response budget is a retry decision, not a send budget. They run from
 * here instead — at-least-once, on the outbox's own failure axis, so a bounced
 * email can never mark the webhook event row retryable or roll the money write
 * back (invariant I10).
 *
 * Enqueued INSIDE TX-B with the handle, so the job and the `paid` transition
 * commit together.
 */
export async function enqueueDepositConfirmationSideEffects(
  database: OutboxTransaction,
  input: {
    salonId: string;
    appointmentId: string;
    depositId: string;
    manageUrl: string;
    smsConsentGranted: boolean;
    googleCalendarSyncEligible: boolean;
    appliedRewardId: string | null;
  },
) {
  await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'booking_confirmed_side_effects',
      // Keyed on the DEPOSIT, not the appointment: one deposit confirms once,
      // and a redelivery of the same session must not enqueue a second batch.
      dedupeKey: `deposit:${input.depositId}:confirmed-side-effects`,
      payload: {
        depositId: input.depositId,
        manageUrl: input.manageUrl,
        smsConsentGranted: input.smsConsentGranted,
        googleCalendarSyncEligible: input.googleCalendarSyncEligible,
        appliedRewardId: input.appliedRewardId,
      },
    })
    .onConflictDoNothing();
}

/**
 * The client and owner notices for a refunded deposit (D5, TX-D).
 *
 * Enqueued INSIDE TX-D rather than after commit: a crash between the refund
 * landing and the notice being scheduled would otherwise return the client's
 * money silently.
 *
 * `variant` selects the client copy. The fixed "the time is no longer
 * available" wording is FALSE for a waiver — there the salon waived the deposit
 * requirement and the booking still stands — and sending it would talk a client
 * out of an appointment they still have.
 */
export async function enqueueDepositRefundNotices(
  database: OutboxTransaction,
  input: {
    salonId: string;
    appointmentId: string;
    depositId: string;
    refundId: string;
    variant: 'slot_lost' | 'waiver';
  },
) {
  await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'deposit_refund_notices',
      dedupeKey: `deposit:${input.depositId}:refund-notices:${input.refundId}`,
      payload: {
        depositId: input.depositId,
        refundId: input.refundId,
        variant: input.variant,
      },
    })
    .onConflictDoNothing();
}

/**
 * Durable salon money alert, written in the same transaction as the refund
 * state change and delivered by the outbox only after that transaction commits.
 */
export async function enqueueDepositRefundAlertInTx(
  database: OutboxTransaction,
  input: {
    salonId: string;
    appointmentId: string;
    event: 'refundFailed' | 'refundAccountDisconnected';
    refund: SalonNotificationRefundMetadata;
  },
) {
  const eventKey = input.event === 'refundFailed'
    ? `refund-failed:${input.refund.keyEpoch}:${input.refund.terminalFailureCount}`
    : `refund-account-disconnected:${input.refund.keyEpoch}`;

  await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'deposit_refund_alert',
      dedupeKey: `appointment:${input.appointmentId}:salon:${eventKey}`,
      payload: {
        event: input.event,
        refund: input.refund,
      },
    })
    .onConflictDoNothing();
}

export async function enqueueGoogleCalendarDeleteInTx(
  database: OutboxTransaction,
  input: {
    appointmentId: string;
    salonId: string;
    mutationVersion: Date;
    googleCalendarEventId?: string | null;
    targetCalendarId?: string;
    authoritativeTerminalDelete?: boolean;
  },
) {
  await acquireGoogleCalendarAppointmentMutationLock(database, input);
  const revision = input.mutationVersion.toISOString();
  const resolvedTarget = input.targetCalendarId
    ? {
        googleCalendarEventId: input.googleCalendarEventId ?? null,
        targetCalendarId: input.targetCalendarId,
      }
    : await resolveGoogleCalendarTargetInTx(database, {
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      googleCalendarEventId: input.googleCalendarEventId,
      mutationVersion: input.mutationVersion,
    });
  const googleCalendarEventId
    = resolvedTarget.googleCalendarEventId ?? input.googleCalendarEventId;
  if (!googleCalendarEventId) {
    return { inserted: false as const, reason: 'no_event' as const };
  }
  const targetCalendarId = resolvedTarget.targetCalendarId;
  const inserted = await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: `google:${input.salonId}:${input.appointmentId}:delete:appointment-mutation:${revision}`,
      payload: {
        appointmentId: input.appointmentId,
        salonId: input.salonId,
        mutationVersion: revision,
        googleCalendarEventId,
        ...(input.authoritativeTerminalDelete
          ? { authoritativeTerminalDelete: true }
          : {}),
        ...(targetCalendarId ? { targetCalendarId } : {}),
      },
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    return { inserted: false as const };
  }
  if (!input.authoritativeTerminalDelete) {
    await markAppointmentCalendarPending(database, input);
  }
  return { inserted: true as const, jobId: inserted[0]!.id };
}

export async function enqueueGoogleCalendarDelete(input: {
  appointmentId: string;
  salonId: string;
  mutationVersion: Date;
  googleCalendarEventId?: string | null;
  targetCalendarId?: string;
  authoritativeTerminalDelete?: boolean;
}) {
  return db.transaction(tx => enqueueGoogleCalendarDeleteInTx(tx, input));
}

async function enqueueGoogleCalendarReconciliationDelete(input: {
  appointmentId: string;
  salonId: string;
  googleCalendarEventId: string;
  observedVersion: string;
  appointmentExists: boolean;
  reconciliationMirrorId?: string;
  reconciliationExpectedAppointmentId?: string | null;
  targetCalendarId: string;
}) {
  return db.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentExists ? input.appointmentId : null,
    provider: 'google_calendar',
    operation: 'delete_event',
    dedupeKey: `google:${input.salonId}:${input.appointmentId}:delete:reconciliation:${input.targetCalendarId}:${input.googleCalendarEventId}:${input.observedVersion}`,
    payload: {
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      mutationVersion: input.appointmentExists ? input.observedVersion : null,
      googleCalendarEventId: input.googleCalendarEventId,
      targetCalendarId: input.targetCalendarId,
      reconciliation: true,
      ...(input.reconciliationMirrorId
        ? {
            reconciliationMirrorId: input.reconciliationMirrorId,
            reconciliationExpectedAppointmentId:
                input.reconciliationExpectedAppointmentId ?? null,
          }
        : {}),
    },
  }).onConflictDoNothing().returning();
}

export async function enqueueStaffRescheduleNotification(database: OutboxTransaction, input: StaffRescheduleNotificationInput<Date>) {
  await database.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    provider: 'email',
    operation: 'staff_reschedule_notification',
    dedupeKey: `email:${input.appointmentId}:staff_reschedule:${input.previousStartTime.toISOString()}:${input.newStartTime.toISOString()}:${input.mutationVersion.toISOString()}`,
    payload: {
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      previousStartTime: input.previousStartTime.toISOString(),
      previousEndTime: input.previousEndTime.toISOString(),
      newStartTime: input.newStartTime.toISOString(),
      newEndTime: input.newEndTime.toISOString(),
      mutationVersion: input.mutationVersion.toISOString(),
      timeZone: input.timeZone,
    },
  }).onConflictDoNothing();
}

/**
 * Claims one outbox row. Google operations for the same tenant appointment use
 * a transaction-scoped mutation lock plus the durable `processing` state as a
 * provider mutex. The matching session lock spans only the provider transport;
 * no database transaction spans provider I/O.
 */
function googleCalendarAppointmentId(job: IntegrationOutboxRow): string | null {
  if (job.appointmentId) {
    return job.appointmentId;
  }
  if (job.provider !== 'google_calendar' || !job.payload || typeof job.payload !== 'object') {
    return null;
  }
  const appointmentId = (job.payload as { appointmentId?: unknown }).appointmentId;
  return typeof appointmentId === 'string' && appointmentId ? appointmentId : null;
}

function googleCalendarAppointmentLeaseKey(salonId: string, appointmentId: string) {
  return JSON.stringify([
    'integration_outbox_google_calendar',
    salonId,
    appointmentId,
  ]);
}

function googleCalendarEventPairLeaseKey(
  targetCalendarId: string,
  googleCalendarEventId: string,
) {
  return JSON.stringify([
    'integration_outbox_google_calendar_event_pair',
    targetCalendarId,
    googleCalendarEventId,
  ]);
}

function googleCalendarEventPair(job: IntegrationOutboxRow) {
  if (job.provider !== 'google_calendar' || !job.payload || typeof job.payload !== 'object') {
    return null;
  }
  const payload = job.payload as Partial<GoogleCalendarMutationPayload>;
  return typeof payload.targetCalendarId === 'string' && payload.targetCalendarId
    && typeof payload.googleCalendarEventId === 'string' && payload.googleCalendarEventId
    ? {
        googleCalendarEventId: payload.googleCalendarEventId,
        targetCalendarId: payload.targetCalendarId,
      }
    : null;
}

const activeGoogleCalendarDispatchKeys = new Set<string>();
const GOOGLE_OUTBOX_HEARTBEAT_MS = 15_000;
const GOOGLE_OUTBOX_HEARTBEAT_TIMEOUT_MS = 5_000;
const GOOGLE_OUTBOX_PROVIDER_TIMEOUT_MS = 100_000;
const GOOGLE_OUTBOX_ABORT_DRAIN_MS = 5_000;
const GOOGLE_OUTBOX_LEASE_MS = 15 * 60_000;

async function releaseGoogleCalendarSessionLocks(
  session: DatabaseSessionHandle,
  acquiredKeys: string[],
  missingLockCode: string,
) {
  try {
    for (const key of acquiredKeys.reverse()) {
      const result = await session.execute<{ unlocked: boolean }>(
        sql`SELECT pg_advisory_unlock(hashtextextended(${key}, 0)) AS unlocked`,
      );
      if (!queryResultRows<{ unlocked: boolean }>(result)[0]?.unlocked) {
        throw new Error(missingLockCode);
      }
    }
  } catch (error) {
    throw new DatabaseSessionReleaseError(error);
  }
}

async function withGoogleCalendarDispatchLock<T>(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
  googleCalendarEventId: string | null | undefined,
  operation: () => Promise<T>,
  leaseControls: GoogleOutboxLeaseControls,
  preparedMutationVersion?: string,
): Promise<T> {
  const appointmentKey = googleCalendarAppointmentLeaseKey(
    job.salonId,
    payload.appointmentId,
  );
  const pairKey = googleCalendarEventId && payload.targetCalendarId
    ? googleCalendarEventPairLeaseKey(payload.targetCalendarId, googleCalendarEventId)
    : null;
  const dispatchKeys = [appointmentKey, pairKey]
    .filter((value): value is string => Boolean(value));
  if (dispatchKeys.some(key => activeGoogleCalendarDispatchKeys.has(key))) {
    throw new GoogleCalendarDispatchBusyError();
  }
  dispatchKeys.forEach(key => activeGoogleCalendarDispatchKeys.add(key));

  if (!usesRuntimePostgres) {
    try {
      await assertGoogleJobStillCurrentBeforeDispatch(
        job,
        payload,
        payload.targetCalendarId!,
      );
      await assertGoogleCalendarPairOwnedOrAbsent(
        payload.appointmentId,
        job.salonId,
        payload.targetCalendarId!,
        googleCalendarEventId,
        {
          reconciliationMirrorId: payload.reconciliationMirrorId,
          reconciliationExpectedAppointmentId:
            payload.reconciliationExpectedAppointmentId,
        },
      );
      return await operation();
    } finally {
      dispatchKeys.forEach(key => activeGoogleCalendarDispatchKeys.delete(key));
    }
  }

  try {
    await leaseControls.beginSessionHeartbeat();
    return await withDedicatedDatabaseSession(async (session) => {
      const acquiredKeys: string[] = [];
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let heartbeatError: GoogleOutboxLeaseError | null = null;
      let heartbeatInFlight: Promise<void> | null = null;
      try {
        for (const key of dispatchKeys) {
          const result = await session.execute<{ acquired: boolean }>(
            sql`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`,
          );
          if (!queryResultRows<{ acquired: boolean }>(result)[0]?.acquired) {
            throw new GoogleCalendarDispatchBusyError();
          }
          acquiredKeys.push(key);
        }
        const [owned] = await session.select({ id: integrationOutboxSchema.id })
          .from(integrationOutboxSchema)
          .where(and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
            eq(integrationOutboxSchema.provider, 'google_calendar'),
            eq(integrationOutboxSchema.status, 'processing'),
            eq(integrationOutboxSchema.attempts, claimedAttempt),
          ))
          .limit(1);
        if (!owned) {
          throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
        }
        if (preparedMutationVersion) {
          const preparedAppointment = await getCurrentAppointmentForGoogleJob(
            payload.appointmentId,
            job.salonId,
            session,
          );
          if (preparedAppointment?.updatedAt.toISOString() !== preparedMutationVersion) {
            throw new GoogleCalendarPreparedInputStaleError();
          }
        }
        const refreshOnLockedSession = async () => {
          const updated = await session.update(integrationOutboxSchema).set({
            updatedAt: new Date(),
          }).where(and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
            eq(integrationOutboxSchema.status, 'processing'),
            eq(integrationOutboxSchema.attempts, claimedAttempt),
          )).returning();
          if (updated.length !== 1) {
            throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
          }
        };
        await refreshOnLockedSession();
        await assertGoogleJobStillCurrentBeforeDispatch(
          job,
          payload,
          payload.targetCalendarId!,
          session,
        );
        await assertGoogleCalendarPairOwnedOrAbsent(
          payload.appointmentId,
          job.salonId,
          payload.targetCalendarId!,
          googleCalendarEventId,
          {
            reconciliationMirrorId: payload.reconciliationMirrorId,
            reconciliationExpectedAppointmentId:
            payload.reconciliationExpectedAppointmentId,
          },
          session,
        );
        const sendHeartbeat = () => {
          if (heartbeatInFlight) {
            return;
          }
          heartbeatInFlight = refreshOnLockedSession().catch(() => {
            heartbeatError = new GoogleOutboxLeaseError('GOOGLE_OUTBOX_HEARTBEAT_FAILED');
          }).finally(() => {
            heartbeatInFlight = null;
          });
        };
        heartbeat = setInterval(sendHeartbeat, GOOGLE_OUTBOX_HEARTBEAT_MS);
        heartbeat.unref();
        const result = await operation();
        if (heartbeatInFlight) {
          await heartbeatInFlight;
        }
        if (heartbeatError) {
          throw heartbeatError;
        }
        await refreshOnLockedSession();
        return result;
      } finally {
        clearInterval(heartbeat);
        if (heartbeatInFlight) {
          await heartbeatInFlight;
        }
        await releaseGoogleCalendarSessionLocks(
          session,
          acquiredKeys,
          'GOOGLE_CALENDAR_DISPATCH_UNLOCK_MISSING',
        );
      }
    });
  } finally {
    leaseControls.endSessionHeartbeat();
    dispatchKeys.forEach(key => activeGoogleCalendarDispatchKeys.delete(key));
  }
}

async function reclaimStaleGoogleCalendarJob(
  job: IntegrationOutboxRow,
  staleBefore: Date,
): Promise<boolean> {
  const appointmentId = googleCalendarAppointmentId(job);
  if (!appointmentId) {
    const reclaimed = await db.update(integrationOutboxSchema).set({
      status: 'retry',
      availableAt: new Date(),
      lastError: 'WORKER_INTERRUPTED',
    }).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.provider, 'google_calendar'),
      eq(integrationOutboxSchema.status, 'processing'),
      lt(integrationOutboxSchema.updatedAt, staleBefore),
    )).returning();
    return reclaimed.length === 1;
  }

  const pair = googleCalendarEventPair(job);
  const keys = [
    googleCalendarAppointmentLeaseKey(job.salonId, appointmentId),
    ...(pair
      ? [googleCalendarEventPairLeaseKey(
          pair.targetCalendarId,
          pair.googleCalendarEventId,
        )]
      : []),
  ];
  if (keys.some(key => activeGoogleCalendarDispatchKeys.has(key))) {
    return false;
  }
  if (!usesRuntimePostgres) {
    const reclaimed = await db.update(integrationOutboxSchema).set({
      status: 'retry',
      availableAt: new Date(),
      lastError: 'WORKER_INTERRUPTED',
    }).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.provider, 'google_calendar'),
      eq(integrationOutboxSchema.status, 'processing'),
      lt(integrationOutboxSchema.updatedAt, staleBefore),
    )).returning();
    return reclaimed.length === 1;
  }
  return withDedicatedDatabaseSession(async (session) => {
    const acquiredKeys: string[] = [];
    try {
      for (const key of keys) {
        const result = await session.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`,
        );
        if (!queryResultRows<{ acquired: boolean }>(result)[0]?.acquired) {
          return false;
        }
        acquiredKeys.push(key);
      }
      const reclaimed = await session.update(integrationOutboxSchema).set({
        status: 'retry',
        availableAt: new Date(),
        lastError: 'WORKER_INTERRUPTED',
      }).where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        eq(integrationOutboxSchema.status, 'processing'),
        lt(integrationOutboxSchema.updatedAt, staleBefore),
      )).returning();
      return reclaimed.length === 1;
    } finally {
      await releaseGoogleCalendarSessionLocks(
        session,
        acquiredKeys,
        'GOOGLE_CALENDAR_RECLAIM_UNLOCK_MISSING',
      );
    }
  });
}

/**
 * Serializes an appointment mutation against the short Google claim section,
 * then reports whether a provider attempt is already in flight. The caller
 * keeps this transaction open through its local mutation so a later worker
 * claim observes the committed appointment state before dispatch.
 */
export async function acquireGoogleCalendarMutationBarrierInTx(
  database: OutboxTransaction,
  input: { appointmentId: string; salonId: string },
): Promise<boolean> {
  try {
    await acquireGoogleCalendarAppointmentMutationLock(database, input);
  } catch (error) {
    if (error instanceof GoogleCalendarDispatchBusyError) {
      return false;
    }
    throw error;
  }
  const [processingPeer] = await database
    .select({ id: integrationOutboxSchema.id })
    .from(integrationOutboxSchema)
    .where(and(
      eq(integrationOutboxSchema.salonId, input.salonId),
      or(
        eq(integrationOutboxSchema.appointmentId, input.appointmentId),
        and(
          isNull(integrationOutboxSchema.appointmentId),
          sql`${integrationOutboxSchema.payload}->>'appointmentId' = ${input.appointmentId}`,
        ),
      ),
      eq(integrationOutboxSchema.provider, 'google_calendar'),
      eq(integrationOutboxSchema.status, 'processing'),
    ))
    .limit(1);
  return !processingPeer;
}

/**
 * Serializes a local ownership transfer against provider work for the exact
 * remote event pair. Google event ids are calendar-scoped, so the advisory key
 * deliberately excludes the salon: a cross-tenant local collision must also
 * fail closed. Hold the caller transaction through its mirror claim/update.
 */
export async function acquireGoogleCalendarEventPairMutationBarrierInTx(
  database: OutboxTransaction,
  input: {
    expectedMirrorId: string | null;
    expectedSalonId: string;
    googleCalendarEventId: string;
    targetCalendarId: string;
  },
): Promise<boolean> {
  const leaseKey = googleCalendarEventPairLeaseKey(
    input.targetCalendarId,
    input.googleCalendarEventId,
  );
  if (usesRuntimePostgres) {
    const acquired = await database.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${leaseKey}, 0)) AS acquired`,
    );
    if (!queryResultRows<{ acquired: boolean }>(acquired)[0]?.acquired) {
      return false;
    }
  }
  const [processingPeer] = await database
    .select({ id: integrationOutboxSchema.id })
    .from(integrationOutboxSchema)
    .where(and(
      eq(integrationOutboxSchema.provider, 'google_calendar'),
      eq(integrationOutboxSchema.status, 'processing'),
      sql`${integrationOutboxSchema.payload}->>'targetCalendarId' = ${input.targetCalendarId}`,
      sql`${integrationOutboxSchema.payload}->>'googleCalendarEventId' = ${input.googleCalendarEventId}`,
    ))
    .limit(1);
  if (processingPeer) {
    return false;
  }
  const exactPairs = await database.select({
    id: googleCalendarEventSchema.id,
    salonId: googleCalendarEventSchema.salonId,
  }).from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.calendarId, input.targetCalendarId),
    eq(googleCalendarEventSchema.googleEventId, input.googleCalendarEventId),
  ));
  if (input.expectedMirrorId === null) {
    return exactPairs.length === 0;
  }
  return exactPairs.length === 1
    && exactPairs[0]!.id === input.expectedMirrorId
    && exactPairs[0]!.salonId === input.expectedSalonId;
}

async function claimIntegrationOutboxJob(
  job: IntegrationOutboxRow,
): Promise<number | null> {
  const calendarAppointmentId = googleCalendarAppointmentId(job);
  if (job.provider !== 'google_calendar' || !calendarAppointmentId) {
    const claimed = await db
      .update(integrationOutboxSchema)
      .set({
        status: 'processing',
        attempts: sql`${integrationOutboxSchema.attempts} + 1`,
      })
      .where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.attempts, job.attempts),
        inArray(integrationOutboxSchema.status, ['pending', 'retry']),
      ))
      .returning();
    return claimed.length === 1
      ? (claimed[0]!.attempts ?? job.attempts + 1)
      : null;
  }

  const leaseKey = googleCalendarAppointmentLeaseKey(
    job.salonId,
    calendarAppointmentId,
  );
  const eventPair = googleCalendarEventPair(job);
  return db.transaction(async (tx) => {
    if (usesRuntimePostgres) {
      const appointmentLock = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${leaseKey}, 0)) AS acquired`,
      );
      if (!queryResultRows<{ acquired: boolean }>(appointmentLock)[0]?.acquired) {
        return null;
      }
    } else {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${leaseKey}, 0))`,
      );
    }
    if (eventPair) {
      const eventLeaseKey = googleCalendarEventPairLeaseKey(
        eventPair.targetCalendarId,
        eventPair.googleCalendarEventId,
      );
      if (usesRuntimePostgres) {
        const eventLock = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${eventLeaseKey}, 0)) AS acquired`,
        );
        if (!queryResultRows<{ acquired: boolean }>(eventLock)[0]?.acquired) {
          return null;
        }
      } else {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${eventLeaseKey}, 0))`,
        );
      }
    }
    const [processingPeer] = await tx
      .select({ id: integrationOutboxSchema.id })
      .from(integrationOutboxSchema)
      .where(and(
        ne(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        or(
          eq(integrationOutboxSchema.appointmentId, calendarAppointmentId),
          and(
            isNull(integrationOutboxSchema.appointmentId),
            sql`${integrationOutboxSchema.payload}->>'appointmentId' = ${calendarAppointmentId}`,
          ),
        ),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        eq(integrationOutboxSchema.status, 'processing'),
      ))
      .limit(1);
    if (processingPeer) {
      return null;
    }
    if (eventPair) {
      const [eventPairPeer] = await tx
        .select({ id: integrationOutboxSchema.id })
        .from(integrationOutboxSchema)
        .where(and(
          ne(integrationOutboxSchema.id, job.id),
          eq(integrationOutboxSchema.provider, 'google_calendar'),
          eq(integrationOutboxSchema.status, 'processing'),
          sql`${integrationOutboxSchema.payload}->>'targetCalendarId' = ${eventPair.targetCalendarId}`,
          sql`${integrationOutboxSchema.payload}->>'googleCalendarEventId' = ${eventPair.googleCalendarEventId}`,
        ))
        .limit(1);
      if (eventPairPeer) {
        return null;
      }
    }
    const claimed = await tx
      .update(integrationOutboxSchema)
      .set({
        status: 'processing',
        attempts: sql`${integrationOutboxSchema.attempts} + 1`,
      })
      .where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.attempts, job.attempts),
        inArray(integrationOutboxSchema.status, ['pending', 'retry']),
      ))
      .returning();
    return claimed.length === 1
      ? (claimed[0]!.attempts ?? job.attempts + 1)
      : null;
  });
}

class GoogleOutboxLeaseError extends Error {
  constructor(code: 'GOOGLE_OUTBOX_HEARTBEAT_FAILED' | 'GOOGLE_OUTBOX_LEASE_LOST' | 'GOOGLE_OUTBOX_PARENT_ABORTED' | 'GOOGLE_OUTBOX_PROVIDER_TIMEOUT' | 'GOOGLE_OUTBOX_PROVIDER_DID_NOT_DRAIN') {
    super(code);
    this.name = 'GoogleOutboxLeaseError';
  }
}

type GoogleOutboxLeaseControls = {
  beginSessionHeartbeat: () => Promise<void>;
  endSessionHeartbeat: () => void;
};

async function withGoogleOutboxLease<T>(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  operation: (
    signal: AbortSignal,
    leaseControls: GoogleOutboxLeaseControls,
  ) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let heartbeatInFlight: Promise<void> | null = null;
  let ownershipError: GoogleOutboxLeaseError | null = null;
  let finished = false;
  let sessionHeartbeatActive = false;

  const loseOwnership = (error: GoogleOutboxLeaseError) => {
    if (ownershipError || finished) {
      return;
    }
    ownershipError = error;
    controller.abort(error);
  };
  const abortFromParent = () => {
    loseOwnership(new GoogleOutboxLeaseError('GOOGLE_OUTBOX_PARENT_ABORTED'));
  };
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const writeHeartbeat = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new GoogleOutboxLeaseError('GOOGLE_OUTBOX_HEARTBEAT_FAILED')),
        GOOGLE_OUTBOX_HEARTBEAT_TIMEOUT_MS,
      );
      timeout.unref();
    });
    try {
      const updated = await Promise.race([
        db
          .update(integrationOutboxSchema)
          .set({ updatedAt: new Date() })
          .where(and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
            eq(integrationOutboxSchema.status, 'processing'),
            eq(integrationOutboxSchema.attempts, claimedAttempt),
          ))
          .returning(),
        timeoutPromise,
      ]);
      if (updated.length !== 1) {
        throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
      }
    } catch (error) {
      throw error instanceof GoogleOutboxLeaseError
        ? error
        : new GoogleOutboxLeaseError('GOOGLE_OUTBOX_HEARTBEAT_FAILED');
    } finally {
      clearTimeout(timeout);
    }
  };

  const heartbeat = () => {
    if (heartbeatInFlight || sessionHeartbeatActive) {
      return;
    }
    heartbeatInFlight = writeHeartbeat().catch((error) => {
      loseOwnership(error instanceof GoogleOutboxLeaseError
        ? error
        : new GoogleOutboxLeaseError('GOOGLE_OUTBOX_HEARTBEAT_FAILED'));
    }).finally(() => {
      heartbeatInFlight = null;
    });
  };
  if (ownershipError) {
    throw ownershipError;
  }
  await writeHeartbeat();
  const timer = setInterval(heartbeat, GOOGLE_OUTBOX_HEARTBEAT_MS);
  timer.unref();
  const providerTimeout = setTimeout(() => {
    loseOwnership(new GoogleOutboxLeaseError('GOOGLE_OUTBOX_PROVIDER_TIMEOUT'));
  }, GOOGLE_OUTBOX_PROVIDER_TIMEOUT_MS);
  providerTimeout.unref();
  let operationPromise: Promise<T> | null = null;
  let operationSettled = false;
  try {
    if (controller.signal.aborted) {
      throw ownershipError ?? new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
    }
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectForAbort = () => reject(controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST'));
      if (controller.signal.aborted) {
        rejectForAbort();
        return;
      }
      controller.signal.addEventListener('abort', rejectForAbort, { once: true });
    });
    const leaseControls: GoogleOutboxLeaseControls = {
      beginSessionHeartbeat: async () => {
        sessionHeartbeatActive = true;
        if (heartbeatInFlight) {
          await heartbeatInFlight;
        }
        if (ownershipError) {
          throw ownershipError;
        }
      },
      endSessionHeartbeat: () => {
        sessionHeartbeatActive = false;
        heartbeat();
      },
    };
    operationPromise = operation(controller.signal, leaseControls).finally(() => {
      operationSettled = true;
    });
    const result = await Promise.race([operationPromise, abortPromise]);
    if (heartbeatInFlight) {
      await heartbeatInFlight;
    }
    if (ownershipError) {
      throw ownershipError;
    }
    finished = true;
    return result;
  } catch (error) {
    // Give an abort-aware provider a short grace period to unwind before the row
    // becomes runnable. A non-cooperative promise must not defeat the worker's
    // hard budget, so the drain itself is bounded as well.
    if (operationPromise) {
      let drainTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          operationPromise.catch(() => undefined),
          new Promise<void>((resolve) => {
            drainTimeout = setTimeout(resolve, GOOGLE_OUTBOX_ABORT_DRAIN_MS);
            drainTimeout.unref();
          }),
        ]);
      } finally {
        clearTimeout(drainTimeout);
      }
      if (!operationSettled) {
        // Retain the durable `processing` mutex. The production Google boundary
        // normally drains after abort. If it does not, the provider transport's
        // session lock prevents the stale-lease reclaimer from publishing a
        // second attempt while this one is still alive.
        throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_PROVIDER_DID_NOT_DRAIN');
      }
    }
    throw error;
  } finally {
    clearInterval(timer);
    clearTimeout(providerTimeout);
    controller.abort();
    if (heartbeatInFlight) {
      await heartbeatInFlight;
    }
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

type GoogleProviderResult = Awaited<ReturnType<typeof syncGoogleCalendarEventForAppointment>>;

class GoogleOutboxSupersededBeforeDispatchError extends Error {
  constructor() {
    super('GOOGLE_OUTBOX_SUPERSEDED_BEFORE_DISPATCH');
    this.name = 'GoogleOutboxSupersededBeforeDispatchError';
  }
}

function parseGoogleMutationPayload(job: IntegrationOutboxRow): GoogleCalendarMutationPayload & {
  cleanup?: boolean;
  reconciliation?: boolean;
} {
  const payload = job.payload as Partial<GoogleCalendarMutationPayload> & {
    cleanup?: boolean;
    reconciliation?: boolean;
  };
  const appointmentId = googleCalendarAppointmentId(job);
  if (appointmentId && payload.appointmentId === undefined) {
    payload.appointmentId = appointmentId;
  }
  if (payload.salonId === undefined) {
    payload.salonId = job.salonId;
  }
  if (
    !appointmentId
    || payload.appointmentId !== appointmentId
    || payload.salonId !== job.salonId
    || (
      payload.mutationVersion !== undefined
      && payload.mutationVersion !== null
      && typeof payload.mutationVersion !== 'string'
    )
    || (
      payload.adminCopySourceEventId !== undefined
      && (
        typeof payload.adminCopySourceEventId !== 'string'
        || !payload.adminCopySourceEventId
        || !Number.isInteger(payload.adminCopyGeneration)
        || (payload.adminCopyGeneration ?? -1) < 0
      )
    )
    || (
      payload.targetCalendarId !== undefined
      && (typeof payload.targetCalendarId !== 'string' || !payload.targetCalendarId)
    )
    || (
      payload.providerEventIdentity !== undefined
      && (
        typeof payload.providerEventIdentity !== 'string'
        || !payload.providerEventIdentity
      )
    )
    || (
      payload.providerDispatchStarted !== undefined
      && payload.providerDispatchStarted !== true
    )
    || (
      payload.providerEventLane !== undefined
      && (typeof payload.providerEventLane !== 'string' || !payload.providerEventLane)
    )
    || (
      payload.authoritativeTerminalDelete !== undefined
      && payload.authoritativeTerminalDelete !== true
    )
    || (
      payload.reconciliationMirrorId !== undefined
      && (typeof payload.reconciliationMirrorId !== 'string' || !payload.reconciliationMirrorId)
    )
    || (
      payload.authoritativeTerminalDelete === true
      && (
        job.operation !== 'delete_event'
        || payload.reconciliation === true
        || payload.cleanup === true
        || !payload.googleCalendarEventId
        || !payload.targetCalendarId
        || !payload.mutationVersion
      )
    )
    || (
      payload.reconciliationExpectedAppointmentId !== undefined
      && payload.reconciliationExpectedAppointmentId !== null
      && (
        typeof payload.reconciliationExpectedAppointmentId !== 'string'
        || !payload.reconciliationExpectedAppointmentId
      )
    )
    || (
      (payload.reconciliationMirrorId !== undefined
        || payload.reconciliationExpectedAppointmentId !== undefined)
        && (job.operation !== 'delete_event' || payload.reconciliation !== true)
    )
    || (
      (payload.reconciliationMirrorId === undefined)
      !== (payload.reconciliationExpectedAppointmentId === undefined)
    )
  ) {
    throw new Error('INVALID_GOOGLE_CALENDAR_MUTATION');
  }
  if (payload.mutationVersion) {
    const parsed = new Date(payload.mutationVersion);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== payload.mutationVersion) {
      throw new Error('INVALID_GOOGLE_CALENDAR_MUTATION_VERSION');
    }
  }
  return payload as GoogleCalendarMutationPayload & {
    cleanup?: boolean;
    reconciliation?: boolean;
  };
}

function safeGoogleMutationPayloadForFailure(job: IntegrationOutboxRow) {
  try {
    return parseGoogleMutationPayload(job);
  } catch {
    return {
      appointmentId: googleCalendarAppointmentId(job) ?? '',
      salonId: job.salonId,
      mutationVersion: null,
    };
  }
}

async function finishGoogleJobSuperseded(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
) {
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: integrationOutboxSchema.id })
      .from(integrationOutboxSchema)
      .where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.status, 'processing'),
        eq(integrationOutboxSchema.attempts, claimedAttempt),
      ))
      .for('update')
      .limit(1);
    if (!owned) {
      return false;
    }
    // A never-dispatched first attempt cannot have created a remote event.
    // Retried rows may represent an earlier accepted request whose response
    // was lost, so only those need deterministic orphan cleanup here.
    if (job.attempts > 0) {
      await enqueueAmbiguousGoogleCreateCleanup(
        tx,
        job,
        parseGoogleMutationPayload(job),
        { preserveCanonicalIdentity: true },
      );
    }
    const updated = await tx
      .update(integrationOutboxSchema)
      .set({
        status: 'cancelled',
        processedAt: new Date(),
        lastError: 'SUPERSEDED',
      })
      .where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.status, 'processing'),
        eq(integrationOutboxSchema.attempts, claimedAttempt),
      ))
      .returning();
    return updated.length === 1;
  });
}

async function enqueueObsoleteGoogleResultCleanup(
  tx: OutboxTransaction,
  job: IntegrationOutboxRow,
  appointmentId: string,
  googleCalendarEventId: string,
) {
  const targetCalendarId
    = (job.payload as GoogleCalendarMutationPayload).targetCalendarId;
  if (!targetCalendarId) {
    throw new Error('GOOGLE_CALENDAR_TARGET_MISSING');
  }
  await tx.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: job.salonId,
    appointmentId,
    provider: 'google_calendar',
    operation: 'delete_event',
    dedupeKey: `google:${job.salonId}:${appointmentId}:delete:obsolete-result:${job.id}:${targetCalendarId}:${googleCalendarEventId}`,
    payload: {
      appointmentId,
      salonId: job.salonId,
      mutationVersion: null,
      googleCalendarEventId,
      targetCalendarId,
      cleanup: true,
    },
  }).onConflictDoNothing();
}

function googleProviderIdempotencyKey(
  job: IntegrationOutboxRow,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
) {
  if (payload.adminCopySourceEventId) {
    return `${job.id}:admin-copy:${payload.adminCopyGeneration}`;
  }
  if (payload.providerEventIdentity) {
    return payload.providerEventIdentity;
  }
  if (payload.providerEventLane) {
    return `appointment-lane:${payload.providerEventLane}`;
  }
  return payload.mutationVersion
    ? `appointment-revision:${payload.mutationVersion}`
    : job.id;
}

async function markGoogleProviderDispatchStarted(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
) {
  if (payload.providerDispatchStarted) {
    return;
  }
  const updated = await db.update(integrationOutboxSchema).set({
    payload: {
      ...job.payload,
      providerDispatchStarted: true,
    },
  }).where(and(
    eq(integrationOutboxSchema.id, job.id),
    eq(integrationOutboxSchema.salonId, job.salonId),
    eq(integrationOutboxSchema.provider, 'google_calendar'),
    eq(integrationOutboxSchema.status, 'processing'),
    eq(integrationOutboxSchema.attempts, claimedAttempt),
  )).returning();
  if (updated.length !== 1) {
    throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
  }
  payload.providerDispatchStarted = true;
  (job.payload as GoogleCalendarMutationPayload).providerDispatchStarted = true;
}

function possibleCreatedGoogleEventId(
  job: IntegrationOutboxRow,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
) {
  return deterministicGoogleCalendarEventId({
    appointmentId: payload.appointmentId,
    idempotencyKey: googleProviderIdempotencyKey(job, payload),
    salonId: job.salonId,
  });
}

function isCanonicalGoogleProviderEventId(
  job: IntegrationOutboxRow,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
  eventId: string,
) {
  return Boolean(
    payload.providerEventIdentity
    && deterministicGoogleCalendarEventId({
      appointmentId: payload.appointmentId,
      idempotencyKey: payload.providerEventIdentity,
      salonId: job.salonId,
    }) === eventId,
  );
}

async function enqueueAmbiguousGoogleCreateCleanup(
  tx: OutboxTransaction,
  job: IntegrationOutboxRow,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
  options: { preserveCanonicalIdentity?: boolean } = {},
) {
  if (job.operation === 'delete_event') {
    return;
  }
  // A known PATCH target does not prove that no create ran: the provider
  // intentionally falls back to deterministic POST after PATCH returns 404.
  // Deleting the candidate is safe (404 is success), and the cleanup worker
  // fences an event that a newer intent has since adopted.
  const possibleEventId = possibleCreatedGoogleEventId(job, payload);
  if (
    options.preserveCanonicalIdentity
    && isCanonicalGoogleProviderEventId(job, payload, possibleEventId)
  ) {
    return;
  }
  await enqueueObsoleteGoogleResultCleanup(
    tx,
    job,
    payload.appointmentId,
    possibleEventId,
  );
}

/**
 * `appointment.updatedAt` supplies an immutable identity at enqueue time, but
 * unrelated appointment bookkeeping (payments, reminders, photos) may advance
 * it without changing the provider representation. Supersession therefore
 * follows later durable Google intents, not the appointment's current generic
 * timestamp. ISO timestamps sort in the same order as their instants.
 */
async function hasNewerGoogleCalendarIntent(
  database: Pick<OutboxDatabase, 'select'>,
  job: IntegrationOutboxRow,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
) {
  if (!payload.mutationVersion) {
    return false;
  }
  const [newer] = await database.select({ id: integrationOutboxSchema.id })
    .from(integrationOutboxSchema)
    .where(and(
      ne(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.appointmentId, payload.appointmentId),
      eq(integrationOutboxSchema.provider, 'google_calendar'),
      inArray(integrationOutboxSchema.status, AUTHORITATIVE_GOOGLE_INTENT_STATUSES),
      sql`${integrationOutboxSchema.payload}->>'mutationVersion' > ${payload.mutationVersion}`,
    ))
    .limit(1);
  return Boolean(newer);
}

async function lockNewerRunnableGoogleUpsertIntents(
  database: OutboxTransaction,
  job: IntegrationOutboxRow,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
) {
  if (!payload.mutationVersion) {
    return [];
  }
  return database.select({
    id: integrationOutboxSchema.id,
    payload: integrationOutboxSchema.payload,
    status: integrationOutboxSchema.status,
  }).from(integrationOutboxSchema).where(and(
    ne(integrationOutboxSchema.id, job.id),
    eq(integrationOutboxSchema.salonId, job.salonId),
    eq(integrationOutboxSchema.appointmentId, payload.appointmentId),
    eq(integrationOutboxSchema.provider, 'google_calendar'),
    inArray(integrationOutboxSchema.operation, ['sync_appointment', 'upsert_event']),
    inArray(integrationOutboxSchema.status, ['pending', 'retry']),
    sql`${integrationOutboxSchema.payload}->>'adminCopySourceEventId' is null`,
    sql`${integrationOutboxSchema.payload}->>'mutationVersion' > ${payload.mutationVersion}`,
  )).for('update');
}

async function retargetNewerGoogleUpsertsAfterAdminCopy(
  database: OutboxTransaction,
  input: {
    job: IntegrationOutboxRow;
    payload: ReturnType<typeof parseGoogleMutationPayload>;
    sourceCalendarId: string;
    sourceEventId: string;
    destinationCalendarId: string;
    destinationEventId: string;
  },
) {
  const newerIntents = await lockNewerRunnableGoogleUpsertIntents(
    database,
    input.job,
    input.payload,
  );
  for (const intent of newerIntents) {
    const intentPayload = intent.payload as Record<string, unknown>;
    const targetCalendarId = typeof intentPayload.targetCalendarId === 'string'
      ? intentPayload.targetCalendarId
      : null;
    const googleCalendarEventId
      = typeof intentPayload.googleCalendarEventId === 'string'
        ? intentPayload.googleCalendarEventId
        : null;
    const stillTargetsSource = (
      (!targetCalendarId || targetCalendarId === input.sourceCalendarId)
      && (!googleCalendarEventId || googleCalendarEventId === input.sourceEventId)
    );
    const alreadyTargetsDestination = (
      targetCalendarId === input.destinationCalendarId
      && googleCalendarEventId === input.destinationEventId
    );
    if (!stillTargetsSource && !alreadyTargetsDestination) {
      throw new Error('GOOGLE_CALENDAR_ADMIN_COPY_NEWER_INTENT_CONFLICT');
    }
    if (alreadyTargetsDestination) {
      continue;
    }
    const updated = await database.update(integrationOutboxSchema).set({
      payload: {
        ...intentPayload,
        targetCalendarId: input.destinationCalendarId,
        googleCalendarEventId: input.destinationEventId,
      },
    }).where(and(
      eq(integrationOutboxSchema.id, intent.id),
      eq(integrationOutboxSchema.salonId, input.job.salonId),
      eq(integrationOutboxSchema.appointmentId, input.payload.appointmentId),
      eq(integrationOutboxSchema.status, intent.status),
    )).returning();
    if (updated.length !== 1) {
      throw new Error('GOOGLE_CALENDAR_ADMIN_COPY_NEWER_INTENT_CHANGED');
    }
  }
  return newerIntents.length > 0;
}

async function persistAuthoritativeGoogleCalendarMirror(
  tx: OutboxTransaction,
  input: {
    appointment: typeof appointmentSchema.$inferSelect;
    calendarId: string;
    eventId: string;
    salonId: string;
  },
) {
  const activeMirrors = await tx.select({
    id: googleCalendarEventSchema.id,
    calendarId: googleCalendarEventSchema.calendarId,
    googleEventId: googleCalendarEventSchema.googleEventId,
  }).from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.salonId, input.salonId),
    eq(googleCalendarEventSchema.appointmentId, input.appointment.id),
    isNull(googleCalendarEventSchema.deletedAt),
    ne(googleCalendarEventSchema.syncMode, 'superseded'),
  )).for('update');
  if (activeMirrors.length > 1) {
    throw new Error('GOOGLE_CALENDAR_MIRROR_AMBIGUOUS');
  }
  const previous = activeMirrors[0];
  if (
    previous
    && previous.calendarId !== input.calendarId
  ) {
    throw new Error('GOOGLE_CALENDAR_MIRROR_CALENDAR_CONFLICT');
  }

  const now = new Date();
  const inserted = await tx.insert(googleCalendarEventSchema).values({
    id: `gce_${crypto.randomUUID()}`,
    salonId: input.salonId,
    calendarId: input.calendarId,
    googleEventId: input.eventId,
    appointmentId: input.appointment.id,
    sourceAccessRole: 'writer',
    syncMode: 'bidirectional',
    startTime: input.appointment.startTime,
    endTime: input.appointment.endTime,
    durationMinutes: input.appointment.totalDurationMinutes,
    isAllDay: false,
    transparency: 'busy',
    googleStatus: 'confirmed',
    reviewStatus: 'appointment',
    reviewedAt: now,
    lastSyncedAt: now,
  }).onConflictDoNothing().returning();
  const [exactMirror] = inserted.length > 0
    ? inserted
    : await tx.select({
      id: googleCalendarEventSchema.id,
      appointmentId: googleCalendarEventSchema.appointmentId,
      sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
      syncMode: googleCalendarEventSchema.syncMode,
    }).from(googleCalendarEventSchema).where(and(
      eq(googleCalendarEventSchema.salonId, input.salonId),
      eq(googleCalendarEventSchema.calendarId, input.calendarId),
      eq(googleCalendarEventSchema.googleEventId, input.eventId),
    )).for('update');
  if (
    !exactMirror
    || ('appointmentId' in exactMirror && (
      exactMirror.appointmentId !== input.appointment.id
      || exactMirror.syncMode !== 'bidirectional'
      || !['owner', 'writer'].includes(exactMirror.sourceAccessRole)
    ))
  ) {
    throw new Error('GOOGLE_CALENDAR_MIRROR_OWNERSHIP_CONFLICT');
  }

  if (previous && previous.id !== exactMirror.id) {
    await tx.update(googleCalendarEventSchema).set({
      appointmentId: null,
      syncMode: 'superseded',
      supersededByEventId: input.eventId,
    }).where(and(
      eq(googleCalendarEventSchema.id, previous.id),
      eq(googleCalendarEventSchema.salonId, input.salonId),
      eq(googleCalendarEventSchema.appointmentId, input.appointment.id),
      eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
    ));
  }
  await tx.update(googleCalendarEventSchema).set({
    appointmentId: input.appointment.id,
    syncMode: 'bidirectional',
    startTime: input.appointment.startTime,
    endTime: input.appointment.endTime,
    durationMinutes: input.appointment.totalDurationMinutes,
    googleStatus: 'confirmed',
    reviewStatus: 'appointment',
    reviewedAt: now,
    lastSyncedAt: now,
    deletedAt: null,
  }).where(and(
    eq(googleCalendarEventSchema.id, exactMirror.id),
    eq(googleCalendarEventSchema.salonId, input.salonId),
    eq(googleCalendarEventSchema.calendarId, input.calendarId),
    eq(googleCalendarEventSchema.googleEventId, input.eventId),
  ));
}

/**
 * Provider I/O has completed, but it owns no local state yet. Lock and verify
 * the exact attempt before touching the appointment/event rows, then commit
 * provider-result bookkeeping and the job terminal together.
 */
async function finishGoogleJobSuccess(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
  result: GoogleProviderResult,
) {
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: integrationOutboxSchema.id })
      .from(integrationOutboxSchema)
      .where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.status, 'processing'),
        eq(integrationOutboxSchema.attempts, claimedAttempt),
      ))
      .for('update')
      .limit(1);
    if (!owned) {
      return false;
    }

    const [appointment] = await tx.select()
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.id, payload.appointmentId),
        eq(appointmentSchema.salonId, job.salonId),
      ))
      .for('update')
      .limit(1);
    const hasNewerIntent = await hasNewerGoogleCalendarIntent(tx, job, payload);
    let terminalStatus: 'completed' | 'cancelled' = 'completed';
    let terminalError: string | null = null;

    // A retry can be overtaken while its provider call is in flight. The
    // returned event id is authoritative for cleanup, but the older attempt is
    // never allowed to publish appointment state after a newer durable intent.
    if (
      hasNewerIntent
      && result.status === 'synced'
      && !payload.adminCopySourceEventId
    ) {
      const dispatchedEventId = (job.payload as { dispatchedEventId?: unknown }).dispatchedEventId;
      if (
        (typeof dispatchedEventId !== 'string' || dispatchedEventId !== result.eventId)
        && !isCanonicalGoogleProviderEventId(job, payload, result.eventId)
      ) {
        await enqueueObsoleteGoogleResultCleanup(
          tx,
          job,
          payload.appointmentId,
          result.eventId,
        );
      }
      terminalStatus = 'cancelled';
      terminalError = 'SUPERSEDED';
    }

    if (result.status === 'synced' && terminalStatus === 'completed') {
      if (payload.adminCopySourceEventId) {
        if (
          !appointment
          || appointment.deletedAt
          || ['awaiting_payment', 'cancelled', 'no_show'].includes(appointment.status)
          || ['cancelled', 'no_show'].includes(appointment.canvasState ?? '')
        ) {
          await enqueueObsoleteGoogleResultCleanup(
            tx,
            job,
            payload.appointmentId,
            result.eventId,
          );
          terminalStatus = 'cancelled';
          terminalError = 'ADMIN_COPY_PRECONDITION_CHANGED';
        } else {
          const [source] = await tx.select()
            .from(googleCalendarEventSchema)
            .where(and(
              eq(googleCalendarEventSchema.id, payload.adminCopySourceEventId),
              eq(googleCalendarEventSchema.salonId, job.salonId),
              eq(googleCalendarEventSchema.appointmentId, appointment.id),
              eq(googleCalendarEventSchema.syncMode, 'inbound_only'),
            ))
            .for('update')
            .limit(1);
          const [connection] = await tx.select({
            salonId: salonGoogleCalendarConnectionSchema.salonId,
          }).from(salonGoogleCalendarConnectionSchema)
            .where(and(
              eq(salonGoogleCalendarConnectionSchema.salonId, job.salonId),
              inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']),
            ))
            .limit(1);
          if (!source || !connection) {
            await enqueueObsoleteGoogleResultCleanup(
              tx,
              job,
              appointment.id,
              result.eventId,
            );
            terminalStatus = 'cancelled';
            terminalError = 'ADMIN_COPY_PRECONDITION_CHANGED';
          } else {
            const resultCalendarId = result.calendarId ?? payload.targetCalendarId;
            if (!resultCalendarId) {
              throw new Error('GOOGLE_CALENDAR_TARGET_MISSING');
            }
            const activeDestinationMirrors = await tx.select({
              calendarId: googleCalendarEventSchema.calendarId,
              googleEventId: googleCalendarEventSchema.googleEventId,
            }).from(googleCalendarEventSchema).where(and(
              eq(googleCalendarEventSchema.salonId, job.salonId),
              eq(googleCalendarEventSchema.appointmentId, appointment.id),
              isNull(googleCalendarEventSchema.deletedAt),
              eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
              inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
            )).for('update');
            if (
              activeDestinationMirrors.length > 1
              || (
                activeDestinationMirrors[0]
                && (
                  activeDestinationMirrors[0].calendarId !== resultCalendarId
                  || activeDestinationMirrors[0].googleEventId !== result.eventId
                )
              )
            ) {
              throw new Error('GOOGLE_CALENDAR_ADMIN_COPY_MIRROR_CONFLICT');
            }
            const insertedMirror = await tx.insert(googleCalendarEventSchema).values({
              id: `gce_${crypto.randomUUID()}`,
              salonId: job.salonId,
              calendarId: resultCalendarId,
              googleEventId: result.eventId,
              appointmentId: appointment.id,
              sourceAccessRole: 'writer',
              syncMode: 'bidirectional',
              title: source.title,
              description: source.description,
              location: source.location,
              startTime: appointment.startTime,
              endTime: appointment.endTime,
              durationMinutes: appointment.totalDurationMinutes,
              isAllDay: false,
              transparency: 'busy',
              reviewStatus: 'appointment',
              reviewedAt: new Date(),
            }).onConflictDoNothing().returning();
            if (insertedMirror.length === 0) {
              const [existingMirror] = await tx.select({
                appointmentId: googleCalendarEventSchema.appointmentId,
                deletedAt: googleCalendarEventSchema.deletedAt,
                sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
                syncMode: googleCalendarEventSchema.syncMode,
              }).from(googleCalendarEventSchema).where(and(
                eq(googleCalendarEventSchema.salonId, job.salonId),
                eq(googleCalendarEventSchema.calendarId, resultCalendarId),
                eq(googleCalendarEventSchema.googleEventId, result.eventId),
              )).for('update').limit(1);
              if (
                existingMirror?.appointmentId !== appointment.id
                || existingMirror.deletedAt !== null
                || existingMirror.syncMode !== 'bidirectional'
                || !['owner', 'writer'].includes(existingMirror.sourceAccessRole)
              ) {
                throw new Error('GOOGLE_CALENDAR_ADMIN_COPY_MIRROR_CONFLICT');
              }
            }
            await tx.update(googleCalendarEventSchema).set({
              appointmentId: null,
              syncMode: 'superseded',
              supersededByEventId: result.eventId,
            }).where(and(
              eq(googleCalendarEventSchema.id, source.id),
              eq(googleCalendarEventSchema.salonId, job.salonId),
              eq(googleCalendarEventSchema.appointmentId, appointment.id),
              eq(googleCalendarEventSchema.syncMode, 'inbound_only'),
            ));
            // A same-appointment mutation may commit while this copy's provider
            // request is in flight. Its durable job initially points at the
            // still-linked inbound source. Adopt the successful destination and
            // retarget every later runnable ordinary upsert in this transaction,
            // so that newer mutation executes last without changing its identity.
            const newerRunnable = await retargetNewerGoogleUpsertsAfterAdminCopy(
              tx,
              {
                job,
                payload,
                sourceCalendarId: source.calendarId,
                sourceEventId: source.googleEventId,
                destinationCalendarId: resultCalendarId,
                destinationEventId: result.eventId,
              },
            );
            await tx.update(appointmentSchema).set({
              googleCalendarEventId: result.eventId,
              googleCalendarSyncStatus: newerRunnable ? 'pending' : 'synced',
              googleCalendarSyncedAt: new Date(),
              googleCalendarSyncError: null,
              updatedAt: appointment.updatedAt,
            }).where(and(
              eq(appointmentSchema.id, appointment.id),
              eq(appointmentSchema.salonId, job.salonId),
              eq(appointmentSchema.updatedAt, appointment.updatedAt),
            ));
          }
        }
      } else if (!hasNewerIntent && appointment && !appointment.deletedAt
        && !['awaiting_payment', 'cancelled', 'no_show'].includes(appointment.status)
        && !['cancelled', 'no_show'].includes(appointment.canvasState ?? '')) {
        const resultCalendarId = result.calendarId ?? payload.targetCalendarId;
        if (!resultCalendarId) {
          throw new Error('GOOGLE_CALENDAR_TARGET_MISSING');
        }
        await persistAuthoritativeGoogleCalendarMirror(tx, {
          appointment,
          calendarId: resultCalendarId,
          eventId: result.eventId,
          salonId: job.salonId,
        });
        await tx.update(appointmentSchema).set({
          googleCalendarEventId: result.eventId,
          googleCalendarSyncStatus: 'synced',
          googleCalendarSyncedAt: new Date(),
          googleCalendarSyncError: null,
          updatedAt: appointment.updatedAt,
        }).where(and(
          eq(appointmentSchema.id, appointment.id),
          eq(appointmentSchema.salonId, job.salonId),
          eq(appointmentSchema.updatedAt, appointment.updatedAt),
        ));
      } else {
        const dispatchedEventId = (job.payload as { dispatchedEventId?: unknown }).dispatchedEventId;
        if (
          (typeof dispatchedEventId !== 'string' || dispatchedEventId !== result.eventId)
          && !(
            hasNewerIntent
            && isCanonicalGoogleProviderEventId(job, payload, result.eventId)
          )
        ) {
          await enqueueObsoleteGoogleResultCleanup(
            tx,
            job,
            payload.appointmentId,
            result.eventId,
          );
        }
      }
    } else if (result.status === 'deleted') {
      const deletedEventId = payload.googleCalendarEventId;
      if (deletedEventId) {
        const deletedAt = new Date();
        const deletedCalendarId = result.calendarId ?? payload.targetCalendarId;
        if (!deletedCalendarId) {
          throw new Error('GOOGLE_CALENDAR_TARGET_MISSING');
        }
        const exactMirrorOwnership = payload.reconciliationMirrorId
          ? and(
            eq(googleCalendarEventSchema.id, payload.reconciliationMirrorId),
            payload.reconciliationExpectedAppointmentId === null
              ? isNull(googleCalendarEventSchema.appointmentId)
              : eq(
                googleCalendarEventSchema.appointmentId,
                payload.reconciliationExpectedAppointmentId
                ?? payload.appointmentId,
              ),
            eq(googleCalendarEventSchema.reviewStatus, 'appointment'),
            eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
            inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
          )
          : eq(googleCalendarEventSchema.appointmentId, payload.appointmentId);
        const newerRunnableUpserts = await lockNewerRunnableGoogleUpsertIntents(
          tx,
          job,
          payload,
        );
        const preserveMirrorForNewerActiveUpsert = Boolean(
          newerRunnableUpserts.length > 0
          && appointment
          && !appointment.deletedAt
          && !['awaiting_payment', 'cancelled', 'no_show'].includes(appointment.status)
          && !['cancelled', 'no_show'].includes(appointment.canvasState ?? ''),
        );
        if (!preserveMirrorForNewerActiveUpsert) {
          await tx.update(googleCalendarEventSchema).set({
            googleStatus: 'cancelled',
            deletedAt,
            lastSyncedAt: deletedAt,
          }).where(and(
            eq(googleCalendarEventSchema.salonId, job.salonId),
            exactMirrorOwnership,
            eq(googleCalendarEventSchema.calendarId, deletedCalendarId),
            eq(googleCalendarEventSchema.googleEventId, deletedEventId),
          ));
        }
        const [remainingMirror] = await tx.select({ id: googleCalendarEventSchema.id })
          .from(googleCalendarEventSchema)
          .where(and(
            eq(googleCalendarEventSchema.salonId, job.salonId),
            eq(googleCalendarEventSchema.appointmentId, payload.appointmentId),
            isNull(googleCalendarEventSchema.deletedAt),
            eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
            inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
          )).limit(1);
        if (
          appointment
          && (
            appointment.googleCalendarEventId === deletedEventId
            || appointment.googleCalendarEventId === null
          )
          && !remainingMirror
          && !hasNewerIntent
          && (
            appointment.deletedAt
            || ['cancelled', 'no_show'].includes(appointment.status)
            || ['cancelled', 'no_show'].includes(appointment.canvasState ?? '')
          )
        ) {
          await tx.update(appointmentSchema).set({
            googleCalendarEventId: null,
            googleCalendarSyncStatus: 'deleted',
            googleCalendarSyncedAt: deletedAt,
            googleCalendarSyncError: null,
            updatedAt: appointment.updatedAt,
          }).where(and(
            eq(appointmentSchema.id, appointment.id),
            eq(appointmentSchema.salonId, job.salonId),
            or(
              eq(appointmentSchema.googleCalendarEventId, deletedEventId),
              isNull(appointmentSchema.googleCalendarEventId),
            ),
            eq(appointmentSchema.updatedAt, appointment.updatedAt),
          ));
        }
      }
    } else if (result.status === 'disabled' && !hasNewerIntent && appointment) {
      await tx.update(appointmentSchema).set({
        googleCalendarSyncStatus: 'not_synced',
        googleCalendarSyncError: null,
        updatedAt: appointment.updatedAt,
      }).where(and(
        eq(appointmentSchema.id, appointment.id),
        eq(appointmentSchema.salonId, job.salonId),
        eq(appointmentSchema.updatedAt, appointment.updatedAt),
      ));
    }

    await tx.update(integrationOutboxSchema)
      .set({
        status: terminalStatus,
        processedAt: new Date(),
        lastError: terminalError,
      })
      .where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.status, 'processing'),
        eq(integrationOutboxSchema.attempts, claimedAttempt),
      ));
    return true;
  });
}

async function finishGoogleJobFailure(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
  error: unknown,
) {
  const final = claimedAttempt >= 8;
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: integrationOutboxSchema.id })
      .from(integrationOutboxSchema)
      .where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.status, 'processing'),
        eq(integrationOutboxSchema.attempts, claimedAttempt),
      ))
      .for('update')
      .limit(1);
    if (!owned) {
      return { owned: false, final };
    }
    const [appointment] = await tx.select()
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.id, payload.appointmentId),
        eq(appointmentSchema.salonId, job.salonId),
      ))
      .for('update')
      .limit(1);
    const hasNewerIntent = await hasNewerGoogleCalendarIntent(tx, job, payload);
    const createAttempted = Boolean(
      error
      && typeof error === 'object'
      && (error as { googleCreateAttempted?: unknown }).googleCreateAttempted === true,
    );
    const identityAdoptionAmbiguous = error instanceof Error
      && error.message === 'GOOGLE_CALENDAR_PROVIDER_IDENTITY_AMBIGUOUS';
    if (!identityAdoptionAmbiguous && ((createAttempted && hasNewerIntent) || final)) {
      await enqueueAmbiguousGoogleCreateCleanup(tx, job, payload, {
        preserveCanonicalIdentity: hasNewerIntent,
      });
    }
    if (
      appointment
      && payload.mutationVersion
      && !hasNewerIntent
    ) {
      await tx.update(appointmentSchema).set({
        googleCalendarSyncStatus: 'failed',
        googleCalendarSyncError: safeJobError(error),
        updatedAt: appointment.updatedAt,
      }).where(and(
        eq(appointmentSchema.id, appointment.id),
        eq(appointmentSchema.salonId, job.salonId),
        eq(appointmentSchema.updatedAt, appointment.updatedAt),
      ));
    }
    await tx.update(integrationOutboxSchema).set({
      status: final ? 'failed' : 'retry',
      lastError: safeJobError(error),
      availableAt: new Date(
        Date.now() + Math.min(60, 2 ** claimedAttempt) * 60_000,
      ),
    }).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.status, 'processing'),
      eq(integrationOutboxSchema.attempts, claimedAttempt),
    ));
    return { owned: true, final };
  });
}

async function loadCurrentGoogleCalendarInput(
  appointmentId: string,
  salonId: string,
) {
  const [{ getAppointmentCalendarEventForSync }, [salon]] = await Promise.all([
    import('@/libs/appointmentManage'),
    db.select({ name: salonSchema.name }).from(salonSchema)
      .where(eq(salonSchema.id, salonId)).limit(1),
  ]);
  if (!salon) {
    throw new Error('GOOGLE_CALENDAR_SALON_NOT_FOUND');
  }
  const event = await getAppointmentCalendarEventForSync(appointmentId, salonId);
  return {
    appointmentId: event.id,
    salonId,
    salonName: salon.name,
    clientName: event.clientName,
    clientPhone: event.clientPhone,
    serviceNames: [event.serviceLabel],
    technicianName: event.technicianName,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
    totalPrice: event.totalPrice,
    totalDurationMinutes: event.totalDurationMinutes,
    timeZone: event.timeZone,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    notes: event.notes,
    googleCalendarEventId: event.googleCalendarEventId,
    mutationVersion: event.updatedAt,
  } satisfies GoogleCalendarAppointmentEventInput;
}

async function getCurrentAppointmentForGoogleJob(
  appointmentId: string,
  salonId: string,
  database: Pick<OutboxDatabase, 'select'> = db,
) {
  const [appointment] = await database.select({
    deletedAt: appointmentSchema.deletedAt,
    canvasState: appointmentSchema.canvasState,
    googleCalendarEventId: appointmentSchema.googleCalendarEventId,
    status: appointmentSchema.status,
    updatedAt: appointmentSchema.updatedAt,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.id, appointmentId),
    eq(appointmentSchema.salonId, salonId),
  )).limit(1);
  return appointment;
}

async function assertGoogleJobStillCurrentBeforeDispatch(
  job: IntegrationOutboxRow,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
  targetCalendarId: string,
  database: OutboxDatabase = db,
) {
  const appointment = await getCurrentAppointmentForGoogleJob(
    payload.appointmentId,
    job.salonId,
    database,
  );
  const terminal = Boolean(
    !appointment
    || appointment.deletedAt
    || ['awaiting_payment', 'cancelled', 'no_show'].includes(appointment.status)
    || ['cancelled', 'no_show'].includes(appointment.canvasState ?? ''),
  );
  const hasNewerIntent = await hasNewerGoogleCalendarIntent(database, job, payload);
  let superseded = false;
  if (job.operation === 'delete_event') {
    if (payload.cleanup) {
      const activeMirrors = appointment && !terminal
        ? await database.select({
          calendarId: googleCalendarEventSchema.calendarId,
          googleEventId: googleCalendarEventSchema.googleEventId,
        })
          .from(googleCalendarEventSchema)
          .where(and(
            eq(googleCalendarEventSchema.salonId, job.salonId),
            eq(googleCalendarEventSchema.appointmentId, payload.appointmentId),
            isNull(googleCalendarEventSchema.deletedAt),
            eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
            inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
          ))
        : [];
      const exactAdopted = activeMirrors.filter(mirror => (
        mirror.calendarId === targetCalendarId
        && mirror.googleEventId === payload.googleCalendarEventId
      ));
      superseded = Boolean(
        appointment
        && exactAdopted.length === 1
        && (
          appointment.googleCalendarEventId === payload.googleCalendarEventId
          || (
            appointment.googleCalendarEventId === null
            && activeMirrors.length === 1
          )
        ),
      );
    } else if (payload.reconciliation) {
      superseded = Boolean(appointment && !terminal);
    } else {
      superseded = hasNewerIntent || Boolean(appointment && !terminal);
    }
  } else {
    superseded = terminal || (!payload.adminCopySourceEventId && hasNewerIntent);
  }
  if (superseded) {
    throw new GoogleOutboxSupersededBeforeDispatchError();
  }
}

async function assertGoogleCalendarPairOwnedOrAbsent(
  appointmentId: string,
  salonId: string,
  targetCalendarId: string,
  googleCalendarEventId?: string | null,
  options: {
    reconciliationMirrorId?: string;
    reconciliationExpectedAppointmentId?: string | null;
  } = {},
  database: OutboxDatabase = db,
) {
  if (!googleCalendarEventId) {
    return;
  }
  const exactPairs = await database.select({
    id: googleCalendarEventSchema.id,
    salonId: googleCalendarEventSchema.salonId,
    appointmentId: googleCalendarEventSchema.appointmentId,
    deletedAt: googleCalendarEventSchema.deletedAt,
    reviewStatus: googleCalendarEventSchema.reviewStatus,
    sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
    syncMode: googleCalendarEventSchema.syncMode,
  }).from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.calendarId, targetCalendarId),
    eq(googleCalendarEventSchema.googleEventId, googleCalendarEventId),
  ));
  if (exactPairs.length > 1) {
    throw new Error('GOOGLE_CALENDAR_MIRROR_AMBIGUOUS');
  }
  const exactPair = exactPairs[0];
  if (options.reconciliationMirrorId) {
    if (
      !exactPair
      || exactPair.id !== options.reconciliationMirrorId
      || exactPair.salonId !== salonId
      || exactPair.appointmentId
      !== (options.reconciliationExpectedAppointmentId ?? null)
      || exactPair.reviewStatus !== 'appointment'
      || exactPair.syncMode !== 'bidirectional'
      || !['owner', 'writer'].includes(exactPair.sourceAccessRole)
    ) {
      throw new GoogleOutboxSupersededBeforeDispatchError();
    }
    return;
  }
  if (exactPair?.salonId === salonId && exactPair.appointmentId === null) {
    throw new GoogleOutboxSupersededBeforeDispatchError();
  }
  if (
    exactPair
    && (
      exactPair.salonId !== salonId
      || exactPair.appointmentId !== appointmentId
    )
  ) {
    throw new Error('GOOGLE_CALENDAR_MIRROR_OWNERSHIP_CONFLICT');
  }
}

/**
 * Pin the exact provider calendar in the durable job payload before dispatch.
 * The claimed-attempt fence serializes the payload update; later retries use
 * that committed value without introducing a connection/event lock inversion.
 */
async function pinGoogleCalendarTarget(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
): Promise<string> {
  if (
    payload.targetCalendarId
    && (payload.googleCalendarEventId || payload.adminCopySourceEventId)
  ) {
    return payload.targetCalendarId;
  }
  return db.transaction(async (tx) => {
    const [owned] = await tx.select().from(integrationOutboxSchema).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.status, 'processing'),
      eq(integrationOutboxSchema.attempts, claimedAttempt),
    )).for('update').limit(1);
    if (!owned) {
      throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
    }
    const ownedPayload = parseGoogleMutationPayload(owned);
    if (
      ownedPayload.targetCalendarId
      && (ownedPayload.googleCalendarEventId || ownedPayload.adminCopySourceEventId)
    ) {
      payload.targetCalendarId = ownedPayload.targetCalendarId;
      (job.payload as GoogleCalendarMutationPayload).targetCalendarId
        = ownedPayload.targetCalendarId;
      if (ownedPayload.googleCalendarEventId) {
        payload.googleCalendarEventId = ownedPayload.googleCalendarEventId;
        (job.payload as GoogleCalendarMutationPayload).googleCalendarEventId
          = ownedPayload.googleCalendarEventId;
      }
      return ownedPayload.targetCalendarId;
    }

    const resolvedTarget = await resolveGoogleCalendarTargetInTx(tx, {
      appointmentId: payload.appointmentId,
      salonId: job.salonId,
      googleCalendarEventId: payload.googleCalendarEventId,
      mutationVersion: payload.mutationVersion ? new Date(payload.mutationVersion) : undefined,
      useDestinationCalendar: Boolean(payload.adminCopySourceEventId),
    });
    if (
      ownedPayload.targetCalendarId
      && resolvedTarget.targetCalendarId
      && ownedPayload.targetCalendarId !== resolvedTarget.targetCalendarId
    ) {
      throw new Error('GOOGLE_CALENDAR_TARGET_CONFLICT');
    }
    const targetCalendarId = ownedPayload.targetCalendarId
      ?? resolvedTarget.targetCalendarId;
    if (!targetCalendarId) {
      throw new Error('GOOGLE_CALENDAR_TARGET_UNAVAILABLE');
    }
    const resolvedEventId = resolvedTarget.googleCalendarEventId ?? null;
    const ownedEventId = ownedPayload.googleCalendarEventId ?? null;
    if (
      ownedPayload.targetCalendarId === targetCalendarId
      && ownedEventId === resolvedEventId
    ) {
      // The attempt-owned row is already pinned to this exact provider pair.
      // Avoid a semantically empty payload UPDATE: updated_at is the lease
      // heartbeat, so advancing it here would blur target resolution with
      // durable ownership and can hide a failed initial heartbeat write.
      payload.targetCalendarId = targetCalendarId;
      (job.payload as GoogleCalendarMutationPayload).targetCalendarId
        = targetCalendarId;
      if (resolvedEventId) {
        payload.googleCalendarEventId = resolvedEventId;
        (job.payload as GoogleCalendarMutationPayload).googleCalendarEventId
          = resolvedEventId;
      }
      return targetCalendarId;
    }
    const nextPayload = {
      ...owned.payload,
      targetCalendarId,
      ...(resolvedEventId
        ? { googleCalendarEventId: resolvedEventId }
        : {}),
    };
    const updated = await tx.update(integrationOutboxSchema).set({
      payload: nextPayload,
    }).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.status, 'processing'),
      eq(integrationOutboxSchema.attempts, claimedAttempt),
    )).returning();
    if (updated.length !== 1) {
      throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
    }
    payload.targetCalendarId = targetCalendarId;
    (job.payload as GoogleCalendarMutationPayload).targetCalendarId = targetCalendarId;
    if (resolvedEventId) {
      payload.googleCalendarEventId = resolvedEventId;
      (job.payload as GoogleCalendarMutationPayload).googleCalendarEventId
        = resolvedEventId;
    }
    return targetCalendarId;
  });
}

/**
 * Choose one raw provider identity for the active appointment lifecycle before
 * any provider I/O. A pre-lane attempt may already have an accepted/lost create
 * under its revision identity, so every newer row in that lifecycle adopts the
 * exact same identity. The appointment advisory lock excludes concurrent
 * enqueue decisions, and all existing lifecycle rows are row-locked and
 * updated together so later dispatchers observe the same durable choice.
 *
 * A terminal delete closes a lifecycle. This adoption deliberately does not
 * claim to fence a still-ambiguous create racing that terminal deletion; doing
 * so requires a separate durable tombstone design.
 */
async function pinGoogleCalendarProviderEventLane(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  payload: ReturnType<typeof parseGoogleMutationPayload>,
) {
  if (
    job.operation === 'delete_event'
    || payload.adminCopySourceEventId
  ) {
    return;
  }
  if (!payload.mutationVersion) {
    throw new Error('GOOGLE_CALENDAR_MUTATION_VERSION_MISSING');
  }
  await db.transaction(async (tx) => {
    await acquireGoogleCalendarAppointmentMutationLock(tx, {
      appointmentId: payload.appointmentId,
      salonId: job.salonId,
    });
    const [owned] = await tx.select().from(integrationOutboxSchema).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.provider, 'google_calendar'),
      eq(integrationOutboxSchema.status, 'processing'),
      eq(integrationOutboxSchema.attempts, claimedAttempt),
    )).for('update').limit(1);
    if (!owned) {
      throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
    }
    const ownedPayload = parseGoogleMutationPayload(owned);
    const currentRevision = payload.mutationVersion!;
    const terminalRevisions = await loadGoogleCalendarTerminalRevisionsInTx(
      tx,
      { appointmentId: payload.appointmentId, salonId: job.salonId },
    );
    const previousTerminalRevision = terminalRevisions
      .filter(revision => revision < currentRevision)
      .at(-1);
    const nextTerminalRevision = terminalRevisions
      .find(revision => revision >= currentRevision);
    const providerEventLane = previousTerminalRevision ?? 'initial';
    if (
      ownedPayload.providerEventLane
      && ownedPayload.providerEventLane !== providerEventLane
    ) {
      throw new Error('GOOGLE_CALENDAR_PROVIDER_LANE_CONFLICT');
    }

    const lifecycleRows = await tx.select().from(integrationOutboxSchema)
      .where(and(
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.appointmentId, payload.appointmentId),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        inArray(integrationOutboxSchema.operation, ['sync_appointment', 'upsert_event']),
        sql`${integrationOutboxSchema.payload}->>'adminCopySourceEventId' is null`,
      ))
      .for('update');
    const sameLifecycleRows = lifecycleRows.filter((candidate) => {
      const mutationVersion = (candidate.payload as Partial<GoogleCalendarMutationPayload>)
        .mutationVersion;
      if (typeof mutationVersion !== 'string') {
        return false;
      }
      const parsed = new Date(mutationVersion);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== mutationVersion) {
        return false;
      }
      return (!previousTerminalRevision || mutationVersion > previousTerminalRevision)
        && (!nextTerminalRevision || mutationVersion < nextTerminalRevision);
    });
    if (!sameLifecycleRows.some(candidate => candidate.id === job.id)) {
      throw new Error('GOOGLE_CALENDAR_PROVIDER_IDENTITY_AMBIGUOUS');
    }

    const cleanupRows = await tx.select({
      payload: integrationOutboxSchema.payload,
    }).from(integrationOutboxSchema).where(and(
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.appointmentId, payload.appointmentId),
      eq(integrationOutboxSchema.provider, 'google_calendar'),
      eq(integrationOutboxSchema.operation, 'delete_event'),
      sql`${integrationOutboxSchema.payload}->>'cleanup' = 'true'`,
    ));
    const identityEvidence: Array<{
      identity: string;
      targetCalendarId: string | null;
    }> = [];
    const ambiguousLegacyEvidence: Array<{
      identity: string;
      targetCalendarId: string | null;
    }> = [];
    for (const candidate of sameLifecycleRows) {
      const candidatePayload
        = candidate.payload as Partial<GoogleCalendarMutationPayload>;
      const identity = candidatePayload.providerEventIdentity;
      if (typeof identity === 'string' && identity) {
        identityEvidence.push({
          identity,
          targetCalendarId: candidatePayload.targetCalendarId ?? null,
        });
        continue;
      }

      // The database attempt count includes the claim currently being
      // processed. The owned row's first claim therefore is not evidence that
      // its pre-pinned lane has reached Google; a retry (claimedAttempt > 1)
      // is. Other rows already expose their durable attempt count directly.
      const hadPriorProviderAttempt = candidate.id === job.id
        ? candidatePayload.providerDispatchStarted === true
        || (
          claimedAttempt > 1
          && (
            candidate.lastError !== 'GOOGLE_CALENDAR_DISPATCH_BUSY'
            || claimedAttempt > 2
          )
        )
        : candidatePayload.providerDispatchStarted === true
          || (
            candidate.attempts > 0
            && (
              candidate.lastError !== 'GOOGLE_CALENDAR_DISPATCH_BUSY'
              || candidate.attempts > 1
            )
          );
      if (!hadPriorProviderAttempt) {
        continue;
      }
      if (candidatePayload.providerEventLane) {
        identityEvidence.push({
          identity: `appointment-lane:${candidatePayload.providerEventLane}`,
          targetCalendarId: candidatePayload.targetCalendarId ?? null,
        });
        continue;
      }
      if (typeof candidatePayload.mutationVersion !== 'string') {
        continue;
      }
      const legacyIdentity
        = `appointment-revision:${candidatePayload.mutationVersion}`;
      const legacyEventId = deterministicGoogleCalendarEventId({
        appointmentId: payload.appointmentId,
        idempotencyKey: legacyIdentity,
        salonId: job.salonId,
      });
      const hasDurableCleanupEvidence = cleanupRows.some(({ payload: cleanup }) => {
        const cleanupPayload = cleanup as Partial<GoogleCalendarMutationPayload> & {
          cleanup?: boolean;
        };
        return cleanupPayload.cleanup === true
          && cleanupPayload.googleCalendarEventId === legacyEventId
          && cleanupPayload.targetCalendarId === candidatePayload.targetCalendarId;
      });
      const remainsRemotelyAmbiguous = ['retry', 'processing'].includes(candidate.status)
        || (
          ['failed', 'cancelled'].includes(candidate.status)
          && hasDurableCleanupEvidence
        );
      if (remainsRemotelyAmbiguous) {
        if (
          candidatePayload.googleCalendarEventId
          && candidatePayload.googleCalendarEventId !== legacyEventId
        ) {
          // A pre-lane known-event attempt could have either PATCHed its linked
          // event or fallen back to the deterministic create. Without durable
          // transport-path evidence, both remote identities remain eligible.
          throw new Error('GOOGLE_CALENDAR_PROVIDER_IDENTITY_AMBIGUOUS');
        }
        ambiguousLegacyEvidence.push({
          identity: legacyIdentity,
          targetCalendarId: candidatePayload.targetCalendarId ?? null,
        });
      }
    }
    const durableIdentities = [...new Set(identityEvidence.map(({ identity }) => identity))];
    const ambiguousLegacyIdentities = [
      ...new Set(ambiguousLegacyEvidence.map(({ identity }) => identity)),
    ];
    const allIdentityEvidence = [
      ...identityEvidence,
      ...ambiguousLegacyEvidence,
    ];
    const evidenceTargets = [
      ...new Set(allIdentityEvidence.map(({ targetCalendarId }) => targetCalendarId)),
    ];
    if (
      durableIdentities.length > 1
      || ambiguousLegacyIdentities.length > 1
      || evidenceTargets.length > 1
      || (allIdentityEvidence.length > 0 && evidenceTargets[0] === null)
      || (
        durableIdentities[0]
        && ambiguousLegacyIdentities[0]
        && durableIdentities[0] !== ambiguousLegacyIdentities[0]
      )
    ) {
      throw new Error('GOOGLE_CALENDAR_PROVIDER_IDENTITY_AMBIGUOUS');
    }
    const providerEventIdentity = durableIdentities[0]
      ?? ambiguousLegacyIdentities[0]
      ?? `appointment-lane:${providerEventLane}`;
    const evidencedTargetCalendarId = allIdentityEvidence.length > 0
      ? evidenceTargets[0]
      : null;
    if (
      evidencedTargetCalendarId
      && ownedPayload.targetCalendarId
      && ownedPayload.targetCalendarId !== evidencedTargetCalendarId
    ) {
      throw new Error('GOOGLE_CALENDAR_PROVIDER_IDENTITY_AMBIGUOUS');
    }
    const resolvedTarget = evidencedTargetCalendarId || ownedPayload.targetCalendarId
      ? null
      : await resolveGoogleCalendarTargetInTx(tx, {
        appointmentId: payload.appointmentId,
        salonId: job.salonId,
        googleCalendarEventId: ownedPayload.googleCalendarEventId,
        mutationVersion: new Date(currentRevision),
      });
    const providerTargetCalendarId = evidencedTargetCalendarId
      ?? ownedPayload.targetCalendarId
      ?? resolvedTarget?.targetCalendarId;
    if (!providerTargetCalendarId) {
      throw new Error('GOOGLE_CALENDAR_TARGET_UNAVAILABLE');
    }
    const adoptedLegacyEventId = providerEventIdentity.startsWith('appointment-revision:')
      ? deterministicGoogleCalendarEventId({
        appointmentId: payload.appointmentId,
        idempotencyKey: providerEventIdentity,
        salonId: job.salonId,
      })
      : null;

    for (const candidate of sameLifecycleRows) {
      const candidatePayload
        = candidate.payload as Partial<GoogleCalendarMutationPayload>;
      if (
        candidatePayload.providerEventIdentity === providerEventIdentity
        && candidatePayload.providerEventLane === providerEventLane
        && candidatePayload.targetCalendarId === providerTargetCalendarId
        && (!adoptedLegacyEventId
          || candidatePayload.googleCalendarEventId === adoptedLegacyEventId)
      ) {
        continue;
      }
      const updated = await tx.update(integrationOutboxSchema).set({
        payload: {
          ...candidate.payload,
          ...(adoptedLegacyEventId
            ? { googleCalendarEventId: adoptedLegacyEventId }
            : {}),
          targetCalendarId: providerTargetCalendarId,
          providerEventIdentity,
          providerEventLane,
        },
      }).where(and(
        eq(integrationOutboxSchema.id, candidate.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
      )).returning();
      if (updated.length !== 1) {
        throw new GoogleOutboxLeaseError('GOOGLE_OUTBOX_LEASE_LOST');
      }
    }

    if (adoptedLegacyEventId) {
      // Any one-shot orphan cleanup created before adoption must not race B/C
      // and delete the identity that is now canonical for this lifecycle.
      await tx.update(integrationOutboxSchema).set({
        status: 'cancelled',
        processedAt: new Date(),
        lastError: 'CANONICAL_PROVIDER_IDENTITY_ADOPTED',
      }).where(and(
        eq(integrationOutboxSchema.salonId, job.salonId),
        eq(integrationOutboxSchema.appointmentId, payload.appointmentId),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        eq(integrationOutboxSchema.operation, 'delete_event'),
        inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        sql`${integrationOutboxSchema.payload}->>'cleanup' = 'true'`,
        sql`${integrationOutboxSchema.payload}->>'googleCalendarEventId' = ${adoptedLegacyEventId}`,
        sql`${integrationOutboxSchema.payload}->>'targetCalendarId' = ${providerTargetCalendarId}`,
      ));
      payload.googleCalendarEventId = adoptedLegacyEventId;
      (job.payload as GoogleCalendarMutationPayload).googleCalendarEventId
        = adoptedLegacyEventId;
    }
    payload.targetCalendarId = providerTargetCalendarId;
    (job.payload as GoogleCalendarMutationPayload).targetCalendarId
      = providerTargetCalendarId;
    payload.providerEventIdentity = providerEventIdentity;
    payload.providerEventLane = providerEventLane;
    (job.payload as GoogleCalendarMutationPayload).providerEventIdentity
      = providerEventIdentity;
    (job.payload as GoogleCalendarMutationPayload).providerEventLane
      = providerEventLane;
  });
}

async function processGoogleCalendarJob(
  job: IntegrationOutboxRow,
  claimedAttempt: number,
  parentSignal?: AbortSignal,
  beforeProviderDispatch?: (job: IntegrationOutboxRow) => Promise<void>,
  afterCurrentnessCheckBeforeProviderCall?: (job: IntegrationOutboxRow) => Promise<void>,
) {
  const payload = parseGoogleMutationPayload(job);
  const appointment = await getCurrentAppointmentForGoogleJob(
    payload.appointmentId,
    job.salonId,
  );
  if (payload.mutationVersion === undefined) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(appointmentSchema).where(and(
        eq(appointmentSchema.id, payload.appointmentId),
        eq(appointmentSchema.salonId, job.salonId),
      )).for('update').limit(1);
      if (!locked) {
        return;
      }
      if (locked.deletedAt || ['awaiting_payment', 'cancelled', 'no_show'].includes(locked.status)) {
        if (locked.googleCalendarEventId) {
          try {
            await enqueueGoogleCalendarDeleteInTx(tx, {
              appointmentId: locked.id,
              salonId: locked.salonId,
              mutationVersion: locked.updatedAt,
              googleCalendarEventId: locked.googleCalendarEventId,
            });
          } catch (error) {
            if (!(error instanceof Error)
              || error.message !== 'GOOGLE_CALENDAR_TARGET_UNATTRIBUTED') {
              throw error;
            }
            // A pre-outbox scalar does not identify its calendar. Remote
            // metadata reconciliation may recover the exact pair; never guess
            // today's destination merely to retire this legacy row.
          }
        }
      } else {
        await enqueueGoogleCalendarAppointmentMutation(tx, {
          appointmentId: locked.id,
          salonId: locked.salonId,
          mutationVersion: locked.updatedAt,
        });
      }
    });
    // Legacy rows predate deterministic provider identities. They are migrated
    // to a current durable intent without assuming a remote create could have
    // happened, then terminalized under the exact attempt fence.
    const updated = await db.update(integrationOutboxSchema).set({
      status: 'cancelled',
      processedAt: new Date(),
      lastError: 'SUPERSEDED',
    }).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      eq(integrationOutboxSchema.status, 'processing'),
      eq(integrationOutboxSchema.attempts, claimedAttempt),
    )).returning();
    return updated.length === 1;
  }
  await pinGoogleCalendarProviderEventLane(job, claimedAttempt, payload);
  const terminal = Boolean(
    !appointment
    || appointment.deletedAt
    || ['awaiting_payment', 'cancelled', 'no_show'].includes(appointment.status)
    || ['cancelled', 'no_show'].includes(appointment.canvasState ?? ''),
  );
  const hasNewerIntent = await hasNewerGoogleCalendarIntent(db, job, payload);

  let providerResult: GoogleProviderResult;
  const targetCalendarId = await pinGoogleCalendarTarget(job, claimedAttempt, payload);
  const dispatchWithCurrentIntentFence = <T>(
    googleCalendarEventId: string | null | undefined,
    operation: (
      signal: AbortSignal,
      leaseControls: GoogleOutboxLeaseControls,
    ) => Promise<T>,
  ) => withGoogleOutboxLease(job, claimedAttempt, async (signal, leaseControls) => {
    await beforeProviderDispatch?.(job);
    // Preliminary check after target pinning. The provider request fence repeats
    // these checks while holding the shared appointment/event session lock, so
    // a mutation committed in this historical check/send window suppresses the
    // obsolete request before any Calendar transport starts.
    await assertGoogleJobStillCurrentBeforeDispatch(job, payload, targetCalendarId);
    await assertGoogleCalendarPairOwnedOrAbsent(
      payload.appointmentId,
      job.salonId,
      targetCalendarId,
      googleCalendarEventId,
      {
        reconciliationMirrorId: payload.reconciliationMirrorId,
        reconciliationExpectedAppointmentId:
          payload.reconciliationExpectedAppointmentId,
      },
    );
    await afterCurrentnessCheckBeforeProviderCall?.(job);
    // Persist that this exact row reached the provider boundary before OAuth
    // or Calendar transport starts. A later retry can distinguish a genuinely
    // ambiguous old operation from a claim that failed during local pinning.
    await markGoogleProviderDispatchStarted(job, claimedAttempt, payload);
    return operation(signal, leaseControls);
  }, parentSignal);
  if (job.operation === 'delete_event') {
    if (!payload.googleCalendarEventId) {
      return finishGoogleJobSuperseded(job, claimedAttempt);
    }
    const activeMirrors = await db.select({
      calendarId: googleCalendarEventSchema.calendarId,
      googleEventId: googleCalendarEventSchema.googleEventId,
    })
      .from(googleCalendarEventSchema)
      .where(and(
        eq(googleCalendarEventSchema.salonId, job.salonId),
        eq(googleCalendarEventSchema.appointmentId, payload.appointmentId),
        isNull(googleCalendarEventSchema.deletedAt),
        eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
        inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
      ));
    const exactActiveMirror = activeMirrors.filter(mirror => (
      mirror.calendarId === targetCalendarId
      && mirror.googleEventId === payload.googleCalendarEventId
    ));
    if (
      payload.cleanup
      && appointment
      && !terminal
      && (
        appointment.googleCalendarEventId === payload.googleCalendarEventId
        || (
          appointment.googleCalendarEventId === null
          && activeMirrors.length === 1
        )
      )
      && exactActiveMirror.length === 1
    ) {
      // The event was obsolete when cleanup was queued, but a later durable
      // copy/upsert has since adopted that exact id. Never let delayed cleanup
      // delete the appointment's now-authoritative remote event.
      return finishGoogleJobSuperseded(job, claimedAttempt);
    }
    if (
      !payload.cleanup
      && !payload.reconciliation
      && (hasNewerIntent || !terminal)
    ) {
      return finishGoogleJobSuperseded(job, claimedAttempt);
    }
    if (payload.reconciliation && appointment && !terminal) {
      return finishGoogleJobSuperseded(job, claimedAttempt);
    }
    if (!payload.cleanup && !payload.authoritativeTerminalDelete && appointment) {
      if (
        appointment.googleCalendarEventId !== payload.googleCalendarEventId
        && exactActiveMirror.length === 0
      ) {
        return finishGoogleJobSuperseded(job, claimedAttempt);
      }
    }
    providerResult = await dispatchWithCurrentIntentFence(
      payload.googleCalendarEventId,
      (signal, leaseControls) =>
        deleteGoogleCalendarEventForAppointment({
          appointmentId: payload.appointmentId,
          salonId: job.salonId,
          googleCalendarEventId: payload.googleCalendarEventId,
        }, {
          persistResult: false,
          signal,
          targetCalendarId,
          reconciliationMirrorId: payload.reconciliationMirrorId,
          reconciliationExpectedAppointmentId:
          payload.reconciliationExpectedAppointmentId,
          authoritativeTerminalDelete: payload.authoritativeTerminalDelete === true,
          dispatchFence: operation => withGoogleCalendarDispatchLock(
            job,
            claimedAttempt,
            payload,
            payload.googleCalendarEventId,
            operation,
            leaseControls,
          ),
          attemptFence: { jobId: job.id, claimedAttempt },
          mutationVersion: payload.mutationVersion ?? undefined,
        }),
    );
  } else if (job.operation === 'sync_appointment') {
    if (
      !appointment
      || terminal
      || (!payload.adminCopySourceEventId && hasNewerIntent)
    ) {
      return finishGoogleJobSuperseded(job, claimedAttempt);
    }
    if (payload.adminCopySourceEventId) {
      const [source] = await db.select({ id: googleCalendarEventSchema.id })
        .from(googleCalendarEventSchema)
        .where(and(
          eq(googleCalendarEventSchema.id, payload.adminCopySourceEventId),
          eq(googleCalendarEventSchema.salonId, job.salonId),
          eq(googleCalendarEventSchema.appointmentId, payload.appointmentId),
          eq(googleCalendarEventSchema.syncMode, 'inbound_only'),
        )).limit(1);
      if (!source) {
        return finishGoogleJobSuperseded(job, claimedAttempt);
      }
    }
    const currentInput = await loadCurrentGoogleCalendarInput(
      payload.appointmentId,
      job.salonId,
    );
    if (payload.adminCopySourceEventId) {
      currentInput.googleCalendarEventId = null;
    } else if (payload.googleCalendarEventId) {
      currentInput.googleCalendarEventId = payload.googleCalendarEventId;
    }
    (job.payload as Record<string, unknown>).dispatchedEventId
      = currentInput.googleCalendarEventId ?? null;
    providerResult = await dispatchWithCurrentIntentFence(
      currentInput.googleCalendarEventId,
      (signal, leaseControls) =>
        syncGoogleCalendarEventForAppointment({
          ...currentInput,
          mutationVersion: payload.adminCopySourceEventId
            ? currentInput.mutationVersion
            : payload.mutationVersion ?? undefined,
        }, {
          persistResult: false,
          signal,
          useDestinationCalendar: Boolean(payload.adminCopySourceEventId),
          idempotencyKey: googleProviderIdempotencyKey(job, payload),
          targetCalendarId,
          dispatchFence: operation => withGoogleCalendarDispatchLock(
            job,
            claimedAttempt,
            payload,
            currentInput.googleCalendarEventId,
            operation,
            leaseControls,
            payload.adminCopySourceEventId
              ? currentInput.mutationVersion
              : undefined,
          ),
          attemptFence: { jobId: job.id, claimedAttempt },
        }),
    );
  } else if (job.operation === 'upsert_event') {
    const serialized = job.payload as SerializedGoogleEvent & GoogleCalendarMutationPayload;
    const startTime = new Date(serialized.startTime);
    const endTime = new Date(serialized.endTime);
    if (
      !appointment
      || terminal
      || hasNewerIntent
      || Number.isNaN(startTime.getTime())
      || Number.isNaN(endTime.getTime())
    ) {
      return finishGoogleJobSuperseded(job, claimedAttempt);
    }
    const dispatchedEventId = serialized.googleCalendarEventId
      || appointment.googleCalendarEventId
      || null;
    (job.payload as Record<string, unknown>).dispatchedEventId = dispatchedEventId;
    providerResult = await dispatchWithCurrentIntentFence(
      dispatchedEventId,
      (signal, leaseControls) =>
        syncGoogleCalendarEventForAppointment({
          ...serialized,
          startTime,
          endTime,
          googleCalendarEventId: dispatchedEventId,
          mutationVersion: payload.mutationVersion ?? undefined,
        }, {
          persistResult: false,
          signal,
          idempotencyKey: googleProviderIdempotencyKey(job, payload),
          targetCalendarId,
          dispatchFence: operation => withGoogleCalendarDispatchLock(
            job,
            claimedAttempt,
            payload,
            dispatchedEventId,
            operation,
            leaseControls,
          ),
          attemptFence: { jobId: job.id, claimedAttempt },
        }),
    );
  } else {
    throw new Error('INVALID_GOOGLE_CALENDAR_OPERATION');
  }

  if (providerResult.status === 'failed') {
    const providerError = new Error(providerResult.error) as Error & {
      googleCreateAttempted?: boolean;
    };
    providerError.googleCreateAttempted = providerResult.createAttempted === true;
    throw providerError;
  }
  if (
    providerResult.status !== 'disabled'
    && providerResult.calendarId !== undefined
    && providerResult.calendarId !== targetCalendarId
  ) {
    throw new Error('GOOGLE_CALENDAR_TARGET_MISMATCH');
  }
  if (providerResult.status === 'disabled' && payload.adminCopySourceEventId) {
    // Copy is an explicit provider mutation, not a best-effort sync toggle. A
    // disabled connection has not copied anything, so retain retry/rearm
    // semantics instead of freezing the stable source-event key as completed.
    throw new Error('GOOGLE_CALENDAR_ADMIN_COPY_DISABLED');
  }
  if (providerResult.status === 'disabled' && payload.reconciliation) {
    // A stable reconciliation key must remain retryable while the connection
    // is unavailable. Completing it would make later discovery collide with a
    // false-success row and permanently strand the remote event.
    throw new Error('GOOGLE_CALENDAR_RECONCILIATION_DISABLED');
  }
  if (providerResult.status === 'deleted' && providerResult.eventId) {
    payload.googleCalendarEventId = providerResult.eventId;
  }
  return finishGoogleJobSuccess(job, claimedAttempt, payload, providerResult);
}

export async function processIntegrationOutbox(
  limit = 50,
  options: {
    signal?: AbortSignal;
    /** Integration-test gate immediately after lease acquisition. */
    beforeGoogleProviderDispatch?: (job: IntegrationOutboxRow) => Promise<void>;
    /** Test-only gate in the historical last-check/request-start window. */
    afterGoogleCurrentnessCheckBeforeProviderCall?: (
      job: IntegrationOutboxRow,
    ) => Promise<void>;
  } = {},
) {
  const throwIfAborted = () => {
    if (!options.signal?.aborted) {
      return;
    }
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error('INTEGRATION_OUTBOX_ABORTED');
  };
  throwIfAborted();
  // A Vercel invocation can end after a job is claimed but before it is marked
  // complete. A stale Google row is reclaimable only after its matching session
  // lock can also be acquired, proving no old transport remains live in this
  // database session domain. Provider ETags/stable ids cover process-death
  // ambiguity after the session itself disappears.
  const staleBefore = new Date(Date.now() - GOOGLE_OUTBOX_LEASE_MS);
  await db
    .update(integrationOutboxSchema)
    .set({
      status: 'retry',
      availableAt: new Date(),
      lastError: 'WORKER_INTERRUPTED',
    })
    .where(
      and(
        eq(integrationOutboxSchema.status, 'processing'),
        ne(integrationOutboxSchema.provider, 'google_calendar'),
        lt(integrationOutboxSchema.updatedAt, staleBefore),
      ),
    );
  const staleGoogleJobs = usesRuntimePostgres
    ? await db.select().from(integrationOutboxSchema)
      .where(and(
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        eq(integrationOutboxSchema.status, 'processing'),
        lt(integrationOutboxSchema.updatedAt, staleBefore),
      ))
      .orderBy(asc(integrationOutboxSchema.updatedAt))
      .limit(limit)
    : [];
  for (const staleJob of staleGoogleJobs.filter(staleJob => (
    staleJob.provider === 'google_calendar'
    && staleJob.status === 'processing'
    && staleJob.updatedAt < staleBefore
  ))) {
    throwIfAborted();
    await reclaimStaleGoogleCalendarJob(staleJob, staleBefore);
  }
  throwIfAborted();

  // Google jobs use `processing` as their per-appointment provider mutex. A
  // live provider await refreshes updated_at every 15 seconds; only a processing
  // row with no successful heartbeat for this full horizon is reclaimable.

  const jobs = await db
    .select()
    .from(integrationOutboxSchema)
    .where(
      and(
        inArray(integrationOutboxSchema.provider, ['google_calendar', 'email']),
        inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        lte(integrationOutboxSchema.availableAt, new Date()),
      ),
    )
    .orderBy(asc(integrationOutboxSchema.createdAt))
    .limit(limit);
  const summary = {
    scanned: jobs.length,
    succeeded: 0,
    retried: 0,
    failed: 0,
    cancelledEventCandidates: 0,
    remoteAppointmentMirrorsScanned: 0,
    remoteCancelledEventCandidates: 0,
    queuedCancelledEvents: 0,
    skippedCancelledEvents: 0,
    failedCancelledEvents: 0,
  };
  for (const job of jobs) {
    throwIfAborted();
    const claimedAttempt = await claimIntegrationOutboxJob(job);
    if (claimedAttempt === null) {
      if (job.provider === 'google_calendar') {
        // A live peer owns this appointment. Move only this unchanged snapshot
        // briefly out of the due set so an oldest group cannot consume every
        // bounded scan and starve unrelated tenants on later invocations.
        await db.update(integrationOutboxSchema).set({
          availableAt: new Date(Date.now() + 30_000),
        }).where(and(
          eq(integrationOutboxSchema.id, job.id),
          eq(integrationOutboxSchema.salonId, job.salonId),
          eq(integrationOutboxSchema.attempts, job.attempts),
          inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        ));
      }
      continue;
    }
    try {
      let result;
      if (job.provider === 'google_calendar') {
        try {
          const owned = await processGoogleCalendarJob(
            job,
            claimedAttempt,
            options.signal,
            options.beforeGoogleProviderDispatch,
            options.afterGoogleCurrentnessCheckBeforeProviderCall,
          );
          if (owned) {
            summary.succeeded += 1;
          }
        } catch (error) {
          if (
            error instanceof GoogleOutboxLeaseError
            && error.message === 'GOOGLE_OUTBOX_PROVIDER_DID_NOT_DRAIN'
          ) {
            // The exact attempt stays `processing`, preserving the durable
            // appointment mutex until stale-lease recovery. Do not publish a
            // retry while a non-cooperative provider promise may still exist.
            continue;
          }
          if (isGoogleCalendarDispatchFenceError(error)) {
            const cause = error.cause;
            if (cause instanceof GoogleOutboxSupersededBeforeDispatchError) {
              const owned = await finishGoogleJobSuperseded(job, claimedAttempt);
              if (owned) {
                summary.succeeded += 1;
              }
              continue;
            }
            if (cause instanceof GoogleOutboxLeaseError) {
              const outcome = await finishGoogleJobFailure(
                job,
                claimedAttempt,
                safeGoogleMutationPayloadForFailure(job),
                cause,
              );
              if (outcome.owned) {
                if (outcome.final) {
                  summary.failed += 1;
                } else {
                  summary.retried += 1;
                }
              }
              continue;
            }
          }
          if (error instanceof GoogleOutboxSupersededBeforeDispatchError) {
            const owned = await finishGoogleJobSuperseded(job, claimedAttempt);
            if (owned) {
              summary.succeeded += 1;
            }
            continue;
          }
          const outcome = await finishGoogleJobFailure(
            job,
            claimedAttempt,
            safeGoogleMutationPayloadForFailure(job),
            error,
          );
          if (outcome.owned) {
            if (outcome.final) {
              summary.failed += 1;
            } else {
              summary.retried += 1;
            }
          }
        }
        continue;
      } else if (
        job.provider === 'email'
        && job.operation === 'retry_booking_confirmation'
      ) {
        const payload = job.payload as { deliveryId?: string };
        if (!job.appointmentId || !payload.deliveryId) {
          throw new Error('INVALID_BOOKING_EMAIL_RETRY');
        }
        const { retryCustomerBookingConfirmationEmail } = await import(
          '@/libs/customerBookingEmail'
        );
        await retryCustomerBookingConfirmationEmail({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          deliveryId: payload.deliveryId,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'retry_salon_notification'
      ) {
        const payload = job.payload as {
          deliveryId?: string;
          event?: SalonNotificationEventKey;
          source?: SalonNotificationSource;
          previous?: SalonNotificationPreviousSchedule | null;
          cancellation?: SalonNotificationCancellation | null;
          refund?: SalonNotificationRefundMetadata | null;
        };
        if (!job.appointmentId || !payload.deliveryId || !payload.event) {
          throw new Error('INVALID_SALON_NOTIFICATION_RETRY');
        }
        const { retrySalonNotificationEmail } = await import(
          '@/libs/salonNotificationEmail'
        );
        await retrySalonNotificationEmail({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          deliveryId: payload.deliveryId,
          event: payload.event,
          source: payload.source ?? 'unknown',
          previous: payload.previous ?? undefined,
          cancellation: payload.cancellation ?? undefined,
          refund: payload.refund ?? undefined,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'retry_booking_recovery'
      ) {
        const payload = job.payload as {
          deliveryId?: string;
          appointmentIds?: string[];
        };
        if (!payload.deliveryId || !payload.appointmentIds?.length) {
          throw new Error('INVALID_BOOKING_RECOVERY_RETRY');
        }
        const { retryBookingRecoveryEmail } = await import(
          '@/libs/bookingRecoveryEmail'
        );
        await retryBookingRecoveryEmail({
          salonId: job.salonId,
          deliveryId: payload.deliveryId,
          appointmentIds: payload.appointmentIds,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'booking_confirmed_side_effects'
      ) {
        // Paid-deposit confirmation is an at-least-once aggregate. The handler
        // verifies durable paid state before running the shared effects, but
        // every effect keeps its own replay posture: stable local claims protect
        // calendar/customer/salon email, while best-effort client SMS and
        // owner/staff delivery may be invoked again after a crash or retry.
        const payload = job.payload as { depositId?: string };
        if (!job.appointmentId || !payload.depositId) {
          throw new Error('INVALID_DEPOSIT_SIDE_EFFECTS');
        }
        const { runDepositConfirmationSideEffects } = await import(
          '@/libs/deposits/depositOutboxHandlers'
        );
        await runDepositConfirmationSideEffects({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          parentJobId: job.id,
          payload: job.payload,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'deposit_refund_notices'
      ) {
        const payload = job.payload as { depositId?: string };
        if (!job.appointmentId || !payload.depositId) {
          throw new Error('INVALID_DEPOSIT_REFUND_NOTICES');
        }
        const { runDepositRefundNotices } = await import(
          '@/libs/deposits/depositOutboxHandlers'
        );
        await runDepositRefundNotices({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          payload: job.payload,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'deposit_refund_alert'
      ) {
        if (!job.appointmentId) {
          throw new Error('INVALID_DEPOSIT_REFUND_ALERT');
        }
        const { runDepositRefundAlert } = await import(
          '@/libs/deposits/depositOutboxHandlers'
        );
        await runDepositRefundAlert({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          payload: job.payload,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        result = { status: 'synced' as const };
      } else if (job.provider === 'email' && job.operation === 'staff_reschedule_notification') {
        const payload = parseStaffRescheduleNotificationPayload(job.payload);
        const loadCurrent = async () => {
          const [current] = await db.select({
            startTime: appointmentSchema.startTime,
            endTime: appointmentSchema.endTime,
            status: appointmentSchema.status,
            deletedAt: appointmentSchema.deletedAt,
            salonName: salonSchema.name,
          }).from(appointmentSchema)
            .innerJoin(salonSchema, eq(salonSchema.id, appointmentSchema.salonId))
            .where(and(
              eq(appointmentSchema.id, job.appointmentId!),
              eq(appointmentSchema.salonId, job.salonId),
            )).limit(1);
          return current;
        };
        const finishTerminal = async (status: 'cancelled' | 'failed', lastError: 'SUPERSEDED' | 'RECIPIENT_UNAVAILABLE' | 'INVALID_PAYLOAD') => db
          .update(integrationOutboxSchema).set({ status, processedAt: new Date(), lastError }).where(and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
            eq(integrationOutboxSchema.status, 'processing'),
            eq(integrationOutboxSchema.attempts, claimedAttempt),
          )).returning();
        if (
          !payload
          || payload.appointmentId !== job.appointmentId
          || payload.salonId !== job.salonId
        ) {
          const terminalized = await finishTerminal('failed', 'INVALID_PAYLOAD');
          if (terminalized.length === 1) {
            summary.failed += 1;
          }
          continue;
        }
        const newStart = new Date(payload.newStartTime);
        const current = await loadCurrent();
        const isCurrent = (value: typeof current): value is NonNullable<typeof current> => Boolean(
          value && !value.deletedAt && ['pending', 'confirmed'].includes(value.status)
          && value.startTime.getTime() === newStart.getTime(),
        );
        if (!isCurrent(current)) {
          const terminalized = await finishTerminal('cancelled', 'SUPERSEDED');
          if (terminalized.length === 1) {
            summary.succeeded += 1;
          }
          continue;
        }
        const date = formatDateInTimeZone(payload.newStartTime, { weekday: 'long', month: 'long', day: 'numeric' }, payload.timeZone);
        const time = formatTimeInTimeZone(payload.newStartTime, {}, payload.timeZone);
        let superseded = false;
        const { sendAppointmentOperationalEmailOnce } = await import('@/libs/clientLifecycleStabilization');
        const delivery = await sendAppointmentOperationalEmailOnce({
          salonId: job.salonId,
          appointmentId: job.appointmentId!,
          purpose: 'client_appointment_rescheduled',
          eventVersion: [payload.previousStartTime, payload.previousEndTime, payload.newStartTime, payload.newEndTime, payload.mutationVersion].join(':'),
          retryFailed: true,
          signal: options.signal,
          prepare: async () => {
            const { mintAppointmentManageLink } = await import('@/libs/appointmentManageLink');
            const manageUrl = await mintAppointmentManageLink({
              id: job.appointmentId!,
              salonId: job.salonId,
              endTime: current.endTime,
            });
            return {
              subject: `${current.salonName} appointment rescheduled`,
              text: `Your ${current.salonName} appointment has been moved to ${date} at ${time}.\n\nView, reschedule, or cancel: ${manageUrl}`,
              html: `<p>Your <strong>${escapeHtml(current.salonName)}</strong> appointment has been moved to <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(manageUrl)}">View, reschedule, or cancel</a></p>`,
            };
          },
          validateBeforeDelivery: async () => {
            superseded = !isCurrent(await loadCurrent());
            return !superseded;
          },
          validationErrorCode: 'SUPERSEDED',
        });
        if (superseded) {
          const terminalized = await finishTerminal('cancelled', 'SUPERSEDED');
          if (terminalized.length === 1) {
            summary.succeeded += 1;
          }
          continue;
        }
        if (delivery.status === 'unavailable') {
          const terminalized = await finishTerminal('failed', 'RECIPIENT_UNAVAILABLE');
          if (terminalized.length === 1) {
            summary.failed += 1;
          }
          continue;
        }
        result = delivery.status === 'failed'
          ? { status: 'failed' as const, error: 'STAFF_RESCHEDULE_EMAIL_FAILED' }
          : { status: 'synced' as const };
      } else {
        throw new Error('INVALID_INTEGRATION_OUTBOX_OPERATION');
      }
      if (result.status === 'failed') {
        throw new Error(result.error);
      }
      throwIfAborted();
      const completed = await db
        .update(integrationOutboxSchema)
        .set({ status: 'completed', processedAt: new Date(), lastError: null })
        .where(
          and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
            eq(integrationOutboxSchema.status, 'processing'),
            eq(integrationOutboxSchema.attempts, claimedAttempt),
          ),
        )
        .returning();
      if (completed.length === 1) {
        summary.succeeded += 1;
      }
    } catch (error) {
      const attempts = claimedAttempt;
      const final = attempts >= 8;
      const terminalized = await db
        .update(integrationOutboxSchema)
        .set({
          status: final ? 'failed' : 'retry',
          lastError: safeJobError(error),
          availableAt: new Date(
            Date.now() + Math.min(60, 2 ** attempts) * 60_000,
          ),
        })
        .where(
          and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
            eq(integrationOutboxSchema.status, 'processing'),
            eq(integrationOutboxSchema.attempts, claimedAttempt),
          ),
        )
        .returning();
      if (terminalized.length !== 1) {
        continue;
      }
      if (final) {
        summary.failed += 1;
        if (DEPOSIT_OUTBOX_OPERATIONS.has(job.operation)) {
          // The worker's own terminal is SILENT — it emails the salon owner and
          // stops. That is the right posture for a bounced confirmation, and the
          // wrong one for a deposit: these two jobs are the only notice a client
          // gets that their money moved, so their exhaustion needs an operator
          // signal, not just an owner email. The attempt-fenced terminal write
          // lets only its winner attempt this ids-only alert (Sentry never
          // receives payloads on these money paths). A crash after terminalizing
          // but before dispatch can still lose the best-effort alert.
          Sentry.captureMessage('deposit_outbox_job_failed', {
            level: 'error',
            tags: { outbox_operation: job.operation },
            extra: {
              jobId: job.id,
              appointmentId: job.appointmentId,
              depositId: (job.payload as { depositId?: string }).depositId,
            },
          });
        }
        if (job.provider === 'email') {
          const deliveryId = (job.payload as { deliveryId?: string })
            .deliveryId;
          if (deliveryId) {
            await db
              .update(notificationDeliverySchema)
              .set({ retryable: false })
              .where(
                and(
                  eq(notificationDeliverySchema.id, deliveryId),
                  eq(notificationDeliverySchema.salonId, job.salonId),
                ),
              );
          }
        }
        const [salon] = await db
          .select({
            name: salonSchema.name,
            ownerEmail: salonSchema.ownerEmail,
            email: salonSchema.email,
          })
          .from(salonSchema)
          .where(eq(salonSchema.id, job.salonId))
          .limit(1);
        const recipient = salon?.ownerEmail || salon?.email;
        if (recipient) {
          const { sendTransactionalEmail } = await import('@/libs/email');
          const isEmail = job.provider === 'email';
          const isSalonNotification
            = job.operation === 'retry_salon_notification'
            || job.operation === 'deposit_refund_alert';
          const notice = isSalonNotification
            ? {
                subject: `${salon?.name || 'Your salon'} appointment alerts need attention`,
                text: `Luster could not deliver a salon appointment alert after several retries. The appointment itself is unaffected and still safe in Luster. Check the notification email address in Settings → Notifications.\n\nAppointment: ${job.appointmentId || 'unknown'}`,
                html: `<p>Luster could not deliver a salon appointment alert after several retries. The appointment itself is unaffected and still safe in Luster.</p><p>Check the notification email address in Settings &rarr; Notifications.</p>`,
              }
            : isEmail
              ? {
                  subject: `${salon?.name || 'Your salon'} client email needs attention`,
                  text: `Luster could not deliver a client booking confirmation after several retries. The appointment is still safe in Luster. Open the appointment to verify the email address and resend the confirmation.\n\nAppointment: ${job.appointmentId || 'unknown'}`,
                  html: `<p>Luster could not deliver a client booking confirmation after several retries. The appointment is still safe.</p><p>Open the appointment, verify the email address, and resend the confirmation.</p>`,
                }
              : {
                  subject: `${salon?.name || 'Your salon'} Google Calendar needs attention`,
                  text: `Google Calendar could not sync an appointment after several retries. The booking is still safe in Luster. Reconnect Calendar from the Luster area or contact support.\n\nAppointment: ${job.appointmentId || 'unknown'}`,
                  html: `<p>Google Calendar could not sync an appointment after several retries. The booking is still safe in Luster.</p><p>Reconnect Calendar from the Luster area or contact support.</p>`,
                };
          await sendTransactionalEmail({
            to: recipient,
            subject: notice.subject,
            text: notice.text,
            html: notice.html,
          }, { signal: options.signal, timeoutMs: 5_000 }).catch(() => false);
        }
      } else {
        summary.retried += 1;
      }
    }
  }

  // Past mirrors cannot block a future booking, and allowing them into this
  // bounded repair batch can permanently starve a recently cancelled future
  // appointment. Prefer the newest future cancellations and scan a wider but
  // still bounded set so one salon's history cannot monopolize the worker.
  const reconciliationLimit = Math.min(Math.max(limit * 4, 200), 500);
  throwIfAborted();
  const reconciliationCutoff = new Date();
  const linkedMirrors = await db.select({
    reconciliationMirrorId: googleCalendarEventSchema.id,
    appointmentId: appointmentSchema.id,
    salonId: appointmentSchema.salonId,
    googleCalendarEventId: googleCalendarEventSchema.googleEventId,
    observedVersion: appointmentSchema.updatedAt,
    appointmentExists: sql<boolean>`true`,
    targetCalendarId: googleCalendarEventSchema.calendarId,
  })
    .from(appointmentSchema)
    .innerJoin(
      googleCalendarEventSchema,
      and(
        eq(googleCalendarEventSchema.salonId, appointmentSchema.salonId),
        eq(googleCalendarEventSchema.appointmentId, appointmentSchema.id),
      ),
    )
    .innerJoin(
      salonGoogleCalendarConnectionSchema,
      eq(salonGoogleCalendarConnectionSchema.salonId, appointmentSchema.salonId),
    )
    .where(and(
      or(
        inArray(appointmentSchema.status, ['cancelled', 'no_show']),
        inArray(appointmentSchema.canvasState, ['cancelled', 'no_show']),
        isNotNull(appointmentSchema.deletedAt),
      ),
      gte(appointmentSchema.endTime, reconciliationCutoff),
      isNull(googleCalendarEventSchema.deletedAt),
      ne(googleCalendarEventSchema.googleStatus, 'cancelled'),
      eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
      inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
      inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']),
    ))
    .orderBy(desc(appointmentSchema.updatedAt))
    .limit(reconciliationLimit);

  const cancelledMirrors = new Map<string, {
    appointmentId: string;
    salonId: string;
    googleCalendarEventId: string | null;
    observedVersion: Date;
    appointmentExists: boolean;
    targetCalendarId: string;
    reconciliationMirrorId?: string;
    reconciliationExpectedAppointmentId?: string | null;
  }>();
  for (const appointment of linkedMirrors) {
    if (!appointment.googleCalendarEventId) {
      continue;
    }
    cancelledMirrors.set(
      `${appointment.salonId}:${appointment.targetCalendarId}:${appointment.appointmentId}:${appointment.googleCalendarEventId}`,
      {
        ...appointment,
        // Discovery proved this exact writable mirror belongs to the terminal
        // appointment. Persist that ownership snapshot into the durable job so
        // a later transfer to another appointment supersedes the delete before
        // provider dispatch instead of being retried as a generic conflict.
        reconciliationExpectedAppointmentId: appointment.appointmentId,
      },
    );
  }

  // Older failed cancellations can have lost both local identifiers while the
  // Google event still carries the private appointmentId/salonId metadata we
  // wrote when creating it. Query only those app-owned events, then verify the
  // appointment is terminal in our database before adding it to the repair
  // set. The private-property filter avoids scanning or touching unrelated
  // calendar entries.
  const connections = await db
    .select({
      salonId: salonGoogleCalendarConnectionSchema.salonId,
      destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId,
    })
    .from(salonGoogleCalendarConnectionSchema)
    .where(inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']))
    // Request-context acquisition advances last_checked_at on either success
    // or classified failure. Oldest-first rotation prevents a fixed low limit
    // from selecting the same tenants forever.
    .orderBy(
      sql`${salonGoogleCalendarConnectionSchema.lastCheckedAt} asc nulls first`,
      asc(salonGoogleCalendarConnectionSchema.salonId),
    )
    .limit(Math.min(limit, 50));
  for (const connection of connections) {
    throwIfAborted();
    try {
      const historicalTargets = await db.select({
        targetCalendarId: sql<string>`${integrationOutboxSchema.payload}->>'targetCalendarId'`,
      }).from(integrationOutboxSchema).where(and(
        eq(integrationOutboxSchema.salonId, connection.salonId),
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        sql`${integrationOutboxSchema.payload}->>'targetCalendarId' is not null`,
      )).groupBy(
        sql`${integrationOutboxSchema.payload}->>'targetCalendarId'`,
      ).orderBy(desc(sql`max(${integrationOutboxSchema.updatedAt})`)).limit(49);
      const calendarIds = [...new Set([
        connection.destinationCalendarId,
        ...historicalTargets.flatMap(({ targetCalendarId }) => (
          typeof targetCalendarId === 'string' && targetCalendarId
            ? [targetCalendarId]
            : []
        )),
      ])];
      const remoteEvents = [];
      for (const calendarId of calendarIds) {
        try {
          remoteEvents.push(...await listGoogleCalendarEventsForSalon({
            salonId: connection.salonId,
            calendarIds: [calendarId],
            startTime: reconciliationCutoff,
            endTime: new Date(
              reconciliationCutoff.getTime() + 365 * 24 * 60 * 60 * 1000,
            ),
            privateExtendedProperties: [`salonId=${connection.salonId}`],
          }, { signal: options.signal }));
        } catch (error) {
          throwIfAborted();
          summary.failedCancelledEvents += 1;
          console.error('[GoogleCalendar] Failed to scan reconciliation calendar:', {
            calendarId,
            salonId: connection.salonId,
            error: safeJobError(error),
          });
        }
      }
      const appEvents = remoteEvents.filter(event => (
        event.status !== 'cancelled'
        && event.salonId === connection.salonId
        && Boolean(event.appointmentId)
      ));
      summary.remoteAppointmentMirrorsScanned += appEvents.length;
      const appointmentIds = [...new Set(appEvents.flatMap(event => (
        event.appointmentId ? [event.appointmentId] : []
      )))];
      if (!appointmentIds.length) {
        continue;
      }
      const storedAppointments: Array<{
        id: string;
        status: string;
        canvasState: string | null;
        deletedAt: Date | null;
        updatedAt: Date;
      }> = [];
      // events.list can return far more rows than the local repair batch. An
      // arbitrary SQL LIMIT would make a valid active appointment look absent
      // and authorize deletion. Exhaust every distinct remote appointment id
      // in bounded parameter chunks before classifying any event as orphaned.
      for (let offset = 0; offset < appointmentIds.length; offset += 400) {
        const appointmentIdChunk = appointmentIds.slice(offset, offset + 400);
        storedAppointments.push(...await db
          .select({
            id: appointmentSchema.id,
            status: appointmentSchema.status,
            canvasState: appointmentSchema.canvasState,
            deletedAt: appointmentSchema.deletedAt,
            updatedAt: appointmentSchema.updatedAt,
          })
          .from(appointmentSchema)
          .where(and(
            eq(appointmentSchema.salonId, connection.salonId),
            inArray(appointmentSchema.id, appointmentIdChunk),
          )));
      }
      const appointmentsById = new Map(storedAppointments.map(appointment => [
        appointment.id,
        appointment,
      ]));
      for (const event of appEvents) {
        if (!event.appointmentId) {
          continue;
        }
        const appointment = appointmentsById.get(event.appointmentId);
        const safeToDelete = !appointment
          || Boolean(appointment.deletedAt)
          || ['cancelled', 'no_show'].includes(appointment.status)
          || ['cancelled', 'no_show'].includes(appointment.canvasState ?? '');
        if (!safeToDelete) {
          continue;
        }
        const key = `${connection.salonId}:${event.calendarId}:${event.appointmentId}:${event.id}`;
        let reconciliationMirrorId: string | undefined;
        let reconciliationExpectedAppointmentId: string | null | undefined;
        if (!cancelledMirrors.has(key)) {
          const exactLocalPairs = await db.select({
            id: googleCalendarEventSchema.id,
            salonId: googleCalendarEventSchema.salonId,
            appointmentId: googleCalendarEventSchema.appointmentId,
            deletedAt: googleCalendarEventSchema.deletedAt,
            googleStatus: googleCalendarEventSchema.googleStatus,
            reviewStatus: googleCalendarEventSchema.reviewStatus,
            sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
            syncMode: googleCalendarEventSchema.syncMode,
          }).from(googleCalendarEventSchema).where(and(
            eq(googleCalendarEventSchema.calendarId, event.calendarId),
            eq(googleCalendarEventSchema.googleEventId, event.id),
          ));
          if (exactLocalPairs.length > 1) {
            continue;
          }
          const exactLocalPair = exactLocalPairs[0];
          if (exactLocalPair) {
            const ownedPair = (
              exactLocalPair.salonId === connection.salonId
              && (
                exactLocalPair.appointmentId === event.appointmentId
                || exactLocalPair.appointmentId === null
              )
              && exactLocalPair.reviewStatus === 'appointment'
              && exactLocalPair.syncMode === 'bidirectional'
              && ['owner', 'writer'].includes(exactLocalPair.sourceAccessRole)
            );
            if (!ownedPair) {
              continue;
            }
            reconciliationMirrorId = exactLocalPair.id;
            reconciliationExpectedAppointmentId = exactLocalPair.appointmentId;
          }
        }
        if (!cancelledMirrors.has(key)) {
          summary.remoteCancelledEventCandidates += 1;
        }
        cancelledMirrors.set(key, {
          appointmentId: event.appointmentId,
          salonId: connection.salonId,
          googleCalendarEventId: event.id,
          observedVersion: appointment?.updatedAt ?? event.updatedAt ?? reconciliationCutoff,
          appointmentExists: Boolean(appointment),
          targetCalendarId: event.calendarId,
          ...(reconciliationMirrorId !== undefined
            ? { reconciliationMirrorId }
            : {}),
          ...(reconciliationExpectedAppointmentId !== undefined
            ? { reconciliationExpectedAppointmentId }
            : {}),
        });
      }
    } catch (error) {
      throwIfAborted();
      summary.failedCancelledEvents += 1;
      console.error('[GoogleCalendar] Failed to discover orphaned appointment events:', {
        salonId: connection.salonId,
        error: safeJobError(error),
      });
    }
  }
  summary.cancelledEventCandidates = cancelledMirrors.size;

  for (const appointment of cancelledMirrors.values()) {
    throwIfAborted();
    try {
      const inserted = await enqueueGoogleCalendarReconciliationDelete({
        appointmentId: appointment.appointmentId,
        salonId: appointment.salonId,
        googleCalendarEventId: appointment.googleCalendarEventId!,
        observedVersion: appointment.observedVersion.toISOString(),
        appointmentExists: appointment.appointmentExists,
        targetCalendarId: appointment.targetCalendarId,
        reconciliationMirrorId: appointment.reconciliationMirrorId,
        reconciliationExpectedAppointmentId:
          appointment.reconciliationExpectedAppointmentId,
      });
      if (inserted.length === 1) {
        summary.queuedCancelledEvents += 1;
      } else {
        summary.skippedCancelledEvents += 1;
      }
    } catch (error) {
      throwIfAborted();
      summary.failedCancelledEvents += 1;
      console.error('[GoogleCalendar] Failed to reconcile a cancelled appointment event:', {
        appointmentId: appointment.appointmentId,
        salonId: appointment.salonId,
        error: safeJobError(error),
      });
    }
  }

  throwIfAborted();
  return summary;
}
