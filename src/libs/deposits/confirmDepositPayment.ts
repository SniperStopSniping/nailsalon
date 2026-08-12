import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, desc, eq, sql } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { mintAppointmentManageCapability } from '@/libs/bookingCommitEffects';
import { db } from '@/libs/DB';
import { DEPOSIT_CURRENCY } from '@/libs/depositPolicy';
import { enqueueDepositConfirmationSideEffects } from '@/libs/integrationOutbox';
import type { AppointmentStatus } from '@/models/Schema';
import {
  appointmentAuditLogSchema,
  appointmentDepositSchema,
  appointmentSchema,
  communicationConsentSchema,
  salonSchema,
  salonStripeAccountSchema,
} from '@/models/Schema';

import { depositsTransaction } from './depositsTransaction';

/**
 * THE ONLY CODE PATH ALLOWED TO SET A DEPOSIT `paid` OR MOVE AN APPOINTMENT OUT
 * OF `awaiting_payment` (invariant I1).
 *
 * The webhook, the client's status poll and the reconcile sweep are three
 * DRIVERS of the same routine, not three implementations of it. That is the
 * whole design: every one of them arrives with the same normalized evidence
 * object, runs the same five gates, and lands in the same compare-and-set
 * transaction, so "who told us" changes nothing about what is written.
 *
 * WHAT COUNTS AS EVIDENCE (invariant I2): a signature-verified event payload,
 * its stored projection, or a server-side retrieval on the deposit's snapshot
 * account. A client's arrival on a redirect URL is not evidence — the
 * session-status endpoint's `session_id` selects WHICH deposit to reconcile and
 * asserts nothing about payment.
 */

// =============================================================================
// EVIDENCE
// =============================================================================

/**
 * WHERE THE CONNECTED ACCOUNT CAME FROM — carried in the TYPE, not in a comment.
 *
 * `'webhook'`      → `event.account` on the signature-verified delivery.
 * `'sweep_event'`  → the STORED `account` column of the event row being
 *                    re-dispatched. NOT the deposit snapshot: sourcing it from
 *                    the snapshot collapses the four-leg match into a
 *                    self-comparison, and an event from another account would
 *                    confirm this deposit.
 * `'poll'` /
 * `'sweep_deposit'`→ the deposit's own snapshot, because these are deposit-
 *                    driven and no event row exists to read an account from.
 *
 * A single `'sweep'` literal is forbidden: it makes the rule uncheckable and
 * leaves gate 3 leg (b) with nothing to discriminate.
 */
export type DepositEvidenceSource = 'webhook' | 'poll' | 'sweep_event' | 'sweep_deposit';

export type DepositEvidence = {
  source: DepositEvidenceSource;
  connectedAccountId: string;
  sessionId: string;
  paymentIntentId: string | null;
  paymentStatus: string | null;
  amountTotal: number | null;
  currency: string | null;
  metadataAppointmentId: string | null;
  metadataSalonId: string | null;
  metadataDepositId: string | null;
};

/**
 * What happened, in the vocabulary the event row records.
 *
 * `disposition` is the business outcome (the `outcome` column). `lifecycle`
 * tells the caller where the row belongs in the claim/retry state machine, so
 * no caller has to re-derive terminality from a disposition string.
 */
export type ConfirmDisposition
  = | 'confirmed'
  | 'already_confirmed'
  | 'healed_deposit'
  | 'healed_deposit_late'
  | 'unbound_account'
  | 'deferred_no_deposit'
  | 'account_mismatch'
  | 'held_mismatch'
  | 'held_duplicate_session'
  | 'ignored_unpaid'
  | 'late_recovery_required'
  | 'poisoned';

export type ConfirmResult = {
  disposition: ConfirmDisposition;
  /** Present once gate 2 resolved a row. Money never moves without one. */
  depositId?: string;
  salonId?: string;
  /** Set on `late_recovery_required`: the caller runs routine B OUTSIDE the tx. */
  appointmentId?: string;
  note?: string;
};

/** Terminal dispositions get the same literal in `status` and in `outcome`. */
export function isRetryableDisposition(disposition: ConfirmDisposition): boolean {
  return disposition === 'unbound_account' || disposition === 'deferred_no_deposit';
}

// =============================================================================
// THE ROUTINE
// =============================================================================

