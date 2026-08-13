import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { logAppointmentChange } from '@/libs/appointmentAudit';
import {
  AppointmentManageError,
  getAppointmentCalendarEventForSync,
  inboundGoogleFeedbackIsSupersededInTx,
  runAppointmentManageMutation,
} from '@/libs/appointmentManage';
import { sendAppointmentOperationalEmailOnce } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import {
  type GoogleCalendarRemoteEvent,
  listGoogleCalendarEventsForSalon,
  listGoogleCalendarsForSalon,
} from '@/libs/googleCalendar';
import { extractGoogleEventContact } from '@/libs/googleEventAutofill';
import {
  acquireGoogleCalendarEventPairMutationBarrierInTx,
  enqueueGoogleCalendarDeleteInTx,
  enqueueGoogleCalendarSnapshotInTx,
} from '@/libs/integrationOutbox';
import {
  appointmentSchema,
  googleCalendarEventSchema,
  integrationOutboxSchema,
  salonGoogleCalendarConnectionSchema,
  salonSchema,
} from '@/models/Schema';

const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed'] as const;
const CURSOR_OVERLAP_MS = 60_000;

type GoogleCalendarInboundOptions = {
  signal?: AbortSignal;
  /** Test seam for reproducing a mirror write after the provider scan. */
  beforeMirrorTransaction?: (eventId: string) => Promise<void>;
  /** Test seam for reproducing a write between the scan read and TX reload. */
  beforeCancellationTransaction?: (appointmentId: string) => Promise<void>;
};

type InboundMirror = typeof googleCalendarEventSchema.$inferSelect;
type InboundAppointment = typeof appointmentSchema.$inferSelect;

type InboundMirrorResult = {
  kind: 'accepted';
  mirror: InboundMirror | null;
  linkedAppointment?: InboundAppointment;
  wroteRemoteState: boolean;
} | {
  kind: 'skipped';
};

function throwIfInboundAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('GOOGLE_CALENDAR_INBOUND_ABORTED');
}

function safeError(error: unknown): string {
  const message = error instanceof AppointmentManageError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : 'Unknown Google Calendar synchronization error';
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
}

function formatAppointmentTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#039;');
}

function canonicalInboundCalendarPair(
  remoteCalendarId: string,
  primaryCalendarId: string | undefined,
): { calendarId: string; pairCalendarIds: string[] } {
  const calendarId = remoteCalendarId === 'primary' && primaryCalendarId
    ? primaryCalendarId
    : remoteCalendarId;
  return {
    calendarId,
    pairCalendarIds: primaryCalendarId && calendarId === primaryCalendarId
      ? [...new Set([calendarId, 'primary'])]
      : [calendarId],
  };
}

function remoteVersionIsStale(
  localVersion: Date | null,
  remoteVersion: Date | null,
): boolean {
  return Boolean(
    localVersion
    && (!remoteVersion || localVersion.getTime() > remoteVersion.getTime()),
  );
}

function parseRemoteMutationVersion(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? parsed
    : null;
}

/**
 * Makes the local mirror authoritative before any appointment decision is
 * derived from it. The advisory pair barrier orders ownership changes after a
 * provider attempt, while the row lock plus updatedAt predicate preserves a
 * newer admin review/copy/revert decision made after the inbound scan.
 */
