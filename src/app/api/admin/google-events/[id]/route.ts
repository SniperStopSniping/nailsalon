import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { parseGoogleEventTitle } from '@/libs/googleEventAutofill';
import { recordGoogleEventReviewDecision } from '@/libs/googleEventReview';
import { googleCalendarEventSchema } from '@/models/Schema';

const actionSchema = z.object({
  salonSlug: z.string().min(1),
  action: z.enum(['keep_time', 'reopen']),
});

const detailQuerySchema = z.object({
  salonSlug: z.string().min(1),
});

export async function GET(request: Request, context: { params: { id: string } }) {
  const url = new URL(request.url);
  const parsed = detailQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_GOOGLE_EVENT_QUERY', message: 'Invalid Google event query' } }, { status: 400 });
  }

  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } }, { status: 404 });
  }

  const [event] = await db.select().from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.id, context.params.id),
    eq(googleCalendarEventSchema.salonId, salon.id),
  )).limit(1);

  if (!event) {
    return Response.json({ error: { code: 'GOOGLE_EVENT_NOT_FOUND', message: 'Google event not found' } }, { status: 404 });
  }
  if (event.deletedAt || event.googleStatus === 'cancelled') {
    return Response.json({ error: { code: 'GOOGLE_EVENT_DELETED', message: 'Google event was deleted' } }, { status: 410 });
  }
  if (event.appointmentId || event.reviewStatus === 'appointment') {
    return Response.json({ error: { code: 'GOOGLE_EVENT_ALREADY_CONVERTED', message: 'Google event was already converted' } }, { status: 409 });
  }
  const parsedTitle = parseGoogleEventTitle(event.title);

  return Response.json({
    data: {
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        durationMinutes: event.durationMinutes,
        transparency: event.transparency,
        isReadOnly: !['owner', 'writer'].includes(event.sourceAccessRole),
        sourceVersion: (event.googleUpdatedAt ?? event.updatedAt).toISOString(),
        suggestion: {
          client: event.attendeePhone || event.attendeeEmail || event.attendeeName || parsedTitle.clientName
            ? {
                fullName: event.attendeeName || parsedTitle.clientName,
                phone: event.attendeePhone || '',
                email: event.attendeeEmail,
              }
            : null,
        },
      },
    },
  });
}

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