export async function confirmDepositPayment(evidence: DepositEvidence): Promise<ConfirmResult> {
  // --- GATE 1a. Binding rows for this account — LIVE AND REVOKED. -----------
  //
  // Fetched before the deposit because "no rows at all" and "rows, but none for
  // this deposit's salon" are different findings with different answers, and
  // only the first can be decided without the deposit.
  const bindings = await db
    .select({
      salonId: salonStripeAccountSchema.salonId,
      revokedAt: salonStripeAccountSchema.revokedAt,
      revocationCause: salonStripeAccountSchema.revocationCause,
    })
    .from(salonStripeAccountSchema)
    .where(eq(salonStripeAccountSchema.stripeAccountId, evidence.connectedAccountId));

  if (bindings.length === 0) {
    // A REAL window: `accounts.create` returns at t0, the binding INSERT lands
    // at t0+Δ. Retryable, never terminal — a terminal here loses a real deposit
    // permanently, because Stripe does not redeliver an acked event.
    Sentry.captureMessage('deposit_confirm_unbound_account', {
      level: 'warning',
      tags: { deposits: 'confirm' },
      extra: { sessionId: evidence.sessionId, account: evidence.connectedAccountId },
    });
    return { disposition: 'unbound_account' };
  }

  // --- GATE 2. The deposit, by its GLOBALLY UNIQUE Checkout Session id. -----
  //
  // The session id is the ONLY thing that addresses a row. Metadata and
  // `client_reference_id` are payload-supplied and are COMPARED against what we
  // find, never used to find it (invariant I14).
  const [deposit] = await db
    .select()
    .from(appointmentDepositSchema)
    .where(eq(appointmentDepositSchema.stripeCheckoutSessionId, evidence.sessionId))
    .limit(1);

  if (!deposit) {
    return { disposition: 'deferred_no_deposit' };
  }

  // --- GATE 1b. The PAIR row, by CAUSE. ------------------------------------
  const pairRow = bindings.find(binding => binding.salonId === deposit.salonId);

  if (!pairRow) {
    // THIS is the leg that carries the cross-salon property. The account has
    // rows, but none — live or revoked — for this deposit's salon, so the event
    // and the deposit belong to different tenants. Terminal and alerted: it
    // used to be a 72-hour retry, which laundered an attack signal into
    // deauthorized-salon lifecycle noise and re-alerted up to 72 times.
    Sentry.captureMessage('deposit_confirm_account_mismatch', {
      level: 'error',
      tags: { deposits: 'confirm', leg: 'pair_row_absent' },
      extra: {
        sessionId: evidence.sessionId,
        account: evidence.connectedAccountId,
        depositId: deposit.id,
      },
    });
    return { disposition: 'account_mismatch', depositId: deposit.id, salonId: deposit.salonId };
  }

  if (pairRow.revokedAt !== null && pairRow.revocationCause === 'deauthorized') {
    // We can no longer act on this account, so a refund is not attemptable
    // either. Retryable on the long schedule: a re-authorization converges it.
    return { disposition: 'unbound_account', depositId: deposit.id, salonId: deposit.salonId };
  }
  // A `revoked_local` pair row PROCEEDS. A local UI unlink must not freeze
  // money the client has already paid: authorization comes from the deposit's
  // account snapshot and legs (b)/(c), not from the link state. This holds even
  // when a DIFFERENT salon now holds the account's live row — the old salon's
  // revoked row authorizes the old salon's deposits.

  // --- GATE 3. The match legs. ---------------------------------------------
  //
  // (a) `deposit.salon_id === pairRow.salonId` is TRUE BY CONSTRUCTION under
  //     pair-row resolution — we found the pair row BY that equality. It is an
  //     assertion, never a discriminator, and nothing may build a mutation
  //     check on it.
  if (deposit.stripeAccountId !== evidence.connectedAccountId) {
    // (b) THE CROSS-ACCOUNT DISCRIMINATOR, and the one genuinely exercised on
    // the event-driven sweep: the deposit was created against one connected
    // account and the evidence arrived on another.
    Sentry.captureMessage('deposit_confirm_account_mismatch', {
      level: 'error',
      tags: { deposits: 'confirm', leg: 'snapshot' },
      extra: { sessionId: evidence.sessionId, depositId: deposit.id },
    });
    return { disposition: 'account_mismatch', depositId: deposit.id, salonId: deposit.salonId };
  }

  const [appointment] = await db
    .select()
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.id, deposit.appointmentId),
      eq(appointmentSchema.salonId, deposit.salonId),
    ))
    .limit(1);

  if (!appointment) {
    // (c) The composite-FK-backed appointment. Its absence means the row this
    // deposit points at is gone, which is a data-integrity finding, not a
    // payment one.
    Sentry.captureMessage('deposit_confirm_account_mismatch', {
      level: 'error',
      tags: { deposits: 'confirm', leg: 'appointment_absent' },
      extra: { sessionId: evidence.sessionId, depositId: deposit.id },
    });
    return { disposition: 'account_mismatch', depositId: deposit.id, salonId: deposit.salonId };
  }

  if (evidence.metadataDepositId && evidence.metadataDepositId !== deposit.id) {
    // (d) DIAGNOSTIC ONLY — warn and PROCEED. Session metadata is
    // connected-account-writable after creation, so a blocking leg here would
    // let a tenant rewrite one field on a paid session and permanently WITHHOLD
    // a verified confirm: poll and the sweep re-fetch the same tampered value.
    Sentry.captureMessage('deposit_confirm_metadata_deposit_id_mismatch', {
      level: 'warning',
      tags: { deposits: 'confirm' },
      extra: { sessionId: evidence.sessionId, depositId: deposit.id },
    });
  }

  // --- GATE 4. Payment status, amount and currency. -------------------------
  if (evidence.paymentStatus !== 'paid') {
    // ANY other value, known or unknown. `no_payment_required` is what a
    // salon's own setup and trial sessions carry, and an unknown future literal
    // must not be read as payment.
    return { disposition: 'ignored_unpaid', depositId: deposit.id, salonId: deposit.salonId };
  }

  if (evidence.amountTotal !== deposit.amountCents || evidence.currency !== DEPOSIT_CURRENCY) {
    // HELD, not auto-refunded and not confirmed. Real client money is captured
    // and the amount does not match what we asked for; that is a decision a
    // person makes, and a named queryable state is how they find it.
    Sentry.captureMessage('deposit_confirm_amount_mismatch', {
      level: 'error',
      tags: { deposits: 'confirm' },
      extra: {
        sessionId: evidence.sessionId,
        depositId: deposit.id,
        expectedCents: deposit.amountCents,
        observedCents: evidence.amountTotal,
        observedCurrency: evidence.currency,
      },
    });
    return { disposition: 'held_mismatch', depositId: deposit.id, salonId: deposit.salonId };
  }

  // --- GATE 5. ONE transaction: appointment lock, then deposit lock. --------
  return applyConfirmTransaction({ evidence, depositId: deposit.id, salonId: deposit.salonId });
}

