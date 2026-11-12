import { describe, expect, it } from 'vitest';

import { resolveAppointmentDepositFinancials } from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';

import type { CustomerPaymentAccountingInput } from './accounting';
import { assertCustomerPaymentCollectibleQuote, projectCustomerPaymentRefund, projectCustomerPaymentSettlement, projectCustomerPrepaymentApplication, resolveCustomerPaymentAccounting } from './accounting';
import { verifyCustomerPaymentTender } from './provenance';

const capturedAt = new Date('2026-11-08T12:00:00Z');
function fixture(): CustomerPaymentAccountingInput {
  return {
    appointment: { id: 'appt_1', salonId: 'salon_1', status: 'confirmed', completedAt: null, totalPrice: 10000, finalPriceCents: null, taxableSubtotalCents: null, taxAmountCents: null, taxExempt: null, taxExemptReason: null, invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents: 10000, taxAmountCents: 0, taxableSubtotalCents: 0, taxApplied: false }, currency: 'CAD', capturedAt }), rescheduleTaxSnapshot: null, finalTaxSnapshot: null, tipCents: 0, amountPaidCents: 0, paymentStatus: 'pending' },
    stripeAccountId: 'acct_test',
    moneyRevision: 0,
    invoiceGeneration: 0,
    collectionHold: 'none',
    payments: [],
    deposits: [],
    prepayments: [],
  };
}
function settle(input = fixture(), principalCents = 10000, tipCents = 2000) {
  return projectCustomerPaymentSettlement(input, { expectedRevision: input.moneyRevision, referenceId: `cp_${input.prepayments.length + 1}`, paymentIntentId: `pi_${input.prepayments.length + 1}`, stripeAccountId: input.stripeAccountId, livemode: false, currency: 'CAD', principalCents, tipCents, applicationFeeCents: 100 });
}
function complete(input: CustomerPaymentAccountingInput, finalPriceCents = 10000): CustomerPaymentAccountingInput {
  return { ...input, moneyRevision: input.moneyRevision + 1, appointment: { ...input.appointment, status: 'completed', completedAt: capturedAt, finalPriceCents, taxAmountCents: 0, taxableSubtotalCents: 0, taxExempt: false, taxExemptReason: null, finalTaxSnapshot: buildFinalTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents, taxAmountCents: 0, taxableSubtotalCents: 0, taxApplied: false }, currency: 'CAD', capturedAt, taxExempt: false }) } };
}
function deposit(): CustomerPaymentAccountingInput['deposits'][number] {
  return { id: 'dep_1', salonId: 'salon_1', appointmentId: 'appt_1', status: 'paid', amountCents: 2000, currency: 'CAD', stripePaymentIntentId: 'pi_deposit', stripeRefundId: null, refundedAt: null, refundStatus: null, refundStatusChangedAt: null, refundAmountCents: null, refundRequestedAt: null, refundTrigger: null, refundLastErrorCode: null, refundFailureReason: null, externalRefundObservedCents: null, refundConflictFlag: false, refundTerminalFailureCount: 0, priorRefundIds: [], forfeitedAt: null, forfeitureTaxSnapshot: null, createdAt: capturedAt };
}

