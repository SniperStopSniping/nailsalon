import { and, eq, gt, isNull, lt, ne } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { processGoogleCalendarInboundSync } from '@/libs/googleCalendarInbound';
import { parseGoogleEventTitle } from '@/libs/googleEventAutofill';
import { googleCalendarEventSchema } from '@/models/Schema';

const querySchema = z.object({
  salonSlug: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid Google Calendar date range' }, { status: 400 });
  }
  const startTime = new Date(parsed.data.startTime);
  const endTime = new Date(parsed.data.endTime);
  if (endTime <= startTime || endTime.getTime() - startTime.getTime() > 93 * 24 * 60 * 60 * 1000) {
    return Response.json({ error: 'Google Calendar range must be between 1 minute and 93 days' }, { status: 400 });
  }

  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  try {
    await processGoogleCalendarInboundSync(1, salon.id);
    const events = await db.select({
      id: googleCalendarEventSchema.id,
      googleEventId: googleCalendarEventSchema.googleEventId,
      calendarId: googleCalendarEventSchema.calendarId,
      appointmentId: googleCalendarEventSchema.appointmentId,
      title: googleCalendarEventSchema.title,
      description: googleCalendarEventSchema.description,
      location: googleCalendarEventSchema.location,
      attendeeName: googleCalendarEventSchema.attendeeName,
      attendeePhone: googleCalendarEventSchema.attendeePhone,
      attendeeEmail: googleCalendarEventSchema.attendeeEmail,
      startTime: googleCalendarEventSchema.startTime,
      endTime: googleCalendarEventSchema.endTime,
      durationMinutes: googleCalendarEventSchema.durationMinutes,
      isAllDay: googleCalendarEventSchema.isAllDay,
      transparency: googleCalendarEventSchema.transparency,
      reviewStatus: googleCalendarEventSchema.reviewStatus,
      sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
      syncMode: googleCalendarEventSchema.syncMode,
      lastSyncedAt: googleCalendarEventSchema.lastSyncedAt,
    }).from(googleCalendarEventSchema).where(and(
      eq(googleCalendarEventSchema.salonId, salon.id),
      isNull(googleCalendarEventSchema.deletedAt),
      ne(googleCalendarEventSchema.syncMode, 'superseded'),
      lt(googleCalendarEventSchema.startTime, endTime),
      gt(googleCalendarEventSchema.endTime, startTime),
    ));
    return Response.json({
      data: {
        events: events.map((event) => {
          const parsedTitle = parseGoogleEventTitle(event.title);
          return {
            ...event,
            startTime: event.startTime.toISOString(),
            endTime: event.endTime.toISOString(),
            lastSyncedAt: event.lastSyncedAt.toISOString(),
            needsDetails: event.reviewStatus === 'needs_review',
            isReadOnly: !['owner', 'writer'].includes(event.sourceAccessRole),
            label: event.title || (event.transparency === 'free' ? 'Google free event' : 'Google busy time'),
            suggestedClient: event.attendeePhone || event.attendeeEmail || event.attendeeName || parsedTitle.clientName
              ? {
                  fullName: event.attendeeName || parsedTitle.clientName,
                  phone: event.attendeePhone || '',
                  email: event.attendeeEmail,
                }
              : null,
          };
        }),
      },
    });
  } catch (cause) {
    return Response.json({
      error: cause instanceof Error ? cause.message : 'Google Calendar events could not be loaded',
    }, { status: 503 });
  }
}