async function reconcileInboundMirror(args: {
  salonId: string;
  remoteEvent: GoogleCalendarRemoteEvent;
  primaryCalendarId?: string;
  sourceAccessRole: string;
  checkpoint: Date;
  writeRemoteState: boolean;
}): Promise<InboundMirrorResult> {
  const {
    calendarId,
    pairCalendarIds,
  } = canonicalInboundCalendarPair(
    args.remoteEvent.calendarId,
    args.primaryCalendarId,
  );
  return db.transaction(async (tx) => {
    // This first read identifies the expected rows only. The pair barrier
    // below validates that expectation atomically before any row is trusted.
    const discoveredMirrors = await tx.select({
      id: googleCalendarEventSchema.id,
      salonId: googleCalendarEventSchema.salonId,
      calendarId: googleCalendarEventSchema.calendarId,
    }).from(googleCalendarEventSchema).where(and(
      inArray(googleCalendarEventSchema.calendarId, pairCalendarIds),
      eq(googleCalendarEventSchema.googleEventId, args.remoteEvent.id),
    ));
    if (
      discoveredMirrors.length > 1
      || discoveredMirrors.some(mirror => mirror.salonId !== args.salonId)
    ) {
      return { kind: 'skipped' } as const;
    }
    const discoveredMirror = discoveredMirrors[0];
    const requiresPairBarrier = Boolean(
      discoveredMirror && discoveredMirror.calendarId !== calendarId,
    );
    if (!discoveredMirror || requiresPairBarrier) {
      // Ownership acquisition and alias canonicalization use the provider's
      // exact-pair barrier. A routine same-owner refresh intentionally does
      // not: an inbound cancellation must be able to commit the newer durable
      // intent while an older outbound request is already in flight.
      for (const pairCalendarId of [...pairCalendarIds].sort()) {
        const expectedMirror = discoveredMirrors.find(
          mirror => mirror.calendarId === pairCalendarId,
        );
        const pairIdle = await acquireGoogleCalendarEventPairMutationBarrierInTx(tx, {
          expectedMirrorId: expectedMirror?.id ?? null,
          expectedSalonId: args.salonId,
          targetCalendarId: pairCalendarId,
          googleCalendarEventId: args.remoteEvent.id,
        });
        if (!pairIdle) {
          return { kind: 'skipped' } as const;
        }
      }
    }

    const matchingMirrors = await tx.select()
      .from(googleCalendarEventSchema)
      .where(and(
        inArray(googleCalendarEventSchema.calendarId, pairCalendarIds),
        eq(googleCalendarEventSchema.googleEventId, args.remoteEvent.id),
      ))
      .for('update');
    // Provider ids are calendar-scoped, but a canonical/alias duplicate or a
    // cross-tenant exact-pair claim is not safe to reconcile automatically.
    if (
      matchingMirrors.length > 1
      || matchingMirrors.some(mirror => mirror.salonId !== args.salonId)
    ) {
      return { kind: 'skipped' } as const;
    }

    const lockedMirror = matchingMirrors[0];
    if (
      lockedMirror?.appointmentId
      && args.remoteEvent.appointmentId
      && lockedMirror.appointmentId !== args.remoteEvent.appointmentId
    ) {
      return { kind: 'skipped' } as const;
    }
    if (
      lockedMirror
      && remoteVersionIsStale(
        lockedMirror.googleUpdatedAt,
        args.remoteEvent.updatedAt,
      )
    ) {
      return { kind: 'skipped' } as const;
    }

    let linkedAppointment: InboundAppointment | undefined;
    let linkedAppointmentId = lockedMirror?.appointmentId ?? null;
    if (
      !lockedMirror
      && args.remoteEvent.salonId === args.salonId
      && args.remoteEvent.appointmentId
    ) {
      [linkedAppointment] = await tx.select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, args.remoteEvent.appointmentId),
          eq(appointmentSchema.salonId, args.salonId),
        ))
        .for('update')
        .limit(1);
      linkedAppointmentId = linkedAppointment?.id ?? null;
    }

    const attendeeContact = extractGoogleEventContact(
      args.remoteEvent.attendees,
      args.remoteEvent.summary,
    );
    const now = new Date();
    if (!lockedMirror) {
      if (!args.writeRemoteState) {
        return {
          kind: 'accepted',
          mirror: null,
          linkedAppointment,
          wroteRemoteState: false,
        } as const;
      }
      const startTime = args.remoteEvent.startTime!;
      const endTime = args.remoteEvent.endTime!;
      const durationMinutes = Math.max(
        1,
        Math.round((endTime.getTime() - startTime.getTime()) / 60_000),
      );
      const inserted = await tx.insert(googleCalendarEventSchema).values({
        id: `gce_${crypto.randomUUID()}`,
        salonId: args.salonId,
        calendarId,
        googleEventId: args.remoteEvent.id,
        recurringEventId: args.remoteEvent.recurringEventId,
        appointmentId: linkedAppointmentId,
        sourceAccessRole: args.sourceAccessRole,
        syncMode: ['owner', 'writer'].includes(args.sourceAccessRole)
          ? 'bidirectional'
          : 'inbound_only',
        title: args.remoteEvent.summary,
        description: args.remoteEvent.description,
        location: args.remoteEvent.location,
        attendeeName: attendeeContact?.fullName ?? null,
        attendeePhone: attendeeContact?.phone || null,
        attendeeEmail: attendeeContact?.email ?? null,
        startTime,
        endTime,
        durationMinutes,
        isAllDay: args.remoteEvent.isAllDay,
        transparency: args.remoteEvent.transparency,
        googleStatus: args.remoteEvent.status,
        reviewStatus: linkedAppointmentId
          ? 'appointment'
          : endTime >= args.checkpoint ? 'needs_review' : 'reviewed',
        googleUpdatedAt: args.remoteEvent.updatedAt,
        lastSyncedAt: now,
        reviewedAt: linkedAppointmentId || endTime < args.checkpoint ? now : null,
        deletedAt: null,
      }).onConflictDoNothing().returning();
      if (inserted.length !== 1) {
        return { kind: 'skipped' } as const;
      }
      return {
        kind: 'accepted',
        mirror: inserted[0]!,
        linkedAppointment,
        wroteRemoteState: true,
      } as const;
    }

    const canonicalizationRequired = lockedMirror.calendarId !== calendarId;
    if (!args.writeRemoteState && !canonicalizationRequired) {
      return {
        kind: 'accepted',
        mirror: lockedMirror,
        wroteRemoteState: false,
      } as const;
    }
    const updated = await tx.update(googleCalendarEventSchema).set(args.writeRemoteState
      ? {
          calendarId,
          recurringEventId: args.remoteEvent.recurringEventId,
          sourceAccessRole: args.sourceAccessRole,
          syncMode: lockedMirror.syncMode === 'superseded'
            ? 'superseded'
            : ['owner', 'writer'].includes(args.sourceAccessRole)
                ? 'bidirectional'
                : 'inbound_only',
          // Ownership and review fields deliberately come only from the
          // locked local row. Provider private metadata is not an ownership
          // transfer protocol.
          title: args.remoteEvent.summary,
          description: args.remoteEvent.description,
          location: args.remoteEvent.location,
          attendeeName: attendeeContact?.fullName ?? null,
          attendeePhone: attendeeContact?.phone || null,
          attendeeEmail: attendeeContact?.email ?? null,
          startTime: args.remoteEvent.startTime!,
          endTime: args.remoteEvent.endTime!,
          durationMinutes: Math.max(
            1,
            Math.round((
              args.remoteEvent.endTime!.getTime()
              - args.remoteEvent.startTime!.getTime()
            ) / 60_000),
          ),
          isAllDay: args.remoteEvent.isAllDay,
          transparency: args.remoteEvent.transparency,
          googleStatus: args.remoteEvent.status,
          googleUpdatedAt: args.remoteEvent.updatedAt,
          lastSyncedAt: now,
          deletedAt: null,
        }
      : { calendarId })
      .where(and(
        eq(googleCalendarEventSchema.id, lockedMirror.id),
        eq(googleCalendarEventSchema.salonId, args.salonId),
        eq(googleCalendarEventSchema.calendarId, lockedMirror.calendarId),
        eq(googleCalendarEventSchema.googleEventId, lockedMirror.googleEventId),
        eq(googleCalendarEventSchema.updatedAt, lockedMirror.updatedAt),
      ))
      .returning();
    if (updated.length !== 1) {
      return { kind: 'skipped' } as const;
    }
    if (canonicalizationRequired) {
      // Alias migration and queued work change atomically. The pair barriers
      // above prove no matching provider attempt is already executing. A
      // first-create job may not yet know its remote id; once inbound observes
      // the exact appointment-owned mirror, adopt the full canonical pair.
      await tx.update(integrationOutboxSchema).set({
        payload: sql`jsonb_set(
          jsonb_set(
            ${integrationOutboxSchema.payload},
            '{targetCalendarId}',
            to_jsonb(${calendarId}::text),
            true
          ),
          '{googleCalendarEventId}',
          to_jsonb(${args.remoteEvent.id}::text),
          true
        )`,
      }).where(and(
        eq(integrationOutboxSchema.salonId, args.salonId),
        lockedMirror.appointmentId
          ? eq(integrationOutboxSchema.appointmentId, lockedMirror.appointmentId)
          : sql`false`,
        eq(integrationOutboxSchema.provider, 'google_calendar'),
        inArray(integrationOutboxSchema.operation, ['sync_appointment', 'upsert_event']),
        inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        sql`${integrationOutboxSchema.payload}->>'targetCalendarId' = ${lockedMirror.calendarId}`,
        sql`(
          ${integrationOutboxSchema.payload}->>'googleCalendarEventId' is null
          or ${integrationOutboxSchema.payload}->>'googleCalendarEventId' = ${args.remoteEvent.id}
        )`,
      ));
    }
    return {
      kind: 'accepted',
      mirror: updated[0]!,
      wroteRemoteState: args.writeRemoteState,
    } as const;
  });
}