describe('canonical customer-payment accounting projection', () => {
  it('matches the actual canonical ledger and deposit APIs', () => {
    const input = fixture();
    input.payments = [{ id: 'tender_1', salonId: 'salon_1', appointmentId: 'appt_1', amountCents: 1000, voidedAt: null, reference: null }];
    input.appointment.amountPaidCents = 1000;
    input.deposits = [deposit()];
    const ledger = resolveAppointmentPaymentLedger({ paymentRows: input.payments, cachedAmountPaidCents: 1000, expectedSalonId: 'salon_1', appointmentStatus: 'confirmed', paymentStatus: 'pending' });

    expect(ledger.ok).toBe(true);

    const canonical = resolveAppointmentDepositFinancials({ deposits: input.deposits, invoiceCurrency: 'CAD', finalPriceCents: 10000, taxAmountCents: 0, tipCents: 0, appointmentPaymentsCents: 1000, appointmentStatus: 'confirmed', paymentStatus: 'pending' });

    expect(resolveCustomerPaymentAccounting(input)).toMatchObject(canonical.balance!);
    expect(resolveCustomerPaymentAccounting(input).balanceCents).toBe(7000);
  });

  it('preserves full prepayment and its tip at completion without making a deposit', () => {
    const paid = settle();

    expect(paid.next.deposits).toEqual([]);
    expect(paid.accounting).toMatchObject({ balanceCents: 0, prepaidTipCents: 2000, effectiveTipCents: 2000, unpostedCreditCents: 12000 });

    const completed = complete(paid.next);
    completed.appointment.tipCents = 0; // A finalized invoice cannot be silently inflated.

    expect(() => resolveCustomerPaymentAccounting(completed)).toThrow('FINAL_TIP_RECONCILIATION');

    completed.appointment.tipCents = 2000;

    expect(resolveCustomerPaymentAccounting(completed)).toMatchObject({ balanceCents: 0, effectiveTipCents: 2000 });

    const applied = projectCustomerPrepaymentApplication(completed, { expectedRevision: completed.moneyRevision, referenceId: 'cp_1', canonicalPaymentId: 'tender_prepaid' });

    expect(applied.accounting).toMatchObject({ balanceCents: 0, canonicalTenderCents: 12000, unpostedCreditCents: 0 });
    expect(applied.next.appointment).toMatchObject({ amountPaidCents: 12000, tipCents: 2000 });
  });

  it('supports partial then full prepayment and added tips without double counting', () => {
    const first = settle(fixture(), 4000, 1000);

    expect(first.accounting.balanceCents).toBe(6000);

    const second = settle(first.next, 6000, 500);

    expect(second.accounting).toMatchObject({ balanceCents: 0, prepaidTipCents: 1500, effectiveTipCents: 1500, unpostedCreditCents: 11500 });
  });

  it('recomputes final-price increases and blocks overpayment after a price reduction', () => {
    const paid = settle().next;

    expect(resolveCustomerPaymentAccounting(complete(paid, 12000))).toMatchObject({ balanceCents: 2000, effectiveTipCents: 2000 });

    const lower = complete(paid, 8000);

    expect(resolveCustomerPaymentAccounting(lower)).toMatchObject({ collectionBlock: 'OVERPAYMENT_RECONCILIATION_REQUIRED', tenderExcessCents: 2000 });
    expect(() => assertCustomerPaymentCollectibleQuote(lower, { expectedRevision: lower.moneyRevision, principalCents: 1, additionalTipCents: 0 })).toThrow('OVERPAYMENT');
  });

  it('does not silently append a new tip to an already-final invoice', () => {
    const input = complete(fixture());

    expect(() => assertCustomerPaymentCollectibleQuote(input, { expectedRevision: input.moneyRevision, principalCents: 10000, additionalTipCents: 1000 })).toThrow('FINAL_TIP_CHANGE_REQUIRES_REISSUE');
    expect(assertCustomerPaymentCollectibleQuote(input, { expectedRevision: input.moneyRevision, principalCents: 10000, additionalTipCents: 0 }).chargeCents).toBe(10000);
  });

  it('does not double count a prepayment represented by a linked tender row', () => {
    const completed = complete(settle().next);
    const applied = projectCustomerPrepaymentApplication(completed, { expectedRevision: completed.moneyRevision, referenceId: 'cp_1', canonicalPaymentId: 'tender_1' });

    expect(applied.accounting.amountAlreadyPaidCents).toBe(12000);

    const broken = { ...applied.next, prepayments: applied.next.prepayments.map(row => ({ ...row, canonicalPaymentId: null })) };

    expect(() => resolveCustomerPaymentAccounting(broken)).toThrow('UNLINKED_TENDER');
  });

  it('rejects stale quotes, overcollection, foreign rows and mismatched provider accounts', () => {
    const input = fixture();

    expect(() => assertCustomerPaymentCollectibleQuote(input, { expectedRevision: 1, principalCents: 100, additionalTipCents: 0 })).toThrow('STALE_QUOTE');
    expect(() => settle(input, 10001)).toThrow('EXCEEDS_BALANCE');
    expect(() => resolveCustomerPaymentAccounting({ ...input, deposits: [{ ...deposit(), salonId: 'foreign' }] })).toThrow('FOREIGN_MONEY');

    const paid = settle().next;

    expect(() => resolveCustomerPaymentAccounting({ ...paid, stripeAccountId: 'acct_other' })).toThrow('CREDIT_RECONCILIATION');
    expect(() => resolveCustomerPaymentAccounting({ ...paid, deposits: [{ ...deposit(), stripePaymentIntentId: 'pi_1' }] })).toThrow('DUPLICATE_DEPOSIT');
  });

  it('rejects ambiguous legacy tender, stale tax scalars and missing frozen tax evidence', () => {
    const input = fixture();
    input.appointment.amountPaidCents = 1000;

    expect(() => resolveCustomerPaymentAccounting(input)).toThrow('LEDGER_RECONCILIATION');

    const badTax = fixture();
    badTax.appointment.totalPrice = 9999;

    expect(() => resolveCustomerPaymentAccounting(badTax)).toThrow('TAX_INVALID');

    const old = fixture();
    old.appointment.bookingTaxSnapshot = null;

    expect(() => resolveCustomerPaymentAccounting(old)).toThrow('FROZEN_INVOICE');
  });

  it('blocks unresolved deposit refunds and comp collection', () => {
    const input = fixture();
    input.deposits = [{ ...deposit(), refundStatus: 'pending' }];

    expect(() => resolveCustomerPaymentAccounting(input)).toThrow('DEPOSIT_BLOCKED');

    const comp = fixture();
    comp.appointment.paymentStatus = 'comp';

    expect(() => settle(comp)).toThrow('COMPLIMENTARY');
  });

  it('blocks cancellation/no-show and reopening until money is reconciled', () => {
    for (const status of ['cancelled', 'no_show']) {
      const input = settle(fixture(), 4000).next;
      input.appointment.status = status;

      expect(resolveCustomerPaymentAccounting(input).collectionBlock).toBe('TERMINAL_APPOINTMENT');
      expect(() => settle(input, 1000)).toThrow('TERMINAL');
    }
    const reopened = settle(fixture(), 4000).next;
    reopened.invoiceGeneration++;

    expect(() => settle(reopened, 1000)).toThrow('REOPEN_RECONCILIATION');
  });

  it('preserves prepaid tip before finalization even if an old draft resets it', () => {
    const input = settle().next;
    input.appointment.tipCents = 0;

    expect(resolveCustomerPaymentAccounting(input).effectiveTipCents).toBe(2000);
  });

  it('holds full refunds of active and completed invoices against recollection', () => {
    for (const input of [settle().next, complete(settle().next)]) {
      const result = projectCustomerPaymentRefund(input, { refundedAt: capturedAt, expectedRevision: input.moneyRevision, referenceId: 'cp_1', principalRefundCents: 10000, tipRefundCents: 2000 });

      expect(result.accounting.collectionBlock).toBe('REFUND_RECONCILIATION_REQUIRED');
      expect(() => settle(result.next, 10000)).toThrow('REFUND_RECONCILIATION');
    }
  });

  it('refunds cancelled prepayment without reviving service balance or mutating deposits', () => {
    const input = settle().next;
    input.appointment.status = 'cancelled';
    const result = projectCustomerPaymentRefund(input, { refundedAt: capturedAt, expectedRevision: input.moneyRevision, referenceId: 'cp_1', principalRefundCents: 10000, tipRefundCents: 2000 });

    expect(result.accounting).toMatchObject({ balanceCents: 0, unpostedCreditCents: 0, prepaidTipCents: 0, collectionBlock: 'TERMINAL_APPOINTMENT' });
    expect(result.applicationFeeRefundDueCents).toBe(100);
    expect(result.next.deposits).toEqual([]);
  });

  it('allocates partial principal and tip refunds explicitly and holds recollection', () => {
    const input = settle().next;
    const result = projectCustomerPaymentRefund(input, { refundedAt: capturedAt, expectedRevision: input.moneyRevision, referenceId: 'cp_1', principalRefundCents: 3000, tipRefundCents: 1000 });

    expect(result.accounting).toMatchObject({ effectiveTipCents: 2000, prepaidTipCents: 1000, balanceCents: 4000, collectionBlock: 'REFUND_RECONCILIATION_REQUIRED' });
    expect(result.applicationFeeRefundDueCents).toBe(33);
    expect(() => settle(result.next, 3000)).toThrow('REFUND_RECONCILIATION');
    expect(() => projectCustomerPaymentRefund(result.next, { refundedAt: capturedAt, expectedRevision: result.next.moneyRevision, referenceId: 'cp_1', principalRefundCents: 7001, tipRefundCents: 0 })).toThrow('INVALID_REFUND_ALLOCATION');
  });

  it('preserves immutable gross tender and invoice while deriving refunded net and hold', () => {
    const completed = complete(settle().next);
    const input = projectCustomerPrepaymentApplication(completed, { expectedRevision: completed.moneyRevision, referenceId: 'cp_1', canonicalPaymentId: 'tender_1' }).next;
    const result = projectCustomerPaymentRefund(input, { refundedAt: capturedAt, expectedRevision: input.moneyRevision, referenceId: 'cp_1', principalRefundCents: 5000, tipRefundCents: 1000 });

    expect(result.next.payments).toEqual(input.payments);
    expect(result.next.payments[0]?.amountCents).toBe(12000);
    expect(result.next.appointment.amountPaidCents).toBe(6000);
    expect(result.accounting.collectionBlock).toBe('REFUND_RECONCILIATION_REQUIRED');
    expect(result.accounting).toMatchObject({ canonicalTenderCents: 6000, unpostedCreditCents: 0, effectiveTipCents: 2000, prepaidTipCents: 1000 });

    const final = projectCustomerPaymentRefund(result.next, { refundedAt: capturedAt, expectedRevision: result.next.moneyRevision, referenceId: 'cp_1', principalRefundCents: 5000, tipRefundCents: 1000 });

    expect(final.next.payments).toEqual(input.payments);
    expect(final.next.appointment.amountPaidCents).toBe(0);
    expect(final.next.appointment.tipCents).toBe(2000); // Frozen gross invoice, not net cash.
    expect(final.accounting.prepaidTipCents).toBe(0);
    expect(final.accounting.collectionBlock).toBe('REFUND_RECONCILIATION_REQUIRED');
    expect(final.applicationFeeRefundDueCents).toBe(100);
  });
});

