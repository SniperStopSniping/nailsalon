import { describe, expect, it, vi } from 'vitest';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import type { DepositCreditRow } from '@/libs/depositCredit';
import {
  buildBookingTaxSnapshot,
  buildFinalTaxSnapshot,
  buildRescheduleTaxSnapshot,
  resolveTaxConfig,
} from '@/libs/taxConfig';

import { buildBookingEmailFinancialSummary } from './bookingEmailFinancialSummary.server';

vi.mock('server-only', () => ({}));

const paidDeposit: DepositCreditRow = {
  id: 'deposit_1',
  status: 'paid',
  amountCents: 2500,
  currency: 'CAD',
  stripePaymentIntentId: 'pi_1',
  stripeRefundId: null,
  refundedAt: null,
  refundStatus: null,
  refundStatusChangedAt: null,
  refundAmountCents: null,
  refundRequestedAt: null,
  refundTrigger: null,
  refundLastErrorCode: null,
  refundFailureReason: null,
  externalRefundObservedCents: null,
  refundConflictFlag: false,
  refundTerminalFailureCount: 0,
  priorRefundIds: [],
  forfeitedAt: null,
  forfeitureTaxSnapshot: null,
  createdAt: new Date('2026-08-15T00:00:00Z'),
};

const bookingTaxConfig = resolveTaxConfig({
  payments: {
    tax: {
      enabled: true,
      name: 'HST',
      rateBps: 1300,
      jurisdiction: 'Ontario',
      country: 'Canada',
      region: 'ON',
    },
  },
}, new Date('2026-08-15T00:00:00.000Z'));
const bookingSnapshot = buildBookingTaxSnapshot({
  taxConfig: bookingTaxConfig,
  totals: computeCheckoutTotals({
    items: [{ lineTotalCents: 10000, taxable: true }],
    taxConfig: bookingTaxConfig,
  }),
  capturedAt: new Date('2026-08-15T00:00:00.000Z'),
  currency: 'CAD',
});
const includedTaxConfig = {
  ...bookingTaxConfig,
  pricesIncludeTax: true,
};
const includedBookingSnapshot = buildBookingTaxSnapshot({
  taxConfig: includedTaxConfig,
  totals: computeCheckoutTotals({
    items: [{ lineTotalCents: 11300, taxable: true }],
    taxConfig: includedTaxConfig,
  }),
  capturedAt: new Date('2026-08-15T00:00:00.000Z'),
  currency: 'CAD',
});
const finalSnapshot = buildFinalTaxSnapshot({
  taxConfig: bookingTaxConfig,
  totals: computeCheckoutTotals({
    items: [{ lineTotalCents: 10000, taxable: true }],
    taxConfig: bookingTaxConfig,
  }),
  capturedAt: new Date('2026-08-15T02:00:00.000Z'),
  currency: 'CAD',
  taxExempt: false,
});

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    status: 'confirmed',
    completedAt: null,
    paymentStatus: 'pending',
    totalPrice: 10000,
    finalPriceCents: null,
    taxableSubtotalCents: null,
    taxAmountCents: null,
    taxExempt: null,
    taxExemptReason: null,
    tipCents: 0,
    invoiceCurrency: null,
    bookingTaxSnapshot: bookingSnapshot,
    rescheduleTaxSnapshot: null,
    finalTaxSnapshot: null,
    ...overrides,
  };
}

