import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, eq, inArray, sql } from 'drizzle-orm';

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
import { enqueueDepositRefundNotices } from '@/libs/integrationOutbox';
import { stripe } from '@/libs/stripe';
import {
  appointmentAuditLogSchema,
  appointmentDepositSchema,
  appointmentSchema,
  salonSchema,
  stripeWebhookEventSchema,
} from '@/models/Schema';

import { depositsTransaction } from './depositsTransaction';

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
 * THE EXPLICIT PER-CALL TIMEOUT (verify item (n)).
 *
 * The SHARED Stripe client at `src/libs/stripe.ts` deliberately sets none —
 * that is an unsigned owner decision recorded in that file, and it is D2-owned
 * and shared with SaaS billing, so this packet must not add one there. Without
 * a bound the reconcile sweep's budget arithmetic
 * `(batch × stripe_timeout) < maxDuration` has no finite term and the sweep is
 * limited only by the platform function timeout. Every Stripe call D5 makes
 * therefore carries this value explicitly.
 */
export const DEPOSIT_STRIPE_CALL_TIMEOUT_MS = 10_000;

export type RefundTrigger = 'system' | 'owner' | 'external';

export type DepositRow = typeof appointmentDepositSchema.$inferSelect;

export type RecoveryDisposition
  = | 'restored'
  | 'refunded'
  | 'already_confirmed'
  | 'already_confirmed_late_refund'
  | 'refund_failed_unreconciled'
  | 'orphan_unresolved'
  | 'noop';

export type RecoveryResult = {
  disposition: RecoveryDisposition;
  depositId: string;
  refundId?: string;
  note?: string;
};

// =============================================================================
// THE ENTRY SET — ONE PRODUCER
// =============================================================================

/**
 * The deposit statuses a refund may be entered from.
 *
 * ONE PRODUCER for two consumers: the step-0 entry gate and TX-D's CAS
 * predicate. Writing the list as a literal in either place is how they drift,
 * and a drift here means the gate admits a refund that the CAS then refuses —
 * money left with no arrow and a sweep that re-drives forever.
 *
 * TOTAL BY CONSTRUCTION: an exhaustive `switch` over `refund_trigger` with a
 * `never` check and NO widening default.
 *
 * WHY THE STATUS DISJUNCTS AND NOT A TRIGGER SWITCH ALONE:
 * `refund_trigger='external'` is written on every adopted salon-Dashboard
 * refund, and those rows carry `status='refunded'`. An `otherwise` arm handing
 * back the system four rejects them, the sweep re-drives forever, and an
 * owner's Retry becomes a no-op with zero provider calls.
 *
 * `'waived'` MUST stay in the default set and in TX-D's CAS, or the waived-plus-
 * paid branch loops back to the top forever and its promised refund never runs.
 *
 * `refund_trigger` is a later packet's column, so the field is absent today and
 * only the status disjuncts fire. Typing it optional keeps that packet's arm
 * purely additive.
 */
export function resolveAllowedSourceStatuses(deposit: {
  status: string;
  refundTrigger?: RefundTrigger;
}): string[] {
  const trigger: RefundTrigger = deposit.refundTrigger ?? 'system';

  if (deposit.status === 'paid' || deposit.status === 'refunded') {
    return ['paid', 'refunded'];
  }

  switch (trigger) {
    case 'owner':
      return ['paid', 'refunded'];
    case 'system':
    case 'external':
      return ['expired', 'canceled', 'checkout_created', 'waived'];
    default: {
      const exhaustive: never = trigger;
      throw new Error(`unhandled refund trigger: ${String(exhaustive)}`);
    }
  }
}

/**
 * THE SINGLE PRODUCER of the refund-intent type literal and its `event_id`.
 *
 * The unique `event_id` IS the dedupe, so one literal spelled at two call sites
 * is two dedupe namespaces and two concurrent refunds. Nothing anywhere may
 * hand-write `'luster.refund_intent'` or `'luster.owner_refund_intent'`.
 */
export function deriveRefundIntentIdentity(
  trigger: RefundTrigger,
  depositId: string,
  epoch: number,
): { type: 'luster.refund_intent' | 'luster.owner_refund_intent'; eventId: string } {
  const type = trigger === 'owner' ? 'luster.owner_refund_intent' : 'luster.refund_intent';
  return { type, eventId: `luster:${type}:${depositId}:e${epoch}` };
}

