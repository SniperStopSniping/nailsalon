import type {
  CurrentFinancialReportingSummaries,
  FinancialReportingRangeSummary,
} from '@/libs/financialReportingServer';
import type { FinancialPeriodSummary } from '@/types/admin';
import type { OwnerFinancialSummary } from '@/types/ownerFinancialSummary';

export function serializeFinancialPeriodSummary(
  summary: FinancialReportingRangeSummary,
  timeZone: string,
  isToDate: boolean,
): FinancialPeriodSummary {
  return {
    completedAppointmentRevenueCents:
      summary.completedAppointmentRevenueCents,
    cashCollectedCents: summary.cashCollectedCents,
    appointmentPaymentsCollectedCents:
      summary.appointmentPaymentsCollectedCents,
    depositCollectedCents: summary.depositCollectedCents,
    depositRefundedCents: summary.depositRefundedCents,
    depositForfeitedCents: summary.depositForfeitedCents,
    depositForfeitureEstimatedTaxCents:
      summary.depositForfeitureEstimatedTaxCents,
    depositForfeitureEstimatedNetCents:
      summary.depositForfeitureEstimatedNetCents,
    depositForfeitureRefundReversalCents:
      summary.depositForfeitureRefundReversalCents,
    depositForfeitureTaxReversalCents:
      summary.depositForfeitureTaxReversalCents,
    depositForfeitureNetReversalCents:
      summary.depositForfeitureNetReversalCents,
    forfeitureTaxIdentityBuckets: summary.forfeitureTaxIdentityBuckets,
    depositAppliedCents: summary.depositAppliedCents,
    remainingBalancePaymentsCollectedCents:
      summary.remainingBalancePaymentsCollectedCents,
    unattributedPaymentEventCount:
      summary.unattributedPaymentEventCount,
    unresolvedDepositApplicationCount:
      summary.unresolvedDepositApplicationCount,
    unattributedDepositEventCount:
      summary.unattributedDepositEventCount,
    unresolvedDepositEventCount:
      summary.unresolvedDepositEventCount,
    unknownCurrencyAppointmentCount:
      summary.unknownCurrencyAppointmentCount,
    excludedForeignCurrencyAppointmentCount:
      summary.excludedForeignCurrencyAppointmentCount,
    unknownCurrencyPaymentEventCount:
      summary.unknownCurrencyPaymentEventCount,
    excludedForeignCurrencyPaymentEventCount:
      summary.excludedForeignCurrencyPaymentEventCount,
    unknownCurrencyDepositEventCount:
      summary.unknownCurrencyDepositEventCount,
    excludedForeignCurrencyDepositEventCount:
      summary.excludedForeignCurrencyDepositEventCount,
    discountsCents: summary.discountsCents,
    taxCents: summary.taxCents,
    taxableSubtotalCents: summary.taxableSubtotalCents,
    unresolvedActualTaxIdentityCount:
      summary.unresolvedActualTaxIdentityCount,
    actualTaxIdentityBuckets: summary.actualTaxIdentityBuckets,
    tipsCents: summary.tipsCents,
    completedAppointmentCount: summary.completedAppointmentCount,
    provenance: summary.provenance,
    dateRange: {
      start: summary.dateRange.start.toISOString(),
      end: summary.dateRange.end.toISOString(),
      timezone: timeZone,
      isToDate,
    },
  };
}

export function serializeOwnerFinancialSummary(input: {
  summaries: CurrentFinancialReportingSummaries;
  currency: string;
  timeZone: string;
}): OwnerFinancialSummary {
  const { summaries, currency, timeZone } = input;

  return {
    currency,
    timeZone,
    asOf: summaries.generatedAt.toISOString(),
    currentPeriods: {
      today: serializeFinancialPeriodSummary(
        summaries.today,
        timeZone,
        true,
      ),
      weekToDate: serializeFinancialPeriodSummary(
        summaries.weekToDate,
        timeZone,
        true,
      ),
      monthToDate: serializeFinancialPeriodSummary(
        summaries.monthToDate,
        timeZone,
        true,
      ),
    },
    balances: {
      completedOutstandingCents:
        summaries.balances.completedOutstandingCents,
      completed: summaries.balances.completedOutstandingProvenance,
      settledByLegacyPaymentStatusCount:
        summaries.balances.settledByLegacyPaymentStatusCount,
      unknownCurrencyAppointmentCount:
        summaries.balances.unknownCurrencyAppointmentCount,
      excludedForeignCurrencyAppointmentCount:
        summaries.balances.excludedForeignCurrencyAppointmentCount,
      asOf: summaries.balances.asOf.toISOString(),
    },
  };
}
