import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, eq } from 'drizzle-orm';

import {
  getActiveAppointmentsForCanonicalClientWithHandle,
} from '@/libs/activeAppointments';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  isSlotConstraintViolation,
  lockTechnicianAndAssertSlotFree,
} from '@/libs/bookingConflictGuard';
import {
  lockOperationalSalonClientContactWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import {
  appointmentAuditLogSchema,
  appointmentDepositSchema,
  appointmentSchema,
  salonSchema,
} from '@/models/Schema';

import { enqueueDepositConfirmationEffectsInTx } from './confirmDepositPayment';
import {
  type DepositRow,
  type RecoveryResult,
  runRefundCore,
} from './depositRefund';
import { depositsTransaction } from './depositsTransaction';

export {
  buildRefundIdempotencyKey,
  DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
  type DepositRow,
  deriveRefundIntentIdentity,
  type RecoveryDisposition,
  type RecoveryResult,
  type RefundTrigger,
  resolveAllowedSourceStatuses,
} from './depositRefund';

/**
 * ROUTINE B — what happens when a deposit payment arrives after the hold is gone.
 *
 * Two outcomes and no third: RESTORE the booking if the reaper released it and
 * the slot is still free, or REFUND in full. Money always gets exactly one
 * arrow (invariant I7), and the one thing that is never allowed is a captured
 * payment with neither a booking nor a refund attached to it.
 *
 * EVERY DECISION BRANCHES ON A FRESH DEPOSIT READ, never on the status the
 * caller observed. The caller's read happened before a transaction it does not
 * own committed; acting on it is how a paid deposit gets refunded.
 */

/**
 * The one recovery no-op that intentionally remains owned by the sweep.
 *
 * Other `noop` notes describe terminal/idempotent observations. Widening this
 * predicate to every noop would keep already-refunded or vanished work alive
 * forever; omitting this exact note permanently consumes the only retry driver
 * while an asynchronously-settling Session still has no PaymentIntent.
 */
export function isSweepRetryableRecoveryResult(result: RecoveryResult): boolean {
  return result.disposition === 'noop' && result.note === 'payment_intent_unresolved';
}

// ROUTINE B
// =============================================================================

export async function runLateDepositRecovery(args: {
  depositId: string;
  salonId: string;
}): Promise<RecoveryResult> {
  // FRESH read. The caller observed this deposit before a transaction it does
  // not own may have committed.
  const deposit = await readDeposit(args);

  if (!deposit) {
    return { disposition: 'noop', depositId: args.depositId, note: 'deposit_absent' };
  }

  switch (deposit.status) {
    case 'paid':
      // Somebody confirmed it while we were deciding. NEVER refund from here.
      return { disposition: 'already_confirmed', depositId: deposit.id };

    case 'refunded':
      return { disposition: 'noop', depositId: deposit.id, note: 'already_refunded' };

    case 'expired':
      // The reaper released it. Restore is possible; refund is the fallback.
      return attemptRestoreThenRefund(deposit);

    case 'waived':
      // Never a silent no-op. The owner waived the requirement and the client
      // paid anyway, so the money must go back — and it gets the WAIVER copy,
      // because the fixed "your time is gone" wording is false here.
      Sentry.captureMessage('deposit_waived_with_payment', {
        level: 'error',
        tags: { deposits: 'recovery' },
        extra: { depositId: deposit.id },
      });
      return runRefundCore(deposit, 'waiver');

    case 'canceled':
    case 'checkout_created':
      // `canceled` is D4's compensating cancel — under D4 no session exists for
      // these, so this arm is defence in depth. `checkout_created` behind a
      // cancelled appointment is drift, and drift with money in it gets a warn.
      if (deposit.status === 'checkout_created') {
        Sentry.captureMessage('deposit_checkout_created_behind_cancelled_appointment', {
          level: 'warning',
          tags: { deposits: 'recovery' },
          extra: { depositId: deposit.id },
        });
      }
      return runRefundCore(deposit, 'slot_lost');

    default:
      return { disposition: 'noop', depositId: deposit.id, note: `unknown_status:${deposit.status}` };
  }
}

async function readDeposit(args: { depositId: string; salonId: string }): Promise<DepositRow | null> {
  const [row] = await db
    .select()
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.id, args.depositId),
      eq(appointmentDepositSchema.salonId, args.salonId),
    ))
    .limit(1);
  return row ?? null;
}