// =============================================================================
// TX-B
// =============================================================================

type ConfirmTransactionArgs = {
  evidence: DepositEvidence;
  depositId: string;
  salonId: string;
};

async function applyConfirmTransaction(args: ConfirmTransactionArgs): Promise<ConfirmResult> {
  const { evidence, depositId, salonId } = args;

  let pendingWarning: string | null = null;

  let result: ConfirmResult;
  try {
    result = await depositsTransaction(db, async (tx): Promise<ConfirmResult> => {
    // LOCK ORDER: appointment row, then deposit row. NEVER the reverse — the
    // reaper and the restore path take them in this order too, and a single
    // writer taking them the other way is all a deadlock needs.
      const [deposit] = await tx
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.id, depositId),
          eq(appointmentDepositSchema.salonId, salonId),
        ))
        .limit(1);

      if (!deposit) {
        return { disposition: 'deferred_no_deposit' };
      }

      const [appointment] = await tx
        .select({
          id: appointmentSchema.id,
          status: appointmentSchema.status,
          endTime: appointmentSchema.endTime,
          startTime: appointmentSchema.startTime,
          clientPhone: appointmentSchema.clientPhone,
        })
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, deposit.appointmentId),
          eq(appointmentSchema.salonId, salonId),
        ))
        .for('update')
        .limit(1);

      if (!appointment) {
        return { disposition: 'account_mismatch', depositId, salonId };
      }

      const [lockedDeposit] = await tx
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.id, depositId),
          eq(appointmentDepositSchema.salonId, salonId),
        ))
        .for('update')
        .limit(1);

      if (!lockedDeposit) {
        return { disposition: 'deferred_no_deposit' };
      }

      const status = appointment.status as AppointmentStatus;

      // THE DISPATCH IS AN EXHAUSTIVE SWITCH WITH A `never` CHECK AND NO WIDENING
      // DEFAULT. This cell has been re-opened one status at a time three separate
      // times — a `default` arm makes each of those a silent no-op instead of a
      // compile error, so the compiler is the only durable fix.
      switch (status) {
        case 'awaiting_payment':
          return holdArm({ tx, evidence, appointment, deposit: lockedDeposit, salonId });

        case 'pending':
        case 'confirmed':
        case 'in_progress':
        case 'completed':
        case 'no_show':
        // ACTIVE-OR-SETTLED. `completed` and `no_show` are here for the same
        // reason: the owner may reactivate a reaper-released hold and then drive
        // the booking all the way through before the client's payment lands, and
        // it is the SAME appointment id in every case. Omitting either leaves a
        // paid event matching NO branch at all.
          return settledArm({ tx, evidence, appointment, deposit: lockedDeposit, salonId, onWarn: (message) => {
            pendingWarning = message;
          } });

        case 'cancelled':
        // Handed to routine B OUTSIDE this transaction: restore-or-refund takes
        // the technician advisory lock and may call Stripe, neither of which may
        // happen while these row locks are held (invariant I9).
          return {
            disposition: 'late_recovery_required',
            depositId,
            salonId,
            appointmentId: appointment.id,
          };

        default: {
          const exhaustive: never = status;
          throw new Error(`unhandled appointment status: ${String(exhaustive)}`);
        }
      }
    });
  } catch (error) {
    if (error instanceof TornConfirmPairError) {
      // The whole transaction rolled back, so nothing was written — the
      // appointment is still a hold and the deposit is still unpaid. POISON the
      // event rather than retrying: the deposit CAS failed on a status or a
      // payment-intent predicate, and neither of those changes on a retry, so a
      // retry loop would just burn attempts against a state a person has to look at.
      Sentry.captureMessage('deposit_confirm_pair_torn', {
        level: 'error',
        tags: { deposits: 'confirm' },
        extra: { depositId, salonId, sessionId: evidence.sessionId },
      });
      return { disposition: 'poisoned', depositId, salonId };
    }
    throw error;
  }

  if (pendingWarning) {
    Sentry.captureMessage(pendingWarning, {
      level: 'warning',
      tags: { deposits: 'confirm' },
      extra: { depositId, salonId, sessionId: evidence.sessionId },
    });
  }

  return result;
}