/**
 * The refund idempotency key, from PERSISTED COLUMNS ONLY.
 *
 * BOTH variable components are read from `appointment_deposit`, NEVER counted
 * from a `refunds.list` result: a listing is paginated and lossy, so two
 * attempts that observe different pages mint different keys and Stripe issues
 * two refunds. With `refund_key_epoch` defaulting to 1, a first attempt's key
 * is byte-identical to the pre-amendment form, so nothing breaks across the
 * deploy that introduces the epoch.
 *
 * The epoch exists because Stripe saves and REPLAYS errors — including 500s —
 * for at least 24 hours against one key. With a constant `v1` every retry
 * receives the saved 500 and the deposit is wedged with no operator escape.
 * D5 READS the epoch and never increments it.
 */
export function buildRefundIdempotencyKey(deposit: {
  id: string;
  refundKeyEpoch: number;
  refundTerminalFailureCount: number;
}): string {
  return `deposit:${deposit.id}:auto-refund:v${deposit.refundKeyEpoch}:${deposit.refundTerminalFailureCount}`;
}

/** Refund states that discharge a deposit. `failed`/`canceled` are corpses. */
const LIVE_REFUND_STATUSES = new Set(['pending', 'succeeded', 'requires_action']);

// =============================================================================
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
          updatedAt: new Date(),
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

// =============================================================================
// THE REFUND CORE
// =============================================================================

/**
 * Full refund of a deposit whose booking cannot be honoured.
 *
 * PARAMETERISED AND COLUMN-WRITING here so a later packet can MOVE it without
 * changing behaviour. The literal defaults keep every current caller
 * byte-identical.
 *
 * NEVER REACHABLE WITHOUT A RESOLVED DEPOSIT ROW (S15). Provenance admits an
 * event for processing; only a row Luster owns authorizes an outflow. That is
 * why this function takes a `DepositRow` and not an id or a session.
 */