// =============================================================================
// TX-C — RESTORE
// =============================================================================

async function attemptRestoreThenRefund(deposit: DepositRow): Promise<RecoveryResult> {
  const [appointment] = await db
    .select()
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.id, deposit.appointmentId),
      eq(appointmentSchema.salonId, deposit.salonId),
    ))
    .limit(1);

  // ONLY a reaper-released row is restorable. An owner who reactivated a hold
  // and then cancelled it deliberately must not have that cancel overridden by
  // a late payment.
  const restorable = Boolean(
    appointment
    && appointment.status === 'cancelled'
    && appointment.cancelReason === 'deposit_not_paid'
    && appointment.startTime.getTime() > Date.now(),
  );

  if (!restorable) {
    return runRefundCore(deposit, 'slot_lost');
  }

  try {
    const restored = await restoreReleasedHold(deposit);
    if (restored) {
      return { disposition: 'restored', depositId: deposit.id };
    }
  } catch (error) {
    // Two ways the booking can fail to come back, and both mean refund:
    // somebody took the slot (the advisory-lock guard, the 0054-successor
    // partial unique, or the gist exclusion), or the one-active partial unique
    // fired because a second deposit already claims this appointment.
    if (!isSlotConstraintViolation(error) && !(error instanceof RestoreLostError)) {
      throw error;
    }
  }

  // RE-DISPATCH ON A FRESH STATUS after any TX-C failure. If a concurrent
  // confirm won in the meantime, refunding here would take back money for a
  // booking that now exists.
  const fresh = await readDeposit({ depositId: deposit.id, salonId: deposit.salonId });
  if (fresh?.status === 'paid') {
    return { disposition: 'already_confirmed', depositId: deposit.id };
  }
  if (fresh?.status === 'refunded') {
    return { disposition: 'noop', depositId: deposit.id, note: 'already_refunded' };
  }

  return runRefundCore(fresh ?? deposit, 'slot_lost');
}

/**
 * TX-C. The FULL activation-writer stack, in the order the repo's own
 * reactivation writer documents: terminal-client lock → technician advisory
 * lock and slot recheck → appointment row lock → drift re-verification →
 * lineage gate → the two CASes.
 *
 * The client lock is part of the order, not an optional extra: the lineage gate
 * below is a plain SELECT with no locking clause, so it is only safe underneath
 * it. Dropping the client lock is what lets a concurrent booking for the same
 * client produce two active rows.
 */
