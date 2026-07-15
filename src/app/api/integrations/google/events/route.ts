import { and, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { listExternalGoogleCalendarEvents } from '@/libs/googleCalendar';
import { processGoogleCalendarInboundSync } from '@/libs/googleCalendarInbound';
import { googleCalendarDraftSchema } from '@/models/Schema';

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
    const [events, drafts] = await Promise.all([
      listExternalGoogleCalendarEvents({ salonId: salon.id, startTime, endTime }),
      db.select({
        id: googleCalendarDraftSchema.id,
        googleEventId: googleCalendarDraftSchema.googleEventId,
        title: googleCalendarDraftSchema.title,
        startTime: googleCalendarDraftSchema.startTime,
        endTime: googleCalendarDraftSchema.endTime,
      }).from(googleCalendarDraftSchema).where(and(
        eq(googleCalendarDraftSchema.salonId, salon.id),
        eq(googleCalendarDraftSchema.status, 'needs_details'),
        gte(googleCalendarDraftSchema.startTime, startTime),
        lt(googleCalendarDraftSchema.startTime, endTime),
      )),
    ]);
    const draftsByEventId = new Map(drafts.map(draft => [draft.googleEventId, draft]));
    return Response.json({
      data: {
        events: events.map((event) => {
          const draft = draftsByEventId.get(event.id);
          return {
            id: event.id,
            draftId: draft?.id ?? null,
            startTime: event.startTime.toISOString(),
            endTime: event.endTime.toISOString(),
            label: draft?.title || (draft ? 'Google appointment needs details' : 'Google Calendar busy'),
            needsDetails: Boolean(draft),
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
