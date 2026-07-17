import 'server-only';

import { and, asc, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';

import { type Appointment, appointmentSchema } from '@/models/Schema';

import { db } from './DB';

/**
 * Statuses that count as an "active" reservation everywhere an appointment
 * can block a new booking or be recovered by the client.
 * Mirrors the partial unique index in migrations/0054_prevent_double_booking.sql.
 */
export const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'in_progress'] as const;

/**
 * Build the phone formats an appointment row may have been stored with.
 * Historical rows predate normalization, so lookups must match raw input,
 * digits-only, 10-digit, and +1/+ prefixed variants.
 */
export function buildClientPhoneVariants(rawPhone: string): string[] {
  const normalizedPhone = rawPhone.replace(/\D/g, '');
  const tenDigitPhone = normalizedPhone.length === 11 && normalizedPhone.startsWith('1')
    ? normalizedPhone.slice(1)
    : normalizedPhone;
  return Array.from(new Set([
    rawPhone,
    normalizedPhone,
    tenDigitPhone,
    `+1${tenDigitPhone}`,
    `+${normalizedPhone}`,
  ]));
}

/**
 * Time filter for what counts as "active":
 * - 'booking-gate': startTime >= now — the exact duplicate-booking gate
 *   semantics used by POST /api/appointments (unchanged behavior).
 * - 'recovery': endTime > now — also matches an appointment currently in
 *   progress or running late, so a client can always recover its manage link.
 */
export type ActiveAppointmentHorizon = 'booking-gate' | 'recovery';

/**
 * Single source of truth for finding a client's active appointments by
 * contact details. Used by the duplicate-booking gate (phone) and the
 * public recovery endpoint (email and/or phone) so the two flows can never
 * disagree about which appointments exist.
 *
 * Matches only non-deleted CRM appointments in ACTIVE_APPOINTMENT_STATUSES —
 * cancelled/completed/no-show/soft-deleted rows and Google Calendar events
 * (separate tables) can never match.
 */
export async function getActiveAppointmentsForContact(args: {
  salonId: string;
  phone?: string | null;
  email?: string | null;
  horizon: ActiveAppointmentHorizon;
  now?: Date;
}): Promise<Appointment[]> {
  const { salonId, phone, email, horizon } = args;
  const now = args.now ?? new Date();

  const identityConditions = [];
  if (phone) {
    identityConditions.push(inArray(appointmentSchema.clientPhone, buildClientPhoneVariants(phone)));
  }
  if (email) {
    identityConditions.push(sql`lower(${appointmentSchema.clientEmail}) = ${email.trim().toLowerCase()}`);
  }
  if (!identityConditions.length) {
    throw new Error('ACTIVE_APPOINTMENT_LOOKUP_REQUIRES_CONTACT');
  }

  return db
    .select()
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.salonId, salonId),
        inArray(appointmentSchema.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        horizon === 'booking-gate'
          ? gte(appointmentSchema.startTime, now)
          : gt(appointmentSchema.endTime, now),
        isNull(appointmentSchema.deletedAt),
        or(...identityConditions),
      ),
    )
    .orderBy(asc(appointmentSchema.startTime))
    .limit(10);
}
