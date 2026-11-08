import { describe, expect, it } from 'vitest';

import { serializeFinancialPeriodSummary } from './financialReportingSerializer';
import type { FinancialReportingRangeSummary } from './financialReportingServer';

function summary(extra: Partial<FinancialReportingRangeSummary> = {}): FinancialReportingRangeSummary {
  return {
    cashCollectedCents: 2500,
    appointmentPaymentsCollectedCents: 0,
    depositCollectedCents: 2500,
    depositRefundedCents: 500,
    completedAppointmentRevenueCents: 6000,
    dateRange: { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-02T00:00:00Z') },
    ...extra,
  } as FinancialReportingRangeSummary;
}

describe('customer payment financial serialization', () => {
  it('retains gross revenue/deposits and independent negative customer cash and platform refunds', () => {
    const fields = {
      customerPaymentCollectedCents: 0,
      customerPaymentHeldForReviewCents: 0,
      customerPaymentRefundedCents: 1000,
      customerPaymentRefundHeldForReviewCents: 200,
      customerPaymentFeeRefundedCents: 100,
      customerPaymentFeeRefundHeldForReviewCents: 20,
      customerPaymentNetCashCents: -1000,
    };

    expect(serializeFinancialPeriodSummary(summary(fields), 'America/Toronto', false)).toMatchObject({
      ...fields,
      cashCollectedCents: 2500,
      completedAppointmentRevenueCents: 6000,
      depositRefundedCents: 500,
    });
  });

  it('does not fabricate zero customer metrics for an older summary', () => {
    const result = serializeFinancialPeriodSummary(summary(), 'UTC', true);

    expect(result.customerPaymentNetCashCents).toBeUndefined();
    expect(result.customerPaymentRefundedCents).toBeUndefined();
    expect(result.cashCollectedCents).toBe(2500);
  });
});
