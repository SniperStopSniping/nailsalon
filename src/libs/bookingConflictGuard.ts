import 'server-only';

import { and, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import { appointmentSchema } from '@/models/Schema';

/**
 * Appointment statuses that occupy a technician's time. Must stay in sync with
 * the partial-index predicate in migrations/0054_prevent_double_booking.sql.
 */
export const BLOCKING_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'in_progress'] as const;

export class SlotConflictError extends Error {
  constructor() {
    super('SLOT_CONFLICT');
    this.name = 'SlotConflictError';
  }
}

type ConflictGuardTx = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
  select: typeof import('@/libs/DB').db.select;
};

/**
 * Serializes booking writes per technician and re-validates the requested
 * window against committed appointments, inside the booking transaction.
 *
 * The advisory lock is transaction-scoped: a concurrent booking for the same
 * technician waits here until this transaction commits, then re-checks against
 * the fresh snapshot and sees the newly committed appointment.
 *
 * The conflict window mirrors `hasBufferedConflict` in bookingPolicy.ts:
 * an existing appointment blocks [start_time, start_time + blocked minutes)
 * where blocked minutes falls back to the visible duration plus buffer.
 */
export async function lockTechnicianAndAssertSlotFree(
  tx: ConflictGuardTx,
  args: {
    salonId: string;
    technicianId: string;
    startTime: Date;
    blockedEndTime: Date;
    excludedAppointmentId?: string | null;
  },
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${args.salonId}), hashtext(${args.technicianId}))`,
  );

  const conditions = [
    eq(appointmentSchema.salonId, args.salonId),
    eq(appointmentSchema.technicianId, args.technicianId),
    inArray(appointmentSchema.status, [...BLOCKING_APPOINTMENT_STATUSES]),
    isNull(appointmentSchema.deletedAt),
    lt(appointmentSchema.startTime, args.blockedEndTime),
    sql`GREATEST(
      ${appointmentSchema.endTime},
      ${appointmentSchema.startTime} + make_interval(mins => COALESCE(
        ${appointmentSchema.blockedDurationMinutes},
        ${appointmentSchema.totalDurationMinutes} + COALESCE(${appointmentSchema.bufferMinutes}, 0)
      ))
    ) > ${args.startTime}`,
  ];

  if (args.excludedAppointmentId) {
    conditions.push(ne(appointmentSchema.id, args.excludedAppointmentId));
  }

  const [conflict] = await tx
    .select({ id: appointmentSchema.id })
    .from(appointmentSchema)
    .where(and(...conditions))
    .limit(1);

  if (conflict) {
    throw new SlotConflictError();
  }
}

const SLOT_CONSTRAINT_NAMES = [
  'appointment_tech_active_slot_unique',
  'appointment_tech_active_no_overlap',
];

/**
 * True when an insert was rejected by the double-booking unique index (23505)
 * or exclusion constraint (23P01) from migration 0054 — i.e. a concurrent
 * booking won the slot between our recheck and the insert.
 */
export function isSlotConstraintViolation(error: unknown): boolean {
  const candidates: unknown[] = [error];
  if (error instanceof Error && error.cause) {
    candidates.push(error.cause);
  }

  return candidates.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const { code, constraint, message } = candidate as {
      code?: string;
      constraint?: string;
      message?: string;
    };
    if (code !== '23505' && code !== '23P01') {
      return false;
    }
    if (constraint) {
      return SLOT_CONSTRAINT_NAMES.includes(constraint);
    }
    return SLOT_CONSTRAINT_NAMES.some(name => message?.includes(name) ?? false);
  });
}