describe('booking email financial summary', () => {
  it('uses the frozen tax snapshot and canonical deposit credit', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment(),
      deposits: [paidDeposit],
      appointmentPaymentsCents: 0,
    })).toMatchObject({
      currency: 'CAD',
      serviceInvoiceTotalCents: 11300,
      totalDueCents: 11300,
      taxAmountCents: 1300,
      taxLabel: 'HST',
      taxMode: 'added',
      taxClassification: 'estimate',
      taxApplied: true,
      collectedDepositCents: 2500,
      depositCreditAppliedCents: 2500,
      amountAlreadyPaidCents: 2500,
      balanceCents: 8800,
      depositBlockedCode: null,
    });
  });

  it('preserves validated included-tax booking evidence for email wording', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({
        totalPrice: 11300,
        bookingTaxSnapshot: includedBookingSnapshot,
      }),
      deposits: [],
      appointmentPaymentsCents: 0,
    })).toMatchObject({
      serviceInvoiceTotalCents: 11300,
      totalDueCents: 11300,
      taxAmountCents: 1300,
      taxLabel: 'HST',
      taxMode: 'included',
      taxClassification: 'estimate',
      taxApplied: true,
    });
  });

  it('uses the latest reschedule estimate without rewriting original booking history', () => {
    const rescheduleTaxSnapshot = buildRescheduleTaxSnapshot({
      settings: {
        payments: {
          tax: {
            enabled: true,
            name: 'HST',
            rateBps: 1300,
          },
        },
      },
      capturedAt: new Date('2026-08-16T00:00:00.000Z'),
      currency: 'CAD',
      serviceLineTotalCents: 10_000,
      addOnLineTotalCents: 0,
      discountCents: 1_000,
    });

    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({
        totalPrice: 9_000,
        rescheduleTaxSnapshot,
      }),
      deposits: [],
      appointmentPaymentsCents: 0,
    })).toMatchObject({
      serviceInvoiceTotalCents: 10_170,
      taxAmountCents: 1_170,
      balanceCents: 10_170,
      taxClassification: 'estimate',
    });
    expect(bookingSnapshot.serviceSubtotalCents).toBe(10_000);
  });

  it('preserves validated final-actual tax evidence for email wording', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({
        status: 'completed',
        completedAt: new Date(finalSnapshot.capturedAt),
        paymentStatus: 'partially_paid',
        finalPriceCents: 10000,
        taxableSubtotalCents: 10000,
        taxAmountCents: 1300,
        taxExempt: false,
        taxExemptReason: null,
        invoiceCurrency: 'CAD',
        finalTaxSnapshot: finalSnapshot,
      }),
      deposits: [],
      appointmentPaymentsCents: 0,
    })).toMatchObject({
      serviceInvoiceTotalCents: 11300,
      totalDueCents: 11300,
      taxAmountCents: 1300,
      taxLabel: 'HST',
      taxMode: 'added',
      taxClassification: 'actual',
      taxApplied: true,
    });
  });

  it('keeps tips due after applying the deposit against service and tax', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({
        finalPriceCents: 10000,
        taxAmountCents: 1300,
        tipCents: 1000,
        invoiceCurrency: 'CAD',
      }),
      deposits: [paidDeposit],
      appointmentPaymentsCents: 0,
    })).toMatchObject({
      serviceInvoiceTotalCents: 11300,
      totalDueCents: 12300,
      depositCreditAppliedCents: 2500,
      balanceCents: 9800,
    });
  });

  it('surfaces an in-flight refund as blocked instead of silently charging', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment(),
      deposits: [{
        ...paidDeposit,
        status: 'refunded',
        stripeRefundId: 're_1',
        refundedAt: new Date('2026-08-15T01:00:00Z'),
        refundStatus: 'pending',
        refundStatusChangedAt: new Date('2026-08-15T01:00:00Z'),
        refundAmountCents: 2500,
        refundRequestedAt: new Date('2026-08-15T01:00:00Z'),
        refundTrigger: 'admin_cancel',
      }],
      appointmentPaymentsCents: 0,
    })).toMatchObject({
      depositCreditAppliedCents: 0,
      balanceCents: 11300,
      depositBlockedCode: 'DEPOSIT_REFUND_IN_FLIGHT',
    });
  });

  it('does not invent a currency for a historical appointment', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({ bookingTaxSnapshot: null }),
      deposits: [],
      appointmentPaymentsCents: 0,
    })).toBeNull();
  });

  it('fails closed when a D6.1 completed booking loses its final snapshot', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({
        status: 'completed',
        completedAt: new Date(finalSnapshot.capturedAt),
        paymentStatus: 'paid',
        finalPriceCents: 10000,
        taxableSubtotalCents: 10000,
        taxAmountCents: 1300,
        taxExempt: false,
        invoiceCurrency: 'CAD',
      }),
      deposits: [paidDeposit],
      appointmentPaymentsCents: 8800,
    })).toBeNull();
  });

  it('preserves an explicit legacy path only when both tax snapshots are absent', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({
        status: 'completed',
        paymentStatus: 'paid',
        invoiceCurrency: 'CAD',
        bookingTaxSnapshot: null,
        finalTaxSnapshot: null,
      }),
      deposits: [],
      appointmentPaymentsCents: 10000,
    })).toMatchObject({
      currency: 'CAD',
      serviceInvoiceTotalCents: 10000,
      balanceCents: 0,
    });
  });

  it('fails closed when tender exceeds the canonical completed invoice', () => {
    expect(buildBookingEmailFinancialSummary({
      appointment: appointment({
        status: 'completed',
        paymentStatus: 'paid',
        finalPriceCents: 10000,
        taxableSubtotalCents: 10000,
        taxAmountCents: 1300,
        taxExempt: false,
        taxExemptReason: null,
        invoiceCurrency: 'CAD',
        finalTaxSnapshot: finalSnapshot,
      }),
      deposits: [],
      appointmentPaymentsCents: 12000,
    })).toBeNull();
  });
});