async function markInboundMirrorCancelled(args: {
  salonId: string;
  expectedMirror: InboundMirror;
  remoteEvent: GoogleCalendarRemoteEvent;
  expectedAppointmentId?: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (args.expectedAppointmentId) {
      const [lockedAppointment] = await tx.select({
        id: appointmentSchema.id,
        status: appointmentSchema.status,
      }).from(appointmentSchema).where(and(
        eq(appointmentSchema.id, args.expectedAppointmentId),
        eq(appointmentSchema.salonId, args.salonId),
      )).for('update').limit(1);
      if (
        lockedAppointment
        && ACTIVE_APPOINTMENT_STATUSES.includes(
          lockedAppointment.status as typeof ACTIVE_APPOINTMENT_STATUSES[number],
        )
      ) {
        return false;
      }
    }
    const [lockedMirror] = await tx.select()
      .from(googleCalendarEventSchema)
      .where(and(
        eq(googleCalendarEventSchema.id, args.expectedMirror.id),
        eq(googleCalendarEventSchema.salonId, args.salonId),
      ))
      .for('update')
      .limit(1);
    if (
      !lockedMirror
      || lockedMirror.calendarId !== args.expectedMirror.calendarId
      || lockedMirror.googleEventId !== args.expectedMirror.googleEventId
      || lockedMirror.appointmentId !== args.expectedMirror.appointmentId
      || lockedMirror.reviewStatus !== args.expectedMirror.reviewStatus
      || lockedMirror.syncMode !== args.expectedMirror.syncMode
      || lockedMirror.updatedAt.getTime() !== args.expectedMirror.updatedAt.getTime()
      || remoteVersionIsStale(
        lockedMirror.googleUpdatedAt,
        args.remoteEvent.updatedAt,
      )
    ) {
      return false;
    }
    if (
      args.expectedAppointmentId
      && await inboundGoogleFeedbackIsSupersededInTx(tx, {
        appointmentId: args.expectedAppointmentId,
        salonId: args.salonId,
        remoteMutationVersion: parseRemoteMutationVersion(
          args.remoteEvent.mutationVersion,
        ),
      })
    ) {
      return false;
    }
    const deletedAt = new Date();
    const updated = await tx.update(googleCalendarEventSchema).set({
      googleStatus: 'cancelled',
      googleUpdatedAt: args.remoteEvent.updatedAt,
      deletedAt,
      lastSyncedAt: deletedAt,
    }).where(and(
      eq(googleCalendarEventSchema.id, lockedMirror.id),
      eq(googleCalendarEventSchema.salonId, args.salonId),
      eq(googleCalendarEventSchema.updatedAt, lockedMirror.updatedAt),
    )).returning();
    return updated.length === 1;
  });
}

