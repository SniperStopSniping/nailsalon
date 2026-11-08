import { describe, expect, it } from 'vitest';

import type { CustomerPaymentObservation } from './attempt';
import {
  applyCustomerPaymentObservation,
  bindCustomerPaymentApplicationFee,
  bindCustomerPaymentSession,
  prepareCustomerPaymentAttempt,
  recordCustomerPaymentFeeRefund,
  recordCustomerPaymentRefund,
} from './attempt';
import { calculatePaymentSnapshot } from './money';

function prepared() {
  return prepareCustomerPaymentAttempt({
    referenceId: 'cp_test1',
    salonId: 'salon_test1',
    appointmentId: 'appt_test1',
    stripeAccountId: 'acct_test1',
    expiresAt: 2000,
    snapshot: calculatePaymentSnapshot({
      currency: 'cad',
      servicesCents: 10000,
      discountCents: 0,
      taxCents: 1300,
      tipCents: 2000,
      collection: 'full',
    }),
  });
}

function opened() {
  return bindCustomerPaymentSession(prepared(), { id: 'cs_test_first', livemode: false, stripeAccountId: 'acct_test1' });
}

function observation(overrides: Partial<CustomerPaymentObservation> = {}): CustomerPaymentObservation {
  return {
    eventId: 'evt_test1',
    stripeAccountId: 'acct_test1',
    livemode: false,
    referenceId: 'cp_test1',
    sessionId: 'cs_test_first',
    status: 'succeeded',
    currency: 'cad',
    amountCents: 13300,
    applicationFeeCents: 100,
    paymentIntentId: 'pi_test1',
    observedAt: 1500,
    ...overrides,
  };
}

function paid() {
  return applyCustomerPaymentObservation(opened(), observation(), 1);
}

describe('payment attempt rehearsal state', () => {
  it('starts uncollected and copies immutable quote data', () => {
    const attempt = prepared();

    expect(attempt.phase).toBe('prepared');
    expect(attempt.sessionId).toBeNull();
    expect(attempt.settledCents).toBe(0);
    expect(Object.isFrozen(attempt.snapshot)).toBe(true);
  });

  it.each(['chargeCents', 'applicationFeeCents', 'remainingCents', 'totalCents', 'version'] as const)('refuses tampered derived snapshot field %s', (field) => {
    const attempt = prepared();

    expect(() => prepareCustomerPaymentAttempt({
      ...attempt,
      snapshot: { ...attempt.snapshot, [field]: attempt.snapshot[field] + 1 },
    })).toThrow('PAYMENT_SNAPSHOT_MISMATCH');
  });

  it('preserves verified captured money while contradictory evidence is held for review', () => {
    const attempt = paid();
    const held = applyCustomerPaymentObservation(attempt, observation({ eventId: 'evt_mismatch', amountCents: 1 }), attempt.revision);

    expect(held.phase).toBe('held_review');
    expect(held.settledCents).toBe(13300);
    expect(held.paymentIntentId).toBe('pi_test1');
    expect(recordCustomerPaymentRefund(held, {
      id: 're_afterhold',
      amountCents: 13300,
      paymentIntentId: 'pi_test1',
      stripeAccountId: 'acct_test1',
      livemode: false,
    }, held.revision).attempt.refundedCents).toBe(13300);
  });

  it('binds one test session and makes an identical binding a no-op', () => {
    const attempt = opened();

    expect(bindCustomerPaymentSession(attempt, { id: 'cs_test_first', livemode: false, stripeAccountId: 'acct_test1' })).toBe(attempt);
    expect(() => bindCustomerPaymentSession(attempt, { id: 'cs_test_second', livemode: false, stripeAccountId: 'acct_test1' })).toThrow('ALREADY_BOUND');
  });

  it.each([
    { id: 'cs_live_first', livemode: true, stripeAccountId: 'acct_test1' },
    { id: 'cs_test_first', livemode: false, stripeAccountId: 'acct_other' },
  ])('rejects the wrong account or live session %j', (session) => {
    expect(() => bindCustomerPaymentSession(prepared(), session)).toThrow('IDENTITY_MISMATCH');
  });

  it('marks a matching provider observation paid and ignores its replay', () => {
    const attempt = paid();

    expect(attempt.phase).toBe('paid');
    expect(attempt.settledCents).toBe(13300);
    expect(attempt.paymentIntentId).toBe('pi_test1');
    expect(applyCustomerPaymentObservation(attempt, observation({ observedAt: 1700 }), attempt.revision)).toBe(attempt);
  });

  it('rejects an event ID reused with different financial evidence', () => {
    const attempt = paid();

    expect(() => applyCustomerPaymentObservation(attempt, observation({ amountCents: 1 }), attempt.revision)).toThrow('EVENT_IDENTITY_CONFLICT');
  });

  it('requires a transaction revision check before applying an event', () => {
    expect(() => applyCustomerPaymentObservation(opened(), observation(), 0)).toThrow('REVISION_CONFLICT');
  });

  it.each([
    { stripeAccountId: 'acct_other' },
    { livemode: true },
    { referenceId: 'cp_other' },
    { sessionId: 'cs_test_other' },
    { currency: 'usd' },
    { amountCents: 1300 },
    { applicationFeeCents: 0 },
  ])('holds mismatched evidence without crediting money %j', (overrides) => {
    const result = applyCustomerPaymentObservation(opened(), observation(overrides), 1);

    expect(result.phase).toBe('held_review');
    expect(result.paymentIntentId).toBeNull();
  });

  it('does not resurrect an expired booking, even with an earlier timestamp', () => {
    const expired = applyCustomerPaymentObservation(opened(), observation({ eventId: 'evt_expired', status: 'expired', paymentIntentId: null }), 1);
    const late = applyCustomerPaymentObservation(expired, observation(), expired.revision);

    expect(late.phase).toBe('refund_required');
    expect(late.reviewReason).toBe('LATE_PAYMENT');
  });

  it('holds a late success for refund and never confirms it as paid', () => {
    expect(applyCustomerPaymentObservation(opened(), observation({ observedAt: 2000 }), 1).phase).toBe('refund_required');
  });

  it.each(['expired', 'failed'] as const)('never unpays a verified payment on a later %s event', (status) => {
    const attempt = paid();

    expect(applyCustomerPaymentObservation(attempt, observation({ eventId: `evt_${status}`, status, paymentIntentId: null }), attempt.revision).phase).toBe('paid');
  });

  it('does not reopen an evidence hold automatically', () => {
    const held = applyCustomerPaymentObservation(opened(), observation({ amountCents: 2 }), 1);
    const corrected = applyCustomerPaymentObservation(held, observation({ eventId: 'evt_corrected' }), held.revision);

    expect(corrected.phase).toBe('held_review');
    expect(corrected.settledCents).toBe(13300);
    expect(corrected.paymentIntentId).toBe('pi_test1');
  });
});

