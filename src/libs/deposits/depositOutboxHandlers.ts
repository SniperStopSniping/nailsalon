import 'server-only';

import { and, eq } from 'drizzle-orm';

import {
  loadBookingCommitEffectsContext,
  runBookingCommitSideEffects,
} from '@/libs/bookingCommitEffects';
import { sendAppointmentOperationalEmailOnce } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import {
  appointmentDepositSchema,
  appointmentSchema,
  salonSchema,
} from '@/models/Schema';

/**
 * The two durable side-effect batches D5 enqueues from inside its money
 * transactions, run by the integration outbox worker.
 *
 * WHY THESE LIVE ON THE OUTBOX AND NOT INLINE. A confirmation can be driven by
 * a Stripe webhook, whose response is a RETRY DECISION, not a send budget: a
 * bounced email that turned into a non-2xx would put Stripe into a three-day
 * redelivery loop against money that has already moved. Invariant I10 puts
 * notifications on their own failure axis for exactly that reason — a
 * side-effect failure can never mark the event row retryable, and can never
 * roll back the state transition.
 *
 * REPLAY CONTRACT. These aggregate jobs are at-least-once, and each effect
 * keeps its own failure and replay posture. Confirmation does not catch and
 * retry every notification leg: DB mutations are idempotent, and the calendar
 * child plus customer and salon email have stable local identities. Client SMS
 * and internal owner/staff delivery are best-effort and may run again after an
 * interrupted attempt or another propagated failure; their ordinary provider
 * failures are absorbed by their helpers. Refund notices do collect leg
 * failures and throw, but only the client email has a stable per-refund claim;
 * the direct owner email may be sent again on replay. None of these local
 * claims eliminates a remote provider's accepted-but-unacknowledged ambiguity.
 */

type HandlerArgs = {
  salonId: string;
  appointmentId: string;
  payload: unknown;
  signal?: AbortSignal;
};

type ConfirmationHandlerArgs = HandlerArgs & {
  parentJobId: string;
};

type ConfirmationPayload = {
  depositId: string;
  manageUrl: string;
  smsConsentGranted: boolean;
  googleCalendarSyncEligible: boolean;
  appliedRewardId: string | null;
};

type RefundNoticePayload = {
  depositId: string;
  refundId: string;
  variant: 'slot_lost' | 'waiver';
};

function readConfirmationPayload(value: unknown): ConfirmationPayload {
  const payload = (value ?? {}) as Partial<ConfirmationPayload>;
  if (typeof payload.depositId !== 'string' || typeof payload.manageUrl !== 'string') {
    throw new TypeError('INVALID_DEPOSIT_SIDE_EFFECTS');
  }
  return {
    depositId: payload.depositId,
    manageUrl: payload.manageUrl,
    smsConsentGranted: payload.smsConsentGranted === true,
    googleCalendarSyncEligible: payload.googleCalendarSyncEligible === true,
    appliedRewardId: typeof payload.appliedRewardId === 'string' ? payload.appliedRewardId : null,
  };
}

function readRefundNoticePayload(value: unknown): RefundNoticePayload {
  const payload = (value ?? {}) as Partial<RefundNoticePayload>;
  if (typeof payload.depositId !== 'string' || typeof payload.refundId !== 'string') {
    throw new TypeError('INVALID_DEPOSIT_REFUND_NOTICES');
  }
  return {
    depositId: payload.depositId,
    refundId: payload.refundId,
    variant: payload.variant === 'waiver' ? 'waiver' : 'slot_lost',
  };
}

function throwIfDepositOutboxAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('DEPOSIT_OUTBOX_ABORTED');
}

/**
 * Runs D4.5's extracted booking-commit effects for a deposit that has just been
 * confirmed.
 *
 * TX-B/TX-C atomically enqueue this aggregate confirmation job with the paid
 * transition. After this handler verifies that durable state, the shared
 * runner owns the DB-only, deduplicated calendar enqueue. A later calendar
 * worker pass owns the provider call, outside the payment transaction.
 */