async function enqueueCurrentAppointmentState(
  appointmentId: string,
  salonId: string,
  sourceEventId: string,
  sourceVersion: string,
) {
  const [salon, event] = await Promise.all([
    db.select({ name: salonSchema.name }).from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1),
    getAppointmentCalendarEventForSync(appointmentId, salonId),
  ]);
  const input = {
    appointmentId: event.id,
    salonId,
    salonName: salon[0]?.name || 'Luster salon',
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
  };
  const mutationVersion = new Date(event.updatedAt);
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ updatedAt: appointmentSchema.updatedAt })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.id, appointmentId),
        eq(appointmentSchema.salonId, salonId),
      )).for('update').limit(1);
    if (!locked || locked.updatedAt.getTime() !== mutationVersion.getTime()) {
      throw new Error('GOOGLE_CALENDAR_RESTORE_STALE');
    }
    return enqueueGoogleCalendarSnapshotInTx(tx, input, {
      cause: { kind: 'inbound_restore', sourceEventId, sourceVersion },
      mutationVersion,
    });
  });
}

async function sendCalendarChangeEmail(args: {
  salonId: string;
  appointmentId: string;
  clientName: string | null;
  salonName: string;
  timeZone: string;
  startTime: Date;
  operation: 'rescheduled' | 'cancelled';
  eventVersion: string;
  signal?: AbortSignal;
}) {
  const greeting = args.clientName?.trim() ? `Hi ${args.clientName.trim()},` : 'Hello,';
  const time = formatAppointmentTime(args.startTime, args.timeZone);
  const action = args.operation === 'rescheduled'
    ? `Your appointment at ${args.salonName} was rescheduled to ${time}.`
    : `Your appointment at ${args.salonName} on ${time} was cancelled.`;
  const safeGreeting = escapeHtml(greeting);
  const safeAction = escapeHtml(action);
  const safeSalonName = escapeHtml(args.salonName);
  throwIfInboundAborted(args.signal);
  await sendAppointmentOperationalEmailOnce({
    salonId: args.salonId,
    appointmentId: args.appointmentId,
    purpose: `google_calendar_appointment_${args.operation}`,
    eventVersion: args.eventVersion,
    signal: args.signal,
    prepare: () => ({
      subject: `${args.salonName} appointment ${args.operation}`,
      text: `${greeting}\n\n${action}\n\nPlease contact ${args.salonName} if this change was unexpected.`,
      html: `<p>${safeGreeting}</p><p>${safeAction}</p><p>Please contact ${safeSalonName} if this change was unexpected.</p>`,
    }),
  }).catch(() => undefined);
}

