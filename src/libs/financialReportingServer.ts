import 'server-only';

import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import {
  type AnalyticsDateRange,
  getAnalyticsToDateRange,
} from '@/libs/analyticsDateRange';
import { db } from '@/libs/DB';
import {
  buildReportingProvenance,
  type ReportingProvenance,
  UNSUPPORTED_DEPOSIT_DUE,
} from '@/libs/financialReporting';
import { completedAppointmentRevenueAggregateSql } from '@/libs/revenueSql';
import {
  appointmentPaymentSchema,
  appointmentSchema,
} from '@/models/Schema';

export type FinancialReportingRange = Pick<AnalyticsDateRange, 'start' | 'end'>;

export type FinancialReportingRangeSummary = {
  completedAppointmentRevenueCents: number;
  completedAppointmentCount: number;
  cashCollectedCents: number;
  tipsCents: number;
  taxCents: number;
  discountsCents: number;
  provenance: ReportingProvenance;
  dateRange: FinancialReportingRange;
};

export type FinancialBalanceSummary = {
  completedOutstandingCents: number;
  upcomingBalanceCents: number;
  completedOutstandingProvenance: ReportingProvenance;
  upcomingAppointmentCount: number;
  unresolvedUpcomingAppointmentCount: number;
  /**
   * Older completions can be marked paid without an itemized payment ledger.
   * They are treated as settled rather than fabricated as debt, and disclosed
   * separately from balances backed by appointment_payment rows.
   */
  settledByLegacyPaymentStatusCount: number;
  depositDue: typeof UNSUPPORTED_DEPOSIT_DUE;
  asOf: Date;
};

export type CurrentFinancialReportingRanges = {
  today: FinancialReportingRange;
  weekToDate: FinancialReportingRange;
  monthToDate: FinancialReportingRange;
};

export type CurrentFinancialReportingSummaries = {
  today: FinancialReportingRangeSummary;
  weekToDate: FinancialReportingRangeSummary;
  monthToDate: FinancialReportingRangeSummary;
  balances: FinancialBalanceSummary;
  generatedAt: Date;
  timeZone: string | null;
};

export type FinancialReportingRangeSummaryInput = FinancialReportingRange & {
  salonId: string;
};

export type FinancialBalanceSummaryInput = {
  salonId: string;
  asOf?: Date;
  /**
   * Optional normalized/legacy phone variants for one tenant-scoped client.
   * The salon predicate remains mandatory and authoritative.
   */
  clientPhoneVariants?: string[];
};

export type CurrentFinancialReportingSummariesInput = {
  salonId: string;
  timeZone: string | null | undefined;
  now?: Date;
};

function assertSalonId(salonId: string): void {
  if (!salonId.trim()) {
    throw new TypeError('salonId is required');
  }
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
}