export async function runDepositConfirmationSideEffects(
  args: ConfirmationHandlerArgs,
): Promise<void> {
  throwIfDepositOutboxAborted(args.signal);
  const payload = readConfirmationPayload(args.payload);

  // Reload the paid deposit by its complete tenant/appointment identity before
  // any booking effect can run. The scope-clean base does not persist a reward
  // identity on deposit rows; the aggregate payload retains the established
  // reward field and its producer continues to emit null.
  const [confirmedDeposit] = await db
    .select({
      status: appointmentDepositSchema.status,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.id, payload.depositId),
      eq(appointmentDepositSchema.salonId, args.salonId),
      eq(appointmentDepositSchema.appointmentId, args.appointmentId),
    ))
    .limit(1);

  throwIfDepositOutboxAborted(args.signal);

  if (!confirmedDeposit) {
    throw new Error('DEPOSIT_SIDE_EFFECTS_DEPOSIT_UNAVAILABLE');
  }
  if (['canceled', 'expired', 'refunded', 'waived'].includes(confirmedDeposit.status)) {
    return;
  }
  if (confirmedDeposit.status !== 'paid') {
    throw new Error('DEPOSIT_SIDE_EFFECTS_DEPOSIT_UNAVAILABLE');
  }

  const context = await loadBookingCommitEffectsContext({
    salonId: args.salonId,
    appointmentId: args.appointmentId,
    manageUrl: payload.manageUrl,
    smsConsentGranted: payload.smsConsentGranted,
    googleCalendarSyncEligible: payload.googleCalendarSyncEligible,
    appliedRewardId: payload.appliedRewardId,
  });

  throwIfDepositOutboxAborted(args.signal);

  if (!context) {
    // The appointment, its salon or its client could not be read. That is
    // retryable, not terminal: the row exists — TX-B committed it — so this is
    // a transient read failure, and the outbox's own attempt cap bounds it.
    throw new Error('DEPOSIT_SIDE_EFFECTS_CONTEXT_UNAVAILABLE');
  }

  if (['cancelled', 'no_show'].includes(context.appointment.status ?? '')) {
    return;
  }

  await runBookingCommitSideEffects(context, {
    calendarCause: {
      kind: 'deposit_confirmation',
      parentJobId: args.parentJobId,
    },
    signal: args.signal,
  });
}

/**
 * Client and owner notices for a deposit D5 refunded.
 *
 * TWO CLIENT COPY VARIANTS. The `slot_lost` wording is the ordinary case: the
 * payment arrived after the hold lapsed and the time could not be recovered.
 * The `waiver` wording exists because that sentence is simply FALSE for a
 * waived deposit — the appointment still stands and the salon chose not to
 * collect — and sending the fixed copy would talk a client out of a booking
 * they still have.
 */
