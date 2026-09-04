import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  enqueueGoogleCalendarAppointmentMutation,
  isGoogleCalendarDispatchBusyError,
} from '@/libs/integrationOutbox';
import { appointmentSchema, googleCalendarEventSchema, salonGoogleCalendarConnectionSchema } from '@/models/Schema';

const bodySchema = z.object({ salonSlug: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid Google event request' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const [connection] = await db.select({ destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId }).from(salonGoogleCalendarConnectionSchema).where(and(
    eq(salonGoogleCalendarConnectionSchema.salonId, salon.id),
    inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']),
  )).limit(1);
  if (!connection) {
    return Response.json({ error: 'Google Calendar is not connected' }, { status: 409 });
  }
  let queued;
  try {
    queued = await db.transaction(async (tx) => {
      // These reads only resolve the candidate aggregate. The enqueue helper then
      // takes every write lock in the worker's canonical outbox -> appointment ->
      // source order and revalidates this snapshot before committing any job.
      const [event] = await tx.select().from(googleCalendarEventSchema).where(and(
        eq(googleCalendarEventSchema.id, (await context.params).id),
        eq(googleCalendarEventSchema.salonId, salon.id),
      )).limit(1);
      if (!event || event.reviewStatus !== 'appointment') {
        return { error: 'Convert this event to an appointment before copying it' } as const;
      }
      let appointmentId = event.appointmentId;
      if (event.syncMode === 'superseded' && event.supersededByEventId) {
        const destinationMirrors = await tx.select({
          appointmentId: googleCalendarEventSchema.appointmentId,
          calendarId: googleCalendarEventSchema.calendarId,
        }).from(googleCalendarEventSchema).where(and(
          eq(googleCalendarEventSchema.salonId, salon.id),
          eq(googleCalendarEventSchema.googleEventId, event.supersededByEventId),
          eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
          isNull(googleCalendarEventSchema.deletedAt),
          inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
        ));
        if (destinationMirrors.length !== 1 || !destinationMirrors[0]?.appointmentId) {
          return { error: 'The completed Google copy state is inconsistent' } as const;
        }
        appointmentId = destinationMirrors[0].appointmentId;
      } else if (event.syncMode !== 'inbound_only') {
        return { error: 'This event already supports two-way synchronization' } as const;
      }
      if (!appointmentId) {
        return { error: 'Convert this event to an appointment before copying it' } as const;
      }
      const [appointment] = await tx.select().from(appointmentSchema).where(and(
        eq(appointmentSchema.id, appointmentId),
        eq(appointmentSchema.salonId, salon.id),
      )).limit(1);
      if (!appointment || appointment.deletedAt || ['cancelled', 'no_show'].includes(appointment.status)) {
        return { error: 'The linked appointment is no longer active' } as const;
      }
      if (appointment.status === 'awaiting_payment') {
        return { error: 'Awaiting-payment deposit holds cannot be copied to Google Calendar', code: 'HOLD_LOCKED' } as const;
      }
      const result = await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: appointment.id,
        salonId: salon.id,
        mutationVersion: appointment.updatedAt,
        adminCopySourceEventId: event.id,
      });
      return { result } as const;
    });
  } catch (error) {
    if (isGoogleCalendarDispatchBusyError(error)) {
      return Response.json({
        error: {
          code: 'GOOGLE_CALENDAR_WRITE_IN_PROGRESS',
          message: 'Google Calendar is updating this appointment. Try again shortly.',
        },
      }, { status: 409 });
    }
    throw error;
  }
  if ('error' in queued) {
    return Response.json({
      error: queued.code
        ? { code: queued.code, message: queued.error }
        : queued.error,
    }, { status: 409 });
  }
  const status = queued.result.inserted || queued.result.rearmed
    ? 'queued'
    : queued.result.status === 'completed'
      ? 'already_completed'
      : ['failed', 'cancelled', 'inconsistent'].includes(queued.result.status)
          ? 'failed'
          : 'already_queued';
  return Response.json({
    data: {
      jobId: queued.result.jobId,
      status,
    },
  }, { status: status === 'already_completed' ? 200 : status === 'failed' ? 409 : 202 });
}
