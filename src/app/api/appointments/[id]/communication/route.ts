import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonClientById, getSalonClientByPhone } from '@/libs/queries';
import {
  buildAppointmentReminderQueue,
  buildCommunicationStatusTimestamps,
  canTransitionCommunicationStatus,
  type CommunicationSnapshot,
  sanitizeCommunicationMessageSnapshot,
} from '@/libs/retentionAssistant';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  clientCommunicationSchema,
  notificationDeliverySchema,
  salonClientSchema,
} from '@/models/Schema';
import {
  CLIENT_COMMUNICATION_STATUSES,
  type ClientCommunicationKind,
  type ClientCommunicationStatus,
  REMINDER_SNOOZE_HOURS,
} from '@/types/retention';

export const dynamic = 'force-dynamic';

const APPOINTMENT_COMMUNICATION_KINDS = [
  'generic_text',
  'reminder',
  'appointment_details',
  'directions',
] as const satisfies readonly ClientCommunicationKind[];

const mutationSchema = z.object({
  kind: z.enum(APPOINTMENT_COMMUNICATION_KINDS),
  status: z.enum(CLIENT_COMMUNICATION_STATUSES),
  messageSnapshot: z.string().max(5000).optional().nullable(),
  snoozeHours: z.literal(REMINDER_SNOOZE_HOURS).optional(),
}).strict().superRefine((value, context) => {
  if (value.snoozeHours !== undefined && (
    value.kind !== 'reminder'
    || value.status !== 'snoozed'
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snoozeHours'],
      message: 'snoozeHours is only valid when snoozing an appointment reminder',
    });
  }
  if (value.status === 'snoozed' && value.kind !== 'reminder') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'Only appointment reminders can be snoozed here',
    });
  }
});

type CommunicationRow = typeof clientCommunicationSchema.$inferSelect;
type AppointmentClient = typeof salonClientSchema.$inferSelect;

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

async function resolveAppointmentClient(appointment: {
  salonId: string;
  salonClientId: string | null;
  clientPhone: string;
}): Promise<AppointmentClient | null> {
  if (appointment.salonClientId) {
    const linkedClient = await getSalonClientById(
      appointment.salonId,
      appointment.salonClientId,
    );
    if (linkedClient) {
      return linkedClient;
    }
  }

  return getSalonClientByPhone(appointment.salonId, appointment.clientPhone);
}