describe('successful customer-payment refund evidence', () => {
  const refund = { id: 're_test1', amountCents: 6650, paymentIntentId: 'pi_test1', stripeAccountId: 'acct_test1', livemode: false };

  it('records half of the charge once and proposes half of the fee for reversal', () => {
    const first = recordCustomerPaymentRefund(paid(), refund, 2);

    expect(first.attempt.refundedCents).toBe(6650);
    expect(first.applicationFeeRefundDueCents).toBe(50);

    const replay = recordCustomerPaymentRefund(first.attempt, refund, first.attempt.revision);

    expect(replay.attempt).toBe(first.attempt);
    // A plan is not a completed fee refund; it remains due until durable provider evidence exists.
    expect(replay.applicationFeeRefundDueCents).toBe(50);
  });

  it('full cumulative refund returns the entire platform fee', () => {
    const first = recordCustomerPaymentRefund(paid(), refund, 2);
    const second = recordCustomerPaymentRefund(first.attempt, { ...refund, id: 're_test2' }, first.attempt.revision);

    expect(second.attempt.refundedCents).toBe(13300);
    expect(second.applicationFeeRefundDueCents).toBe(100);
  });

  it('rejects an oversized refund and conflicting refund replay', () => {
    expect(() => recordCustomerPaymentRefund(paid(), { ...refund, amountCents: 13301 }, 2)).toThrow('INVALID_REFUND_TOTALS');

    const first = recordCustomerPaymentRefund(paid(), refund, 2);

    expect(() => recordCustomerPaymentRefund(first.attempt, { ...refund, amountCents: 1 }, first.attempt.revision)).toThrow('REFUND_IDENTITY_CONFLICT');
  });

  it.each([{ livemode: true }, { stripeAccountId: 'acct_other' }, { paymentIntentId: 'pi_other' }])('rejects foreign/live refund evidence %j', (overrides) => {
    expect(() => recordCustomerPaymentRefund(paid(), { ...refund, ...overrides }, 2)).toThrow('REFUND_EVIDENCE_MISMATCH');
  });

  it('does not accept refund evidence against an unverified payment', () => {
    expect(() => recordCustomerPaymentRefund(opened(), refund, 1)).toThrow('REFUND_EVIDENCE_MISMATCH');
  });
});

