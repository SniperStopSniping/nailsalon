import type {
  FinancialPeriodSummary,
} from '@/types/admin';

/**
 * Core financial data required by the owner Today workspace.
 *
 * This is deliberately independent from AnalyticsResponse: core owner revenue
 * remains available when the optional Analytics module is disabled.
 */
export type OwnerFinancialSummary = {
  currency: string;
  timeZone: string;
  asOf: string;
  currentPeriods: {
    today: FinancialPeriodSummary;
    weekToDate: FinancialPeriodSummary;
    monthToDate: FinancialPeriodSummary;
  };
  balances: {
    completedOutstandingCents: number;
    completed: FinancialPeriodSummary['provenance'];
    settledByLegacyPaymentStatusCount: number;
    unknownCurrencyAppointmentCount?: number;
    excludedForeignCurrencyAppointmentCount?: number;
    asOf: string;
  };
};

export type OwnerFinancialSummaryResponse = {
  data: OwnerFinancialSummary;
};
