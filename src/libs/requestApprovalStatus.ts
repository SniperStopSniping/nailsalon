import { isPendingRequestBlocking } from '@/libs/appointmentBlocking';
import type { Appointment } from '@/models/Schema';

/**
 * Luster L1 PR5 — the EFFECTIVE state of a request-approval booking.
 *
 * A `pending` row whose `request_expires_at` has already passed is, in every
 * way that matters, no longer an open request: `appointmentBlocking.ts` stops
 * it occupying the slot in real time, well before `approvalRequestSweeper.ts`
 * finalizes the row into `cancelled`. Anything reading the raw `status` column
 * during that gap would see an ordinary `'pending'` row and could wrongly
 * present it as still awaiting the salon's decision.
 *
 * This resolver closes that gap by computing the effective state through the
 * exact cutoff `appointmentBlocking.ts` uses (`isPendingRequestBlocking` —
 * strict `>`, so at/after the deadline the request has lapsed), which is why
 * `'expired'` reads identically whether the sweep has run yet or not.
 *
 * It lives here rather than in the route module it serves because a Next.js
 * route file may only export known Route fields (`GET`, `POST`, `dynamic`,
 * …). Exporting this helper from the route for testability compiled fine
 * under `tsc --noEmit` and failed only in `next build`, which type-checks
 * routes against its own generated constraints:
 *
 *   Type error: Route "…/request-status/route.ts" does not match the required
 *   types of a Next.js Route. "resolveEffectiveRequestApprovalStatus" is not a
 *   valid Route export field.
 */
export type EffectiveRequestApprovalStatus =
  | 'pending'
  | 'expired'
  | 'declined'
  | 'confirmed'
  | 'in_progress'
  | 'awaiting_payment'
  | 'completed'
  | 'no_show'
  | 'cancelled';

/** Pure — no I/O. `now` is the caller's instant, never re-derived here, so a test can pin it. */
export function resolveEffectiveRequestApprovalStatus(
  appointment: Pick<Appointment, 'status' | 'cancelReason' | 'requestExpiresAt'>,
  now: Date,
): EffectiveRequestApprovalStatus {
  if (appointment.status === 'pending') {
    return isPendingRequestBlocking(appointment.requestExpiresAt, now) ? 'pending' : 'expired';
  }
  if (appointment.status === 'cancelled') {
    if (appointment.cancelReason === 'declined_by_salon') {
      return 'declined';
    }
    if (appointment.cancelReason === 'request_expired') {
      return 'expired';
    }
    return 'cancelled';
  }
  return appointment.status as EffectiveRequestApprovalStatus;
}
