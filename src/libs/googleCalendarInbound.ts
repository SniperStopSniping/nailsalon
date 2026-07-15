import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { logAppointmentChange } from '@/libs/appointmentAudit';
import {
  AppointmentManageError,
  getAppointmentCalendarEventForSync,
  runAppointmentManageMutation,
} from '@/libs/appointmentManage';
import { db } from '@/libs/DB';
import { sendTransactionalEmail } from '@/libs/email';
import { listGoogleCalendarEventsForSalon } from '@/libs/googleCalendar';
import { enqueueGoogleCalendarUpsert } from '@/libs/integrationOutbox';
import {
  appointmentSchema,
  salonGoogleCalendarConnectionSchema,
  salonSchema,
} from '@/models/Schema';

const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed'] as const;
const CURSOR_OVERLAP_MS = 60_000;

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

async function enqueueCurrentAppointmentState(appointmentId: string, salonId: string) {
  const [salon, event] = await Promise.all([
    db.select({ name: salonSchema.name }).from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1),
    getAppointmentCalendarEventForSync(appointmentId, salonId),
  ]);
  await enqueueGoogleCalendarUpsert({
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
    googleCalendarEventId: event.googleCalendarEventId,
  }, { dedupeSuffix: `restore-${Date.now()}` });
}

async function sendCalendarChangeEmail(args: {
  clientEmail: string | null;
  clientName: string | null;
  salonName: string;
  timeZone: string;
  startTime: Date;
  operation: 'rescheduled' | 'cancelled';
}) {
  if (!args.clientEmail) {
    return;
  }
  const greeting = args.clientName?.trim() ? `Hi ${args.clientName.trim()},` : 'Hello,';
  const time = formatAppointmentTime(args.startTime, args.timeZone);
  const action = args.operation === 'rescheduled'
    ? `Your appointment at ${args.salonName} was rescheduled to ${time}.`
    : `Your appointment at ${args.salonName} on ${time} was cancelled.`;
  const safeGreeting = escapeHtml(greeting);
  const safeAction = escapeHtml(action);
  const safeSalonName = escapeHtml(args.salonName);
  await sendTransactionalEmail({
    to: args.clientEmail,
    subject: `${args.salonName} appointment ${args.operation}`,
    text: `${greeting}\n\n${action}\n\nPlease contact ${args.salonName} if this change was unexpected.`,
    html: `<p>${safeGreeting}</p><p>${safeAction}</p><p>Please contact ${safeSalonName} if this change was unexpected.</p>`,
  }).catch(() => false);
}