export async function processGoogleCalendarInboundSync(
  limit = 25,
  salonId?: string,
  options: GoogleCalendarInboundOptions = {},
) {
  throwIfInboundAborted(options.signal);
  const connections = await db
    .select({
      salonId: salonGoogleCalendarConnectionSchema.salonId,
      inboundSyncedAt: salonGoogleCalendarConnectionSchema.inboundSyncedAt,
      destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId,
      busyCalendarIds: salonGoogleCalendarConnectionSchema.busyCalendarIds,
    })
    .from(salonGoogleCalendarConnectionSchema)
    .where(and(
      eq(salonGoogleCalendarConnectionSchema.inboundSyncEnabled, true),
      inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']),
      ...(salonId ? [eq(salonGoogleCalendarConnectionSchema.salonId, salonId)] : []),
    ))
    .orderBy(
      sql`${salonGoogleCalendarConnectionSchema.lastCheckedAt} asc nulls first`,
      asc(salonGoogleCalendarConnectionSchema.salonId),
    )
    .limit(limit);
  throwIfInboundAborted(options.signal);

  const summary = {
    scannedConnections: connections.length,
    initializedConnections: 0,
    scannedEvents: 0,
    movedAppointments: 0,
    cancelledAppointments: 0,
    conflicts: 0,
    failedConnections: 0,
    importedEvents: 0,
    importedDrafts: 0,
  };

  for (const connection of connections) {
    throwIfInboundAborted(options.signal);
    const checkpoint = new Date();
    try {
      const [salon] = await db.select({
        name: salonSchema.name,
        settings: salonSchema.settings,
      }).from(salonSchema).where(eq(salonSchema.id, connection.salonId)).limit(1);
      if (!salon) {
        throw new Error('Salon was not found for Google Calendar connection');
      }
      const timeZone = salon.settings?.booking?.timezone || 'America/Toronto';

      const calendarOptions = await listGoogleCalendarsForSalon(
        connection.salonId,
        { signal: options.signal },
      );
      const accessRoles = new Map(calendarOptions.map(calendar => [calendar.id, calendar.accessRole]));
      const primaryCalendarId = calendarOptions.find(calendar => calendar.primary)?.id;
      const destinationCalendarId = connection.destinationCalendarId === 'primary'
        ? primaryCalendarId || connection.destinationCalendarId
        : connection.destinationCalendarId;
      const busyCalendarIds = connection.busyCalendarIds.map(id => id === 'primary' ? primaryCalendarId || id : id);
      const calendarIds = [...new Set([destinationCalendarId, ...busyCalendarIds])];
      if (primaryCalendarId && (connection.destinationCalendarId === 'primary' || connection.busyCalendarIds.includes('primary'))) {
        await db.update(salonGoogleCalendarConnectionSchema).set({
          destinationCalendarId,
          busyCalendarIds: [...new Set(busyCalendarIds)],
        }).where(eq(salonGoogleCalendarConnectionSchema.salonId, connection.salonId));
      }
      const remoteEvents = await listGoogleCalendarEventsForSalon(connection.inboundSyncedAt
        ? {
            salonId: connection.salonId,
            calendarIds,
            updatedMin: new Date(connection.inboundSyncedAt.getTime() - CURSOR_OVERLAP_MS),
            includeDeleted: true,
          }
        : {
            salonId: connection.salonId,
            calendarIds,
            startTime: new Date(checkpoint.getTime() - 90 * 24 * 60 * 60 * 1000),
            endTime: new Date(checkpoint.getTime() + 365 * 24 * 60 * 60 * 1000),
            includeDeleted: false,
          }, { signal: options.signal });
      if (!connection.inboundSyncedAt) {
        summary.initializedConnections += 1;
      }
      const latestById = new Map(remoteEvents.map(event => [`${event.calendarId}:${event.id}`, event]));
      summary.scannedEvents += latestById.size;

      for (const remoteEvent of latestById.values()) {
        throwIfInboundAborted(options.signal);
        if (
          remoteEvent.salonId
          && remoteEvent.salonId !== connection.salonId
        ) {
          continue;
        }
        await options.beforeMirrorTransaction?.(remoteEvent.id);
        const canonicalCalendarId = canonicalInboundCalendarPair(
          remoteEvent.calendarId,
          primaryCalendarId,
        ).calendarId;
        const writesRemoteState = remoteEvent.status !== 'cancelled'
          && Boolean(
            remoteEvent.startTime
            && remoteEvent.endTime
            && remoteEvent.endTime > remoteEvent.startTime,
          );
        const mirrorResult = await reconcileInboundMirror({
          salonId: connection.salonId,
          remoteEvent,
          primaryCalendarId,
          sourceAccessRole: accessRoles.get(canonicalCalendarId)
            || accessRoles.get(remoteEvent.calendarId)
            || 'reader',
          checkpoint,
          writeRemoteState: writesRemoteState,
        });
        if (mirrorResult.kind === 'skipped') {
          continue;
        }
        const storedEvent = mirrorResult.mirror;
        const linkedAppointmentId = storedEvent?.reviewStatus === 'appointment'
          && storedEvent.syncMode !== 'superseded'
          ? storedEvent.appointmentId
          : null;
        if (mirrorResult.wroteRemoteState) {
          summary.importedEvents += 1;
          summary.importedDrafts += 1;
        }
        if (!linkedAppointmentId) {
          if (remoteEvent.status === 'cancelled' && storedEvent) {
            await markInboundMirrorCancelled({
              salonId: connection.salonId,
              expectedMirror: storedEvent,
              remoteEvent,
            });
          }
          continue;
        }
        if (!storedEvent) {
          continue;
        }
        const [appointment] = await db.select({
          id: appointmentSchema.id,
          salonId: appointmentSchema.salonId,
          status: appointmentSchema.status,
          startTime: appointmentSchema.startTime,
          endTime: appointmentSchema.endTime,
          clientEmail: appointmentSchema.clientEmail,
          clientName: appointmentSchema.clientName,
          notes: appointmentSchema.notes,
          updatedAt: appointmentSchema.updatedAt,
        }).from(appointmentSchema).where(and(
          eq(appointmentSchema.id, linkedAppointmentId),
          eq(appointmentSchema.salonId, connection.salonId),
        )).limit(1);
        if (!appointment || !ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as typeof ACTIVE_APPOINTMENT_STATUSES[number])) {
          if (remoteEvent.status === 'cancelled' && storedEvent) {
            await options.beforeCancellationTransaction?.(linkedAppointmentId);
            await markInboundMirrorCancelled({
              salonId: connection.salonId,
              expectedMirror: storedEvent,
              expectedAppointmentId: linkedAppointmentId,
              remoteEvent,
            });
          }
          continue;
        }

        if (remoteEvent.status === 'cancelled') {
          // A remote tombstone is authoritative only when this exact local
          // mirror still owns the appointment. Private event metadata alone is
          // insufficient because it can be stale or forged.
          if (!storedEvent) {
            continue;
          }
          const remoteMutationVersion = parseRemoteMutationVersion(
            remoteEvent.mutationVersion,
          );
          await options.beforeCancellationTransaction?.(appointment.id);
          const cancellation = await db.transaction(async (tx) => {
            // The event scan and appointment read happen before this
            // transaction. Lock and reload the appointment before deriving the
            // mutation revision so a concurrent local move cannot be
            // overwritten with an older timestamp or incorrectly supersede
            // the terminal delete barrier.
            const [lockedAppointment] = await tx.select({
              id: appointmentSchema.id,
              salonId: appointmentSchema.salonId,
              status: appointmentSchema.status,
              notes: appointmentSchema.notes,
              updatedAt: appointmentSchema.updatedAt,
              startTime: appointmentSchema.startTime,
              endTime: appointmentSchema.endTime,
              clientName: appointmentSchema.clientName,
            }).from(appointmentSchema).where(and(
              eq(appointmentSchema.id, appointment.id),
              eq(appointmentSchema.salonId, connection.salonId),
              inArray(appointmentSchema.status, [...ACTIVE_APPOINTMENT_STATUSES]),
            )).for('update').limit(1);
            if (!lockedAppointment) {
              return null;
            }
            const [lockedSourceEvent] = await tx.select({
              appointmentId: googleCalendarEventSchema.appointmentId,
              calendarId: googleCalendarEventSchema.calendarId,
              googleEventId: googleCalendarEventSchema.googleEventId,
              googleUpdatedAt: googleCalendarEventSchema.googleUpdatedAt,
              reviewStatus: googleCalendarEventSchema.reviewStatus,
              syncMode: googleCalendarEventSchema.syncMode,
              deletedAt: googleCalendarEventSchema.deletedAt,
              updatedAt: googleCalendarEventSchema.updatedAt,
            }).from(googleCalendarEventSchema).where(and(
              eq(googleCalendarEventSchema.id, storedEvent.id),
              eq(googleCalendarEventSchema.salonId, connection.salonId),
            )).for('update').limit(1);
            if (
              !lockedSourceEvent
              || lockedSourceEvent.appointmentId !== lockedAppointment.id
              || lockedSourceEvent.calendarId !== remoteEvent.calendarId
              || lockedSourceEvent.googleEventId !== remoteEvent.id
              || lockedSourceEvent.reviewStatus !== 'appointment'
              || lockedSourceEvent.syncMode === 'superseded'
              || lockedSourceEvent.deletedAt !== null
              || remoteVersionIsStale(
                lockedSourceEvent.googleUpdatedAt,
                remoteEvent.updatedAt,
              )
            ) {
              return null;
            }
            if (await inboundGoogleFeedbackIsSupersededInTx(tx, {
              appointmentId: lockedAppointment.id,
              salonId: lockedAppointment.salonId,
              remoteMutationVersion,
            })) {
              return null;
            }
            const mutationTime = new Date(Math.max(
              Date.now(),
              lockedAppointment.updatedAt.getTime() + 1,
            ));
            const markedMirrors = await tx.update(googleCalendarEventSchema).set({
              googleStatus: 'cancelled',
              googleUpdatedAt: remoteEvent.updatedAt,
              deletedAt: mutationTime,
              lastSyncedAt: mutationTime,
            }).where(and(
              eq(googleCalendarEventSchema.id, storedEvent.id),
              eq(googleCalendarEventSchema.salonId, connection.salonId),
              eq(googleCalendarEventSchema.appointmentId, lockedAppointment.id),
              eq(googleCalendarEventSchema.updatedAt, lockedSourceEvent.updatedAt),
            )).returning();
            if (markedMirrors.length !== 1) {
              return null;
            }
            const [terminalAppointment] = await tx.update(appointmentSchema).set({
              status: 'cancelled',
              cancelReason: 'client_request',
              notes: [lockedAppointment.notes, '[Google Calendar] Event deleted by salon owner.'].filter(Boolean).join('\n'),
              googleCalendarEventId: null,
              googleCalendarSyncStatus: 'deleted',
              googleCalendarSyncError: null,
              googleCalendarSyncedAt: mutationTime,
              updatedAt: mutationTime,
            }).where(and(
              eq(appointmentSchema.id, appointment.id),
              eq(appointmentSchema.salonId, connection.salonId),
              eq(appointmentSchema.status, lockedAppointment.status),
              eq(appointmentSchema.updatedAt, lockedAppointment.updatedAt),
            )).returning();
            if (!terminalAppointment) {
              return null;
            }
            // Although the inbound event is already deleted, this durable
            // delete is the newest local intent when an older outbound upsert
            // may already own the appointment provider mutex. It is dispatched
            // only after that peer; local retry/fencing is deterministic while
            // Google acceptance can still be ambiguous after a timeout.
            await enqueueGoogleCalendarDeleteInTx(tx, {
              appointmentId: terminalAppointment.id,
              salonId: terminalAppointment.salonId,
              mutationVersion: terminalAppointment.updatedAt,
              googleCalendarEventId: lockedSourceEvent.googleEventId,
              targetCalendarId: lockedSourceEvent.calendarId,
              authoritativeTerminalDelete: true,
            });
            return { terminalAppointment, previous: lockedAppointment };
          });
          if (!cancellation) {
            continue;
          }
          const { terminalAppointment: cancelled, previous } = cancellation;
          try {
            await logAppointmentChange({
              appointmentId: cancelled.id,
              salonId: cancelled.salonId,
              action: 'cancelled',
              performedBy: 'google-calendar-sync',
              performedByRole: 'system',
              performedByName: 'Google Calendar',
              previousValue: { status: previous.status },
              newValue: { status: 'cancelled' },
              reason: 'The connected Google Calendar event was deleted by the salon owner.',
            });
          } catch {
            console.error('[Google Calendar inbound] Cancellation audit failed after the transition committed:', {
              salonId: appointment.salonId,
              appointmentId: appointment.id,
            });
          }
          // The cancellation, sync bookkeeping, and audit attempt all finish
          // before the outbound notification provider is called.
          await sendCalendarChangeEmail({
            salonId: appointment.salonId,
            appointmentId: appointment.id,
            clientName: previous.clientName,
            salonName: salon.name,
            timeZone,
            startTime: previous.startTime,
            operation: 'cancelled',
            eventVersion: [
              remoteEvent.id,
              remoteEvent.updatedAt?.toISOString() ?? 'updated-at-unavailable',
              'cancelled',
            ].join(':'),
            signal: options.signal,
          });
          summary.cancelledAppointments += 1;
          continue;
        }

        if (!remoteEvent.startTime || !remoteEvent.endTime) {
          continue;
        }
        const durationMinutes = Math.round(
          (remoteEvent.endTime.getTime() - remoteEvent.startTime.getTime()) / 60_000,
        );
        const unchanged = appointment.startTime.getTime() === remoteEvent.startTime.getTime()
          && appointment.endTime.getTime() === remoteEvent.endTime.getTime();
        if (unchanged) {
          continue;
        }

        const remoteMutationVersion = parseRemoteMutationVersion(
          remoteEvent.mutationVersion,
        );

        try {
          await runAppointmentManageMutation({
            appointmentId: appointment.id,
            salonId: appointment.salonId,
            operation: 'move',
            startTime: remoteEvent.startTime,
            durationMinutes,
            canReassignTechnician: false,
            sourceEventFence: {
              rowId: storedEvent.id,
              calendarId: storedEvent.calendarId,
              googleEventId: storedEvent.googleEventId,
              googleUpdatedAt: storedEvent.googleUpdatedAt,
              remoteMutationVersion,
            },
          });
        } catch (error) {
          if (
            error instanceof AppointmentManageError
            && ['STALE_GOOGLE_EVENT', 'STALE_GOOGLE_FEEDBACK', 'STALE_STATE']
              .includes(error.code)
          ) {
            continue;
          }
          const message = safeError(error);
          let restoreFailed = false;
          try {
            await enqueueCurrentAppointmentState(
              appointment.id,
              appointment.salonId,
              `${remoteEvent.calendarId}:${remoteEvent.id}`,
              remoteEvent.updatedAt?.toISOString() ?? 'updated-at-unavailable',
            );
          } catch {
            restoreFailed = true;
          }
          if (restoreFailed) {
            await db.update(appointmentSchema).set({
              googleCalendarSyncStatus: 'failed',
              googleCalendarSyncError: message,
              googleCalendarSyncedAt: new Date(),
            }).where(and(
              eq(appointmentSchema.id, appointment.id),
              eq(appointmentSchema.salonId, connection.salonId),
              eq(appointmentSchema.updatedAt, appointment.updatedAt),
            ));
          }
          summary.conflicts += 1;
          continue;
        }

        // The provider-originated move owns a durable outbound intent. The
        // manage transaction committed the new schedule, its immutable
        // revision, and pending Calendar state together. It normally becomes
        // an idempotent PATCH of the state Google just sent; when an older
        // local call was already in flight, this queued operation is ordered
        // after that peer and retries until it either succeeds or exhausts.
        // Google acceptance remains externally ambiguous after a timeout.

        try {
          await logAppointmentChange({
            appointmentId: appointment.id,
            salonId: appointment.salonId,
            action: 'time_changed',
            performedBy: 'google-calendar-sync',
            performedByRole: 'system',
            performedByName: 'Google Calendar',
            previousValue: {
              startTime: appointment.startTime.toISOString(),
              endTime: appointment.endTime.toISOString(),
            },
            newValue: {
              startTime: remoteEvent.startTime.toISOString(),
              endTime: remoteEvent.endTime.toISOString(),
              durationMinutes,
            },
            reason: 'The connected Google Calendar event was changed by the salon owner.',
          });
        } catch {
          console.error('[Google Calendar inbound] Move audit failed after the transition committed:', {
            salonId: appointment.salonId,
            appointmentId: appointment.id,
          });
        }
        // The move, sync bookkeeping, and audit attempt all finish before the
        // outbound notification provider is called. A retry observes the
        // durable sync state.
        await sendCalendarChangeEmail({
          salonId: appointment.salonId,
          appointmentId: appointment.id,
          clientName: appointment.clientName,
          salonName: salon.name,
          timeZone,
          startTime: remoteEvent.startTime,
          operation: 'rescheduled',
          eventVersion: [
            remoteEvent.id,
            remoteEvent.updatedAt?.toISOString() ?? 'updated-at-unavailable',
            appointment.startTime.toISOString(),
            remoteEvent.startTime.toISOString(),
          ].join(':'),
          signal: options.signal,
        });
        summary.movedAppointments += 1;
      }

      throwIfInboundAborted(options.signal);
      await db.update(salonGoogleCalendarConnectionSchema).set({
        inboundSyncedAt: checkpoint,
        inboundSyncError: null,
      }).where(eq(salonGoogleCalendarConnectionSchema.salonId, connection.salonId));
    } catch (error) {
      throwIfInboundAborted(options.signal);
      await db.update(salonGoogleCalendarConnectionSchema).set({
        inboundSyncError: safeError(error),
        status: 'degraded',
      }).where(eq(salonGoogleCalendarConnectionSchema.salonId, connection.salonId));
      summary.failedConnections += 1;
    }
  }

  throwIfInboundAborted(options.signal);
  return summary;
}