async function restoreReleasedHold(deposit: DepositRow): Promise<boolean> {
  return withClientLifecycleTransactionRetry(async () =>
    depositsTransaction(db, async (tx) => {
      const [salon] = await tx
        .select({ freeSoloEnabled: salonSchema.freeSoloEnabled })
        .from(salonSchema)
        .where(eq(salonSchema.id, deposit.salonId))
        .limit(1);
      const target = salon?.freeSoloEnabled ? 'confirmed' : 'pending';

      const [preview] = await tx
        .select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, deposit.appointmentId),
          eq(appointmentSchema.salonId, deposit.salonId),
        ))
        .limit(1);

      if (!preview) {
        return false;
      }

      // The terminal client, resolved exactly as the repo's reactivation writer
      // resolves it: the linked id when there is one, else the canonical
      // identity for the phone/email on the row. This lock is not optional —
      // the lineage gate below is a plain SELECT with no locking clause and is
      // safe ONLY underneath it.
      const terminalClient = await resolveTerminalClient(tx, preview, deposit.salonId);

      if (!terminalClient) {
        // No canonical client to lock means the lineage gate cannot be made
        // safe, so the booking does not come back. Refunding is the correct
        // direction: it returns the money rather than risking two active rows.
        return false;
      }

      if (preview.technicianId) {
        const blockedDurationMinutes = preview.blockedDurationMinutes
          ?? (preview.totalDurationMinutes + (preview.bufferMinutes ?? 0));
        const blockedEndTime = new Date(Math.max(
          preview.endTime.getTime(),
          preview.startTime.getTime() + blockedDurationMinutes * 60_000,
        ));
        await lockTechnicianAndAssertSlotFree(tx, {
          salonId: deposit.salonId,
          technicianId: preview.technicianId,
          startTime: preview.startTime,
          blockedEndTime,
          excludedAppointmentId: preview.id,
        });
      }

      const [locked] = await tx
        .select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, deposit.appointmentId),
          eq(appointmentSchema.salonId, deposit.salonId),
        ))
        .for('update')
        .limit(1);

      if (!locked) {
        return false;
      }

      // The advisory lock was taken against values read BEFORE it. If any of
      // them moved, the lock protected the wrong slot — restart rather than
      // trust it.
      const drifted = locked.technicianId !== preview.technicianId
        || locked.startTime.getTime() !== preview.startTime.getTime()
        || locked.endTime.getTime() !== preview.endTime.getTime();

      if (drifted || locked.status !== 'cancelled' || locked.cancelReason !== 'deposit_not_paid') {
        return false;
      }

      // The lineage gate — a plain SELECT, safe only under the client lock
      // taken above.
      const active = await getActiveAppointmentsForCanonicalClientWithHandle(tx, {
        salonId: deposit.salonId,
        terminalClientId: terminalClient.id,
        horizon: 'lineage-active',
        excludeAppointmentId: locked.id,
        allowArchived: true,
      });

      if (active.length > 0) {
        return false;
      }

      const movedAppointment = await tx
        .update(appointmentSchema)
        .set({
          status: target,
          cancelReason: null,
          canvasState: 'waiting',
          canvasStateUpdatedAt: new Date(),
          depositHoldExpiresAt: null,
          updatedAt: new Date(Math.max(
            Date.now(),
            locked.updatedAt.getTime() + 1,
          )),
        })
        .where(and(
          eq(appointmentSchema.id, locked.id),
          eq(appointmentSchema.salonId, deposit.salonId),
          eq(appointmentSchema.status, 'cancelled'),
        ))
        .returning();

      if (movedAppointment.length === 0) {
        return false;
      }

      const paidDeposit = await tx
        .update(appointmentDepositSchema)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(and(
          eq(appointmentDepositSchema.id, deposit.id),
          eq(appointmentDepositSchema.salonId, deposit.salonId),
          eq(appointmentDepositSchema.status, 'expired'),
        ))
        .returning();

      if (paidDeposit.length === 0) {
        // The one-active partial unique may also have fired here. Either way,
        // rolling back and refunding is the safe direction.
        throw new RestoreLostError();
      }

      await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
        appointmentId: locked.id,
        salonId: deposit.salonId,
        action: 'payment_status_changed',
        performedBy: 'system:deposits',
        performedByRole: 'system',
        previousValue: { status: 'cancelled', depositStatus: 'expired' },
        newValue: { status: target, depositStatus: 'paid' },
        reason: 'deposit_hold_restored',
      }));

      // A successful late restore is a paid confirmation, not a special
      // side-effect-free booking. Enqueue the same durable batch as TX-B while
      // this transaction still owns the restored appointment/deposit pair.
      await enqueueDepositConfirmationEffectsInTx({
        tx,
        appointment: locked,
        deposit: paidDeposit[0]!,
        salonId: deposit.salonId,
        clientPhone: locked.clientPhone,
      });

      return true;
    }));
}

/**
 * The canonical client whose lineage the restore must not violate.
 *
 * Returns null when no canonical identity exists, which the caller treats as
 * "cannot restore" rather than as an error: a restore without this lock could
 * produce two active appointments for one client.
 */
async function resolveTerminalClient(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  appointment: { salonClientId: string | null; clientPhone: string; clientEmail: string | null },
  salonId: string,
) {
  if (appointment.salonClientId) {
    return lockOperationalSalonClientContactWithHandle(tx, {
      salonId,
      clientId: appointment.salonClientId,
      allowArchived: true,
    });
  }

  const identity = await resolveCanonicalSalonClientIdentityWithHandle(tx, {
    salonId,
    phone: appointment.clientPhone,
    email: appointment.clientEmail,
    allowArchived: true,
  }).catch(() => null);

  if (!identity) {
    return null;
  }

  return lockOperationalSalonClientContactWithHandle(tx, {
    salonId,
    clientId: identity.terminal.id,
    allowArchived: true,
  });
}

class RestoreLostError extends Error {
  constructor() {
    super('restore lost to a concurrent writer');
    this.name = 'RestoreLostError';
  }
}
