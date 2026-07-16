import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { getAppointmentCalendarEventForSync } from '@/libs/appointmentManage';
import { db } from '@/libs/DB';
import { syncGoogleCalendarEventForAppointment } from '@/libs/googleCalendar';
import { appointmentSchema, googleCalendarEventSchema, salonGoogleCalendarConnectionSchema } from '@/models/Schema';

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
    return Response.json({ error: 'Convert this event to an appointment before copying it' }, { status: 409 });
  }
  if (event.syncMode !== 'inbound_only') {
    return Response.json({ error: 'This event already supports two-way synchronization' }, { status: 409 });
  }
  const [connection] = await db.select({ destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId }).from(salonGoogleCalendarConnectionSchema).where(eq(salonGoogleCalendarConnectionSchema.salonId, salon.id)).limit(1);
  if (!connection) {
    return Response.json({ error: 'Google Calendar is not connected' }, { status: 409 });
  }
  const appointment = await getAppointmentCalendarEventForSync(event.appointmentId, salon.id);
  await db.transaction(async (tx) => {
    await tx.update(googleCalendarEventSchema).set({ appointmentId: null, syncMode: 'superseded' }).where(eq(googleCalendarEventSchema.id, event.id));
    await tx.update(appointmentSchema).set({ googleCalendarEventId: null }).where(and(eq(appointmentSchema.id, appointment.id), eq(appointmentSchema.salonId, salon.id)));
  });
  const result = await syncGoogleCalendarEventForAppointment({
    appointmentId: appointment.id,
    salonId: salon.id,
    salonName: salon.name,
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    serviceNames: [appointment.serviceLabel],
    technicianName: appointment.technicianName,
    startTime: new Date(appointment.startTime),
    endTime: new Date(appointment.endTime),
    totalPrice: appointment.totalPrice,
    totalDurationMinutes: appointment.totalDurationMinutes,
    timeZone: appointment.timeZone,
    locationName: appointment.locationName,
    locationAddress: appointment.locationAddress,
    googleCalendarEventId: null,
  });
  if (result.status !== 'synced') {
    await db.transaction(async (tx) => {
      await tx.update(googleCalendarEventSchema).set({ appointmentId: appointment.id, syncMode: 'inbound_only' }).where(eq(googleCalendarEventSchema.id, event.id));
      await tx.update(appointmentSchema).set({ googleCalendarEventId: event.googleEventId }).where(and(eq(appointmentSchema.id, appointment.id), eq(appointmentSchema.salonId, salon.id)));
    });
    return Response.json({ error: result.status === 'failed' ? result.error : 'The event could not be copied' }, { status: 503 });
  }
  await db.insert(googleCalendarEventSchema).values({
    id: `gce_${crypto.randomUUID()}`,
    salonId: salon.id,
    calendarId: connection.destinationCalendarId,
    googleEventId: result.eventId,
    appointmentId: appointment.id,
    sourceAccessRole: 'writer',
    syncMode: 'bidirectional',
    title: event.title,
    description: event.description,
    location: event.location,
    startTime: new Date(appointment.startTime),
    endTime: new Date(appointment.endTime),
    durationMinutes: appointment.totalDurationMinutes,
    isAllDay: false,
    transparency: 'busy',
    reviewStatus: 'appointment',
    reviewedAt: new Date(),
  }).onConflictDoNothing();
  await db.update(googleCalendarEventSchema).set({ supersededByEventId: result.eventId }).where(eq(googleCalendarEventSchema.id, event.id));
  return Response.json({ data: { eventId: result.eventId, syncMode: 'bidirectional' } });
}
