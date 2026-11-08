import type { CustomerPaymentSnapshot } from './money';
import { assertCents, calculatePaymentSnapshot } from './money';
import { calculateApplicationFeeRefund } from './refunds';

export type CustomerPaymentAttempt = {
  referenceId: string;
  salonId: string;
  appointmentId: string;
  stripeAccountId: string;
  snapshot: CustomerPaymentSnapshot;
  expiresAt: number;
  sessionId: string | null;
  paymentIntentId: string | null;
  phase: 'prepared' | 'checkout_open' | 'paid' | 'expired' | 'refund_required' | 'held_review';
  reviewReason: string | null;
  revision: number;
  observations: Readonly<Record<string, string>>;
  refunds: Readonly<Record<string, number>>;
  /** Verified historical capture, never erased by a later review or refund. */
  settledCents: number;
  refundedCents: number;
  applicationFeeId: string | null;
  applicationFeeRefunds: Readonly<Record<string, number>>;
  applicationFeeRefundedCents: number;
};

/**
 * Pure rehearsal state machine, NOT a durable ledger. A collection integration
 * must store the attempt, unique provider event/refund IDs and ledger effect in
 * one tenant-scoped transaction with a revision check before using its output.
 * No existing appointment/deposit state is mutated by this module.
 */
export function prepareCustomerPaymentAttempt(input: {
  referenceId: string;
  salonId: string;
  appointmentId: string;
  stripeAccountId: string;
  snapshot: CustomerPaymentSnapshot;
  expiresAt: number;
}): CustomerPaymentAttempt {
  if (![input.referenceId, input.salonId, input.appointmentId].every(value => value.trim().length > 0)
    || !/^acct_[a-z0-9]+$/i.test(input.stripeAccountId)
    || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0
    || input.snapshot.collection === 'offline' || input.snapshot.chargeCents <= 0) {
    throw new Error('INVALID_PAYMENT_ATTEMPT');
  }
  const canonicalSnapshot = calculatePaymentSnapshot({
    currency: input.snapshot.currency,
    servicesCents: input.snapshot.servicesCents,
    discountCents: input.snapshot.discountCents,
    taxCents: input.snapshot.taxCents,
    tipCents: input.snapshot.tipCents,
    collection: input.snapshot.collection,
    ...(input.snapshot.depositCents === null ? {} : { depositCents: input.snapshot.depositCents }),
    feePolicy: {
      payer: input.snapshot.feePayer,
      taxTreatment: input.snapshot.feeTaxTreatment,
      refundPolicy: input.snapshot.feeRefundPolicy,
      feeCents: input.snapshot.configuredFeeCents,
    },
  });
  if ((Object.keys(canonicalSnapshot) as Array<keyof CustomerPaymentSnapshot>)
    .some(key => canonicalSnapshot[key] !== input.snapshot[key])) {
    throw new Error('PAYMENT_SNAPSHOT_MISMATCH');
  }
  return {
    ...input,
    // Recompute all derived fields and retain a fresh immutable snapshot.
    snapshot: canonicalSnapshot,
    sessionId: null,
    paymentIntentId: null,
    phase: 'prepared',
    reviewReason: null,
    revision: 0,
    observations: {},
    refunds: {},
    settledCents: 0,
    refundedCents: 0,
    applicationFeeId: null,
    applicationFeeRefunds: {},
    applicationFeeRefundedCents: 0,
  };
}

export function bindCustomerPaymentSession(
  attempt: CustomerPaymentAttempt,
  session: { id: string; livemode: boolean; stripeAccountId: string },
): CustomerPaymentAttempt {
  if (session.livemode !== false || session.stripeAccountId !== attempt.stripeAccountId
    || !/^cs_test_[a-z0-9]+$/i.test(session.id)) {
    throw new Error('PAYMENT_SESSION_IDENTITY_MISMATCH');
  }
  if (attempt.sessionId !== null) {
    if (attempt.sessionId !== session.id) {
      throw new Error('PAYMENT_ATTEMPT_ALREADY_BOUND');
    }
    return attempt;
  }
  if (attempt.phase !== 'prepared') {
    throw new Error('PAYMENT_ATTEMPT_NOT_PREPARED');
  }
  return { ...attempt, sessionId: session.id, phase: 'checkout_open', revision: attempt.revision + 1 };
}

export type CustomerPaymentObservation = {
  eventId: string;
  stripeAccountId: string;
  livemode: boolean;
  referenceId: string;
  sessionId: string;
  status: 'succeeded' | 'expired' | 'failed';
  currency: string;
  amountCents: number;
  applicationFeeCents: number;
  paymentIntentId: string | null;
  observedAt: number;
};

