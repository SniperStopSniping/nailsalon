import { describe, expect, it } from 'vitest';

import type { DepositCreditRow } from '@/libs/depositCredit';

import {
  APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
  appointmentFinancialOverpayment,
  resolveAppointmentDepositFinancials,
  resolveAppointmentDepositPresentation,
} from './appointmentDepositFinancials';

const refundedDeposit: DepositCreditRow = {
  id: 'deposit_refunded',
  status: 'refunded',
  amountCents: 2500,
  currency: 'cad',
  stripePaymentIntentId: 'pi_1',
  stripeRefundId: 're_1',
  refundedAt: new Date('2026-08-15T02:00:00Z'),
  refundStatus: 'succeeded',
  refundStatusChangedAt: new Date('2026-08-15T02:00:00Z'),
  refundAmountCents: 2500,
  refundRequestedAt: new Date('2026-08-15T01:00:00Z'),
  refundTrigger: 'owner',
  refundLastErrorCode: null,
  refundFailureReason: null,
  externalRefundObservedCents: null,
  refundConflictFlag: false,
  refundTerminalFailureCount: 0,
  priorRefundIds: [],
  forfeitedAt: null,
  forfeitureTaxSnapshot: null,
  createdAt: new Date('2026-08-14T00:00:00Z'),
};

const creditableDeposit: DepositCreditRow = {
  ...refundedDeposit,
  id: 'deposit_creditable',
  status: 'paid',
  stripeRefundId: null,
  refundedAt: null,
  refundStatus: null,
  refundStatusChangedAt: null,
  refundAmountCents: null,
  refundRequestedAt: null,
  refundTrigger: null,
};

const completedPaid = {
  invoiceCurrency: 'CAD',
  finalPriceCents: 10000,
  taxAmountCents: 1300,
  tipCents: 0,
  appointmentPaymentsCents: null,
  appointmentStatus: 'completed',
  paymentStatus: 'paid',
};

describe('appointment deposit financial adapter', () => {
  it('preserves the pre-deposit legacy-paid fallback when no deposit history exists', () => {
    const result = resolveAppointmentDepositFinancials({
      ...completedPaid,
      deposits: [],
    });

    expect(result.balance).toMatchObject({
      amountAlreadyPaidCents: 11300,
      balanceCents: 0,
      legacyPaidAssumed: true,
    });
  });

  it('does not let a stale paid scalar hide a balance after a full deposit refund', () => {
    const result = resolveAppointmentDepositFinancials({
      ...completedPaid,
      deposits: [refundedDeposit],
    });

    expect(result.depositResolution).toMatchObject({
      ok: true,
      state: 'fully_refunded',
      eligibleCreditCents: 0,
    });
    expect(result.balance).toMatchObject({
      appointmentPaymentsCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 11300,
      legacyPaidAssumed: false,
    });
  });

  it('preserves legacy-paid inference for clean creditable and uncollected history', () => {
    const creditable = resolveAppointmentDepositFinancials({
      ...completedPaid,
      deposits: [creditableDeposit],
    });
    const waived = resolveAppointmentDepositFinancials({
      ...completedPaid,
      deposits: [{
        ...creditableDeposit,
        id: 'deposit_waived',
        status: 'waived',
        stripePaymentIntentId: null,
      }],
    });

    expect(creditable.balance).toMatchObject({
      depositCreditAppliedCents: 2500,
      appointmentPaymentsCents: 8800,
      amountAlreadyPaidCents: 11300,
      balanceCents: 0,
      legacyPaidAssumed: true,
    });
    expect(waived.balance).toMatchObject({
      depositCreditAppliedCents: 0,
      appointmentPaymentsCents: 11300,
      amountAlreadyPaidCents: 11300,
      balanceCents: 0,
      legacyPaidAssumed: true,
    });
  });

  it('treats a cancelled paid deposit as retained refund-candidate money, not invoice credit', () => {
    const result = resolveAppointmentDepositFinancials({
      deposits: [creditableDeposit],
      invoiceCurrency: 'CAD',
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 0,
      appointmentPaymentsCents: 0,
      appointmentStatus: 'cancelled',
      paymentStatus: 'pending',
    });

    expect(result.depositResolution).toMatchObject({
      ok: true,
      state: 'creditable',
      collectedDepositCents: 2500,
    });
    expect(result.depositCredit).toMatchObject({
      collectedCents: 2500,
      refundedCents: 0,
      eligibleCents: 0,
    });
    expect(result.balance).toMatchObject({
      serviceInvoiceTotalCents: 0,
      depositCreditAppliedCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 0,
    });
    expect(resolveAppointmentDepositPresentation({
      appointmentStatus: 'cancelled',
      resolution: result.depositResolution,
    })).toBe('refund_candidate');
  });

  it('moves cancelled deposits from refund candidate to in-flight and refunded', () => {
    const pending = resolveAppointmentDepositFinancials({
      ...completedPaid,
      appointmentStatus: 'cancelled',
      paymentStatus: 'pending',
      appointmentPaymentsCents: 0,
      deposits: [{
        ...creditableDeposit,
        refundStatus: 'pending',
        refundStatusChangedAt: new Date('2026-08-15T01:30:00Z'),
        refundAmountCents: 2500,
        refundRequestedAt: new Date('2026-08-15T01:00:00Z'),
        refundTrigger: 'owner',
      }],
    });
    const refunded = resolveAppointmentDepositFinancials({
      ...completedPaid,
      appointmentStatus: 'cancelled',
      paymentStatus: 'pending',
      appointmentPaymentsCents: 0,
      deposits: [refundedDeposit],
    });

    expect(resolveAppointmentDepositPresentation({
      appointmentStatus: 'cancelled',
      resolution: pending.depositResolution,
    })).toBe('refund_in_flight');
    expect(resolveAppointmentDepositPresentation({
      appointmentStatus: 'cancelled',
      resolution: refunded.depositResolution,
    })).toBe('refunded');
  });

  it('exposes tender excess as one typed reconciliation condition', () => {
    const result = resolveAppointmentDepositFinancials({
      deposits: [creditableDeposit],
      invoiceCurrency: 'CAD',
      finalPriceCents: 10000,
      taxAmountCents: 0,
      tipCents: 0,
      appointmentPaymentsCents: 10000,
      appointmentStatus: 'completed',
      paymentStatus: 'paid',
    });

    expect(result.balance).toMatchObject({
      depositCreditAppliedCents: 2500,
      appointmentPaymentsCents: 10000,
      tenderExcessCents: 2500,
      balanceCents: 0,
    });
    expect(appointmentFinancialOverpayment(result)).toEqual({
      code: APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
      excessDepositCents: 0,
      tenderExcessCents: 2500,
    });
  });
});
