import type { TechnicianBookingDecision } from '@/libs/bookingPolicy';
import type { BookingSelectionErrorCode } from '@/libs/bookingQuote';

/**
 * A1-2 Piece 1 — the SINGLE vocabulary for "why can a day not be booked".
 *
 * Pure by construction: both imports are `import type`, so nothing in this
 * module survives to runtime except the two lookup tables below. It can be
 * imported from a server route, a server-only engine, or (in future) a client
 * surface without dragging the database or `server-only` along.
 *
 * The availability loop in `engine.server.ts` produces a few of these codes
 * itself (`min_notice`, `google_busy`); the rest are produced by the callers
 * that run the checks ABOVE the loop — salon status, entitlement, opening
 * hours, service validation, technician rosters and per-technician schedules.
 * Keeping every code in one union is what lets a caller report all of them in
 * one list without inventing its own strings.
 */
export type DiagnosisCode =
  | 'timezone_unsupported'
  | 'salon_not_public'
  | 'online_booking_off'
  | 'closed_that_day'
  | 'service_not_bookable'
  | 'no_active_technicians'
  | 'no_technician_offers_service'
  | 'technician_time_off'
  | 'technician_day_off'
  | 'service_unsupported'
  | 'outside_schedule'
  | 'location_unavailable'
  | 'blocked_slot'
  | 'time_conflict'
  | 'min_notice'
  | 'google_busy'
  | 'calendar_unverified'
  | 'none';

/**
 * The refusal half of `TechnicianBookingDecision`.
 *
 * NOT written as `TechnicianBookingDecision['reason']`: that union's success
 * member (`{ available: true; schedule }`) carries no `reason`, so the plain
 * indexed access does not type-check. `Extract` narrows to the refusal member
 * first, which is what the spec's shorthand means.
 */
export type TechnicianDecisionReason = Extract<
  TechnicianBookingDecision,
  { available: false }
>['reason'];

/**
 * Total by construction: `Record<TechnicianDecisionReason, …>` fails to
 * compile the moment `bookingPolicy.ts` grows a new refusal reason, and
 * `reasons.test.ts` re-checks the same thing at runtime by parsing the union
 * straight out of `bookingPolicy.ts`.
 */
export const TECHNICIAN_DECISION_DIAGNOSIS: Record<TechnicianDecisionReason, DiagnosisCode> = {
  time_off: 'technician_time_off',
  day_off: 'technician_day_off',
  outside_schedule: 'outside_schedule',
  time_conflict: 'time_conflict',
  blocked_slot: 'blocked_slot',
  service_unsupported: 'service_unsupported',
  location_unavailable: 'location_unavailable',
};

/**
 * Every `BookingSelectionError` the public selection validator can raise is
 * one thing to an owner asking "why can nobody book this?": the service, as
 * selected, is not bookable online. The specific code travels separately as
 * the cause's `detail`, which is typed as `BookingSelectionErrorCode` for
 * exactly this reason — so the vocabulary stays small without losing
 * precision, and a cause cannot carry free-form text.
 */
export const BOOKING_SELECTION_DIAGNOSIS: Record<BookingSelectionErrorCode, DiagnosisCode> = {
  invalid_service: 'service_not_bookable',
  unsupported_technician: 'service_not_bookable',
  invalid_add_on: 'service_not_bookable',
  missing_required_add_on: 'service_not_bookable',
};

export function diagnosisForTechnicianDecision(reason: TechnicianDecisionReason): DiagnosisCode {
  return TECHNICIAN_DECISION_DIAGNOSIS[reason];
}

export function diagnosisForBookingSelection(code: BookingSelectionErrorCode): DiagnosisCode {
  return BOOKING_SELECTION_DIAGNOSIS[code];
}