type ArmArgs = {
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
  evidence: DepositEvidence;
  appointment: { id: string; status: string; startTime: Date; endTime: Date; clientPhone: string };
  deposit: typeof appointmentDepositSchema.$inferSelect;
  salonId: string;
};

/** The hold arm: an unpaid reservation becomes a booking. */
async function holdArm(args: ArmArgs & { onWarn?: (message: string) => void }): Promise<ConfirmResult> {
  const { tx, evidence, appointment, deposit, salonId } = args;

  const [salon] = await tx
    .select({ freeSoloEnabled: salonSchema.freeSoloEnabled })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  // NOT unconditionally 'confirmed'. A non-freeSolo salon keeps its booking
  // triage queue: the deposit replaces the PAYMENT gate, not the REVIEW gate.
  const target = salon?.freeSoloEnabled ? 'confirmed' : 'pending';

  const movedAppointment = await tx
    .update(appointmentSchema)
    .set({
      status: target,
      // The staff-facing canvas column moves in lockstep with the legacy status
      // column, exactly as every other writer of this pair does.
      canvasState: 'waiting',
      canvasStateUpdatedAt: new Date(),
      depositHoldExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(appointmentSchema.id, appointment.id),
      eq(appointmentSchema.salonId, salonId),
      eq(appointmentSchema.status, 'awaiting_payment'),
    ))
    .returning();

  if (movedAppointment.length === 0) {
    // Somebody else moved the row between our lock and our CAS. Nothing was
    // written; re-drive rather than guess.
    return { disposition: 'deferred_no_deposit', depositId: deposit.id, salonId };
  }

  const paidDeposit = await tx
    .update(appointmentDepositSchema)
    .set({
      status: 'paid',
      stripePaymentIntentId: evidence.paymentIntentId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(appointmentDepositSchema.id, deposit.id),
      eq(appointmentDepositSchema.salonId, salonId),
      eq(appointmentDepositSchema.status, 'checkout_created'),
      // SET-ONCE payment intent. A deposit already carrying a DIFFERENT PI is
      // evidence of two real payments against one hold, which is not something
      // to overwrite.
      sql`(${appointmentDepositSchema.stripePaymentIntentId} IS NULL
        OR ${appointmentDepositSchema.stripePaymentIntentId} = ${evidence.paymentIntentId})`,
    ))
    .returning();

  if (paidDeposit.length === 0) {
    // THE TORN PAIR. The appointment CAS succeeded and the deposit CAS did not,
    // so committing would leave a live booking with a non-paid deposit — a
    // booking nobody paid for that no sweep would ever look at again. Roll the
    // WHOLE transaction back and poison the event so a person sees it.
    throw new TornConfirmPairError(deposit.id);
  }

  await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
    appointmentId: appointment.id,
    salonId,
    action: 'payment_status_changed',
    performedBy: 'system:deposits',
    performedByRole: 'system',
    previousValue: { status: 'awaiting_payment', depositStatus: 'checkout_created' },
    newValue: { status: target, depositStatus: 'paid' },
    reason: 'deposit_payment_confirmed',
  }));

  await enqueueConfirmationEffects({ tx, appointment, deposit, salonId, clientPhone: appointment.clientPhone });

  return { disposition: 'confirmed', depositId: deposit.id, salonId };
}