function accessOptions(request: Request) {
  return {
    assignedOnly: true,
    wrongRoleMessage: 'Only salon staff or admins can manage client communications',
    assignmentForbiddenMessage: 'You can only manage communications for your own appointments',
    tenantForbiddenMessage: 'Appointment does not belong to your salon',
    salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
  };
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const access = await requireAppointmentManagerAccess(
    params.id,
    accessOptions(request),
  );
  if (!access.ok) {
    return access.response;
  }

  try {
    const appointment = access.appointment;
    const client = await resolveAppointmentClient(appointment);
    if (!client) {
      return Response.json({ data: { reminderDue: false, history: [] } });
    }

    const [settings, communicationRows, latestSmsReminder] = await Promise.all([
      getRetentionSettingsForSalon(appointment.salonId),
      db
        .select()
        .from(clientCommunicationSchema)
        .where(and(
          eq(clientCommunicationSchema.salonId, appointment.salonId),
          eq(clientCommunicationSchema.salonClientId, client.id),
          eq(clientCommunicationSchema.appointmentId, appointment.id),
          inArray(clientCommunicationSchema.kind, [...APPOINTMENT_COMMUNICATION_KINDS]),
        ))
        .orderBy(desc(clientCommunicationSchema.createdAt))
        .limit(100),
      db
        .select({ updatedAt: notificationDeliverySchema.updatedAt })
        .from(notificationDeliverySchema)
        .where(and(
          eq(notificationDeliverySchema.salonId, appointment.salonId),
          eq(notificationDeliverySchema.appointmentId, appointment.id),
          eq(notificationDeliverySchema.channel, 'sms'),
          eq(notificationDeliverySchema.purpose, 'appointment_reminder_manual'),
          inArray(notificationDeliverySchema.status, [
            'queued',
            'accepted',
            'sending',
            'sent',
            'delivered',
          ]),
        ))
        .orderBy(desc(notificationDeliverySchema.updatedAt))
        .limit(1)
        .then(rows => rows[0] ?? null),
    ]);

    const reminderQueue = buildAppointmentReminderQueue({
      clients: [{
        id: client.id,
        fullName: client.fullName,
        phone: client.phone,
        lastVisitAt: client.lastVisitAt,
        rebookIntervalDays: client.rebookIntervalDays,
        isBlocked: client.isBlocked,
      }],
      appointments: [{
        id: appointment.id,
        salonClientId: client.id,
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
        reminderSentAt: latestSmsReminder?.updatedAt
          ?? appointment.sameDayReminderSentAt
          ?? appointment.dayBeforeReminderSentAt,
      }],
      communications: toCommunicationSnapshots(communicationRows),
      reminderLeadHours: settings.reminderLeadHours,
      now: new Date(),
    });

    return Response.json({
      data: {
        reminderDue: reminderQueue.length > 0,
        history: communicationRows.map(serializeCommunication),
      },
    });
  } catch (error) {
    console.error('[AppointmentCommunication] failed to load communication state', error);
    return Response.json(
      {
        error: {
          code: 'COMMUNICATION_LOAD_FAILED',
          message: 'Communication history could not be loaded.',
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const access = await requireAppointmentManagerAccess(
    params.id,
    accessOptions(request),
  );
  if (!access.ok) {
    return access.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_JSON', message: 'A JSON request body is required.' } },
      { status: 400 },
    );
  }

  const parsed = mutationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid communication update.',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  try {
    const appointment = access.appointment;
    const client = await resolveAppointmentClient(appointment);
    if (!client) {
      return Response.json({
        data: {
          communication: null,
          tracked: false,
        },
      });
    }

    const now = new Date();
    const safeMessageSnapshot = sanitizeCommunicationMessageSnapshot(
      parsed.data.messageSnapshot,
    );
    let dueAt: Date | null = null;
    if (parsed.data.kind === 'reminder') {
      const settings = await getRetentionSettingsForSalon(appointment.salonId);
      dueAt = new Date(
        appointment.startTime.getTime() - settings.reminderLeadHours * 3_600_000,
      );
    }

    const [latest] = await db
      .select()
      .from(clientCommunicationSchema)
      .where(and(
        eq(clientCommunicationSchema.salonId, appointment.salonId),
        eq(clientCommunicationSchema.salonClientId, client.id),
        eq(clientCommunicationSchema.appointmentId, appointment.id),
        eq(clientCommunicationSchema.kind, parsed.data.kind),
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
      return Response.json(
        {
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot change communication from ${latest.status} to ${parsed.data.status}.`,
          },
        },
        { status: 409 },
      );
    }

    const timestamps = buildCommunicationStatusTimestamps(parsed.data.status, now, {
      kind: parsed.data.kind,
      appointmentStartTime: appointment.startTime,
    });
    const communication = await db.transaction(async (tx) => {
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
            eq(clientCommunicationSchema.salonId, appointment.salonId),
            eq(clientCommunicationSchema.salonClientId, client.id),
            eq(clientCommunicationSchema.appointmentId, appointment.id),
          ))
          .returning();
        savedCommunication = updated;
      } else {
        const [created] = await tx
          .insert(clientCommunicationSchema)
          .values({
            id: `comm_${crypto.randomUUID()}`,
            salonId: appointment.salonId,
            salonClientId: client.id,
            appointmentId: appointment.id,
            kind: parsed.data.kind,
            status: parsed.data.status,
            dueAt,
            messageSnapshot: safeMessageSnapshot ?? null,
            actorAdminId: access.actorRole === 'admin' ? access.admin.id : null,
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
            eq(salonClientSchema.salonId, appointment.salonId),
          ));
      }

      return savedCommunication;
    });

    if (!communication) {
      return Response.json(
        { error: { code: 'UPDATE_FAILED', message: 'Communication could not be saved.' } },
        { status: 500 },
      );
    }

    return Response.json({
      data: {
        communication: serializeCommunication(communication),
        tracked: true,
      },
    });
  } catch (error) {
    console.error('[AppointmentCommunication] failed to save communication state', error);
    return Response.json(
      {
        error: {
          code: 'COMMUNICATION_UPDATE_FAILED',
          message: 'Communication history could not be updated.',
        },
      },
      { status: 500 },
    );
  }
}
