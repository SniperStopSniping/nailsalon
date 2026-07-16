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
    return Response.json({ data: { calendars, selection: connection || null } });
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
  const ids = new Set(available.map(calendar => calendar.id));
  if (!ids.has(parsed.data.destinationCalendarId) || parsed.data.busyCalendarIds.some(id => !ids.has(id))) {
    return Response.json({ error: 'A selected calendar is not available to this Google account' }, { status: 400 });
  }
  await db.update(salonGoogleCalendarConnectionSchema).set({
    destinationCalendarId: parsed.data.destinationCalendarId,
    busyCalendarIds: parsed.data.busyCalendarIds,
    status: 'active',
    lastError: null,
    inboundSyncEnabled: true,
    inboundSyncedAt: new Date(),
    inboundSyncError: null,
  }).where(eq(salonGoogleCalendarConnectionSchema.salonId, salon.id));
  return Response.json({ data: { saved: true } });
}