/** Active-or-settled appointment: the deposit moves, the appointment does not. */
async function settledArm(args: ArmArgs & { onWarn: (message: string) => void }): Promise<ConfirmResult> {
  const { tx, evidence, appointment, deposit, salonId } = args;

  if (deposit.status === 'paid') {
    if (deposit.stripeCheckoutSessionId && deposit.stripeCheckoutSessionId !== evidence.sessionId) {
      // A SECOND real payment against one deposit. That is captured client
      // money with no confirm and no refund attached to it, so it must be a
      // named, queryable state — not an alert stapled to an idempotent ack.
      return { disposition: 'held_duplicate_session', depositId: deposit.id, salonId };
    }
    // Ordinary idempotent redelivery, including after the owner has since
    // marked the booking `no_show`.
    return { disposition: 'already_confirmed', depositId: deposit.id, salonId };
  }

  if (deposit.status !== 'checkout_created' && deposit.status !== 'expired' && deposit.status !== 'canceled') {
    // `refunded` or `waived`. Money already has an arrow; routine B owns those.
    return {
      disposition: 'late_recovery_required',
      depositId: deposit.id,
      salonId,
      appointmentId: appointment.id,
    };
  }

  const late = deposit.status !== 'checkout_created';

  const healed = await tx
    .update(appointmentDepositSchema)
    .set({
      status: 'paid',
      stripePaymentIntentId: evidence.paymentIntentId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(appointmentDepositSchema.id, deposit.id),
      eq(appointmentDepositSchema.salonId, salonId),
      eq(appointmentDepositSchema.status, deposit.status),
      sql`(${appointmentDepositSchema.stripePaymentIntentId} IS NULL
        OR ${appointmentDepositSchema.stripePaymentIntentId} = ${evidence.paymentIntentId})`,
    ))
    .returning();

  if (healed.length === 0) {
    return { disposition: 'deferred_no_deposit', depositId: deposit.id, salonId };
  }

  await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
    appointmentId: appointment.id,
    salonId,
    action: 'payment_status_changed',
    performedBy: 'system:deposits',
    performedByRole: 'system',
    previousValue: { depositStatus: deposit.status },
    newValue: { depositStatus: 'paid' },
    reason: late ? 'healed_deposit_late' : 'healed_deposit',
  }));

  await enqueueConfirmationEffects({ tx, appointment, deposit, salonId, clientPhone: appointment.clientPhone });

  if (late) {
    // The owner reactivated a reaper-released hold and the client then paid,
    // possibly after the booking was completed or no-showed. THE SALON KEEPS THE
    // DEPOSIT and NO APPOINTMENT STATUS IS WRITTEN: compensating a no-show is
    // the reason a deposit exists, and refunding it would return the money in
    // precisely the case the instrument was designed for. A discretionary
    // refund stays available through the owner tooling.
    args.onWarn('deposit_healed_late');
    return { disposition: 'healed_deposit_late', depositId: deposit.id, salonId };
  }

  return { disposition: 'healed_deposit', depositId: deposit.id, salonId };
}