export async function runRefundCore(
  deposit: DepositRow,
  variant: 'slot_lost' | 'waiver',
  options: { trigger?: RefundTrigger } = {},
): Promise<RecoveryResult> {
  const trigger = options.trigger ?? 'system';
  const allowedSourceStatuses = resolveAllowedSourceStatuses({
    status: deposit.status,
    refundTrigger: trigger,
  });

  // (0) ENTRY GATE, from the shared producer.
  if (!allowedSourceStatuses.includes(deposit.status)) {
    return { disposition: 'noop', depositId: deposit.id, note: `outside_entry_set:${deposit.status}` };
  }

  // (0b) WRITE-AHEAD INTENT ROW, before ANY provider call. Without it a crash
  // between `refunds.create` and TX-D leaves a live refund with nothing local
  // pointing at it, and no sweep able to find it.
  const identity = deriveRefundIntentIdentity(trigger, deposit.id, deposit.refundKeyEpoch);
  await db
    .insert(stripeWebhookEventSchema)
    .values({
      id: `swe_${crypto.randomUUID()}`,
      eventId: identity.eventId,
      type: identity.type,
      account: deposit.stripeAccountId,
      livemode: false,
      salonId: deposit.salonId,
      status: 'processing',
      attempts: 1,
      sessionId: deposit.stripeCheckoutSessionId,
      metadataDepositId: deposit.id,
      projectionStatus: 'ok',
    })
    .onConflictDoNothing({ target: stripeWebhookEventSchema.eventId });

  // (0c) The system-intent CAS on `refund_status` is NOT implementable at D5:
  // that column belongs to a later packet and is not in 0065, and this packet
  // ships no migration for columns 0065 was not asked to carry. The write-ahead
  // row above is the finder in the meantime.

  const stripeAccount = requireSnapshotAccount(deposit);
  let corpsesObserved = 0;

  // (1) A STORED refund id is adopted ONLY if it still passes step 3's filter.
  // Unconditional adoption is a permanent trap: a refund that reached `failed`
  // discharges nothing, and re-adopting it every run means the money never goes
  // back and nothing ever escalates.
  if (deposit.stripeRefundId) {
    const stored = await retrieveRefund(deposit.stripeRefundId, stripeAccount);
    if (stored && isAdoptableRefund(stored, deposit)) {
      return finalizeRefund(deposit, stored.id, allowedSourceStatuses, variant);
    }
    corpsesObserved += 1;
  }

  // (2) Establish the payment intent.
  const paymentIntentId = deposit.stripePaymentIntentId
    ?? await retrieveSessionPaymentIntent(deposit, stripeAccount);

  if (!paymentIntentId) {
    // Nothing to refund against. Retryable by the sweep rather than terminal:
    // the session may simply not have settled yet.
    return { disposition: 'noop', depositId: deposit.id, note: 'payment_intent_unresolved' };
  }

  // (3) Adopt an existing LIVE refund of the FULL amount and currency. The
  // amount and currency legs are what stop a salon's own CA$5 goodwill refund
  // on the same payment intent from discharging a CA$25 deposit.
  const existing = await listRefunds(paymentIntentId, stripeAccount);
  const adoptable = existing.find(refund => isAdoptableRefund(refund, deposit));
  corpsesObserved += existing.filter(refund => isCorpse(refund)).length;

  if (adoptable) {
    return finalizeRefund(deposit, adoptable.id, allowedSourceStatuses, variant);
  }

  // (3b) PERSIST THE COUNT AS ITS OWN COMMITTED STATEMENT, before step 4 reads
  // it. `GREATEST` makes it monotone, so a re-run that sees a shorter listing
  // (pagination drops older refunds) cannot lower it and mint a key an earlier
  // attempt already used.
  const [counted] = await db
    .update(appointmentDepositSchema)
    .set({
      refundTerminalFailureCount: sql`GREATEST(${appointmentDepositSchema.refundTerminalFailureCount}, ${corpsesObserved})`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(appointmentDepositSchema.id, deposit.id),
      eq(appointmentDepositSchema.salonId, deposit.salonId),
    ))
    .returning();

  if (!counted) {
    return { disposition: 'noop', depositId: deposit.id, note: 'deposit_vanished' };
  }

  // (4) Create the refund. BOTH variable components of the key come from the
  // columns we just committed — never from the listing above.
  const idempotencyKey = buildRefundIdempotencyKey({
    id: counted.id,
    refundKeyEpoch: counted.refundKeyEpoch,
    refundTerminalFailureCount: counted.refundTerminalFailureCount,
  });

  let refundId: string;
  try {
    const created = await stripe.refunds.create(
      // No `amount`: full refund only.
      { payment_intent: paymentIntentId },
      { stripeAccount, idempotencyKey, timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS },
    );
    refundId = created.id;
  } catch (error) {
    if (isChargeAlreadyRefunded(error)) {
      // Re-list and adopt under the same filter. Somebody refunded it out of
      // band, and that discharges the deposit only if it is a full refund.
      const relisted = await listRefunds(paymentIntentId, stripeAccount);
      const adopted = relisted.find(refund => isAdoptableRefund(refund, deposit));
      if (adopted) {
        return finalizeRefund(counted, adopted.id, allowedSourceStatuses, variant);
      }
    }
    throw error;
  }

  return finalizeRefund(counted, refundId, allowedSourceStatuses, variant);
}

/**
 * TX-D. The status CAS consumes THE SAME resolved `allowedSourceStatuses` the
 * entry gate used — not a second literal list.
 */
