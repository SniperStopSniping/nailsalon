import 'server-only';

import { and, asc, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  getSalonClientLineageIdentityWithHandle,
  type LifecycleSqlHandle,
} from '@/libs/clientLifecycleStabilization';
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
export type ActiveAppointmentHorizon =
  | 'booking-gate'
  | 'lineage-active'
  | 'recovery';

export type CanonicalActiveAppointment = Pick<
  Appointment,
  | 'id'
  | 'salonId'
  | 'salonClientId'
  | 'clientPhone'
  | 'clientEmail'
  | 'status'
  | 'startTime'
  | 'endTime'
>;

function resultRows(result: unknown): Record<string, unknown>[] {
  const withRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(withRows?.rows)) {
    return withRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

function dateFromRow(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('ACTIVE_APPOINTMENT_ROW_INVALID');
  }
  return date;
}

/**
 * Authoritative lifecycle-aware active lookup.
 *
 * Stable appointment ownership always wins. Historical phone/email values are
 * consulted only for legacy rows that have no salon_client_id, so a matching
 * snapshot can never steal a row from another stable client.
 */
export async function getActiveAppointmentsForCanonicalClientWithHandle(
  handle: LifecycleSqlHandle,
  args: {
    salonId: string;
    terminalClientId: string;
    horizon: ActiveAppointmentHorizon;
    now?: Date;
    excludeAppointmentId?: string | null;
    allowArchived?: boolean;
  },
): Promise<CanonicalActiveAppointment[]> {
  const now = args.now ?? new Date();
  const identity = await getSalonClientLineageIdentityWithHandle(handle, {
    salonId: args.salonId,
    terminalClientId: args.terminalClientId,
    allowArchived: args.allowArchived,
  });
  const phoneValues = [...new Set(
    identity.phones.map(phone => phone.replace(/\D/g, '')).filter(Boolean),
  )].sort();
  const emailValues = [...new Set(
    identity.emails.map(email => email.trim().toLowerCase()).filter(Boolean),
  )].sort();
  const fallbackConditions = [];
  if (phoneValues.length > 0) {
    fallbackConditions.push(sql`
      case
        when length(regexp_replace(appointment.client_phone, '[^0-9]', '', 'g')) = 11
          and left(regexp_replace(appointment.client_phone, '[^0-9]', '', 'g'), 1) = '1'
        then substring(regexp_replace(appointment.client_phone, '[^0-9]', '', 'g') from 2)
        else regexp_replace(appointment.client_phone, '[^0-9]', '', 'g')
      end in (
        ${sql.join(phoneValues.map(phone => sql`${phone}`), sql`, `)}
      )
    `);
  }
  if (emailValues.length > 0) {
    fallbackConditions.push(sql`
      lower(appointment.client_email) in (
        ${sql.join(emailValues.map(email => sql`${email}`), sql`, `)}
      )
    `);
  }
  const legacyFallback = fallbackConditions.length > 0
    ? sql`
      (
        appointment.salon_client_id is null
        and (${sql.join(fallbackConditions, sql` or `)})
      )
    `
    : sql`false`;
  const excluded = args.excludeAppointmentId?.trim() || null;

  const result = await handle.execute(sql`
    select
      appointment.id,
      appointment.salon_id,
      appointment.salon_client_id,
      appointment.client_phone,
      appointment.client_email,
      appointment.status,
      appointment.start_time,
      appointment.end_time
    from appointment
    where appointment.salon_id = ${args.salonId}
      and appointment.status in ('pending', 'confirmed', 'in_progress')
      and appointment.deleted_at is null
      and (
        appointment.salon_client_id in (
          ${sql.join(identity.clientIds.map(id => sql`${id}`), sql`, `)}
        )
        or ${legacyFallback}
      )
      and (
        ${args.horizon === 'booking-gate'
          ? sql`appointment.start_time >= ${now}`
          : args.horizon === 'recovery'
            ? sql`appointment.end_time > ${now}`
            : sql`true`}
      )
      and (${excluded}::text is null or appointment.id <> ${excluded})
    order by appointment.start_time, appointment.id
    limit 25
  `);

  return resultRows(result).map(row => ({
    id: String(row.id),
    salonId: String(row.salon_id),
    salonClientId: typeof row.salon_client_id === 'string'
      ? row.salon_client_id
      : null,
    clientPhone: String(row.client_phone),
    clientEmail: typeof row.client_email === 'string' ? row.client_email : null,
    status: String(row.status),
    startTime: dateFromRow(row.start_time),
    endTime: dateFromRow(row.end_time),
  })) as CanonicalActiveAppointment[];
}

export function getActiveAppointmentsForCanonicalClient(args: {
  salonId: string;
  terminalClientId: string;
  horizon: ActiveAppointmentHorizon;
  now?: Date;
  excludeAppointmentId?: string | null;
  allowArchived?: boolean;
}): Promise<CanonicalActiveAppointment[]> {
  return getActiveAppointmentsForCanonicalClientWithHandle(
    db as LifecycleSqlHandle,
    args,
  );
}

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
          : horizon === 'recovery'
            ? gt(appointmentSchema.endTime, now)
            : sql`true`,
        isNull(appointmentSchema.deletedAt),
        or(...identityConditions),
      ),
    )
    .orderBy(asc(appointmentSchema.startTime))
    .limit(10);
}