describe('immutable captured refund accounting', () => {
  const captureId = '00000000-0000-4000-8000-000000000001';
  const reference = `customer_payment_capture:${captureId}`;
  const capture = { id: captureId, salonId: 'salon_1', appointmentId: 'appt_1', amountCents: 12000, tipCents: 2000, state: 'posted' as const, mode: 'test' as const, synthetic: true as const };
  const gross = { id: `cpay_${captureId}`, salonId: 'salon_1', appointmentId: 'appt_1', amountCents: 12000, reference, method: 'online', recordedByType: 'system', voidedAt: null };
  function posted() {
    const input = settle().next;
    input.prepayments = input.prepayments.map(credit => ({ ...credit, referenceId: reference, canonicalPaymentId: gross.id }));
    input.payments = [verifyCustomerPaymentTender(gross, capture, [])];
    input.appointment.amountPaidCents = 12000;
    return input;
  }

  it('requires fresh proof to project a reserved tender refund and never rewrites gross', () => {
    const input = posted();
    const request = { expectedRevision: input.moneyRevision, referenceId: reference, refundedAt: capturedAt, principalRefundCents: 3000, tipRefundCents: 1000 };

    expect(() => projectCustomerPaymentRefund(input, request)).toThrow('REFUND_EVIDENCE_REQUIRED');

    const refundedTender = verifyCustomerPaymentTender(gross, capture, [{ id: 'refund1', refundId: 're_1', captureId, salonId: 'salon_1', appointmentId: 'appt_1', amountCents: 4000, principalCents: 3000, tipCents: 1000, state: 'applied' }]);
    const result = projectCustomerPaymentRefund(input, { ...request, refundedTender });

    expect(result.next.payments[0]?.amountCents).toBe(12000);
    expect(result.next.appointment).toMatchObject({ amountPaidCents: 8000, tipCents: 2000 });
    expect(result.accounting).toMatchObject({ canonicalTenderCents: 8000, collectionBlock: 'REFUND_RECONCILIATION_REQUIRED' });
    expect(() => projectCustomerPaymentRefund(result.next, { ...request, refundedTender })).toThrow('STALE_QUOTE');
    expect(resolveCustomerPaymentAccounting({ ...result.next, collectionHold: 'none' }).collectionBlock).toBe('REFUND_RECONCILIATION_REQUIRED');
    expect(() => settle({ ...result.next, collectionHold: 'none' })).toThrow('REFUND_RECONCILIATION');
    expect(() => resolveCustomerPaymentAccounting({ ...result.next, prepayments: input.prepayments })).toThrow('REFUND_EVIDENCE_MISMATCH');
  });

  it('holds review receipts with no applied allocation and no customer net change', () => {
    const input = posted();
    input.payments = [verifyCustomerPaymentTender(gross, capture, [{ id: 'review1', refundId: 're_review', captureId, salonId: 'salon_1', appointmentId: 'appt_1', amountCents: 15000, principalCents: 15000, tipCents: 0, state: 'held_review' }])];

    expect(resolveCustomerPaymentAccounting(input)).toMatchObject({ canonicalTenderCents: 12000, collectionBlock: 'REFUND_RECONCILIATION_REQUIRED' });
  });

  it('keeps actual fee return independent from planned customer-proportional target', () => {
    const input = posted();
    input.prepayments = input.prepayments.map(credit => ({ ...credit, applicationFeeRefundedCents: 100 }));

    expect(resolveCustomerPaymentAccounting(input)).toMatchObject({ canonicalTenderCents: 12000, collectionBlock: null });

    const refundedTender = verifyCustomerPaymentTender(gross, capture, [{ id: 'refund1', refundId: 're_1', captureId, salonId: 'salon_1', appointmentId: 'appt_1', amountCents: 1000, principalCents: 1000, tipCents: 0, state: 'applied' }]);
    const result = projectCustomerPaymentRefund(input, { expectedRevision: input.moneyRevision, referenceId: reference, refundedAt: capturedAt, principalRefundCents: 1000, tipRefundCents: 0, refundedTender });

    expect(result.applicationFeeRefundDueCents).toBe(0);
    expect(result.next.prepayments[0]?.applicationFeeRefundedCents).toBe(100);
  });
});
