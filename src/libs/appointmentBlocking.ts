import 'server-only';

import { and, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm';

import { appointmentSchema } from '@/models/Schema';

/**
 * Luster L1 PR4 — the ONE semantic owner of "does this appointment occupy a
 * technician's slot right now?"
 *
 * Before this module, that question was answered independently at three call
 * sites (`bookingConflictGuard.ts`, `bookingPolicy.ts`, and a SmartFit
 * re-check inside `route.ts`), all agreeing on a STATUS-ONLY predicate:
 * `status IN ('pending', 'confirmed', 'in_progress', 'awaiting_payment')`.
 * That predicate has always been correct because `appointment.request_expires_at`
 * (migration 0072) has never been written by any production code — every
 * `'pending'` row in this database has a NULL `request_expires_at`, so
 * "status is 'pending'" and "status is 'pending' AND has no (or an unexpired)
 * expiry" have always meant exactly the same thing.
 *
 * L1's request-approval flow (dark behind `catalog.bookingModesV1`, see
 * `catalogResolver.server.ts` / `confirmationMode.ts`) is the first thing
 * that can ever populate `request_expires_at`. Once it does, the old
 * status-only predicate stops being correct: an EXPIRED explicit-pending
 * request must stop blocking the slot IMMEDIATELY — availability correctness
 * must never depend on a sweep job's timing (there is no sweep job; PR5 owns
 * expiry finalization, and this module deliberately does not implement it).
 *
 * THE PREDICATE (both forms below MUST agree — see the differential
 * integration test in `appointmentBlocking.test.ts`):
 *
 *   status IN ('confirmed', 'in_progress', 'awaiting_payment')
 *   OR (status = 'pending' AND (request_expires_at IS NULL OR request_expires_at > :now))
 *
 * - `confirmed` / `in_progress` always block (unconditional today, unchanged).
 * - `awaiting_payment` always blocks (a deposit hold IS the appointment row —
 *   D-track behaviour, untouched by L1).
 * - A LEGACY `pending` row (`request_expires_at IS NULL`) blocks
 *   INDEFINITELY — exactly today's behaviour, preserved byte-for-byte.
 * - An EXPLICIT `pending` row (a real `request_expires_at`) blocks only
 *   BEFORE that instant; at or after it, it stops blocking immediately.
 *
 * `now` must be the SAME transaction-stable instant used for every other
 * time-sensitive decision in one write (never a fresh `Date.now()` read a
 * second time mid-transaction) — callers own sourcing that value; this
 * module only consumes it.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT COVER: `ACTIVE_APPOINTMENT_STATUSES`
 * / `SLOT_OCCUPYING_CLIENT_STATUSES` (`activeAppointments.ts`) answer a
 * DIFFERENT question — "does this appointment occupy the CLIENT" (the
 * duplicate-booking gate) — and are intentionally out of scope here; see that
 * file's own module doc comment.
 */

/**
 * Statuses that occupy a technician's slot, independent of any other
 * appointment field. Mirrors the migrations' double-booking backstops
 * (originally 0054, widened for deposit holds by 0066) — see
 * `bookingBlockingStatuses.test.ts`, which machine-checks this exact array
 * (re-exported, unchanged in shape and name, from `bookingConflictGuard.ts`
 * for backward compatibility) against the live migration predicate.
 *
 * `'pending'` is included here for that DDL-parity check (the database's own
 * backstop is still status-only — see the module doc comment on
 * `blockingAppointmentCondition` for why that is a deliberate, currently
 * harmless gap, not an oversight), but every APPLICATION-level consumer in
 * this module treats `'pending'` conditionally, never via a bare membership
 * test against this array. Use `isAppointmentBlockingSlot` /
 * `blockingAppointmentCondition` instead of testing membership in this array
 * directly.
 */
export const BLOCKING_APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'in_progress',
  'awaiting_payment',
] as const;

/** `BLOCKING_APPOINTMENT_STATUSES` minus `'pending'` — the statuses that block with no further condition. */
const UNCONDITIONALLY_BLOCKING_STATUSES = BLOCKING_APPOINTMENT_STATUSES
  .filter((status): status is Exclude<typeof BLOCKING_APPOINTMENT_STATUSES[number], 'pending'> => status !== 'pending');

/**
 * Pure predicate form — "is an EXPLICIT-OR-LEGACY pending row still
 * blocking, as of `now`?" `requestExpiresAt` accepts a string too because a
 * row read back from Postgres over a raw `sql` tag, or serialized through
 * JSON, may arrive as an ISO string rather than a `Date` instance.
 */