/** Input must originate from verified, account-scoped provider evidence, never a return URL/body. */
export function applyCustomerPaymentObservation(
  attempt: CustomerPaymentAttempt,
  observation: CustomerPaymentObservation,
  expectedRevision: number,
): CustomerPaymentAttempt {
  if (expectedRevision !== attempt.revision) {
    throw new Error('PAYMENT_ATTEMPT_REVISION_CONFLICT');
  }
  if (!observation.eventId.trim() || !Number.isSafeInteger(observation.observedAt) || observation.observedAt < 0
    || !['succeeded', 'expired', 'failed'].includes(observation.status)) {
    throw new Error('INVALID_PAYMENT_OBSERVATION');
  }
  const fingerprint = JSON.stringify([
    observation.stripeAccountId,
    observation.livemode,
    observation.referenceId,
    observation.sessionId,
    observation.status,
    observation.currency,
    observation.amountCents,
    observation.applicationFeeCents,
    observation.paymentIntentId,
  ]);
  const seen = attempt.observations[observation.eventId];
  if (seen !== undefined) {
    if (seen !== fingerprint) {
      throw new Error('PAYMENT_EVENT_IDENTITY_CONFLICT');
    }
    return attempt;
  }
  const next = {
    ...attempt,
    revision: attempt.revision + 1,
    observations: { ...attempt.observations, [observation.eventId]: fingerprint },
  };
  if (observation.livemode !== false || observation.stripeAccountId !== attempt.stripeAccountId
    || observation.referenceId !== attempt.referenceId || observation.sessionId !== attempt.sessionId
    || observation.currency !== attempt.snapshot.currency
    || observation.amountCents !== attempt.snapshot.chargeCents
    || observation.applicationFeeCents !== attempt.snapshot.applicationFeeCents
    || (attempt.paymentIntentId !== null && observation.paymentIntentId !== null
      && observation.paymentIntentId !== attempt.paymentIntentId)) {
    return { ...next, phase: 'held_review', reviewReason: 'PAYMENT_EVIDENCE_MISMATCH' };
  }
  if (observation.status === 'succeeded') {
    if (!observation.paymentIntentId?.startsWith('pi_')) {
      return { ...next, phase: 'held_review', reviewReason: 'PAYMENT_INTENT_MISSING' };
    }
    // Verified money stays accounted for even while an operator reviews the
    // booking. Only an explicit audited repair may reopen that booking.
    if (attempt.phase === 'held_review' || attempt.phase === 'refund_required') {
      return { ...next, settledCents: attempt.snapshot.chargeCents, paymentIntentId: observation.paymentIntentId };
    }
    if (attempt.phase === 'paid') {
      return next;
    }
    // A released/expired slot is never resurrected by a late payment.
    if (attempt.phase === 'expired' || observation.observedAt >= attempt.expiresAt) {
      return { ...next, settledCents: attempt.snapshot.chargeCents, paymentIntentId: observation.paymentIntentId, phase: 'refund_required', reviewReason: 'LATE_PAYMENT' };
    }
    return { ...next, settledCents: attempt.snapshot.chargeCents, phase: 'paid', paymentIntentId: observation.paymentIntentId };
  }
  // Out-of-order expiry/failure cannot erase an already verified payment.
  if (attempt.phase === 'paid' || attempt.phase === 'held_review' || attempt.phase === 'refund_required') {
    return next;
  }
  return { ...next, phase: observation.status === 'expired' ? 'expired' : attempt.phase };
}

/** Successful refunds only. Persist this result atomically with its unique provider refund ID. */
export function recordCustomerPaymentRefund(
  attempt: CustomerPaymentAttempt,
  refund: { id: string; amountCents: number; paymentIntentId: string; stripeAccountId: string; livemode: boolean },
  expectedRevision: number,
): { attempt: CustomerPaymentAttempt; applicationFeeRefundDueCents: number } {
  if (attempt.revision !== expectedRevision) {
    throw new Error('PAYMENT_ATTEMPT_REVISION_CONFLICT');
  }
  assertCents(refund.amountCents, 'refundAmountCents');
  if (attempt.settledCents <= 0 || attempt.paymentIntentId === null
    || refund.livemode !== false || refund.stripeAccountId !== attempt.stripeAccountId
    || refund.paymentIntentId !== attempt.paymentIntentId || !refund.id.startsWith('re_')
    || refund.amountCents <= 0) {
    throw new Error('REFUND_EVIDENCE_MISMATCH');
  }
  const recorded = attempt.refunds[refund.id];
  if (recorded !== undefined && recorded !== refund.amountCents) {
    throw new Error('REFUND_IDENTITY_CONFLICT');
  }
  const refundedCents = recorded === undefined ? attempt.refundedCents + refund.amountCents : attempt.refundedCents;
  const plan = calculateApplicationFeeRefund({
    originalChargeCents: attempt.snapshot.chargeCents,
    originalApplicationFeeCents: attempt.snapshot.applicationFeeCents,
    cumulativeChargeRefundedCents: refundedCents,
    applicationFeeAlreadyRefundedCents: attempt.applicationFeeRefundedCents,
  });
  return {
    attempt: recorded === undefined
      ? {
          ...attempt,
          revision: attempt.revision + 1,
          refunds: { ...attempt.refunds, [refund.id]: refund.amountCents },
          refundedCents,
        }
      : attempt,
    applicationFeeRefundDueCents: plan.additionalFeeRefundCents,
  };
}

