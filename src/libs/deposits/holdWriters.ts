import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { appointmentDepositSchema, appointmentSchema } from '@/models/Schema';

import { depositsTransaction } from './depositsTransaction';

/**
 * THE MODULE BOUNDARY (invariant I3).
 *
 * Every writer that moves an appointment row OUT of 'awaiting_payment' lives in
 * `src/libs/deposits/**`, and each one is a status-guarded CAS inside a single
 * `db.transaction`. Nothing else in the codebase may write that transition:
 * `src/libs/bookingBlockingStatuses`-style drift is checked by a test that greps
 * for a CAS on 'awaiting_payment' anywhere under `src/` and asserts every hit is
 * inside this directory.
 *
 * The fence is a PATH, deliberately, not a count of writers — D6 lands
 * `waiveDeposit` and `releaseHold` here, and a count-based fence would reject
 * them at review time for being the fourth and fifth.
 *
 * Both writers below share one shape, and the shape is the point:
 *
 *   - ONE transaction containing BOTH statements. Two loose statements would let
 *     a crash between them leave a permanently non-terminal deposit row attached
 *     to a cancelled appointment that no sweep could ever find, because every
 *     eligibility scan keys on the APPOINTMENT status.
 *   - The appointment CAS runs FIRST and its row count is the arbiter. Zero rows
 *     means another writer (D5's confirm, an earlier reaper run) already won, so
 *     we roll back and do nothing rather than terminalise a deposit behind a
 *     booking that is now live.
 *   - The deposit CAS is guarded on 'checkout_created', so a deposit that has
 *     since become 'paid' is never overwritten.
 */

type HoldTransition = {
  appointmentId: string;
  salonId: string;
  depositId: string;
};

export type HoldWriteOutcome
  = | { applied: true }
  | { applied: false; reason: 'appointment_not_a_hold' };

/**
 * Release a hold whose Checkout Session was never created, or was created and
 * has now definitively failed. Used by the booking route's compensating cancel.
 */
export async function cancelHoldAfterDefiniteCheckoutFailure(
  args: HoldTransition,
): Promise<HoldWriteOutcome> {
  return applyHoldTransition({
    ...args,
    depositStatus: 'canceled',
    resolutionNote: null,
  });
}

/**
 * Finalise a hold that has lapsed. Used by the reaper.
 */
export async function finalizeExpiredHold(
  args: HoldTransition & { resolutionNote?: string | null },
): Promise<HoldWriteOutcome> {
  return applyHoldTransition({
    ...args,
    depositStatus: 'expired',
    resolutionNote: args.resolutionNote ?? null,
  });
}

async function applyHoldTransition(args: HoldTransition & {
  depositStatus: 'canceled' | 'expired';
  resolutionNote: string | null;
}): Promise<HoldWriteOutcome> {
  // Routed through the deposits seam rather than `db.transaction` directly: the
  // seam raises the in-transaction flag the instrumented Stripe mock reads, so
  // "no provider call while these two row locks are held" is machine-checked
  // here exactly as it is for D5's confirm and refund writers. Behaviour is
  // otherwise unchanged — the seam only wraps the callback.
  return depositsTransaction(db, async (tx) => {
    const [releasedAppointment] = await tx
      .update(appointmentSchema)
      .set({
        status: 'cancelled',
        cancelReason: 'deposit_not_paid',
        // Keep the staff-facing canvas column in lockstep with the legacy
        // status column, exactly as the cancel and transition routes do.
        canvasState: 'cancelled',
        canvasStateUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(appointmentSchema.id, args.appointmentId),
        eq(appointmentSchema.salonId, args.salonId),
        eq(appointmentSchema.status, 'awaiting_payment'),
      ))
      .returning();

    if (!releasedAppointment) {
      // Somebody else moved this row first. Roll back so the deposit statement
      // below cannot terminalise a deposit behind a now-live booking.
      return { applied: false, reason: 'appointment_not_a_hold' } as const;
    }

    const releasedDeposit = await tx
      .update(appointmentDepositSchema)
      .set({
        status: args.depositStatus,
        ...(args.resolutionNote === null ? {} : { resolutionNote: args.resolutionNote }),
        updatedAt: new Date(),
      })
      .where(and(
        eq(appointmentDepositSchema.id, args.depositId),
        eq(appointmentDepositSchema.salonId, args.salonId),
        eq(appointmentDepositSchema.status, 'checkout_created'),
      ))
      .returning();

    if (releasedDeposit.length !== 1) {
      // The appointment and deposit are one hold aggregate. A concurrent paid
      // transition that wins the deposit row must roll this appointment write
      // back, never leave a live payment behind a cancelled booking.
      throw new Error('DEPOSIT_HOLD_RELEASE_PAIR_TORN');
    }

    return { applied: true } as const;
  });
}
