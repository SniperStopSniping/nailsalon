import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { recordGoogleEventReviewDecision } from '@/libs/googleEventReview';
import { appointmentSchema, googleCalendarEventSchema } from '@/models/Schema';

const bodySchema = z.object({ salonSlug: z.string().min(1) });

export async function POST(request: Request, context: { params: { id: string } }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid Google event request' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const [event] = await db.select().from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.id, context.params.id),
    eq(googleCalendarEventSchema.salonId, salon.id),
  )).limit(1);
  if (!event?.appointmentId || event.reviewStatus !== 'appointment') {
    return Response.json({ error: 'This Google event is not a linked appointment' }, { status: 409 });
  }
  const result = await db.transaction(async (tx) => {
    const [cancelled] = await tx.update(appointmentSchema).set({
      status: 'cancelled',
      cancelReason: 'client_request',
      googleCalendarEventId: null,
      googleCalendarSyncStatus: 'not_synced',
      updatedAt: new Date(),
    }).where(and(
      eq(appointmentSchema.id, event.appointmentId!),
      eq(appointmentSchema.salonId, salon.id),
      inArray(appointmentSchema.status, ['pending', 'confirmed']),
    )).returning();
    if (!cancelled) {
      return null;
    }
    await tx.update(googleCalendarEventSchema).set({
      appointmentId: null,
      reviewStatus: 'reviewed',
      reviewedAt: new Date(),
      syncMode: ['owner', 'writer'].includes(event.sourceAccessRole) ? 'bidirectional' : 'inbound_only',
    }).where(and(
      eq(googleCalendarEventSchema.id, event.id),
      eq(googleCalendarEventSchema.salonId, salon.id),
    ));
    return cancelled;
  });
  if (!result) {
    return Response.json({ error: 'Started or completed appointments cannot be changed back to calendar time' }, { status: 409 });
  }
  await recordGoogleEventReviewDecision({
    salonId: salon.id,
    title: event.title,
    decision: event.transparency === 'free' ? 'free_event' : 'busy_time',
  });
  return Response.json({ data: { eventId: event.id, appointmentStatus: 'cancelled', reviewStatus: 'reviewed' } });
}
