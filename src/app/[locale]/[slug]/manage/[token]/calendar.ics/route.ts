import { eq } from 'drizzle-orm';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { buildDirectionsDestination } from '@/libs/directions';
import { getLocationById, getPrimaryLocation } from '@/libs/queries';
import {
  applyLocationDisplayMode,
  resolveConfirmedBookingLocationDisplayMode,
} from '@/libs/salonContent';
import { appointmentServicesSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toIcsDate(value: Date): string {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string; token: string }> }) {
  const capability = await verifyAppointmentAccessToken((await context.params).token);
  if (!capability || capability.salonSlug !== (await context.params).slug) {
    return new Response('This calendar link is invalid or expired.', { status: 404 });
  }

  const services = await db
    .select({ name: appointmentServicesSchema.nameSnapshot })
    .from(appointmentServicesSchema)
    .where(eq(appointmentServicesSchema.appointmentId, capability.appointmentId));
  const serviceName = services.map(service => service.name).filter(Boolean).join(', ') || 'Nail appointment';
  const appointment = capability.appointment;
  // Same capability-scoped projection as the manage page: `after_booking`
  // resolves to the exact address only because this file is reachable solely
  // through the verified appointment token; `city_only` stays city-only.
  const locationRow = appointment.locationId
    ? await getLocationById(appointment.locationId, appointment.salonId)
    : await getPrimaryLocation(appointment.salonId);
  const visitDestination = locationRow
    ? buildDirectionsDestination(applyLocationDisplayMode({
      address: locationRow.address,
      city: locationRow.city,
      state: locationRow.state,
      zipCode: locationRow.zipCode,
    }, resolveConfirmedBookingLocationDisplayMode(
      resolveBookingPageContent(capability.salonSettings).live.locationDisplayMode,
      appointment.status,
    )))
    : null;
  const now = new Date();
  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Luster//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(appointment.id)}@luster`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(appointment.startTime)}`,
    `DTEND:${toIcsDate(appointment.endTime)}`,
    `SUMMARY:${escapeIcs(`${serviceName} at ${capability.salonName}`)}`,
    `DESCRIPTION:${escapeIcs(`Booked with ${capability.salonName}. Use your private Luster link to reschedule or cancel.`)}`,
    ...(visitDestination ? [`LOCATION:${escapeIcs(visitDestination)}`] : []),
    `STATUS:${appointment.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  return new Response(calendar, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="luster-appointment-${appointment.id}.ics"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