function assertRange(start: Date, end: Date): void {
  assertValidDate(start, 'start');
  assertValidDate(end, 'end');
  if (start.getTime() >= end.getTime()) {
    throw new RangeError('Reporting range start must be before end');
  }
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/**
 * Load earned revenue and collection activity for one half-open UTC range.
 *
 * Appointment revenue is bucketed by the appointment's service start time.
 * Cash collection is independently bucketed by payment recordedAt. Both
 * queries are explicitly tenant-scoped.
 */
export async function getFinancialReportingRangeSummary(
  input: FinancialReportingRangeSummaryInput,
): Promise<FinancialReportingRangeSummary> {
  assertSalonId(input.salonId);
  assertRange(input.start, input.end);

  const revenueAggregate = completedAppointmentRevenueAggregateSql();
  const finalizedEligible = sql`${appointmentSchema.status} = 'completed'
    AND ${appointmentSchema.deletedAt} IS NULL
    AND ${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'
    AND ${appointmentSchema.finalPriceCents} IS NOT NULL
    AND ${appointmentSchema.finalPriceCents} >= 0`;
  const completedEligible = sql`${appointmentSchema.status} = 'completed'
    AND ${appointmentSchema.deletedAt} IS NULL
    AND ${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'`;

  const [revenueRows, cashRows] = await Promise.all([
    db
      .select({
        ...revenueAggregate,
        completedAppointmentCount:
          sql<number>`COUNT(*) FILTER (WHERE ${completedEligible})::int`,
        tipsCents: sql<number>`COALESCE(SUM(
          CASE WHEN ${finalizedEligible}
            THEN GREATEST(COALESCE(${appointmentSchema.tipCents}, 0), 0)
            ELSE 0
          END
        ), 0)::int`,
        taxCents: sql<number>`COALESCE(SUM(
          CASE WHEN ${finalizedEligible}
            THEN GREATEST(COALESCE(${appointmentSchema.taxAmountCents}, 0), 0)
            ELSE 0
          END
        ), 0)::int`,
        discountsCents: sql<number>`COALESCE(SUM(
          CASE WHEN ${finalizedEligible}
            THEN GREATEST(COALESCE(${appointmentSchema.finalDiscountCents}, 0), 0)
            ELSE 0
          END
        ), 0)::int`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, input.salonId),
          gte(appointmentSchema.startTime, input.start),
          lt(appointmentSchema.startTime, input.end),
        ),
      ),
    db
      .select({
        cashCollectedCents:
          sql<number>`COALESCE(SUM(${appointmentPaymentSchema.amountCents}), 0)::int`,
      })
      .from(appointmentPaymentSchema)
      .where(
        and(
          eq(appointmentPaymentSchema.salonId, input.salonId),
          isNull(appointmentPaymentSchema.voidedAt),
          gte(appointmentPaymentSchema.recordedAt, input.start),
          lt(appointmentPaymentSchema.recordedAt, input.end),
          sql`${appointmentPaymentSchema.amountCents} > 0`,
        ),
      ),
  ]);

  const revenue = revenueRows[0];
  const provenance = buildReportingProvenance({
    finalizedAppointmentCount: numberValue(revenue?.finalizedAppointmentCount),
    legacyAppointmentCount: numberValue(revenue?.legacyAppointmentCount),
    unresolvedAppointmentCount: numberValue(revenue?.unresolvedAppointmentCount),
    finalizedAmountCents: numberValue(revenue?.finalizedAmountCents),
    legacyFallbackAmountCents: numberValue(revenue?.legacyFallbackAmountCents),
  });

  return {
    completedAppointmentRevenueCents:
      provenance.finalizedAmountCents + provenance.legacyFallbackAmountCents,
    completedAppointmentCount: numberValue(revenue?.completedAppointmentCount),
    cashCollectedCents: numberValue(cashRows[0]?.cashCollectedCents),
    tipsCents: numberValue(revenue?.tipsCents),
    taxCents: numberValue(revenue?.taxCents),
    discountsCents: numberValue(revenue?.discountsCents),
    provenance,
    dateRange: {
      start: input.start,
      end: input.end,
    },
  };
}

/**
 * Load point-in-time balances without turning ordinary future booking balances
 * into completed client debt.
 *
 * The aggregate uses appointment_payment as the amount-paid source. A cached
 * zero can prove that payment tracking was initialized with no collection.
 * Positive cache-only values are unresolved because the cache is never summed
 * in place of its missing payment ledger.
 */
