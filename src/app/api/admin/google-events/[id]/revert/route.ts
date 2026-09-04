import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { recordGoogleEventReviewDecision } from '@/libs/googleEventReview';
import { acquireGoogleCalendarMutationBarrierInTx } from '@/libs/integrationOutbox';
import { appointmentSchema, googleCalendarEventSchema } from '@/models/Schema';

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
  const [event] = await db.select().from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.id, (await context.params).id),
    eq(googleCalendarEventSchema.salonId, salon.id),
  )).limit(1);
  if (!event?.appointmentId || event.reviewStatus !== 'appointment') {
    return Response.json({ error: 'This Google event is not a linked appointment' }, { status: 409 });
  }
  const result = await db.transaction(async (tx) => {
    // Take the same short appointment-scoped advisory mutex used by Calendar
    // claims before locking either business row. A provider call never runs
    // under this transaction; if one is already in flight, fail closed and let
    // the operator retry. Otherwise later workers can claim only after this
    // transaction commits and will observe the reverted ownership.
    const calendarIdle = await acquireGoogleCalendarMutationBarrierInTx(tx, {
      appointmentId: event.appointmentId!,
      salonId: salon.id,
    });
    if (!calendarIdle) {
      return { kind: 'calendar_busy' as const };
    }
    const [lockedAppointment] = await tx.select()
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.id, event.appointmentId!),
        eq(appointmentSchema.salonId, salon.id),
        inArray(appointmentSchema.status, ['pending', 'confirmed']),
      ))
      .for('update')
      .limit(1);
    if (!lockedAppointment) {
      return { kind: 'conflict' as const };
    }
    const [lockedEvent] = await tx.select()
      .from(googleCalendarEventSchema)
      .where(and(
        eq(googleCalendarEventSchema.id, event.id),
        eq(googleCalendarEventSchema.salonId, salon.id),
        eq(googleCalendarEventSchema.appointmentId, lockedAppointment.id),
        eq(googleCalendarEventSchema.reviewStatus, 'appointment'),
      ))
      .for('update')
      .limit(1);
    if (!lockedEvent) {
      return { kind: 'conflict' as const };
    }
    const mutationVersion = new Date(Math.max(
      Date.now(),
      lockedAppointment.updatedAt.getTime() + 1,
    ));
    const [cancelled] = await tx.update(appointmentSchema).set({
      status: 'cancelled',
      cancelReason: 'client_request',
      googleCalendarEventId: null,
      googleCalendarSyncStatus: 'not_synced',
      updatedAt: mutationVersion,
    }).where(and(
      eq(appointmentSchema.id, lockedAppointment.id),
      eq(appointmentSchema.salonId, salon.id),
      eq(appointmentSchema.status, lockedAppointment.status),
    )).returning();
    if (!cancelled) {
      return { kind: 'conflict' as const };
    }
    await tx.update(googleCalendarEventSchema).set({
      appointmentId: null,
      reviewStatus: 'reviewed',
      reviewedAt: mutationVersion,
      syncMode: ['owner', 'writer'].includes(lockedEvent.sourceAccessRole) ? 'bidirectional' : 'inbound_only',
    }).where(and(
      eq(googleCalendarEventSchema.id, lockedEvent.id),
      eq(googleCalendarEventSchema.salonId, salon.id),
      eq(googleCalendarEventSchema.appointmentId, cancelled.id),
      eq(googleCalendarEventSchema.reviewStatus, 'appointment'),
    ));
    return { kind: 'reverted' as const, appointment: cancelled };
  });
  if (result.kind === 'calendar_busy') {
    return Response.json({ error: 'Calendar synchronization is still in progress; retry shortly' }, { status: 409 });
  }
  if (result.kind === 'conflict') {
    return Response.json({ error: 'Started or completed appointments cannot be changed back to calendar time' }, { status: 409 });
  }
  await recordGoogleEventReviewDecision({
    salonId: salon.id,
    title: event.title,
    decision: event.transparency === 'free' ? 'free_event' : 'busy_time',
  });
  return Response.json({ data: { eventId: event.id, appointmentStatus: 'cancelled', reviewStatus: 'reviewed' } });
}