describe('independent successful application-fee refund evidence', () => {
  const fee = { id: 'fee_test1', paymentIntentId: 'pi_test1', stripeAccountId: 'acct_test1', livemode: false, currency: 'cad', amountCents: 100 };
  const refund = { id: 'fr_test1', applicationFeeId: fee.id, stripeAccountId: fee.stripeAccountId, livemode: false, currency: 'cad', amountCents: 50 };
  function boundAndHalfRefunded() {
    const bound = bindCustomerPaymentApplicationFee(paid(), fee, 2);
    return recordCustomerPaymentRefund(bound, { id: 're_half', amountCents: 6650, paymentIntentId: fee.paymentIntentId, stripeAccountId: fee.stripeAccountId, livemode: false }, bound.revision).attempt;
  }

  it('binds original fee once and rejects a replacement identity', () => {
    const bound = bindCustomerPaymentApplicationFee(paid(), fee, 2);

    expect(bindCustomerPaymentApplicationFee(bound, fee, bound.revision)).toBe(bound);
    expect(() => bindCustomerPaymentApplicationFee(bound, { ...fee, id: 'fee_other' }, bound.revision)).toThrow('APPLICATION_FEE_IDENTITY_CONFLICT');
    expect(() => bindCustomerPaymentApplicationFee(paid(), fee, 0)).toThrow('REVISION_CONFLICT');
    expect(() => bindCustomerPaymentApplicationFee(opened(), fee, 1)).toThrow('EVIDENCE_MISMATCH');
  });

  it.each([{ livemode: true }, { stripeAccountId: 'acct_other' }, { paymentIntentId: 'pi_other' }, { currency: 'usd' }, { amountCents: 99 }, { id: 'fee_' }])('rejects invalid original fee %j', (override) => {
    expect(() => bindCustomerPaymentApplicationFee(paid(), { ...fee, ...override }, 2)).toThrow('EVIDENCE_MISMATCH');
  });

  it('records confirmed partial then full fee refunds independently and idempotently', () => {
    const start = boundAndHalfRefunded();
    const first = recordCustomerPaymentFeeRefund(start, refund, start.revision);

    expect(first.applicationFeeRefundedCents).toBe(50);
    expect(first.refundedCents).toBe(6650);
    expect(first.settledCents).toBe(13300);
    expect(recordCustomerPaymentFeeRefund(first, refund, first.revision)).toBe(first);
    expect(() => recordCustomerPaymentFeeRefund(first, { ...refund, amountCents: 1 }, first.revision)).toThrow('IDENTITY_CONFLICT');

    const secondCustomer = recordCustomerPaymentRefund(first, { id: 're_rest', amountCents: 6650, paymentIntentId: fee.paymentIntentId, stripeAccountId: fee.stripeAccountId, livemode: false }, first.revision);

    expect(secondCustomer.applicationFeeRefundDueCents).toBe(50);

    const full = recordCustomerPaymentFeeRefund(secondCustomer.attempt, { ...refund, id: 'fr_rest' }, secondCustomer.attempt.revision);

    expect(full.applicationFeeRefundedCents).toBe(100);
    expect(full.refundedCents).toBe(13300);
    expect(() => recordCustomerPaymentFeeRefund(full, { ...refund, id: 'fr_excess', amountCents: 1 }, full.revision)).toThrow('EXCEEDS_TARGET');
  });

  it('rejects unbound, premature, over-target and stale evidence', () => {
    expect(() => recordCustomerPaymentFeeRefund(paid(), refund, 2)).toThrow('EVIDENCE_MISMATCH');

    const bound = bindCustomerPaymentApplicationFee(paid(), fee, 2);

    expect(() => recordCustomerPaymentFeeRefund(bound, refund, bound.revision)).toThrow('EXCEEDS_TARGET');

    const half = boundAndHalfRefunded();

    expect(() => recordCustomerPaymentFeeRefund(half, { ...refund, amountCents: 51 }, half.revision)).toThrow('EXCEEDS_TARGET');
    expect(() => recordCustomerPaymentFeeRefund(half, refund, 0)).toThrow('REVISION_CONFLICT');
  });

  it.each([{ livemode: true }, { stripeAccountId: 'acct_other' }, { applicationFeeId: 'fee_other' }, { currency: 'usd' }, { amountCents: 0 }, { id: 'fr_' }])('rejects foreign/invalid fee refund %j', (override) => {
    const half = boundAndHalfRefunded();

    expect(() => recordCustomerPaymentFeeRefund(half, { ...refund, ...override }, half.revision)).toThrow('EVIDENCE_MISMATCH');
  });

  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid fee refund cents %s', (amountCents) => {
    const half = boundAndHalfRefunded();

    expect(() => recordCustomerPaymentFeeRefund(half, { ...refund, amountCents }, half.revision)).toThrow('INVALID_CENTS');
  });
});
