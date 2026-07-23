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
    discountsCents: summary.discountsCents,
    taxCents: summary.taxCents,
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
      asOf: summaries.balances.asOf.toISOString(),
    },
  };
}
