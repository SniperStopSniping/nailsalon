import 'server-only';

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { and, asc, eq, gte, isNull } from 'drizzle-orm';

import { blockingAppointmentCondition } from '@/libs/appointmentBlocking';
import { appointmentSchema, salonLocationSchema } from '@/models/Schema';

import { type SetupDocument, SetupError, type SetupHours, type SetupReview } from './contracts';
import type { SetupTransaction } from './drafts.server';

/** Review-only comparison; appointment creation still uses the booking engine. */
export function appointmentFitsProposedHours(start: Date, end: Date, hours: SetupHours, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (value: Date) => Object.fromEntries(formatter.formatToParts(value).map(part => [part.type, part.value]));
  const first = parts(start);
  const last = parts(end);
  const interval = hours[first.weekday!.toLowerCase() as keyof SetupHours];
  return Boolean(interval && first.year === last.year && first.month === last.month && first.day === last.day && `${first.hour}:${first.minute}` >= interval.open && `${last.hour}:${last.minute}` <= interval.close);
}

export async function setupAppointmentImpact(tx: SetupTransaction, salonId: string, before: SetupDocument, after: SetupDocument, now = new Date()): Promise<SetupReview['appointmentImpact']> {
  const hoursChanged = !isDeepStrictEqual(before.hours, after.hours);
  const changedStaff = (after.staff ?? []).filter((person) => {
    const original = before.staff?.find(saved => saved.id === person.id);
    return original && (original.isActive !== person.isActive || !isDeepStrictEqual(original.hours, person.hours) || original.assignmentMode !== person.assignmentMode || !isDeepStrictEqual([...original.serviceIds].sort(), [...person.serviceIds].sort()));
  });
  if (!hoursChanged && !changedStaff.length) {
    return undefined;
  }
  const rows = await tx.select({ id: appointmentSchema.id, technicianId: appointmentSchema.technicianId, locationId: appointmentSchema.locationId, startTime: appointmentSchema.startTime, endTime: appointmentSchema.endTime, blockedDurationMinutes: appointmentSchema.blockedDurationMinutes, status: appointmentSchema.status, requestExpiresAt: appointmentSchema.requestExpiresAt }).from(appointmentSchema).where(and(eq(appointmentSchema.salonId, salonId), gte(appointmentSchema.startTime, now), isNull(appointmentSchema.deletedAt), blockingAppointmentCondition(now))).orderBy(asc(appointmentSchema.id)).limit(10001).for('share');
  if (rows.length > 10000) {
    throw new SetupError('NOT_READY', 'This schedule change includes too many upcoming appointments to review here. Your draft is saved; use the calendar settings for this change.');
  }
  const locations = await tx.select({ id: salonLocationSchema.id, isPrimary: salonLocationSchema.isPrimary, isActive: salonLocationSchema.isActive, businessHours: salonLocationSchema.businessHours }).from(salonLocationSchema).where(eq(salonLocationSchema.salonId, salonId)).orderBy(asc(salonLocationSchema.id));
  const primary = locations.find(location => location.isPrimary && location.isActive) ?? locations.find(location => location.isActive);
  let outsideHoursCount = 0;
  let staffAffectedCount = 0;
  for (const appointment of rows) {
    const person = changedStaff.find(person => person.id === appointment.technicianId);
    if (person) {
      staffAffectedCount++;
    }
    const end = new Date(Math.max(appointment.endTime.getTime(), appointment.startTime.getTime() + (appointment.blockedDurationMinutes ?? 0) * 60000));
    const location = appointment.locationId ? locations.find(location => location.id === appointment.locationId) : primary;
    const usesNewBusinessHours = hoursChanged && (!location?.businessHours || location.isPrimary);
    if ((usesNewBusinessHours && !appointmentFitsProposedHours(appointment.startTime, end, after.hours, before.booking.timezone)) || (person && (!person.isActive || (person.hours && !appointmentFitsProposedHours(appointment.startTime, end, person.hours, before.booking.timezone))))) {
      outsideHoursCount++;
    }
  }
  // Hash only the allowlisted operational footprint, never contact details.
  const fingerprint = createHash('sha256').update(JSON.stringify({ rows, locations })).digest('hex');
  return { upcomingCount: rows.length, outsideHoursCount, staffAffectedCount, fingerprint };
}