export async function runDepositRefundNotices(args: HandlerArgs): Promise<void> {
  throwIfDepositOutboxAborted(args.signal);
  const payload = readRefundNoticePayload(args.payload);

  const [row] = await db
    .select({
      salonName: salonSchema.name,
      ownerEmail: salonSchema.ownerEmail,
      salonEmail: salonSchema.email,
      clientName: appointmentSchema.clientName,
      startTime: appointmentSchema.startTime,
      amountCents: appointmentDepositSchema.amountCents,
    })
    .from(appointmentDepositSchema)
    .innerJoin(appointmentSchema, and(
      eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
      eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
    ))
    .innerJoin(salonSchema, eq(salonSchema.id, appointmentDepositSchema.salonId))
    .where(and(
      eq(appointmentDepositSchema.id, payload.depositId),
      eq(appointmentDepositSchema.salonId, args.salonId),
    ))
    .limit(1);

  throwIfDepositOutboxAborted(args.signal);

  if (!row) {
    throw new Error('DEPOSIT_REFUND_NOTICE_CONTEXT_UNAVAILABLE');
  }

  const amount = `CA$${(row.amountCents / 100).toFixed(2)}`;
  const failures: string[] = [];

  // ---- Client leg. --------------------------------------------------------
  //
  // DEVIATION, stated rather than hidden. The charter's channel priority is
  // "SMS if consent, else email". The SMS send primitive (`sendSMS`) and its
  // consent gate (`hasTransactionalSmsConsent`) are both module-PRIVATE in
  // `src/libs/SMS.ts`, so sending one from here means exporting a new sibling
  // of `sendCancellationConfirmation` — an edit to the Twilio surface that a
  // concurrent branch owns. D5 therefore delivers the client notice by email
  // only. The notice is still delivered, still deduped per refund id, and
  // still retried; only the channel differs, and adding the SMS leg later is
  // additive because the dedupe key is per-leg.
  const clientCopy = payload.variant === 'waiver'
    ? {
        subject: `${row.salonName}: your deposit has been refunded`,
        body: `${row.salonName} has waived the deposit for your appointment, so the ${amount} you paid has been refunded. Your appointment is unchanged — we will see you as booked.`,
      }
    : {
        subject: `${row.salonName}: your deposit has been refunded`,
        body: `Your payment for ${row.salonName} arrived after the time was released, and that slot is no longer available. The ${amount} deposit has been refunded in full. You are welcome to rebook any time.`,
      };

  try {
    const delivery = await sendAppointmentOperationalEmailOnce({
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      purpose: 'client_deposit_refunded',
      // Per REFUND id, not per deposit: a second refund on a re-opened deposit
      // is a second money event and deserves its own notice.
      eventVersion: `${payload.depositId}:${payload.refundId}`,
      retryFailed: true,
      signal: args.signal,
      prepare: () => ({
        subject: clientCopy.subject,
        text: clientCopy.body,
        html: `<p>${escapeHtml(clientCopy.body)}</p>`,
      }),
    });
    throwIfDepositOutboxAborted(args.signal);
    if (delivery.status === 'failed') {
      failures.push('client_email');
    }
  } catch {
    throwIfDepositOutboxAborted(args.signal);
    failures.push('client_email');
  }
  // The operational-email helper completes its local delivery bookkeeping
  // after a provider await. Only then may an expired worker budget stop this
  // aggregate; no later owner dispatch is allowed from the obsolete attempt.
  throwIfDepositOutboxAborted(args.signal);

  // ---- Owner leg. Always email; the owner needs the money record. ----------
  const ownerRecipient = row.ownerEmail || row.salonEmail;
  if (ownerRecipient) {
    throwIfDepositOutboxAborted(args.signal);
    // The salon's own configured zone, never a hardcoded one: an owner reading
    // "3pm" for a booking their salon holds at noon cannot reconcile the refund
    // against their calendar.
    const { getBookingConfigForSalon } = await import('@/libs/bookingConfig');
    const { timezone } = await getBookingConfigForSalon(args.salonId);
    throwIfDepositOutboxAborted(args.signal);
    const when = `${formatDateInTimeZone(row.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }, timezone)} at ${formatTimeInTimeZone(row.startTime.toISOString(), {}, timezone)}`;
    const ownerText = payload.variant === 'waiver'
      ? `A deposit of ${amount} for ${row.clientName || 'a client'} (${when}) was refunded because the deposit was waived after the client had already paid. No action is needed.`
      : `A deposit of ${amount} for ${row.clientName || 'a client'} (${when}) was refunded automatically: the payment arrived after the hold lapsed and the time could not be restored.`;
    try {
      const { sendTransactionalEmail } = await import('@/libs/email');
      const sent = await sendTransactionalEmail({
        to: ownerRecipient,
        subject: `${row.salonName}: a client deposit was refunded`,
        text: ownerText,
        html: `<p>${escapeHtml(ownerText)}</p>`,
      }, { signal: args.signal });
      throwIfDepositOutboxAborted(args.signal);
      if (!sent) {
        failures.push('owner_email');
      }
    } catch {
      throwIfDepositOutboxAborted(args.signal);
      failures.push('owner_email');
    }
    // A timeout after dispatch is an unavoidable provider ambiguity. Preserve
    // the direct owner's documented at-least-once replay posture, but never
    // begin another leg from this expired attempt.
    throwIfDepositOutboxAborted(args.signal);
  }

  if (failures.length > 0) {
    // Throwing schedules the aggregate retry. The client leg reuses its stable
    // per-refund claim, but the direct owner leg has no claim; if it succeeded
    // before another leg failed, a later attempt may send it again.
    throw new Error(`DEPOSIT_REFUND_NOTICE_FAILED:${failures.join(',')}`);
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#039;');
}