/** Verified original fee evidence, independently bound to the captured intent. */
export function bindCustomerPaymentApplicationFee(
  attempt: CustomerPaymentAttempt,
  fee: { id: string; paymentIntentId: string; stripeAccountId: string; livemode: boolean; currency: string; amountCents: number },
  expectedRevision: number,
): CustomerPaymentAttempt {
  if (attempt.revision !== expectedRevision) {
    throw new Error('PAYMENT_ATTEMPT_REVISION_CONFLICT');
  }
  if (attempt.settledCents <= 0 || attempt.paymentIntentId === null
    || fee.paymentIntentId !== attempt.paymentIntentId || fee.stripeAccountId !== attempt.stripeAccountId
    || fee.livemode !== false || fee.currency !== attempt.snapshot.currency
    || fee.amountCents !== attempt.snapshot.applicationFeeCents || fee.amountCents <= 0
    || !/^fee_[a-z0-9]+$/i.test(fee.id)) {
    throw new Error('APPLICATION_FEE_EVIDENCE_MISMATCH');
  }
  if (attempt.applicationFeeId !== null) {
    if (attempt.applicationFeeId !== fee.id) {
      throw new Error('APPLICATION_FEE_IDENTITY_CONFLICT');
    }
    return attempt;
  }
  return { ...attempt, applicationFeeId: fee.id, revision: attempt.revision + 1 };
}

/** Only independently verified SUCCESSFUL fee refunds, never a requested operation. */
export function recordCustomerPaymentFeeRefund(
  attempt: CustomerPaymentAttempt,
  refund: { id: string; applicationFeeId: string; stripeAccountId: string; livemode: boolean; currency: string; amountCents: number },
  expectedRevision: number,
): CustomerPaymentAttempt {
  if (attempt.revision !== expectedRevision) {
    throw new Error('PAYMENT_ATTEMPT_REVISION_CONFLICT');
  }
  assertCents(refund.amountCents, 'applicationFeeRefundAmountCents');
  if (attempt.settledCents <= 0 || attempt.applicationFeeId === null
    || refund.applicationFeeId !== attempt.applicationFeeId || refund.stripeAccountId !== attempt.stripeAccountId
    || refund.livemode !== false || refund.currency !== attempt.snapshot.currency
    || !/^fr_[a-z0-9]+$/i.test(refund.id) || refund.amountCents <= 0) {
    throw new Error('APPLICATION_FEE_REFUND_EVIDENCE_MISMATCH');
  }
  const recorded = attempt.applicationFeeRefunds[refund.id];
  if (recorded !== undefined) {
    if (recorded !== refund.amountCents) {
      throw new Error('APPLICATION_FEE_REFUND_IDENTITY_CONFLICT');
    }
    return attempt;
  }
  const plan = calculateApplicationFeeRefund({
    originalChargeCents: attempt.snapshot.chargeCents,
    originalApplicationFeeCents: attempt.snapshot.applicationFeeCents,
    cumulativeChargeRefundedCents: attempt.refundedCents,
    applicationFeeAlreadyRefundedCents: attempt.applicationFeeRefundedCents,
  });
  if (refund.amountCents > plan.additionalFeeRefundCents) {
    // Receipt driver must retain/retry out-of-order evidence, not acknowledge
    // it as applied. Never infer a customer refund from a fee refund alone.
    throw new Error('APPLICATION_FEE_REFUND_EXCEEDS_TARGET');
  }
  return {
    ...attempt,
    applicationFeeRefunds: { ...attempt.applicationFeeRefunds, [refund.id]: refund.amountCents },
    applicationFeeRefundedCents: attempt.applicationFeeRefundedCents + refund.amountCents,
    revision: attempt.revision + 1,
  };
}