async function finalizeRefund(
  deposit: DepositRow,
  refundId: string,
  allowedSourceStatuses: string[],
  variant: 'slot_lost' | 'waiver',
): Promise<RecoveryResult> {
  return depositsTransaction(db, async (tx) => {
    const updated = await tx
      .update(appointmentDepositSchema)
      .set({
        status: 'refunded',
        stripeRefundId: refundId,
        // COALESCE, not now(): a re-stamp must not overwrite the FIRST
        // settlement instant, which is the number a dispute is argued from.
        refundedAt: sql`COALESCE(${appointmentDepositSchema.refundedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(appointmentDepositSchema.id, deposit.id),
        eq(appointmentDepositSchema.salonId, deposit.salonId),
        inArray(appointmentDepositSchema.status, allowedSourceStatuses),
        sql`(${appointmentDepositSchema.stripeRefundId} IS NULL
          OR ${appointmentDepositSchema.stripeRefundId} = ${refundId})`,
      ))
      .returning();

    if (updated.length === 0) {
      const [fresh] = await tx
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.id, deposit.id),
          eq(appointmentDepositSchema.salonId, deposit.salonId),
        ))
        .limit(1);

      if (fresh?.stripeRefundId === refundId) {
        return { disposition: 'noop' as const, depositId: deposit.id, refundId, note: 'already_finalized' };
      }
      if (fresh?.stripeRefundId) {
        Sentry.captureMessage('deposit_refund_id_conflict', {
          level: 'error',
          tags: { deposits: 'refund' },
          extra: { depositId: deposit.id, storedRefundId: fresh.stripeRefundId, observedRefundId: refundId },
        });
        return { disposition: 'noop' as const, depositId: deposit.id, note: 'refund_id_conflict' };
      }
      if (fresh?.status === 'paid') {
        // A live refund exists against a deposit that has since confirmed. Both
        // halves are real; only a person can decide which one stands.
        Sentry.captureMessage('deposit_already_confirmed_late_refund', {
          level: 'error',
          tags: { deposits: 'refund' },
          extra: { depositId: deposit.id, refundId },
        });
        return { disposition: 'already_confirmed_late_refund' as const, depositId: deposit.id, refundId };
      }
      return { disposition: 'noop' as const, depositId: deposit.id, note: 'refund_cas_lost' };
    }

    await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
      appointmentId: deposit.appointmentId,
      salonId: deposit.salonId,
      action: 'payment_status_changed',
      performedBy: 'system:deposits',
      performedByRole: 'system',
      previousValue: { depositStatus: deposit.status },
      newValue: { depositStatus: 'refunded', stripeRefundId: refundId },
      reason: 'deposit_refunded',
    }));

    // IN-TX, not post-commit: a crash between the refund landing and the notice
    // being scheduled would return the client's money silently.
    await enqueueDepositRefundNotices(tx, {
      salonId: deposit.salonId,
      appointmentId: deposit.appointmentId,
      depositId: deposit.id,
      refundId,
      variant,
    });

    return { disposition: 'refunded' as const, depositId: deposit.id, refundId };
  });
}

// =============================================================================
// PROVIDER HELPERS — every one on the SNAPSHOT account, every one with a timeout
// =============================================================================

/**
 * The connected account a deposit's money lives on, from its SNAPSHOT.
 *
 * THROWS rather than returning undefined. A Stripe call with
 * `stripeAccount: undefined` executes on the PLATFORM account, which for a
 * refund means returning Luster's money instead of the salon's.
 */
function requireSnapshotAccount(deposit: DepositRow): string {
  if (!deposit.stripeAccountId) {
    throw new Error(`deposit ${deposit.id} has no connected-account snapshot`);
  }
  return deposit.stripeAccountId;
}

function isCorpse(refund: { status?: string | null }): boolean {
  return refund.status === 'failed' || refund.status === 'canceled';
}

function isAdoptableRefund(
  refund: { status?: string | null; amount?: number | null; currency?: string | null },
  deposit: DepositRow,
): boolean {
  return LIVE_REFUND_STATUSES.has(refund.status ?? '')
    && refund.amount === deposit.amountCents
    && refund.currency === deposit.currency;
}

async function retrieveRefund(refundId: string, stripeAccount: string) {
  try {
    return await stripe.refunds.retrieve(refundId, {
      stripeAccount,
      timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
}

async function listRefunds(paymentIntentId: string, stripeAccount: string) {
  const listed = await stripe.refunds.list(
    { payment_intent: paymentIntentId, limit: 100 },
    { stripeAccount, timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS },
  );
  return listed.data;
}

async function retrieveSessionPaymentIntent(
  deposit: DepositRow,
  stripeAccount: string,
): Promise<string | null> {
  if (!deposit.stripeCheckoutSessionId) {
    return null;
  }
  const session = await stripe.checkout.sessions.retrieve(
    deposit.stripeCheckoutSessionId,
    { stripeAccount, timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS },
  );
  const paymentIntent = session.payment_intent;
  if (typeof paymentIntent === 'string') {
    return paymentIntent;
  }
  return paymentIntent?.id ?? null;
}

function isChargeAlreadyRefunded(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: string }).code === 'charge_already_refunded',
  );
}