export async function getFinancialBalanceSummary(
  input: FinancialBalanceSummaryInput,
): Promise<FinancialBalanceSummary> {
  assertSalonId(input.salonId);
  if (input.clientPhoneVariants && input.clientPhoneVariants.length === 0) {
    throw new TypeError('clientPhoneVariants must not be empty when provided');
  }
  const asOf = input.asOf ?? new Date();
  assertValidDate(asOf, 'asOf');

  const paymentsCents = sql<number>`COALESCE((
    SELECT SUM(${appointmentPaymentSchema.amountCents})
    FROM ${appointmentPaymentSchema}
    WHERE ${appointmentPaymentSchema.salonId} = ${appointmentSchema.salonId}
      AND ${appointmentPaymentSchema.appointmentId} = ${appointmentSchema.id}
      AND ${appointmentPaymentSchema.voidedAt} IS NULL
      AND ${appointmentPaymentSchema.recordedAt} <= ${asOf}
      AND ${appointmentPaymentSchema.amountCents} > 0
  ), 0)`;
  const hasPaymentHistory = sql`EXISTS (
    SELECT 1
    FROM ${appointmentPaymentSchema}
    WHERE ${appointmentPaymentSchema.salonId} = ${appointmentSchema.salonId}
      AND ${appointmentPaymentSchema.appointmentId} = ${appointmentSchema.id}
      AND ${appointmentPaymentSchema.recordedAt} <= ${asOf}
  )`;
  const paymentTrackingKnown
    = sql`(COALESCE(${appointmentSchema.amountPaidCents} = 0, false) OR ${hasPaymentHistory})`;
  const legacyStatusSettled
    = sql`(NOT ${paymentTrackingKnown} AND ${appointmentSchema.paymentStatus} = 'paid')`;

  const completedEligible = sql`${appointmentSchema.status} = 'completed'
    AND ${appointmentSchema.deletedAt} IS NULL
    AND ${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'
    AND ${appointmentSchema.startTime} <= ${asOf}`;
  const validSnapshots = sql`COALESCE(${appointmentSchema.taxAmountCents}, 0) >= 0
    AND COALESCE(${appointmentSchema.tipCents}, 0) >= 0`;
  const finalizedFinancials = sql`${appointmentSchema.finalPriceCents} IS NOT NULL
    AND ${appointmentSchema.finalPriceCents} >= 0
    AND ${validSnapshots}`;
  const legacyFinancials = sql`${appointmentSchema.finalPriceCents} IS NULL
    AND ${appointmentSchema.totalPrice} >= 0
    AND ${validSnapshots}`;
  const balancePaymentKnown = sql`(${paymentTrackingKnown} OR ${legacyStatusSettled})`;
  const finalizedResolved
    = sql`${completedEligible} AND ${finalizedFinancials} AND ${balancePaymentKnown}`;
  const legacyResolved
    = sql`${completedEligible} AND ${legacyFinancials} AND ${balancePaymentKnown}`;
  const completedUnresolved
    = sql`${completedEligible} AND NOT (
      (${finalizedFinancials} OR ${legacyFinancials}) AND ${balancePaymentKnown}
    )`;

  const finalizedDueCents = sql<number>`GREATEST(
    ${appointmentSchema.finalPriceCents}
      + COALESCE(${appointmentSchema.taxAmountCents}, 0)
      + COALESCE(${appointmentSchema.tipCents}, 0)
      - CASE WHEN ${legacyStatusSettled}
        THEN ${appointmentSchema.finalPriceCents}
          + COALESCE(${appointmentSchema.taxAmountCents}, 0)
          + COALESCE(${appointmentSchema.tipCents}, 0)
        ELSE ${paymentsCents}
      END,
    0
  )`;
  const legacyDueCents = sql<number>`GREATEST(
    ${appointmentSchema.totalPrice}
      + COALESCE(${appointmentSchema.taxAmountCents}, 0)
      + COALESCE(${appointmentSchema.tipCents}, 0)
      - CASE WHEN ${legacyStatusSettled}
        THEN ${appointmentSchema.totalPrice}
          + COALESCE(${appointmentSchema.taxAmountCents}, 0)
          + COALESCE(${appointmentSchema.tipCents}, 0)
        ELSE ${paymentsCents}
      END,
    0
  )`;

  const upcomingEligible = sql`${appointmentSchema.status} IN ('pending', 'confirmed')
    AND ${appointmentSchema.deletedAt} IS NULL
    AND ${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'
    AND ${appointmentSchema.startTime} >= ${asOf}`;
  const upcomingResolved
    = sql`${upcomingEligible} AND ${appointmentSchema.totalPrice} >= 0`;
  const upcomingDueCents = sql<number>`GREATEST(
    ${appointmentSchema.totalPrice} - ${paymentsCents},
    0
  )`;

  const rows = await db
    .select({
      finalizedAppointmentCount:
        sql<number>`COUNT(*) FILTER (WHERE ${finalizedResolved})::int`,
      legacyAppointmentCount:
        sql<number>`COUNT(*) FILTER (WHERE ${legacyResolved})::int`,
      unresolvedAppointmentCount:
        sql<number>`COUNT(*) FILTER (WHERE ${completedUnresolved})::int`,
      finalizedAmountCents: sql<number>`COALESCE(SUM(
        CASE WHEN ${finalizedResolved} THEN ${finalizedDueCents} ELSE 0 END
      ), 0)::int`,
      legacyFallbackAmountCents: sql<number>`COALESCE(SUM(
        CASE WHEN ${legacyResolved} THEN ${legacyDueCents} ELSE 0 END
      ), 0)::int`,
      upcomingBalanceCents: sql<number>`COALESCE(SUM(
        CASE WHEN ${upcomingResolved} THEN ${upcomingDueCents} ELSE 0 END
      ), 0)::int`,
      upcomingAppointmentCount:
        sql<number>`COUNT(*) FILTER (WHERE ${upcomingResolved})::int`,
      unresolvedUpcomingAppointmentCount:
        sql<number>`COUNT(*) FILTER (
          WHERE ${upcomingEligible} AND NOT (${appointmentSchema.totalPrice} >= 0)
        )::int`,
      settledByLegacyPaymentStatusCount:
        sql<number>`COUNT(*) FILTER (
          WHERE ${completedEligible}
            AND (${finalizedFinancials} OR ${legacyFinancials})
            AND ${legacyStatusSettled}
        )::int`,
    })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.salonId, input.salonId),
      input.clientPhoneVariants
        ? inArray(appointmentSchema.clientPhone, input.clientPhoneVariants)
        : undefined,
    ));

  const aggregate = rows[0];
  const completedOutstandingProvenance = buildReportingProvenance({
    finalizedAppointmentCount: numberValue(aggregate?.finalizedAppointmentCount),
    legacyAppointmentCount: numberValue(aggregate?.legacyAppointmentCount),
    unresolvedAppointmentCount: numberValue(aggregate?.unresolvedAppointmentCount),
    finalizedAmountCents: numberValue(aggregate?.finalizedAmountCents),
    legacyFallbackAmountCents: numberValue(aggregate?.legacyFallbackAmountCents),
  });

  return {
    completedOutstandingCents:
      completedOutstandingProvenance.finalizedAmountCents
      + completedOutstandingProvenance.legacyFallbackAmountCents,
    upcomingBalanceCents: numberValue(aggregate?.upcomingBalanceCents),
    completedOutstandingProvenance,
    upcomingAppointmentCount: numberValue(aggregate?.upcomingAppointmentCount),
    unresolvedUpcomingAppointmentCount:
      numberValue(aggregate?.unresolvedUpcomingAppointmentCount),
    settledByLegacyPaymentStatusCount:
      numberValue(aggregate?.settledByLegacyPaymentStatusCount),
    depositDue: UNSUPPORTED_DEPOSIT_DUE,
    asOf,
  };
}