/**
 * Enqueues the confirmation side-effect job WITH THE TRANSACTION HANDLE, so the
 * job commits with the money write and a crash between the two cannot lose the
 * client's confirmation.
 */
async function enqueueConfirmationEffects(args: {
  tx: ArmArgs['tx'];
  appointment: { id: string; endTime: Date };
  deposit: typeof appointmentDepositSchema.$inferSelect;
  salonId: string;
  clientPhone: string;
}): Promise<void> {
  const { tx, appointment, deposit, salonId } = args;

  // A FRESHLY MINTED capability, not a recovered one. Only the booking-time
  // token's HASH is persisted, so the original URL is not reconstructible.
  // Lookups are by hash, so the booking-time token stays valid and the client
  // ends up with two working links rather than one broken one.
  const capability = await mintAppointmentManageCapability(tx, {
    salonId,
    appointmentId: appointment.id,
    appointmentEndTime: appointment.endTime,
  });

  const [salon] = await tx
    .select({ slug: salonSchema.slug, customDomain: salonSchema.customDomain })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon?.slug) {
    throw new Error('SALON_NOT_FOUND');
  }

  await enqueueDepositConfirmationSideEffects(tx, {
    salonId,
    appointmentId: appointment.id,
    depositId: deposit.id,
    manageUrl: buildAppointmentManageUrl(salon, capability.token),
    // Derived from the PERSISTED consent record rather than carried forward
    // from the booking request: the request that created the hold ended long
    // before this, and a client who revoked consent in between must not be
    // texted.
    smsConsentGranted: await hasTransactionalSmsConsent(tx, salonId, args.clientPhone),
    // TRUE here, and the runner performs the calendar enqueue.
    //
    // The charter's preference is for TX-B to own that enqueue with the handle.
    // Doing so means rebuilding the full calendar payload — services,
    // technician, timezone, location — inside the transaction while both row
    // locks are held, duplicating the loader the runner already calls. The
    // atomicity that actually matters is preserved either way, because the JOB
    // is enqueued in-tx: the calendar upsert then rides that job\'s
    // at-least-once retry rather than a second in-tx enqueue.
    googleCalendarSyncEligible: true,
    // NOT RECOVERABLE AT D5, and deliberately not guessed.
    //
    // The booking route holds the applied reward in memory and the deposit
    // branch skips the marking, so nothing persists WHICH reward was applied to
    // a hold — the link is the marking. Matching one heuristically by discount
    // label and amount could mark the wrong client\'s reward, which is a worse
    // money error than not marking one. Named as a gap that needs a hold-time
    // persistence change in a sibling packet, not closed by improvisation here.
    appliedRewardId: null,
  });
}

/**
 * The persisted transactional-SMS consent for a phone number.
 *
 * Mirrors the predicate `src/libs/SMS.ts` applies before any transactional
 * send. Read here rather than imported because that helper is module-private,
 * and read on the TRANSACTION handle so it sees the same snapshot as the CAS.
 */
async function hasTransactionalSmsConsent(
  tx: ArmArgs['tx'],
  salonId: string,
  phone: string,
): Promise<boolean> {
  const normalized = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const [consent] = await tx
    .select({ status: communicationConsentSchema.status })
    .from(communicationConsentSchema)
    .where(and(
      eq(communicationConsentSchema.salonId, salonId),
      eq(communicationConsentSchema.recipient, normalized),
      eq(communicationConsentSchema.channel, 'sms'),
      eq(communicationConsentSchema.purpose, 'appointment_transactional'),
    ))
    .orderBy(desc(communicationConsentSchema.createdAt))
    .limit(1);
  return consent?.status === 'granted';
}

/** Thrown to roll TX-B back when the appointment moved and the deposit did not. */
export class TornConfirmPairError extends Error {
  constructor(public readonly depositId: string) {
    super(`deposit confirm pair torn: ${depositId}`);
    this.name = 'TornConfirmPairError';
  }
}
