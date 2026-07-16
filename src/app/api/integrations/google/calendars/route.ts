import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { listGoogleCalendarsForSalon } from '@/libs/googleCalendar';
import { salonGoogleCalendarConnectionSchema } from '@/models/Schema';

export async function GET(request: Request) {
  const salonSlug = new URL(request.url).searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json({ error: 'salonSlug is required' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  try {
    const calendars = await listGoogleCalendarsForSalon(salon.id);
    const [connection] = await db.select({ destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId, busyCalendarIds: salonGoogleCalendarConnectionSchema.busyCalendarIds }).from(salonGoogleCalendarConnectionSchema).where(eq(salonGoogleCalendarConnectionSchema.salonId, salon.id)).limit(1);
    const primaryCalendarId = calendars.find(calendar => calendar.primary)?.id;
    const selection = connection
      ? {
          destinationCalendarId: connection.destinationCalendarId === 'primary'
            ? primaryCalendarId || connection.destinationCalendarId
            : connection.destinationCalendarId,
          busyCalendarIds: connection.busyCalendarIds.map(id => id === 'primary' ? primaryCalendarId || id : id),
        }
      : null;
    if (
      connection
      && primaryCalendarId
      && (
        connection.destinationCalendarId === 'primary'
        || connection.busyCalendarIds.includes('primary')
      )
    ) {
      await db.update(salonGoogleCalendarConnectionSchema).set({
        destinationCalendarId: selection!.destinationCalendarId,
        busyCalendarIds: [...new Set(selection!.busyCalendarIds)],
      }).where(eq(salonGoogleCalendarConnectionSchema.salonId, salon.id));
    }
    return Response.json({ data: { calendars, selection } });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : 'Calendar list failed' }, { status: 503 });
  }
}

const selectionSchema = z.object({ salonSlug: z.string(), destinationCalendarId: z.string().min(1), busyCalendarIds: z.array(z.string().min(1)).min(1).max(20) });
export async function PATCH(request: Request) {
  const parsed = selectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid calendar selection' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const available = await listGoogleCalendarsForSalon(salon.id);
  const primaryCalendarId = available.find(calendar => calendar.primary)?.id;
  const destinationCalendarId = parsed.data.destinationCalendarId === 'primary'
    ? primaryCalendarId || parsed.data.destinationCalendarId
    : parsed.data.destinationCalendarId;
  const busyCalendarIds = [...new Set(parsed.data.busyCalendarIds.map(id => id === 'primary' ? primaryCalendarId || id : id))];
  const ids = new Set(available.map(calendar => calendar.id));
  if (!ids.has(destinationCalendarId) || busyCalendarIds.some(id => !ids.has(id))) {
    return Response.json({ error: 'A selected calendar is not available to this Google account' }, { status: 400 });
  }
  await db.update(salonGoogleCalendarConnectionSchema).set({
    destinationCalendarId,
    busyCalendarIds,
    status: 'active',
    lastError: null,
    inboundSyncEnabled: true,
    inboundSyncedAt: null,
    inboundSyncError: null,
  }).where(eq(salonGoogleCalendarConnectionSchema.salonId, salon.id));
  return Response.json({ data: { saved: true, selection: { destinationCalendarId, busyCalendarIds } } });
}