export function getCurrentFinancialReportingRanges(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): CurrentFinancialReportingRanges {
  assertValidDate(now, 'now');

  const today = getAnalyticsToDateRange('daily', timeZone, now);
  const weekToDate = getAnalyticsToDateRange('weekly', timeZone, now);
  const monthToDate = getAnalyticsToDateRange('monthly', timeZone, now);

  return {
    today: { start: today.start, end: today.end },
    weekToDate: { start: weekToDate.start, end: weekToDate.end },
    monthToDate: { start: monthToDate.start, end: monthToDate.end },
  };
}

/**
 * Load the three owner-dashboard periods in parallel, plus one point-in-time
 * balance aggregate. No client or appointment history is materialized.
 */
export async function getCurrentFinancialReportingSummaries(
  input: CurrentFinancialReportingSummariesInput,
): Promise<CurrentFinancialReportingSummaries> {
  assertSalonId(input.salonId);
  const now = input.now ?? new Date();
  const ranges = getCurrentFinancialReportingRanges(input.timeZone, now);

  const [today, weekToDate, monthToDate, balances] = await Promise.all([
    getFinancialReportingRangeSummary({
      salonId: input.salonId,
      ...ranges.today,
    }),
    getFinancialReportingRangeSummary({
      salonId: input.salonId,
      ...ranges.weekToDate,
    }),
    getFinancialReportingRangeSummary({
      salonId: input.salonId,
      ...ranges.monthToDate,
    }),
    getFinancialBalanceSummary({
      salonId: input.salonId,
      asOf: now,
    }),
  ]);

  return {
    today,
    weekToDate,
    monthToDate,
    balances,
    generatedAt: now,
    timeZone: input.timeZone ?? null,
  };
}
