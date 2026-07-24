import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  buildAppointmentReminderQueue,
  buildCommunicationStatusTimestamps,
  buildRetentionQueue,
  canTransitionCommunicationStatus,
  communicationMutationSchema,
  type CommunicationSnapshot,
  normalizeRetentionPhone,
  type RetentionAppointmentSnapshot,
  type RetentionClientSnapshot,
  sanitizeCommunicationMessageSnapshot,
} from '@/libs/retentionAssistant';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import {
  appointmentSchema,
  clientCommunicationSchema,
  salonClientSchema,
} from '@/models/Schema';
import type { ClientCommunicationKind, ClientCommunicationStatus, RetentionStage } from '@/types/retention';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200).optional(),
});

const RETENTION_KINDS: ClientCommunicationKind[] = ['rebook', 'promo_6w', 'promo_8w'];
const ACTIVE_RETENTION_STATUSES: ClientCommunicationStatus[] = ['prepared', 'snoozed'];

type CommunicationRow = typeof clientCommunicationSchema.$inferSelect;

function serializeCommunication(row: CommunicationRow) {
  return {
    id: row.id,
    clientId: row.salonClientId,
    appointmentId: row.appointmentId,
    kind: row.kind,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    messageSnapshot: row.messageSnapshot,
    destinationSnapshot: row.destinationSnapshot,
    metadata: row.metadata ?? {},
    preparedAt: row.preparedAt?.toISOString() ?? null,
    markedSentAt: row.markedSentAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCommunicationSnapshots(rows: CommunicationRow[]): CommunicationSnapshot[] {
  return rows.map(row => ({
    id: row.id,
    salonClientId: row.salonClientId,
    appointmentId: row.appointmentId,
    kind: row.kind as ClientCommunicationKind,
    status: row.status as ClientCommunicationStatus,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
  }));
}

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid retention query.', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }

  if (parsed.data.clientId) {
    const [ownedClient] = await db
      .select({ id: salonClientSchema.id })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.id, parsed.data.clientId),
        eq(salonClientSchema.salonId, salon.id),
      ))
      .limit(1);
    if (!ownedClient) {
      return Response.json({ error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found.' } }, { status: 404 });
    }
  }

  const now = new Date();
  const [settings, clientRows, appointmentRows, communicationRows] = await Promise.all([
    getRetentionSettingsForSalon(salon.id),
    db
      .select({
        id: salonClientSchema.id,
        fullName: salonClientSchema.fullName,
        phone: salonClientSchema.phone,
        lastVisitAt: salonClientSchema.lastVisitAt,
        rebookIntervalDays: salonClientSchema.rebookIntervalDays,
        isBlocked: salonClientSchema.isBlocked,
      })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salon.id),
        isNull(salonClientSchema.archivedAt),
        isNull(salonClientSchema.mergedIntoClientId),
      ))
      .limit(5000),
    db
      .select({
        id: appointmentSchema.id,
        salonClientId: appointmentSchema.salonClientId,
        clientName: appointmentSchema.clientName,
        clientPhone: appointmentSchema.clientPhone,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        dayBeforeReminderSentAt: appointmentSchema.dayBeforeReminderSentAt,
        sameDayReminderSentAt: appointmentSchema.sameDayReminderSentAt,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        isNull(appointmentSchema.deletedAt),
        // Future pending/confirmed bookings, plus any in_progress visit
        // (even one started early or running past its slot) — all of these
        // must suppress retention outreach for the client.
        or(
          and(
            gt(appointmentSchema.startTime, now),
            inArray(appointmentSchema.status, ['pending', 'confirmed', 'in_progress']),
          ),
          eq(appointmentSchema.status, 'in_progress'),
        ),
      ))
      .limit(5000),
    db
      .select()
      .from(clientCommunicationSchema)
      .where(eq(clientCommunicationSchema.salonId, salon.id))
      .orderBy(desc(clientCommunicationSchema.createdAt))
      .limit(10000),
  ]);

  const clients: RetentionClientSnapshot[] = clientRows;
  const appointments: RetentionAppointmentSnapshot[] = appointmentRows.map(appointment => ({
    id: appointment.id,
    salonClientId: appointment.salonClientId,
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    reminderSentAt: appointment.sameDayReminderSentAt ?? appointment.dayBeforeReminderSentAt,
  }));
  const communications = toCommunicationSnapshots(communicationRows);

  const retention = buildRetentionQueue({
    clients,
    futureAppointments: appointments,
    communications,
    defaultRebookDays: settings.defaultRebookDays,
    now,
  });
  const appointmentReminders = buildAppointmentReminderQueue({
    clients,
    appointments,
    communications,
    reminderLeadHours: settings.reminderLeadHours,
    now,
  });

  const history = parsed.data.clientId
    ? communicationRows
      .filter(row => row.salonClientId === parsed.data.clientId)
      .slice(0, 100)
      .map(serializeCommunication)
    : [];

  return Response.json({
    data: {
      retention: retention.map(item => ({
        ...item,
        dueAt: item.dueAt.toISOString(),
        lastVisitAt: item.lastVisitAt.toISOString(),
      })),
      appointmentReminders: appointmentReminders.map(item => ({
        ...item,
        startTime: item.startTime.toISOString(),
        endTime: item.endTime.toISOString(),
        dueAt: item.dueAt.toISOString(),
      })),
      history,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'INVALID_JSON', message: 'A JSON request body is required.' } }, { status: 400 });
  }

  const parsed = communicationMutationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid communication update.', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } }, { status: 401 });
  }

  const [client] = await db
    .select({
      id: salonClientSchema.id,
      phone: salonClientSchema.phone,
      lastVisitAt: salonClientSchema.lastVisitAt,
    })
    .from(salonClientSchema)
    .where(and(
      eq(salonClientSchema.id, parsed.data.clientId),
      eq(salonClientSchema.salonId, salon.id),
      isNull(salonClientSchema.archivedAt),
      isNull(salonClientSchema.mergedIntoClientId),
    ))
    .limit(1);
  if (!client) {
    return Response.json({ error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found.' } }, { status: 404 });
  }

  let appointment: {
    id: string;
    startTime: Date;
    salonClientId: string | null;
    clientPhone: string;
  } | null = null;
  if (parsed.data.appointmentId) {
    const appointmentRows = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        salonClientId: appointmentSchema.salonClientId,
        clientPhone: appointmentSchema.clientPhone,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.id, parsed.data.appointmentId),
        eq(appointmentSchema.salonId, salon.id),
        isNull(appointmentSchema.deletedAt),
      ))
      .limit(1);
    appointment = appointmentRows[0] ?? null;
    const belongsToClient = appointment && (
      appointment.salonClientId === client.id
      || (
        appointment.salonClientId === null
        && normalizeRetentionPhone(appointment.clientPhone) === normalizeRetentionPhone(client.phone)
      )
    );
    if (!appointment || !belongsToClient) {
      return Response.json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found for this client.' } }, { status: 404 });
    }
  }

  const now = new Date();
  const safeMessageSnapshot = sanitizeCommunicationMessageSnapshot(parsed.data.messageSnapshot);
  const settings = await getRetentionSettingsForSalon(salon.id);
  const dueAt = parsed.data.kind === 'reminder' && appointment
    ? new Date(appointment.startTime.getTime() - settings.reminderLeadHours * 3_600_000)
    : client.lastVisitAt && RETENTION_KINDS.includes(parsed.data.kind)
      ? new Date(client.lastVisitAt.getTime() + (
        parsed.data.kind === 'promo_8w'
          ? 56
          : parsed.data.kind === 'promo_6w'
            ? 42
            : settings.defaultRebookDays
      ) * 86_400_000)
      : null;

  const [latest] = await db
    .select()
    .from(clientCommunicationSchema)
    .where(and(
      eq(clientCommunicationSchema.salonId, salon.id),
      eq(clientCommunicationSchema.salonClientId, client.id),
      eq(clientCommunicationSchema.kind, parsed.data.kind),
      parsed.data.appointmentId
        ? eq(clientCommunicationSchema.appointmentId, parsed.data.appointmentId)
        : isNull(clientCommunicationSchema.appointmentId),
    ))
    .orderBy(desc(clientCommunicationSchema.createdAt))
    .limit(1);

  const shouldUpdateLatest = Boolean(latest && (
    ['prepared', 'not_sent', 'snoozed'].includes(latest.status)
    || (latest.status === 'marked_sent' && parsed.data.status === 'converted')
    || latest.status === parsed.data.status
  ));

  if (
    shouldUpdateLatest
    && latest
    && !canTransitionCommunicationStatus(
      latest.status as ClientCommunicationStatus,
      parsed.data.status,
    )
  ) {
    return Response.json({
      error: {
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot change communication from ${latest.status} to ${parsed.data.status}.`,
      },
    }, { status: 409 });
  }

  const timestamps = buildCommunicationStatusTimestamps(parsed.data.status, now, {
    kind: parsed.data.kind,
    appointmentStartTime: appointment?.startTime,
  });
  const communication = await db.transaction(async (tx) => {
    if (RETENTION_KINDS.includes(parsed.data.kind)) {
      await tx
        .update(clientCommunicationSchema)
        .set({
          status: 'dismissed',
          dismissedAt: now,
          snoozedUntil: null,
          metadata: {
            reason: 'superseded_by_retention_stage',
            campaignStage: parsed.data.kind as RetentionStage,
          },
          updatedAt: now,
        })
        .where(and(
          eq(clientCommunicationSchema.salonId, salon.id),
          eq(clientCommunicationSchema.salonClientId, client.id),
          inArray(clientCommunicationSchema.kind, RETENTION_KINDS),
          inArray(clientCommunicationSchema.status, ACTIVE_RETENTION_STATUSES),
          shouldUpdateLatest && latest
            ? ne(clientCommunicationSchema.id, latest.id)
            : ne(clientCommunicationSchema.kind, parsed.data.kind),
        ));
    }

    let savedCommunication: CommunicationRow | undefined;
    if (shouldUpdateLatest && latest) {
      const [updated] = await tx
        .update(clientCommunicationSchema)
        .set({
          status: parsed.data.status,
          dueAt,
          messageSnapshot: safeMessageSnapshot === undefined
            ? latest.messageSnapshot
            : safeMessageSnapshot,
          ...timestamps,
          updatedAt: now,
        })
        .where(and(
          eq(clientCommunicationSchema.id, latest.id),
          eq(clientCommunicationSchema.salonId, salon.id),
        ))
        .returning();
      savedCommunication = updated;
    } else {
      const [created] = await tx
        .insert(clientCommunicationSchema)
        .values({
          id: `comm_${crypto.randomUUID()}`,
          salonId: salon.id,
          salonClientId: client.id,
          appointmentId: appointment?.id ?? null,
          kind: parsed.data.kind,
          status: parsed.data.status,
          dueAt,
          messageSnapshot: safeMessageSnapshot ?? null,
          destinationSnapshot: client.phone,
          actorAdminId: admin.id,
          ...timestamps,
        })
        .returning();
      savedCommunication = created;
    }

    if (parsed.data.status === 'marked_sent') {
      await tx
        .update(salonClientSchema)
        .set({ lastContactAt: now, updatedAt: now })
        .where(and(
          eq(salonClientSchema.id, client.id),
          eq(salonClientSchema.salonId, salon.id),
        ));
    }

    return savedCommunication;
  });

  if (!communication) {
    return Response.json({ error: { code: 'UPDATE_FAILED', message: 'Communication could not be saved.' } }, { status: 500 });
  }

  return Response.json({ data: { communication: serializeCommunication(communication) } });
}