export function isPendingRequestBlocking(
  requestExpiresAt: Date | string | null,
  now: Date,
): boolean {
  if (requestExpiresAt === null) {
    // Legacy pending: no expiry was ever recorded. Blocks indefinitely —
    // exactly today's behaviour.
    return true;
  }
  const expiresAtMs = requestExpiresAt instanceof Date
    ? requestExpiresAt.getTime()
    : new Date(requestExpiresAt).getTime();
  // Strict `>`: AT or AFTER the deadline, the request has lapsed and stops
  // blocking immediately. This is the one place "expired" is defined; every
  // other check in this module and its callers must agree with it.
  return expiresAtMs > now.getTime();
}

/**
 * Pure, in-memory predicate over one appointment-shaped value — for a caller
 * that already has rows in hand (e.g. a pre-fetched day's appointments) and
 * needs to ask "does THIS one block, right now?" without a second query.
 */
export function isAppointmentBlockingSlot(
  appointment: { status: string; requestExpiresAt: Date | string | null },
  now: Date,
): boolean {
  if ((UNCONDITIONALLY_BLOCKING_STATUSES as readonly string[]).includes(appointment.status)) {
    return true;
  }
  if (appointment.status !== 'pending') {
    return false;
  }
  return isPendingRequestBlocking(appointment.requestExpiresAt, now);
}

/**
 * SQL form — the SAME semantics as `isAppointmentBlockingSlot`, as a
 * drizzle `SQL` fragment for a WHERE clause, so a DB-side query and an
 * in-memory check can never diverge (proven by the differential integration
 * test in `appointmentBlocking.test.ts`).
 *
 * `now` is bound as a query PARAMETER, never `now()` / `CURRENT_TIMESTAMP` —
 * it must be the caller's own transaction-stable instant, not a fresh
 * database-side read that could disagree with an application-level check
 * running the same instant through `isAppointmentBlockingSlot`.
 *
 * KNOWN, DELIBERATE GAP — UPDATED, now materially relevant: the migrations'
 * own double-booking backstops (the `appointment_tech_active_slot_unique`
 * partial index and the `appointment_tech_active_no_overlap` exclusion
 * constraint) remain STATUS-ONLY — widening either to also consider
 * `request_expires_at` would require a migration, out of scope for this PR
 * (no schema change). This gap was harmless when it was first documented,
 * because at that point nothing anywhere wrote a non-NULL
 * `request_expires_at`. That has CHANGED: `resolveExplicitRequestApprovalActivation`
 * (`requestApprovalReconciliation.server.ts`), wired into `route.ts`, now
 * WRITES a real `request_expires_at` for a new booking whose service is
 * explicitly `confirmation_mode = 'request_approval'` AND whose salon has
 * the dark `catalog.*` L1 feature key on — still unreachable for any real
 * salon today (same two gates as everywhere else in L1), but no longer
 * hypothetical the moment a fixture/test salon (or, eventually, a real one)
 * turns that gate on.
 *
 * From that point on, the DB backstop is a STRICTER-than-application-logic
 * safety net, not an unsafe one: once an explicit `'pending'` request's
 * `request_expires_at` passes, THIS module's predicate stops blocking it
 * immediately (by design — see the module doc comment), but the STATUS-ONLY
 * unique index / exclusion constraint still sees a `'pending'` row occupying
 * the slot and will reject a legitimate re-book into it with a 23505/23P01
 * (surfaced today as `SlotConflictError` / `TIME_CONFLICT`) until that row's
 * status changes away from `'pending'` some other way. That is a
 * false-conflict / availability-correctness gap, not a double-booking risk
 * — the row order stays the reverse of unsafe. Widening the two backstops
 * to also honor `request_expires_at` (a migration) is the explicitly
 * deferred follow-up; this PR does not implement PR5's expiry
 * finalization/sweep either, so no code path clears a lapsed request's
 * status yet regardless.
 */
export function blockingAppointmentCondition(now: Date): SQL {
  return or(
    inArray(appointmentSchema.status, [...UNCONDITIONALLY_BLOCKING_STATUSES]),
    and(
      eq(appointmentSchema.status, 'pending'),
      or(
        isNull(appointmentSchema.requestExpiresAt),
        gt(appointmentSchema.requestExpiresAt, now),
      ),
    ),
  )!;
}
