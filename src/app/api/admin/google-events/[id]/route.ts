import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { recordGoogleEventReviewDecision } from '@/libs/googleEventReview';
import { googleCalendarEventSchema } from '@/models/Schema';

const actionSchema = z.object({
  salonSlug: z.string().min(1),
  action: z.enum(['keep_time', 'reopen']),
});

export async function PATCH(request: Request, context: { params: { id: string } }) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid Google event action' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const [event] = await db.select().from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.id, context.params.id),
    eq(googleCalendarEventSchema.salonId, salon.id),
  )).limit(1);
  if (!event || event.deletedAt) {
    return Response.json({ error: 'Google event not found' }, { status: 404 });
  }
  if (event.reviewStatus === 'appointment') {
    return Response.json({ error: 'Linked appointments must be reverted from the appointment details' }, { status: 409 });
  }
  const reviewStatus = parsed.data.action === 'reopen' ? 'needs_review' : 'reviewed';
  await db.update(googleCalendarEventSchema).set({
    reviewStatus,
    reviewedAt: reviewStatus === 'reviewed' ? new Date() : null,
  }).where(and(
    eq(googleCalendarEventSchema.id, event.id),
    eq(googleCalendarEventSchema.salonId, salon.id),
  ));
  if (reviewStatus === 'reviewed') {
    await recordGoogleEventReviewDecision({
      salonId: salon.id,
      title: event.title,
      decision: event.transparency === 'free' ? 'free_event' : 'busy_time',
    });
  }
  return Response.json({ data: { id: event.id, reviewStatus } });
}