export async function processGoogleCalendarInboundSync(limit = 25, salonId?: string) {
  const connections = await db
    .select({
      salonId: salonGoogleCalendarConnectionSchema.salonId,
      inboundSyncedAt: salonGoogleCalendarConnectionSchema.inboundSyncedAt,
    })
    .from(salonGoogleCalendarConnectionSchema)
    .where(and(
      eq(salonGoogleCalendarConnectionSchema.inboundSyncEnabled, true),
      inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']),
      ...(salonId ? [eq(salonGoogleCalendarConnectionSchema.salonId, salonId)] : []),
    ))
    .limit(limit);

  const summary = {
    scannedConnections: connections.length,
    initializedConnections: 0,
    scannedEvents: 0,
    movedAppointments: 0,
    cancelledAppointments: 0,
    conflicts: 0,
    failedConnections: 0,
  };

  for (const connection of connections) {
    const checkpoint = new Date();
    if (!connection.inboundSyncedAt) {
      await db.update(salonGoogleCalendarConnectionSchema).set({
        inboundSyncedAt: checkpoint,
        inboundSyncError: null,
      }).where(eq(salonGoogleCalendarConnectionSchema.salonId, connection.salonId));
      summary.initializedConnections += 1;
      continue;
    }

    try {
      const [salon] = await db.select({
        name: salonSchema.name,
        settings: salonSchema.settings,
      }).from(salonSchema).where(eq(salonSchema.id, connection.salonId)).limit(1);
      if (!salon) {
        throw new Error('Salon was not found for Google Calendar connection');
      }
      const timeZone = salon.settings?.booking?.timezone || 'America/Toronto';

      const remoteEvents = await listGoogleCalendarEventsForSalon({
        salonId: connection.salonId,
        updatedMin: new Date(connection.inboundSyncedAt.getTime() - CURSOR_OVERLAP_MS),
        includeDeleted: true,
      });
      const latestById = new Map(remoteEvents.map(event => [event.id, event]));
      summary.scannedEvents += latestById.size;

      for (const remoteEvent of latestById.values()) {
        if (
          !remoteEvent.appointmentId
          || remoteEvent.salonId !== connection.salonId
        ) {
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
        }).from(appointmentSchema).where(and(
          eq(appointmentSchema.id, remoteEvent.appointmentId),
          eq(appointmentSchema.salonId, connection.salonId),
        )).limit(1);
        if (!appointment || !ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as typeof ACTIVE_APPOINTMENT_STATUSES[number])) {
          continue;
        }

        if (remoteEvent.status === 'cancelled') {
          await db.update(appointmentSchema).set({
            status: 'cancelled',
            cancelReason: 'client_request',
            notes: [appointment.notes, '[Google Calendar] Event deleted by salon owner.'].filter(Boolean).join('\n'),
            googleCalendarEventId: null,
            googleCalendarSyncStatus: 'deleted',
            googleCalendarSyncError: null,
            googleCalendarSyncedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(
            eq(appointmentSchema.id, appointment.id),
            eq(appointmentSchema.salonId, connection.salonId),
          ));
          await logAppointmentChange({
            appointmentId: appointment.id,
            salonId: appointment.salonId,
            action: 'cancelled',
            performedBy: 'google-calendar-sync',
            performedByRole: 'system',
            performedByName: 'Google Calendar',
            previousValue: { status: appointment.status },
            newValue: { status: 'cancelled' },
            reason: 'The connected Google Calendar event was deleted by the salon owner.',
          });
          await sendCalendarChangeEmail({
            clientEmail: appointment.clientEmail,
            clientName: appointment.clientName,
            salonName: salon.name,
            timeZone,
            startTime: appointment.startTime,
            operation: 'cancelled',
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

        try {
          await runAppointmentManageMutation({
            appointmentId: appointment.id,
            salonId: appointment.salonId,
            operation: 'move',
            startTime: remoteEvent.startTime,
            durationMinutes,
            canReassignTechnician: false,
          });
          await db.update(appointmentSchema).set({
            googleCalendarEventId: remoteEvent.id,
            googleCalendarSyncStatus: 'synced',
            googleCalendarSyncError: null,
            googleCalendarSyncedAt: new Date(),
          }).where(and(
            eq(appointmentSchema.id, appointment.id),
            eq(appointmentSchema.salonId, connection.salonId),
          ));
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
          await sendCalendarChangeEmail({
            clientEmail: appointment.clientEmail,
            clientName: appointment.clientName,
            salonName: salon.name,
            timeZone,
            startTime: remoteEvent.startTime,
            operation: 'rescheduled',
          });
          summary.movedAppointments += 1;
        } catch (error) {
          const message = safeError(error);
          await db.update(appointmentSchema).set({
            googleCalendarSyncStatus: 'failed',
            googleCalendarSyncError: message,
            googleCalendarSyncedAt: new Date(),
          }).where(and(
            eq(appointmentSchema.id, appointment.id),
            eq(appointmentSchema.salonId, connection.salonId),
          ));
          await enqueueCurrentAppointmentState(appointment.id, appointment.salonId).catch(() => undefined);
          summary.conflicts += 1;
        }
      }

      await db.update(salonGoogleCalendarConnectionSchema).set({
        inboundSyncedAt: checkpoint,
        inboundSyncError: null,
      }).where(eq(salonGoogleCalendarConnectionSchema.salonId, connection.salonId));
    } catch (error) {
      await db.update(salonGoogleCalendarConnectionSchema).set({
        inboundSyncError: safeError(error),
        status: 'degraded',
      }).where(eq(salonGoogleCalendarConnectionSchema.salonId, connection.salonId));
      summary.failedConnections += 1;
    }
  }

  return summary;
}
