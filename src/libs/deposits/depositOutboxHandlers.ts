import 'server-only';

import { and, eq } from 'drizzle-orm';

import {
  loadBookingCommitEffectsContext,
  markAppliedRewardForBooking,
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
 * THE FAILURE CONTRACT BOTH HANDLERS SHARE: catch each send individually,
 * collect the failures, and THROW if any leg failed. Throwing is what makes the
 * outbox re-run the job; catching per leg is what stops one dead leg from
 * hiding the others. On the re-run, legs that already succeeded do NOT re-fire,
 * because each carries its own dedupe key — `sendAppointmentOperationalEmailOnce`
 * for email, a `notification_delivery` row for SMS, and an idempotent update
 * for the referral flip inside the shared runner.
 */

type HandlerArgs = {
  salonId: string;
  appointmentId: string;
  payload: unknown;
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

/**
 * Runs D4.5's extracted booking-commit effects for a deposit that has just been
 * confirmed.
 *
 * `includeGoogleCalendarUpsert: false` is deliberate and load-bearing: TX-B
 * already enqueued the calendar upsert WITH ITS TRANSACTION HANDLE, so the
 * enqueue commits with the money write. Letting the runner enqueue a second one
 * here would move that guarantee back outside the transaction for no gain.
 */
export async function runDepositConfirmationSideEffects(args: HandlerArgs): Promise<void> {
  const payload = readConfirmationPayload(args.payload);

  // The outbox payload is a duplicated integrity assertion, not the source of
  // truth. Reload the paid deposit by the complete tenant/appointment identity
  // and require its durable attribution to match before any booking effect can
  // run. A forged or stale payload can therefore never select a reward.
  const [confirmedDeposit] = await db
    .select({
      appliedRewardId: appointmentDepositSchema.appliedRewardId,
      status: appointmentDepositSchema.status,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.id, payload.depositId),
      eq(appointmentDepositSchema.salonId, args.salonId),
      eq(appointmentDepositSchema.appointmentId, args.appointmentId),
    ))
    .limit(1);

  if (!confirmedDeposit) {
    throw new Error('DEPOSIT_SIDE_EFFECTS_DEPOSIT_UNAVAILABLE');
  }
  if (['canceled', 'expired', 'refunded', 'waived'].includes(confirmedDeposit.status)) {
    return;
  }
  if (confirmedDeposit.status !== 'paid') {
    throw new Error('DEPOSIT_SIDE_EFFECTS_DEPOSIT_UNAVAILABLE');
  }
  if (payload.appliedRewardId !== confirmedDeposit.appliedRewardId) {
    throw new Error('DEPOSIT_REWARD_ATTRIBUTION_MISMATCH');
  }

  const context = await loadBookingCommitEffectsContext({
    salonId: args.salonId,
    appointmentId: args.appointmentId,
    manageUrl: payload.manageUrl,
    smsConsentGranted: payload.smsConsentGranted,
    googleCalendarSyncEligible: payload.googleCalendarSyncEligible,
    appliedRewardId: confirmedDeposit.appliedRewardId,
    rewardAttributionDepositId: payload.depositId,
  });

  if (!context) {
    // The appointment, its salon or its client could not be read. That is
    // retryable, not terminal: the row exists — TX-B committed it — so this is
    // a transient read failure, and the outbox's own attempt cap bounds it.
    throw new Error('DEPOSIT_SIDE_EFFECTS_CONTEXT_UNAVAILABLE');
  }

  if (['cancelled', 'no_show'].includes(context.appointment.status ?? '')) {
    return;
  }

  // Validate the exact already-consumed attribution before effect 1. This is a
  // no-write replay of TX-B/TX-C, and prevents malformed/stale attribution from
  // partially executing retention or notification work before it fails.
  if (context.appliedRewardId) {
    const rewardResult = await markAppliedRewardForBooking(context);
    if (rewardResult === 'terminal_noop') {
      return;
    }
  }

  await runBookingCommitSideEffects(context, { includeGoogleCalendarUpsert: false });
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
      prepare: () => ({
        subject: clientCopy.subject,
        text: clientCopy.body,
        html: `<p>${escapeHtml(clientCopy.body)}</p>`,
      }),
    });
    if (delivery.status === 'failed') {
      failures.push('client_email');
    }
  } catch {
    failures.push('client_email');
  }

  // ---- Owner leg. Always email; the owner needs the money record. ----------
  const ownerRecipient = row.ownerEmail || row.salonEmail;
  if (ownerRecipient) {
    // The salon's own configured zone, never a hardcoded one: an owner reading
    // "3pm" for a booking their salon holds at noon cannot reconcile the refund
    // against their calendar.
    const { getBookingConfigForSalon } = await import('@/libs/bookingConfig');
    const { timezone } = await getBookingConfigForSalon(args.salonId);
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
      });
      if (!sent) {
        failures.push('owner_email');
      }
    } catch {
      failures.push('owner_email');
    }
  }

  if (failures.length > 0) {
    // Throwing is what schedules the retry. The succeeded legs above are
    // individually dedupe-keyed, so the re-run resends only what failed.
    throw new Error(`DEPOSIT_REFUND_NOTICE_FAILED:${failures.join(',')}`);
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#039;');
}
