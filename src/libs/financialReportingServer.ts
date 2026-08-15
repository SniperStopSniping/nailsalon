import 'server-only';

import {
  and,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import {
  type AnalyticsDateRange,
  getAnalyticsToDateRange,
} from '@/libs/analyticsDateRange';
import { resolveAppointmentDepositFinancials } from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import {
  validateAppointmentTaxSnapshotChain,
} from '@/libs/appointmentTaxSnapshot';
import { db } from '@/libs/DB';
import {
  buildReportingProvenance,
  type ReportingProvenance,
  UNSUPPORTED_DEPOSIT_DUE,
} from '@/libs/financialReporting';
import {
  type BookingTaxSnapshot,
  type FinalTaxSnapshot,
  validateForfeitureTaxSnapshot,
  validateInvoiceTaxSnapshot,
} from '@/libs/taxConfig';
import {
  appointmentDepositSchema,
  appointmentPaymentSchema,
  appointmentSchema,
} from '@/models/Schema';

export type FinancialReportingRange = Pick<AnalyticsDateRange, 'start' | 'end'>;

export type FinancialReportingRangeSummary = {
  completedAppointmentRevenueCents: number;
  completedAppointmentCount: number;
  /** Gross inflow: non-voided appointment payments plus dated deposit collections. */
  cashCollectedCents: number;
  appointmentPaymentsCollectedCents: number;
  /** Event-ledger amounts; missing timestamps are excluded and disclosed below. */
  depositCollectedCents: number;
  depositRefundedCents: number;
  depositForfeitedCents: number;
  depositForfeitureEstimatedTaxCents: number;
  depositForfeitureEstimatedNetCents: number;
  /** A later succeeded refund reverses the earlier forfeiture estimate. */
  depositForfeitureRefundReversalCents: number;
  depositForfeitureTaxReversalCents: number;
  depositForfeitureNetReversalCents: number;
  forfeitureTaxIdentityBuckets: FinancialForfeitureTaxIdentityBucket[];
  /** Current canonical credit applied to appointments bucketed in this range. */
  depositAppliedCents: number;
  /** appointment_payment collections are remaining-balance tender, never deposits. */
  remainingBalancePaymentsCollectedCents: number;
  /** Payment rows whose tenant disagrees with their parent appointment. */
  unattributedPaymentEventCount: number;
  unresolvedDepositApplicationCount: number;
  unattributedDepositEventCount: number;
  unresolvedDepositEventCount: number;
  unknownCurrencyAppointmentCount: number;
  excludedForeignCurrencyAppointmentCount: number;
  unknownCurrencyPaymentEventCount: number;
  excludedForeignCurrencyPaymentEventCount: number;
  unknownCurrencyDepositEventCount: number;
  excludedForeignCurrencyDepositEventCount: number;
  tipsCents: number;
  taxCents: number;
  taxableSubtotalCents: number;
  unresolvedActualTaxIdentityCount: number;
  actualTaxIdentityBuckets: FinancialActualTaxIdentityBucket[];
  discountsCents: number;
  provenance: ReportingProvenance;
  dateRange: FinancialReportingRange;
};

export type FinancialActualTaxIdentityBucket = {
  schemaVersion: number;
  classification: string;
  configurationIdentityVersion: number;
  configurationIdentity: string;
  label: string | null;
  rateBps: number;
  mode: 'included' | 'added';
  configurationEffectiveFrom: string | null;
  configurationEffectiveDate: string | null;
  configurationTimeZone: string | null;
  configurationSource: 'default' | 'base' | 'scheduled_change';
  taxApplied: boolean;
  taxExempt: boolean;
  appointmentCount: number;
  serviceSubtotalCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
};

export type FinancialForfeitureTaxIdentityBucket = {
  schemaVersion: number;
  classification: string;
  configurationIdentityVersion: number;
  configurationIdentity: string;
  label: string | null;
  rateBps: number;
  mode: 'included' | 'added';
  configurationEffectiveFrom: string | null;
  configurationEffectiveDate: string | null;
  configurationTimeZone: string | null;
  configurationSource: 'default' | 'base' | 'scheduled_change';
  taxEstimateApplied: boolean;
  forfeitureCount: number;
  grossForfeitedCents: number;
  estimatedTaxIncludedCents: number;
  estimatedNetCents: number;
  refundReversalCount: number;
  refundReversalCents: number;
  estimatedTaxReversalCents: number;
  estimatedNetReversalCents: number;
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
  unknownCurrencyAppointmentCount: number;
  excludedForeignCurrencyAppointmentCount: number;
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
  currency: string;
};

export type FinancialBalanceSummaryInput = {
  salonId: string;
  currency: string;
  asOf?: Date;
  /**
   * Optional normalized/legacy phone variants for one tenant-scoped client.
   * The salon predicate remains mandatory and authoritative.
   */
  clientPhoneVariants?: string[];
};

export type CompletedOutstandingRow = {
  appointmentId: string;
  salonClientId: string | null;
  clientPhone: string;
  completedOutstandingCents: number;
  financialState: 'resolved' | 'under_review';
};

export type CompletedFinancialRow = CompletedOutstandingRow & {
  startTime: Date;
  source: 'finalized' | 'legacy';
  serviceValueCents: number;
  financiallySettled: boolean;
};

export type CompletedRevenueRow = {
  appointmentId: string;
  technicianId: string | null;
  startTime: Date;
  source: 'finalized' | 'legacy';
  serviceValueCents: number;
  tipCents: number;
  taxCents: number;
  unresolvedActualTaxIdentity: boolean;
};

export type CurrentFinancialReportingSummariesInput = {
  salonId: string;
  currency: string;
  timeZone: string | null | undefined;
  now?: Date;
};

function assertSalonId(salonId: string): void {
  if (!salonId.trim()) {
    throw new TypeError('salonId is required');
  }
}

function normalizeReportingCurrency(currency: string): 'CAD' | 'USD' {
  const normalized = currency.trim().toUpperCase();
  if (normalized !== 'CAD' && normalized !== 'USD') {
    throw new TypeError('currency must be CAD or USD');
  }
  return normalized;
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

type CompletedRevenueCandidate = {
  id?: string;
  technicianId?: string | null;
  startTime?: Date;
  completedAt: Date | null;
  totalPrice: number;
  finalPriceCents: number | null;
  taxableSubtotalCents: number | null;
  taxAmountCents: number | null;
  taxExempt: boolean | null;
  taxExemptReason: string | null;
  tipCents: number | null;
  finalDiscountCents: number | null;
  invoiceCurrency: string | null;
  bookingTaxSnapshot: BookingTaxSnapshot | null;
  rescheduleTaxSnapshot: BookingTaxSnapshot | null;
  finalTaxSnapshot: FinalTaxSnapshot | null;
};

type ResolvedCompletedRevenue = {
  ok: true;
  source: 'finalized' | 'legacy';
  serviceValueCents: number;
  tipCents: number;
  taxCents: number;
  taxableSubtotalCents: number;
  discountCents: number;
  unresolvedActualTaxIdentity: boolean;
  finalTaxSnapshot: FinalTaxSnapshot | null;
};

type BlockedCompletedRevenue = {
  ok: false;
  unresolvedActualTaxIdentity: boolean;
};

/** One runtime gate for every finalized revenue/reporting consumer. */
function resolveCompletedRevenueCandidate(
  row: CompletedRevenueCandidate,
): ResolvedCompletedRevenue | BlockedCompletedRevenue {
  const snapshotChain = validateAppointmentTaxSnapshotChain({
    status: 'completed',
    completedAt: row.completedAt,
    totalPrice: row.totalPrice,
    finalPriceCents: row.finalPriceCents,
    taxableSubtotalCents: row.taxableSubtotalCents,
    taxAmountCents: row.taxAmountCents,
    taxExempt: row.taxExempt,
    taxExemptReason: row.taxExemptReason,
    invoiceCurrency: row.invoiceCurrency,
    bookingTaxSnapshot: row.bookingTaxSnapshot,
    rescheduleTaxSnapshot: row.rescheduleTaxSnapshot,
    finalTaxSnapshot: row.finalTaxSnapshot,
  });
  if (!snapshotChain.ok) {
    return { ok: false, unresolvedActualTaxIdentity: true };
  }
  if (row.finalTaxSnapshot === null) {
    if (
      row.bookingTaxSnapshot !== null
      || row.rescheduleTaxSnapshot !== null
    ) {
      return { ok: false, unresolvedActualTaxIdentity: true };
    }
    const historicalTaxCents = row.taxAmountCents ?? 0;
    if (!isMinorUnits(historicalTaxCents)) {
      return { ok: false, unresolvedActualTaxIdentity: true };
    }
    const unresolvedActualTaxIdentity = historicalTaxCents > 0;
    if (row.finalPriceCents === null) {
      return isMinorUnits(row.totalPrice)
        ? {
            ok: true,
            source: 'legacy',
            serviceValueCents: row.totalPrice,
            tipCents: 0,
            taxCents: 0,
            taxableSubtotalCents: 0,
            discountCents: 0,
            unresolvedActualTaxIdentity,
            finalTaxSnapshot: null,
          }
        : { ok: false, unresolvedActualTaxIdentity };
    }
    const historicalTipCents = row.tipCents ?? 0;
    const historicalDiscountCents = row.finalDiscountCents ?? 0;
    if (
      !isMinorUnits(row.finalPriceCents)
      || !isMinorUnits(historicalTipCents)
      || !isMinorUnits(historicalDiscountCents)
    ) {
      return { ok: false, unresolvedActualTaxIdentity };
    }
    return {
      ok: true,
      source: 'finalized',
      serviceValueCents: row.finalPriceCents,
      tipCents: historicalTipCents,
      taxCents: 0,
      taxableSubtotalCents: 0,
      discountCents: historicalDiscountCents,
      unresolvedActualTaxIdentity,
      finalTaxSnapshot: null,
    };
  }

  const tipCents = row.tipCents ?? 0;
  const discountCents = row.finalDiscountCents ?? 0;
  if (!isMinorUnits(tipCents) || !isMinorUnits(discountCents)) {
    return { ok: false, unresolvedActualTaxIdentity: true };
  }
  const validated = validateInvoiceTaxSnapshot(row.finalTaxSnapshot, {
    expectedKind: 'final_actual',
    expectedCurrency: row.invoiceCurrency,
    expectedScalars: {
      finalPriceCents: row.finalPriceCents,
      taxableSubtotalCents: row.taxableSubtotalCents,
      taxAmountCents: row.taxAmountCents,
      taxExempt: row.taxExempt,
      taxExemptReason: row.taxExemptReason,
      serviceInvoiceTotalCents:
        row.finalPriceCents !== null && row.taxAmountCents !== null
          ? row.finalPriceCents + row.taxAmountCents
          : null,
    },
  });
  if (!validated.ok || validated.snapshot.kind !== 'final_actual') {
    return { ok: false, unresolvedActualTaxIdentity: true };
  }
  return {
    ok: true,
    source: 'finalized',
    serviceValueCents: validated.invoiceMoney.finalPriceCents,
    tipCents,
    taxCents: validated.invoiceMoney.taxAmountCents,
    taxableSubtotalCents: validated.invoiceMoney.taxableSubtotalCents,
    discountCents,
    unresolvedActualTaxIdentity: false,
    finalTaxSnapshot: validated.snapshot,
  };
}

export type FinancialBalanceSqlColumns = {
  status: SQL;
  deletedAt: SQL;
  paymentStatus: SQL;
  startTime: SQL;
  finalPriceCents: SQL;
  totalPrice: SQL;
  taxAmountCents: SQL;
  tipCents: SQL;
  amountPaidCents: SQL;
  invoiceCurrency: SQL;
  bookingTaxSnapshot: SQL;
  rescheduleTaxSnapshot?: SQL;
  finalTaxSnapshot?: SQL;
  paymentsCents: SQL<number>;
  hasPaymentHistory: SQL;
  paymentTenantMismatch?: SQL;
  depositCreditCents: SQL<number>;
  depositUnresolved: SQL;
};

function buildUpcomingInvoiceSql(columns: {
  totalPrice: SQL;
  bookingTaxSnapshot: SQL;
  rescheduleTaxSnapshot: SQL;
}) {
  const historical = sql`${columns.bookingTaxSnapshot} IS NULL
    AND ${columns.rescheduleTaxSnapshot} IS NULL`;

  return {
    invoiceCents: sql<number>`CASE
      WHEN ${historical} THEN ${columns.totalPrice}
      ELSE NULL
    END`,
    // Immutable D6.1 snapshots require the full runtime validator (including
    // configuration identity and mode-specific arithmetic). This legacy SQL
    // adapter has no live consumer and deliberately fails closed rather than
    // growing a weaker parallel JSON validator.
    resolved: historical,
  };
}

/**
 * SQL counterpart of the pure deposit resolver for set-based reporting.
 * Ambiguous states are surfaced as unresolved; the observed-partial marker is
 * never subtracted as though it were a succeeded refund.
 */
export function buildDepositCreditSql(input: {
  salonId: SQL;
  appointmentId: SQL;
  invoiceCurrency: SQL;
}) {
  // `invoice_currency` was introduced nullable in 0068. NULL is an unknown
  // historical money identity, not permission to reinterpret the row using a
  // salon's mutable current currency.
  const validInvoiceCurrency = sql`UPPER(${input.invoiceCurrency}) IN ('CAD', 'USD')`;
  const expectedCurrency = sql`LOWER(${input.invoiceCurrency})`;
  const cleanPaid = sql`${validInvoiceCurrency}
    AND ${appointmentDepositSchema.status} = 'paid'
    AND ${appointmentDepositSchema.amountCents} > 0
    AND LOWER(${appointmentDepositSchema.currency}) = ${expectedCurrency}
    AND ${appointmentDepositSchema.stripePaymentIntentId} IS NOT NULL
    AND ${appointmentDepositSchema.stripeRefundId} IS NULL
    AND ${appointmentDepositSchema.refundedAt} IS NULL
    AND ${appointmentDepositSchema.refundStatus} IS NULL
    AND ${appointmentDepositSchema.refundStatusChangedAt} IS NULL
    AND ${appointmentDepositSchema.refundAmountCents} IS NULL
    AND ${appointmentDepositSchema.refundRequestedAt} IS NULL
    AND ${appointmentDepositSchema.refundTrigger} IS NULL
    AND ${appointmentDepositSchema.refundLastErrorCode} IS NULL
    AND ${appointmentDepositSchema.refundFailureReason} IS NULL
    AND ${appointmentDepositSchema.externalRefundObservedCents} IS NULL
    AND ${appointmentDepositSchema.refundConflictFlag} = false
    AND ${appointmentDepositSchema.refundTerminalFailureCount} = 0
    AND COALESCE(array_length(${appointmentDepositSchema.priorRefundIds}, 1), 0) = 0
    AND ${appointmentDepositSchema.forfeitedAt} IS NULL
    AND ${appointmentDepositSchema.forfeitureTaxSnapshot} IS NULL`;
  const cleanRefundedBase = sql`${validInvoiceCurrency}
    AND ${appointmentDepositSchema.status} = 'refunded'
    AND ${appointmentDepositSchema.amountCents} > 0
    AND LOWER(${appointmentDepositSchema.currency}) = ${expectedCurrency}
    AND ${appointmentDepositSchema.stripePaymentIntentId} IS NOT NULL
    AND ${appointmentDepositSchema.refundStatus} = 'succeeded'
    AND ${appointmentDepositSchema.stripeRefundId} IS NOT NULL
    AND ${appointmentDepositSchema.refundAmountCents}
      = ${appointmentDepositSchema.amountCents}
    AND ${appointmentDepositSchema.refundedAt} IS NOT NULL
    AND ${appointmentDepositSchema.refundStatusChangedAt} IS NOT NULL
    AND ${appointmentDepositSchema.externalRefundObservedCents} IS NULL
    AND ${appointmentDepositSchema.refundConflictFlag} = false`;
  const cleanUncollected = sql`${validInvoiceCurrency}
    AND ${appointmentDepositSchema.status}
      IN ('checkout_created','expired','canceled','waived')
    AND ${appointmentDepositSchema.amountCents} > 0
    AND LOWER(${appointmentDepositSchema.currency}) = ${expectedCurrency}
    AND ${appointmentDepositSchema.stripePaymentIntentId} IS NULL
    AND ${appointmentDepositSchema.stripeRefundId} IS NULL
    AND ${appointmentDepositSchema.refundedAt} IS NULL
    AND ${appointmentDepositSchema.refundStatus} IS NULL
    AND ${appointmentDepositSchema.refundStatusChangedAt} IS NULL
    AND ${appointmentDepositSchema.refundAmountCents} IS NULL
    AND ${appointmentDepositSchema.refundRequestedAt} IS NULL
    AND ${appointmentDepositSchema.refundTrigger} IS NULL
    AND ${appointmentDepositSchema.refundLastErrorCode} IS NULL
    AND ${appointmentDepositSchema.refundFailureReason} IS NULL
    AND ${appointmentDepositSchema.externalRefundObservedCents} IS NULL
    AND ${appointmentDepositSchema.refundConflictFlag} = false
    AND ${appointmentDepositSchema.refundTerminalFailureCount} = 0
    AND COALESCE(array_length(${appointmentDepositSchema.priorRefundIds}, 1), 0) = 0
    AND ${appointmentDepositSchema.forfeitedAt} IS NULL
    AND ${appointmentDepositSchema.forfeitureTaxSnapshot} IS NULL`;
  const forfeitureSnapshot = sql`${appointmentDepositSchema.forfeitureTaxSnapshot}`;
  const forfeitureConfiguration = sql`${forfeitureSnapshot}->'configuration'`;
  const forfeitureGross = sql`CASE
    WHEN jsonb_typeof(${forfeitureSnapshot}->'grossForfeitedCents') = 'number'
      AND ${forfeitureSnapshot}->>'grossForfeitedCents' ~ '^[0-9]+$'
    THEN (${forfeitureSnapshot}->>'grossForfeitedCents')::numeric
    ELSE NULL
  END`;
  const forfeitureTax = sql`CASE
    WHEN jsonb_typeof(${forfeitureSnapshot}->'estimatedTaxIncludedCents') = 'number'
      AND ${forfeitureSnapshot}->>'estimatedTaxIncludedCents' ~ '^[0-9]+$'
    THEN (${forfeitureSnapshot}->>'estimatedTaxIncludedCents')::numeric
    ELSE NULL
  END`;
  const forfeitureNet = sql`CASE
    WHEN jsonb_typeof(${forfeitureSnapshot}->'estimatedNetCents') = 'number'
      AND ${forfeitureSnapshot}->>'estimatedNetCents' ~ '^[0-9]+$'
    THEN (${forfeitureSnapshot}->>'estimatedNetCents')::numeric
    ELSE NULL
  END`;
  const forfeitureRateBps = sql`CASE
    WHEN jsonb_typeof(${forfeitureConfiguration}->'rateBps') = 'number'
      AND ${forfeitureConfiguration}->>'rateBps' ~ '^[0-9]+$'
    THEN (${forfeitureConfiguration}->>'rateBps')::numeric
    ELSE NULL
  END`;
  const validForfeitureSnapshot = sql`
    ${forfeitureSnapshot} IS NOT NULL
    AND ${forfeitureSnapshot}->'schemaVersion' = to_jsonb(1)
    AND ${forfeitureSnapshot}->>'kind' = 'forfeiture_estimate'
    AND ${forfeitureSnapshot}->>'classification' = 'estimate'
    AND ${forfeitureSnapshot}->>'capturedAt'
      = to_char(
          ${appointmentDepositSchema.forfeitedAt} AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
    AND UPPER(${forfeitureSnapshot}->>'currency')
      = UPPER(${appointmentDepositSchema.currency})
    AND LOWER(${forfeitureSnapshot}->>'currency') = ${expectedCurrency}
    AND ${forfeitureGross} = ${appointmentDepositSchema.amountCents}
    AND ${forfeitureTax} + ${forfeitureNet} = ${forfeitureGross}
    AND jsonb_typeof(${forfeitureConfiguration}) = 'object'
    AND jsonb_typeof(${forfeitureConfiguration}->'enabled') = 'boolean'
    AND (
      ${forfeitureConfiguration}->'label' = 'null'::jsonb
      OR jsonb_typeof(${forfeitureConfiguration}->'label') = 'string'
    )
    AND ${forfeitureRateBps} BETWEEN 0 AND 30000
    AND ${forfeitureConfiguration}->>'mode' IN ('included', 'added')
    AND ${forfeitureConfiguration}->>'configurationSource'
      IN ('default', 'base', 'scheduled_change')
    AND (
      ${forfeitureConfiguration}->'configurationEffectiveFrom' = 'null'::jsonb
      OR (
        jsonb_typeof(${forfeitureConfiguration}->'configurationEffectiveFrom') = 'string'
        AND ${forfeitureConfiguration}->>'configurationEffectiveFrom'
          ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})$'
      )
    )
    AND (
      ${forfeitureConfiguration}->'jurisdiction' = 'null'::jsonb
      OR jsonb_typeof(${forfeitureConfiguration}->'jurisdiction') = 'string'
    )
    AND (
      ${forfeitureConfiguration}->'country' = 'null'::jsonb
      OR jsonb_typeof(${forfeitureConfiguration}->'country') = 'string'
    )
    AND (
      ${forfeitureConfiguration}->'region' = 'null'::jsonb
      OR jsonb_typeof(${forfeitureConfiguration}->'region') = 'string'
    )
    AND (
      (
        ${forfeitureSnapshot}->'taxEstimateApplied' = to_jsonb(false)
        AND ${forfeitureTax} = 0
        AND ${forfeitureNet} = ${forfeitureGross}
      )
      OR
      (
        ${forfeitureSnapshot}->'taxEstimateApplied' = to_jsonb(true)
        AND ${forfeitureConfiguration}->'enabled' = to_jsonb(true)
        AND ${forfeitureRateBps} > 0
        AND ${forfeitureTax} = FLOOR(
          (
            2 * ${forfeitureGross} * ${forfeitureRateBps}
            + (10000 + ${forfeitureRateBps})
          ) / (2 * (10000 + ${forfeitureRateBps}))
        )
      )
    )`;
  const cleanRefunded = sql`${cleanRefundedBase}
    AND (
      (
        ${appointmentDepositSchema.forfeitedAt} IS NULL
        AND ${appointmentDepositSchema.forfeitureTaxSnapshot} IS NULL
      )
      OR
      (
        ${appointmentDepositSchema.forfeitedAt} IS NOT NULL
        AND ${validForfeitureSnapshot}
      )
    )`;
  // A coherent forfeiture preserves the original collection evidence but is
  // no longer client credit. A later full refund moves the row to the normal
  // clean-refunded branch while retaining this immutable forfeiture evidence.
  const cleanForfeited = sql`${validInvoiceCurrency}
    AND ${appointmentDepositSchema.status} = 'paid'
    AND ${appointmentDepositSchema.amountCents} > 0
    AND LOWER(${appointmentDepositSchema.currency}) = ${expectedCurrency}
    AND ${appointmentDepositSchema.stripePaymentIntentId} IS NOT NULL
    AND ${appointmentDepositSchema.stripeRefundId} IS NULL
    AND ${appointmentDepositSchema.refundedAt} IS NULL
    AND ${appointmentDepositSchema.refundStatus} IS NULL
    AND ${appointmentDepositSchema.refundStatusChangedAt} IS NULL
    AND ${appointmentDepositSchema.refundAmountCents} IS NULL
    AND ${appointmentDepositSchema.refundRequestedAt} IS NULL
    AND ${appointmentDepositSchema.refundTrigger} IS NULL
    AND ${appointmentDepositSchema.refundLastErrorCode} IS NULL
    AND ${appointmentDepositSchema.refundFailureReason} IS NULL
    AND ${appointmentDepositSchema.externalRefundObservedCents} IS NULL
    AND ${appointmentDepositSchema.refundConflictFlag} = false
    AND ${appointmentDepositSchema.refundTerminalFailureCount} = 0
    AND COALESCE(array_length(${appointmentDepositSchema.priorRefundIds}, 1), 0) = 0
    AND ${appointmentDepositSchema.forfeitedAt} IS NOT NULL
    AND ${validForfeitureSnapshot}`;
  const scoped = sql`${appointmentDepositSchema.salonId} = ${input.salonId}
    AND ${appointmentDepositSchema.appointmentId} = ${input.appointmentId}`;

  const creditCents = sql<number>`COALESCE((
    SELECT SUM(CASE WHEN ${cleanPaid}
      THEN ${appointmentDepositSchema.amountCents} ELSE 0 END)
    FROM ${appointmentDepositSchema}
    WHERE ${scoped}
  ), 0)`;
  const unresolved = sql`(
    (SELECT COUNT(*) FILTER (WHERE ${cleanPaid} OR ${cleanForfeited})
      FROM ${appointmentDepositSchema}
      WHERE ${scoped}) > 1
    OR EXISTS (
      SELECT 1
      FROM ${appointmentDepositSchema}
      WHERE ${scoped}
        AND NOT COALESCE(
          (${cleanPaid} OR ${cleanRefunded} OR ${cleanUncollected} OR ${cleanForfeited}),
          false
        )
    )
  )`;

  const hasDeposits = sql`EXISTS (
    SELECT 1
    FROM ${appointmentDepositSchema}
    WHERE ${scoped}
  )`;

  return {
    creditCents,
    unresolved,
    hasDeposits,
    validForfeitureSnapshot,
    forfeitureGrossCents: forfeitureGross,
    forfeitureTaxCents: forfeitureTax,
    forfeitureNetCents: forfeitureNet,
    forfeitureSnapshot,
    forfeitureConfiguration,
    forfeitureRateBps,
  };
}

/**
 * Canonical balance predicates and per-appointment expressions.
 *
 * Most reporting callers use the appointment table directly. Set-based
 * projections (Client Insights) can supply already-aggregated payment columns
 * so the exact same eligibility and clamping rules are reused without a
 * correlated payment lookup for every appointment.
 */
export function buildFinancialBalanceSql(
  asOf: Date,
  suppliedColumns?: FinancialBalanceSqlColumns,
) {
  const defaultPaymentsCents = sql<number>`COALESCE((
    SELECT SUM(${appointmentPaymentSchema.amountCents})
    FROM ${appointmentPaymentSchema}
    WHERE ${appointmentPaymentSchema.appointmentId} = ${appointmentSchema.id}
      AND ${appointmentPaymentSchema.voidedAt} IS NULL
      AND ${appointmentPaymentSchema.recordedAt} <= ${asOf}
      AND ${appointmentPaymentSchema.amountCents} > 0
  ), 0)`;
  const defaultHasPaymentHistory = sql`EXISTS (
    SELECT 1
    FROM ${appointmentPaymentSchema}
    WHERE ${appointmentPaymentSchema.appointmentId} = ${appointmentSchema.id}
      AND ${appointmentPaymentSchema.recordedAt} <= ${asOf}
  )`;
  const defaultPaymentTenantMismatch = sql`EXISTS (
    SELECT 1
    FROM ${appointmentPaymentSchema}
    WHERE ${appointmentPaymentSchema.appointmentId} = ${appointmentSchema.id}
      AND ${appointmentPaymentSchema.salonId} <> ${appointmentSchema.salonId}
  )`;
  const defaultDeposit = buildDepositCreditSql({
    salonId: sql`${appointmentSchema.salonId}`,
    appointmentId: sql`${appointmentSchema.id}`,
    invoiceCurrency: sql`${appointmentSchema.invoiceCurrency}`,
  });
  const columns = suppliedColumns ?? {
    status: sql`${appointmentSchema.status}`,
    deletedAt: sql`${appointmentSchema.deletedAt}`,
    paymentStatus: sql`${appointmentSchema.paymentStatus}`,
    startTime: sql`${appointmentSchema.startTime}`,
    finalPriceCents: sql`${appointmentSchema.finalPriceCents}`,
    totalPrice: sql`${appointmentSchema.totalPrice}`,
    taxAmountCents: sql`${appointmentSchema.taxAmountCents}`,
    tipCents: sql`${appointmentSchema.tipCents}`,
    amountPaidCents: sql`${appointmentSchema.amountPaidCents}`,
    invoiceCurrency: sql`${appointmentSchema.invoiceCurrency}`,
    bookingTaxSnapshot: sql`${appointmentSchema.bookingTaxSnapshot}`,
    rescheduleTaxSnapshot: sql`${appointmentSchema.rescheduleTaxSnapshot}`,
    finalTaxSnapshot: sql`${appointmentSchema.finalTaxSnapshot}`,
    paymentsCents: defaultPaymentsCents,
    hasPaymentHistory: defaultHasPaymentHistory,
    paymentTenantMismatch: defaultPaymentTenantMismatch,
    depositCreditCents: defaultDeposit.creditCents,
    depositUnresolved: defaultDeposit.unresolved,
  };
  const {
    status,
    deletedAt,
    paymentStatus,
    startTime,
    finalPriceCents,
    totalPrice,
    taxAmountCents,
    tipCents,
    amountPaidCents,
    bookingTaxSnapshot,
    paymentsCents,
    hasPaymentHistory,
    depositCreditCents,
    depositUnresolved,
  } = columns;
  const rescheduleTaxSnapshot = columns.rescheduleTaxSnapshot ?? sql`NULL`;
  const finalTaxSnapshot = columns.finalTaxSnapshot ?? sql`NULL`;
  const paymentTenantMismatch = columns.paymentTenantMismatch ?? sql`false`;
  const upcomingInvoice = buildUpcomingInvoiceSql({
    totalPrice,
    bookingTaxSnapshot,
    rescheduleTaxSnapshot,
  });
  const paymentTrackingKnown
    = sql`(
      NOT (${paymentTenantMismatch})
      AND (
      (NOT ${hasPaymentHistory} AND COALESCE(${amountPaidCents} = 0, false))
      OR (
        ${hasPaymentHistory}
        AND (${amountPaidCents} IS NULL OR ${amountPaidCents} = ${paymentsCents})
      )
      )
    )`;
  const legacyStatusSettled
    = sql`(NOT ${hasPaymentHistory}
      AND NOT (${paymentTenantMismatch})
      AND ${amountPaidCents} IS NULL
      AND ${paymentStatus} = 'paid')`;

  const completedEligible = sql`${status} = 'completed'
    AND ${deletedAt} IS NULL
    AND ${paymentStatus} IS DISTINCT FROM 'comp'
    AND ${startTime} <= ${asOf}`;
  const validSnapshots = sql`COALESCE(${taxAmountCents}, 0) >= 0
    AND COALESCE(${tipCents}, 0) >= 0`;
  const historicalSnapshotChain = sql`${bookingTaxSnapshot} IS NULL
    AND ${rescheduleTaxSnapshot} IS NULL
    AND ${finalTaxSnapshot} IS NULL`;
  const finalizedFinancials = sql`${finalPriceCents} IS NOT NULL
    AND ${finalPriceCents} >= 0
    AND ${validSnapshots}
    AND ${historicalSnapshotChain}`;
  const legacyFinancials = sql`${finalPriceCents} IS NULL
    AND ${totalPrice} >= 0
    AND ${validSnapshots}
    AND ${historicalSnapshotChain}`;
  const balancePaymentKnown = sql`(${paymentTrackingKnown} OR ${legacyStatusSettled})`;
  const finalizedDepositResolved = sql`NOT (${depositUnresolved})
    AND ${depositCreditCents} <= ${finalPriceCents} + COALESCE(${taxAmountCents}, 0)`;
  const legacyDepositResolved = sql`NOT (${depositUnresolved})
    AND ${depositCreditCents} <= ${totalPrice} + COALESCE(${taxAmountCents}, 0)`;
  const finalizedTenderResolved = sql`${legacyStatusSettled} OR (
    ${paymentsCents} >= 0
    AND ${paymentsCents} + ${depositCreditCents}
      <= ${finalPriceCents}
        + COALESCE(${taxAmountCents}, 0)
        + COALESCE(${tipCents}, 0)
  )`;
  const legacyTenderResolved = sql`${legacyStatusSettled} OR (
    ${paymentsCents} >= 0
    AND ${paymentsCents} + ${depositCreditCents}
      <= ${totalPrice}
        + COALESCE(${taxAmountCents}, 0)
        + COALESCE(${tipCents}, 0)
  )`;
  const finalizedResolved
    = sql`${completedEligible} AND ${finalizedFinancials}
      AND ${balancePaymentKnown} AND ${finalizedDepositResolved}
      AND (${finalizedTenderResolved})`;
  const legacyResolved
    = sql`${completedEligible} AND ${legacyFinancials}
      AND ${balancePaymentKnown} AND ${legacyDepositResolved}
      AND (${legacyTenderResolved})`;
  const completedUnresolved
    = sql`${completedEligible} AND NOT (
      ((${finalizedFinancials} AND ${finalizedDepositResolved}
          AND (${finalizedTenderResolved}))
        OR (${legacyFinancials} AND ${legacyDepositResolved}
          AND (${legacyTenderResolved})))
      AND ${balancePaymentKnown}
    )`;

  const finalizedDueCents = sql<number>`GREATEST(
    ${finalPriceCents}
      + COALESCE(${taxAmountCents}, 0)
      + COALESCE(${tipCents}, 0)
      - CASE WHEN ${legacyStatusSettled}
        THEN ${finalPriceCents}
          + COALESCE(${taxAmountCents}, 0)
          + COALESCE(${tipCents}, 0)
        ELSE ${paymentsCents} + ${depositCreditCents}
      END,
    0
  )`;
  const legacyDueCents = sql<number>`GREATEST(
    ${totalPrice}
      + COALESCE(${taxAmountCents}, 0)
      + COALESCE(${tipCents}, 0)
      - CASE WHEN ${legacyStatusSettled}
        THEN ${totalPrice}
          + COALESCE(${taxAmountCents}, 0)
          + COALESCE(${tipCents}, 0)
        ELSE ${paymentsCents} + ${depositCreditCents}
      END,
    0
  )`;

  const upcomingEligible = sql`${status} IN ('pending', 'confirmed')
    AND ${deletedAt} IS NULL
    AND ${paymentStatus} IS DISTINCT FROM 'comp'
    AND ${startTime} >= ${asOf}`;
  const upcomingResolved
    = sql`${upcomingEligible} AND ${upcomingInvoice.resolved}
      AND ${upcomingInvoice.invoiceCents} >= 0
      AND NOT (${depositUnresolved})
      AND ${depositCreditCents} <= ${upcomingInvoice.invoiceCents}
      AND ${paymentTrackingKnown}
      AND ${paymentsCents} + ${depositCreditCents}
        <= ${upcomingInvoice.invoiceCents}`;
  const upcomingDueCents = sql<number>`GREATEST(
    ${upcomingInvoice.invoiceCents} - ${depositCreditCents} - ${paymentsCents},
    0
  )`;

  return {
    completedEligible,
    completedUnresolved,
    finalizedDueCents,
    finalizedFinancials,
    finalizedResolved,
    legacyDueCents,
    legacyFinancials,
    legacyResolved,
    legacyStatusSettled,
    upcomingDueCents,
    upcomingEligible,
    upcomingInvoiceCents: upcomingInvoice.invoiceCents,
    upcomingResolved,
  };
}

/**
 * Load earned revenue and collection activity for one half-open UTC range.
 *
 * Appointment revenue is bucketed by the appointment's service start time.
 * Cash collection is independently bucketed by appointment-payment recordedAt
 * and explicit deposit collectedAt. Refund and forfeiture flows use their own
 * event timestamps. Every query is explicitly tenant-scoped.
 */
export async function getFinancialReportingRangeSummary(
  input: FinancialReportingRangeSummaryInput,
): Promise<FinancialReportingRangeSummary> {
  assertSalonId(input.salonId);
  assertRange(input.start, input.end);
  const reportingCurrency = normalizeReportingCurrency(input.currency);

  const validAppointmentCurrency = sql`UPPER(${appointmentSchema.invoiceCurrency}) IN ('CAD', 'USD')`;
  const appointmentInReportingCurrency
    = sql`UPPER(${appointmentSchema.invoiceCurrency}) = ${reportingCurrency}`;
  const unknownAppointmentCurrency = sql`NOT COALESCE(${validAppointmentCurrency}, false)`;
  const foreignAppointmentCurrency = sql`${validAppointmentCurrency}
    AND NOT (${appointmentInReportingCurrency})`;
  const paymentTenantConsistent
    = sql`${appointmentPaymentSchema.salonId} = ${appointmentSchema.salonId}`;

  const completedEligible = sql`${appointmentSchema.status} = 'completed'
    AND ${appointmentSchema.deletedAt} IS NULL
    AND ${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'`;
  const completedDepositApplicationEligible
    = sql`${appointmentSchema.status} = 'completed'
      AND ${appointmentSchema.deletedAt} IS NULL`;
  const validDepositCurrency
    = sql`UPPER(${appointmentDepositSchema.currency}) IN ('CAD', 'USD')`;
  const eventCurrencyConsistent = sql`${validAppointmentCurrency}
    AND ${validDepositCurrency}
    AND UPPER(${appointmentSchema.invoiceCurrency})
      = UPPER(${appointmentDepositSchema.currency})`;
  const eventCurrencyResolved = sql`${eventCurrencyConsistent}
    AND ${appointmentInReportingCurrency}`;
  const eventCurrencyKnownForeign = sql`${eventCurrencyConsistent}
    AND NOT (${appointmentInReportingCurrency})`;
  const eventCurrencyUnknown = sql`NOT COALESCE(${validAppointmentCurrency}, false)
    OR NOT COALESCE(${validDepositCurrency}, false)`;
  const validCollectionEvent = sql`
    ${appointmentDepositSchema.amountCents} > 0
    AND ${appointmentDepositSchema.stripePaymentIntentId} IS NOT NULL
    AND ${appointmentDepositSchema.status} IN ('paid', 'refunded')
    AND ${eventCurrencyResolved}`;
  const validRefundEvent = sql`
    ${validCollectionEvent}
    AND ${appointmentDepositSchema.status} = 'refunded'
    AND ${appointmentDepositSchema.refundStatus} = 'succeeded'
    AND ${appointmentDepositSchema.stripeRefundId} IS NOT NULL
    AND ${appointmentDepositSchema.refundAmountCents}
      = ${appointmentDepositSchema.amountCents}
    AND ${appointmentDepositSchema.refundStatusChangedAt} IS NOT NULL
    AND ${appointmentDepositSchema.externalRefundObservedCents} IS NULL
    AND ${appointmentDepositSchema.refundConflictFlag} = false`;
  const collectionInRange = sql`${appointmentDepositSchema.collectedAt} >= ${input.start}
    AND ${appointmentDepositSchema.collectedAt} < ${input.end}`;
  const refundInRange = sql`${appointmentDepositSchema.refundedAt} >= ${input.start}
    AND ${appointmentDepositSchema.refundedAt} < ${input.end}`;
  const forfeitureInRange = sql`${appointmentDepositSchema.forfeitedAt} >= ${input.start}
    AND ${appointmentDepositSchema.forfeitedAt} < ${input.end}`;

  const [
    cashRows,
    depositEventRows,
    currencyRows,
    forfeitureRows,
    actualTaxRows,
    depositApplicationRows,
    depositApplicationPaymentRows,
  ] = await Promise.all([
    db
      .select({
        cashCollectedCents: sql<number>`COALESCE(SUM(
          CASE WHEN ${paymentTenantConsistent}
            AND ${appointmentInReportingCurrency}
            THEN ${appointmentPaymentSchema.amountCents} ELSE 0 END
        ), 0)::int`,
        unattributedPaymentEventCount: sql<number>`COUNT(*) FILTER (
          WHERE NOT (${paymentTenantConsistent})
        )::int`,
        unknownCurrencyPaymentEventCount: sql<number>`COUNT(*) FILTER (
          WHERE ${paymentTenantConsistent}
            AND ${unknownAppointmentCurrency}
        )::int`,
        excludedForeignCurrencyPaymentEventCount: sql<number>`COUNT(*) FILTER (
          WHERE ${paymentTenantConsistent}
            AND ${foreignAppointmentCurrency}
        )::int`,
      })
      .from(appointmentPaymentSchema)
      .innerJoin(
        appointmentSchema,
        eq(appointmentSchema.id, appointmentPaymentSchema.appointmentId),
      )
      .where(
        and(
          eq(appointmentSchema.salonId, input.salonId),
          isNull(appointmentPaymentSchema.voidedAt),
          gte(appointmentPaymentSchema.recordedAt, input.start),
          lt(appointmentPaymentSchema.recordedAt, input.end),
          sql`${appointmentPaymentSchema.amountCents} > 0`,
        ),
      ),
    db
      .select({
        depositCollectedCents: sql<number>`COALESCE(SUM(
          CASE WHEN ${collectionInRange} AND ${validCollectionEvent}
            THEN ${appointmentDepositSchema.amountCents} ELSE 0 END
        ), 0)::int`,
        depositRefundedCents: sql<number>`COALESCE(SUM(
          CASE WHEN ${refundInRange} AND ${validRefundEvent}
            THEN ${appointmentDepositSchema.amountCents} ELSE 0 END
        ), 0)::int`,
        unattributedDepositEventCount: sql<number>`(
          COUNT(*) FILTER (
            WHERE ${appointmentDepositSchema.stripePaymentIntentId} IS NOT NULL
              AND ${appointmentDepositSchema.status} IN ('paid', 'refunded')
              AND ${appointmentDepositSchema.collectedAt} IS NULL
              AND NOT COALESCE(${eventCurrencyKnownForeign}, false)
          )
          + COUNT(*) FILTER (
            WHERE ${appointmentDepositSchema.refundStatus} = 'succeeded'
              AND ${appointmentDepositSchema.refundedAt} IS NULL
              AND NOT COALESCE(${eventCurrencyKnownForeign}, false)
          )
          + COUNT(*) FILTER (
            WHERE ${appointmentDepositSchema.forfeitureTaxSnapshot} IS NOT NULL
              AND ${appointmentDepositSchema.forfeitedAt} IS NULL
              AND NOT COALESCE(${eventCurrencyKnownForeign}, false)
          )
        )::int`,
        unresolvedDepositEventCount: sql<number>`(
          COUNT(*) FILTER (
            WHERE ${collectionInRange}
              AND NOT COALESCE(${eventCurrencyKnownForeign}, false)
              AND NOT (${validCollectionEvent})
          )
          + COUNT(*) FILTER (
            WHERE ${refundInRange}
              AND NOT COALESCE(${eventCurrencyKnownForeign}, false)
              AND NOT (${validRefundEvent})
          )
        )::int`,
        unknownCurrencyDepositEventCount: sql<number>`(
          COUNT(*) FILTER (WHERE ${collectionInRange} AND ${eventCurrencyUnknown})
          + COUNT(*) FILTER (WHERE ${refundInRange} AND ${eventCurrencyUnknown})
          + COUNT(*) FILTER (WHERE ${forfeitureInRange} AND ${eventCurrencyUnknown})
        )::int`,
        excludedForeignCurrencyDepositEventCount: sql<number>`(
          COUNT(*) FILTER (WHERE ${collectionInRange} AND ${eventCurrencyKnownForeign})
          + COUNT(*) FILTER (WHERE ${refundInRange} AND ${eventCurrencyKnownForeign})
          + COUNT(*) FILTER (WHERE ${forfeitureInRange} AND ${eventCurrencyKnownForeign})
        )::int`,
      })
      .from(appointmentDepositSchema)
      .innerJoin(
        appointmentSchema,
        and(
          eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
          eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
        ),
      )
      .where(eq(appointmentDepositSchema.salonId, input.salonId)),
    db
      .select({
        unknownCurrencyAppointmentCount: sql<number>`COUNT(*) FILTER (
          WHERE ${unknownAppointmentCurrency}
            AND ${completedEligible}
        )::int`,
        excludedForeignCurrencyAppointmentCount: sql<number>`COUNT(*) FILTER (
          WHERE ${foreignAppointmentCurrency}
            AND ${completedEligible}
        )::int`,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, input.salonId),
        gte(appointmentSchema.startTime, input.start),
        lt(appointmentSchema.startTime, input.end),
      )),
    db
      .select({
        ...getTableColumns(appointmentDepositSchema),
        invoiceCurrency: appointmentSchema.invoiceCurrency,
      })
      .from(appointmentDepositSchema)
      .innerJoin(
        appointmentSchema,
        and(
          eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
          eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
        ),
      )
      .where(and(
        eq(appointmentDepositSchema.salonId, input.salonId),
        or(
          and(
            gte(appointmentDepositSchema.forfeitedAt, input.start),
            lt(appointmentDepositSchema.forfeitedAt, input.end),
          ),
          and(
            gte(appointmentDepositSchema.refundedAt, input.start),
            lt(appointmentDepositSchema.refundedAt, input.end),
            sql`${appointmentDepositSchema.forfeitedAt} IS NOT NULL`,
          ),
        ),
      )),
    db
      .select({
        totalPrice: appointmentSchema.totalPrice,
        completedAt: appointmentSchema.completedAt,
        finalPriceCents: appointmentSchema.finalPriceCents,
        taxableSubtotalCents: appointmentSchema.taxableSubtotalCents,
        taxAmountCents: appointmentSchema.taxAmountCents,
        taxExempt: appointmentSchema.taxExempt,
        taxExemptReason: appointmentSchema.taxExemptReason,
        tipCents: appointmentSchema.tipCents,
        finalDiscountCents: appointmentSchema.finalDiscountCents,
        invoiceCurrency: appointmentSchema.invoiceCurrency,
        bookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
        rescheduleTaxSnapshot: appointmentSchema.rescheduleTaxSnapshot,
        finalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, input.salonId),
        appointmentInReportingCurrency,
        gte(appointmentSchema.startTime, input.start),
        lt(appointmentSchema.startTime, input.end),
        completedEligible,
      )),
    db
      .select({
        ...getTableColumns(appointmentDepositSchema),
        appointmentStatus: appointmentSchema.status,
        appointmentCompletedAt: appointmentSchema.completedAt,
        appointmentPaymentStatus: appointmentSchema.paymentStatus,
        appointmentAmountPaidCents: appointmentSchema.amountPaidCents,
        appointmentFinalPriceCents: appointmentSchema.finalPriceCents,
        appointmentTotalPrice: appointmentSchema.totalPrice,
        appointmentTaxAmountCents: appointmentSchema.taxAmountCents,
        appointmentTaxableSubtotalCents:
          appointmentSchema.taxableSubtotalCents,
        appointmentTaxExempt: appointmentSchema.taxExempt,
        appointmentTaxExemptReason: appointmentSchema.taxExemptReason,
        appointmentTipCents: appointmentSchema.tipCents,
        appointmentInvoiceCurrency: appointmentSchema.invoiceCurrency,
        appointmentBookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
        appointmentRescheduleTaxSnapshot:
          appointmentSchema.rescheduleTaxSnapshot,
        appointmentFinalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
      })
      .from(appointmentDepositSchema)
      .innerJoin(
        appointmentSchema,
        and(
          eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
          eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
        ),
      )
      .where(and(
        eq(appointmentDepositSchema.salonId, input.salonId),
        appointmentInReportingCurrency,
        gte(appointmentSchema.startTime, input.start),
        lt(appointmentSchema.startTime, input.end),
        completedDepositApplicationEligible,
      )),
    db
      .select({
        appointmentId: appointmentPaymentSchema.appointmentId,
        salonId: appointmentPaymentSchema.salonId,
        amountCents: appointmentPaymentSchema.amountCents,
        voidedAt: appointmentPaymentSchema.voidedAt,
      })
      .from(appointmentPaymentSchema)
      .innerJoin(
        appointmentSchema,
        eq(appointmentSchema.id, appointmentPaymentSchema.appointmentId),
      )
      .where(and(
        eq(appointmentSchema.salonId, input.salonId),
        appointmentInReportingCurrency,
        gte(appointmentSchema.startTime, input.start),
        lt(appointmentSchema.startTime, input.end),
        completedDepositApplicationEligible,
      )),
  ]);

  const appointmentPaymentsCollectedCents
    = numberValue(cashRows[0]?.cashCollectedCents);
  const depositEvents = depositEventRows[0];
  const depositCollectedCents
    = numberValue(depositEvents?.depositCollectedCents);
  const currencyCounts = currencyRows[0];
  const paymentEvents = cashRows[0];
  const actualTaxBuckets = new Map<string, FinancialActualTaxIdentityBucket>();
  let finalizedAppointmentCount = 0;
  let legacyAppointmentCount = 0;
  let unresolvedAppointmentCount = 0;
  let finalizedAmountCents = 0;
  let legacyFallbackAmountCents = 0;
  let tipsCents = 0;
  let taxCents = 0;
  let discountsCents = 0;
  let taxableSubtotalCents = 0;
  let unresolvedActualTaxIdentityCount = 0;
  for (const row of actualTaxRows) {
    const resolved = resolveCompletedRevenueCandidate(row);
    if (!resolved.ok) {
      unresolvedAppointmentCount += 1;
      if (resolved.unresolvedActualTaxIdentity) {
        unresolvedActualTaxIdentityCount += 1;
      }
      continue;
    }
    if (resolved.unresolvedActualTaxIdentity) {
      unresolvedActualTaxIdentityCount += 1;
    }
    if (resolved.source === 'finalized') {
      finalizedAppointmentCount += 1;
      finalizedAmountCents += resolved.serviceValueCents;
    } else {
      legacyAppointmentCount += 1;
      legacyFallbackAmountCents += resolved.serviceValueCents;
    }
    tipsCents += resolved.tipCents;
    taxCents += resolved.taxCents;
    discountsCents += resolved.discountCents;
    taxableSubtotalCents += resolved.taxableSubtotalCents;

    const snapshot = resolved.finalTaxSnapshot;
    if (snapshot !== null) {
      const configuration = snapshot.configuration;
      const key = JSON.stringify([
        configuration.configurationIdentity,
        snapshot.taxApplied,
        snapshot.taxExempt,
      ]);
      const current = actualTaxBuckets.get(key) ?? {
        schemaVersion: snapshot.schemaVersion,
        classification: snapshot.classification,
        configurationIdentityVersion:
          configuration.configurationIdentityVersion,
        configurationIdentity: configuration.configurationIdentity,
        label: configuration.label,
        rateBps: configuration.rateBps,
        mode: configuration.mode,
        configurationEffectiveFrom: configuration.configurationEffectiveFrom,
        configurationEffectiveDate: configuration.configurationEffectiveDate,
        configurationTimeZone: configuration.configurationTimeZone,
        configurationSource: configuration.configurationSource,
        taxApplied: snapshot.taxApplied,
        taxExempt: snapshot.taxExempt,
        appointmentCount: 0,
        serviceSubtotalCents: 0,
        taxableSubtotalCents: 0,
        taxCents: 0,
      };
      current.appointmentCount += 1;
      current.serviceSubtotalCents += resolved.serviceValueCents;
      current.taxableSubtotalCents += resolved.taxableSubtotalCents;
      current.taxCents += resolved.taxCents;
      actualTaxBuckets.set(key, current);
    }
  }
  // Completed rows excluded by the reporting-currency boundary (historical
  // NULL/invalid invoice currency, or a different valid currency) are real
  // completed money this summary deliberately did not aggregate. They count as
  // unresolved so the provenance discloses the omission (isEstimated flips)
  // instead of presenting a partial total as exact — mirroring how
  // loadResolvedBalanceRows classifies the same rows for balance provenance.
  // The dedicated unknown/foreign counters remain the itemized disclosure.
  const currencyExcludedCompletedCount
    = numberValue(currencyCounts?.unknownCurrencyAppointmentCount)
    + numberValue(currencyCounts?.excludedForeignCurrencyAppointmentCount);
  const provenance = buildReportingProvenance({
    finalizedAppointmentCount,
    legacyAppointmentCount,
    unresolvedAppointmentCount:
      unresolvedAppointmentCount + currencyExcludedCompletedCount,
    finalizedAmountCents,
    legacyFallbackAmountCents,
  });
  const forfeitureTaxBuckets
    = new Map<string, FinancialForfeitureTaxIdentityBucket>();
  let depositForfeitedCents = 0;
  let depositForfeitureEstimatedTaxCents = 0;
  let depositForfeitureEstimatedNetCents = 0;
  let depositForfeitureRefundReversalCents = 0;
  let depositForfeitureTaxReversalCents = 0;
  let depositForfeitureNetReversalCents = 0;
  let canonicalForfeitureInvalidCount = 0;
  const inRange = (value: Date | null) => value !== null
    && value.getTime() >= input.start.getTime()
    && value.getTime() < input.end.getTime();
  for (const row of forfeitureRows) {
    const invoiceCurrency = row.invoiceCurrency?.trim().toUpperCase() ?? null;
    const depositCurrency = row.currency.trim().toUpperCase();
    const currencyResolved = invoiceCurrency === reportingCurrency
      && depositCurrency === reportingCurrency;
    if (!currencyResolved) {
      // Known foreign-currency and unknown-currency events are disclosed in
      // their dedicated counters. A known mismatch on a report-currency
      // appointment is a reconciliation residual.
      if (
        invoiceCurrency === reportingCurrency
        && (depositCurrency === 'CAD' || depositCurrency === 'USD')
      ) {
        canonicalForfeitureInvalidCount += 1;
      }
      continue;
    }
    const validated = validateForfeitureTaxSnapshot(
      row.forfeitureTaxSnapshot,
      {
        expectedCurrency: reportingCurrency,
        expectedGrossForfeitedCents: row.amountCents,
        expectedCapturedAt: row.forfeitedAt,
      },
    );
    const canonicalDeposit = resolveAppointmentDepositFinancials({
      deposits: [row],
      invoiceCurrency,
      finalPriceCents: 0,
      taxAmountCents: 0,
      tipCents: 0,
      appointmentPaymentsCents: 0,
    }).depositResolution;
    const canonicalForfeiture = canonicalDeposit.ok
      && canonicalDeposit.forfeitedDepositIds.includes(row.id);
    if (!canonicalForfeiture || !validated.ok) {
      canonicalForfeitureInvalidCount += 1;
      continue;
    }
    const snapshot = validated.snapshot;
    const configuration = snapshot.configuration;
    const key = JSON.stringify([
      configuration.configurationIdentity,
      snapshot.taxEstimateApplied,
    ]);
    const bucket = forfeitureTaxBuckets.get(key) ?? {
      schemaVersion: snapshot.schemaVersion,
      classification: snapshot.classification,
      configurationIdentityVersion:
        configuration.configurationIdentityVersion,
      configurationIdentity: configuration.configurationIdentity,
      label: configuration.label,
      rateBps: configuration.rateBps,
      mode: configuration.mode,
      configurationEffectiveFrom: configuration.configurationEffectiveFrom,
      configurationEffectiveDate: configuration.configurationEffectiveDate,
      configurationTimeZone: configuration.configurationTimeZone,
      configurationSource: configuration.configurationSource,
      taxEstimateApplied: snapshot.taxEstimateApplied,
      forfeitureCount: 0,
      grossForfeitedCents: 0,
      estimatedTaxIncludedCents: 0,
      estimatedNetCents: 0,
      refundReversalCount: 0,
      refundReversalCents: 0,
      estimatedTaxReversalCents: 0,
      estimatedNetReversalCents: 0,
    };
    if (inRange(row.forfeitedAt)) {
      bucket.forfeitureCount += 1;
      bucket.grossForfeitedCents += snapshot.grossForfeitedCents;
      bucket.estimatedTaxIncludedCents += snapshot.estimatedTaxIncludedCents;
      bucket.estimatedNetCents += snapshot.estimatedNetCents;
      depositForfeitedCents += snapshot.grossForfeitedCents;
      depositForfeitureEstimatedTaxCents += snapshot.estimatedTaxIncludedCents;
      depositForfeitureEstimatedNetCents += snapshot.estimatedNetCents;
    }
    const validRefundReversal = inRange(row.refundedAt)
      && canonicalDeposit.ok
      && canonicalDeposit.refundedDepositIds.includes(row.id);
    if (validRefundReversal) {
      bucket.refundReversalCount += 1;
      bucket.refundReversalCents += snapshot.grossForfeitedCents;
      bucket.estimatedTaxReversalCents += snapshot.estimatedTaxIncludedCents;
      bucket.estimatedNetReversalCents += snapshot.estimatedNetCents;
      depositForfeitureRefundReversalCents += snapshot.grossForfeitedCents;
      depositForfeitureTaxReversalCents += snapshot.estimatedTaxIncludedCents;
      depositForfeitureNetReversalCents += snapshot.estimatedNetCents;
    }
    forfeitureTaxBuckets.set(key, bucket);
  }
  const depositsForApplication = new Map<
    string,
    typeof depositApplicationRows
  >();
  for (const row of depositApplicationRows) {
    const rows = depositsForApplication.get(row.appointmentId) ?? [];
    rows.push(row);
    depositsForApplication.set(row.appointmentId, rows);
  }
  const applicationPaymentsByAppointment = new Map<
    string,
    typeof depositApplicationPaymentRows
  >();
  for (const row of depositApplicationPaymentRows) {
    const rows = applicationPaymentsByAppointment.get(row.appointmentId) ?? [];
    rows.push(row);
    applicationPaymentsByAppointment.set(row.appointmentId, rows);
  }
  let canonicalDepositAppliedCents = 0;
  let canonicalUnresolvedDepositApplicationCount = 0;
  for (const rows of depositsForApplication.values()) {
    const appointment = rows[0]!;
    const paymentLedger = resolveAppointmentPaymentLedger({
      cachedAmountPaidCents: appointment.appointmentAmountPaidCents,
      paymentRows:
        applicationPaymentsByAppointment.get(appointment.appointmentId) ?? [],
      expectedSalonId: input.salonId,
      appointmentStatus: appointment.appointmentStatus,
      paymentStatus: appointment.appointmentPaymentStatus,
    });
    let snapshotResolved = true;
    let serviceSubtotalCents = appointment.appointmentTotalPrice;
    let taxAmountCents = 0;
    let tipCents = 0;
    if (appointment.appointmentFinalTaxSnapshot !== null) {
      const snapshotChain = validateAppointmentTaxSnapshotChain({
        status: appointment.appointmentStatus,
        completedAt: appointment.appointmentCompletedAt,
        totalPrice: appointment.appointmentTotalPrice,
        finalPriceCents: appointment.appointmentFinalPriceCents,
        taxableSubtotalCents:
          appointment.appointmentTaxableSubtotalCents,
        taxAmountCents: appointment.appointmentTaxAmountCents,
        taxExempt: appointment.appointmentTaxExempt,
        taxExemptReason: appointment.appointmentTaxExemptReason,
        invoiceCurrency: appointment.appointmentInvoiceCurrency,
        bookingTaxSnapshot: appointment.appointmentBookingTaxSnapshot,
        rescheduleTaxSnapshot:
          appointment.appointmentRescheduleTaxSnapshot,
        finalTaxSnapshot: appointment.appointmentFinalTaxSnapshot,
      });
      const validated = validateInvoiceTaxSnapshot(
        appointment.appointmentFinalTaxSnapshot,
        {
          expectedKind: 'final_actual',
          expectedCurrency: appointment.appointmentInvoiceCurrency,
          expectedScalars: {
            finalPriceCents: appointment.appointmentFinalPriceCents,
            taxableSubtotalCents:
              appointment.appointmentTaxableSubtotalCents,
            taxAmountCents: appointment.appointmentTaxAmountCents,
            taxExempt: appointment.appointmentTaxExempt,
            taxExemptReason: appointment.appointmentTaxExemptReason,
            serviceInvoiceTotalCents:
              appointment.appointmentFinalPriceCents !== null
              && appointment.appointmentTaxAmountCents !== null
                ? appointment.appointmentFinalPriceCents
                + appointment.appointmentTaxAmountCents
                : null,
          },
        },
      );
      snapshotResolved = snapshotChain.ok && validated.ok;
      if (snapshotResolved && validated.ok) {
        serviceSubtotalCents = validated.invoiceMoney.finalPriceCents;
        taxAmountCents = validated.invoiceMoney.taxAmountCents;
        tipCents = appointment.appointmentTipCents ?? 0;
        snapshotResolved = isMinorUnits(tipCents);
      }
    } else if (
      appointment.appointmentBookingTaxSnapshot !== null
      || appointment.appointmentRescheduleTaxSnapshot !== null
    ) {
      // A D6.1 completion cannot lose its final snapshot and keep applying a
      // deposit from booking estimates.
      snapshotResolved = false;
    } else {
      serviceSubtotalCents = appointment.appointmentFinalPriceCents
      ?? appointment.appointmentTotalPrice;
      taxAmountCents = appointment.appointmentTaxAmountCents ?? 0;
      tipCents = appointment.appointmentTipCents ?? 0;
      snapshotResolved = isMinorUnits(serviceSubtotalCents)
      && isMinorUnits(taxAmountCents)
      && isMinorUnits(tipCents);
    }
    const financial = snapshotResolved && paymentLedger.ok
      ? resolveAppointmentDepositFinancials({
        deposits: rows,
        invoiceCurrency: appointment.appointmentInvoiceCurrency,
        finalPriceCents: serviceSubtotalCents,
        taxAmountCents,
        tipCents,
        appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
        appointmentStatus: appointment.appointmentStatus,
        paymentStatus: appointment.appointmentPaymentStatus,
      })
      : null;
    if (
      financial === null
      || !financial.depositResolution.ok
      || !financial.financials.ok
      || financial.financials.excessDepositCents > 0
      || financial.financials.tenderExcessCents > 0
    ) {
      canonicalUnresolvedDepositApplicationCount += 1;
      continue;
    }
    canonicalDepositAppliedCents
      += financial.financials.depositCreditAppliedCents;
  }

  return {
    completedAppointmentRevenueCents:
      provenance.finalizedAmountCents + provenance.legacyFallbackAmountCents,
    completedAppointmentCount: actualTaxRows.length,
    cashCollectedCents:
      appointmentPaymentsCollectedCents + depositCollectedCents,
    appointmentPaymentsCollectedCents,
    depositCollectedCents,
    depositRefundedCents: numberValue(depositEvents?.depositRefundedCents),
    depositForfeitedCents,
    depositForfeitureEstimatedTaxCents,
    depositForfeitureEstimatedNetCents,
    depositForfeitureRefundReversalCents,
    depositForfeitureTaxReversalCents,
    depositForfeitureNetReversalCents,
    forfeitureTaxIdentityBuckets: [...forfeitureTaxBuckets.values()],
    depositAppliedCents: canonicalDepositAppliedCents,
    remainingBalancePaymentsCollectedCents: appointmentPaymentsCollectedCents,
    unattributedPaymentEventCount:
      numberValue(paymentEvents?.unattributedPaymentEventCount),
    unresolvedDepositApplicationCount:
      canonicalUnresolvedDepositApplicationCount,
    unattributedDepositEventCount:
      numberValue(depositEvents?.unattributedDepositEventCount),
    unresolvedDepositEventCount:
      numberValue(depositEvents?.unresolvedDepositEventCount)
      + canonicalForfeitureInvalidCount,
    unknownCurrencyAppointmentCount:
      numberValue(currencyCounts?.unknownCurrencyAppointmentCount),
    excludedForeignCurrencyAppointmentCount:
      numberValue(currencyCounts?.excludedForeignCurrencyAppointmentCount),
    unknownCurrencyPaymentEventCount:
      numberValue(paymentEvents?.unknownCurrencyPaymentEventCount),
    excludedForeignCurrencyPaymentEventCount:
      numberValue(paymentEvents?.excludedForeignCurrencyPaymentEventCount),
    unknownCurrencyDepositEventCount:
      numberValue(depositEvents?.unknownCurrencyDepositEventCount),
    excludedForeignCurrencyDepositEventCount:
      numberValue(depositEvents?.excludedForeignCurrencyDepositEventCount),
    tipsCents,
    taxCents,
    taxableSubtotalCents,
    unresolvedActualTaxIdentityCount,
    actualTaxIdentityBuckets: [...actualTaxBuckets.values()],
    discountsCents,
    provenance,
    dateRange: {
      start: input.start,
      end: input.end,
    },
  };
}

/**
 * Canonical per-appointment service revenue for charts and technician splits.
 * Rows with missing/corrupt required final snapshots are omitted so every
 * downstream series is a partition of the validated headline revenue.
 */
export async function getCompletedRevenueRows(
  input: FinancialReportingRangeSummaryInput,
): Promise<CompletedRevenueRow[]> {
  assertSalonId(input.salonId);
  assertRange(input.start, input.end);
  const reportingCurrency = normalizeReportingCurrency(input.currency);
  const candidates = await db.select({
    id: appointmentSchema.id,
    technicianId: appointmentSchema.technicianId,
    startTime: appointmentSchema.startTime,
    completedAt: appointmentSchema.completedAt,
    totalPrice: appointmentSchema.totalPrice,
    finalPriceCents: appointmentSchema.finalPriceCents,
    taxableSubtotalCents: appointmentSchema.taxableSubtotalCents,
    taxAmountCents: appointmentSchema.taxAmountCents,
    taxExempt: appointmentSchema.taxExempt,
    taxExemptReason: appointmentSchema.taxExemptReason,
    tipCents: appointmentSchema.tipCents,
    finalDiscountCents: appointmentSchema.finalDiscountCents,
    invoiceCurrency: appointmentSchema.invoiceCurrency,
    bookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
    rescheduleTaxSnapshot: appointmentSchema.rescheduleTaxSnapshot,
    finalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.salonId, input.salonId),
    eq(appointmentSchema.status, 'completed'),
    isNull(appointmentSchema.deletedAt),
    sql`${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'`,
    sql`UPPER(${appointmentSchema.invoiceCurrency}) = ${reportingCurrency}`,
    gte(appointmentSchema.startTime, input.start),
    lt(appointmentSchema.startTime, input.end),
  ));

  const rows: CompletedRevenueRow[] = [];
  for (const candidate of candidates) {
    const resolved = resolveCompletedRevenueCandidate(candidate);
    if (!resolved.ok) {
      continue;
    }
    rows.push({
      appointmentId: candidate.id,
      technicianId: candidate.technicianId,
      startTime: candidate.startTime,
      source: resolved.source,
      serviceValueCents: resolved.serviceValueCents,
      tipCents: resolved.tipCents,
      taxCents: resolved.taxCents,
      unresolvedActualTaxIdentity: resolved.unresolvedActualTaxIdentity,
    });
  }
  return rows;
}

type ResolvedBalanceRows = {
  completedRows: CompletedFinancialRow[];
  completedUnresolvedRows: Array<{
    appointmentId: string;
    salonClientId: string | null;
    clientPhone: string;
  }>;
  completedUnresolvedCount: number;
  upcomingBalanceCents: number;
  upcomingAppointmentCount: number;
  unresolvedUpcomingAppointmentCount: number;
  settledByLegacyPaymentStatusCount: number;
  unknownCurrencyAppointmentCount: number;
  excludedForeignCurrencyAppointmentCount: number;
};

function isMinorUnits(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

async function loadResolvedBalanceRows(input: {
  salonId: string;
  reportingCurrency: 'CAD' | 'USD';
  asOf: Date;
  clientPhoneVariants?: string[];
  technicianId?: string;
}): Promise<ResolvedBalanceRows> {
  const appointments = await db.select({
    id: appointmentSchema.id,
    salonClientId: appointmentSchema.salonClientId,
    clientPhone: appointmentSchema.clientPhone,
    status: appointmentSchema.status,
    completedAt: appointmentSchema.completedAt,
    paymentStatus: appointmentSchema.paymentStatus,
    startTime: appointmentSchema.startTime,
    totalPrice: appointmentSchema.totalPrice,
    finalPriceCents: appointmentSchema.finalPriceCents,
    taxAmountCents: appointmentSchema.taxAmountCents,
    taxableSubtotalCents: appointmentSchema.taxableSubtotalCents,
    taxExempt: appointmentSchema.taxExempt,
    taxExemptReason: appointmentSchema.taxExemptReason,
    tipCents: appointmentSchema.tipCents,
    finalDiscountCents: appointmentSchema.finalDiscountCents,
    amountPaidCents: appointmentSchema.amountPaidCents,
    invoiceCurrency: appointmentSchema.invoiceCurrency,
    bookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
    rescheduleTaxSnapshot: appointmentSchema.rescheduleTaxSnapshot,
    finalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.salonId, input.salonId),
    isNull(appointmentSchema.deletedAt),
    sql`${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'`,
    or(
      and(
        eq(appointmentSchema.status, 'completed'),
        lte(appointmentSchema.startTime, input.asOf),
      ),
      and(
        inArray(appointmentSchema.status, ['pending', 'confirmed']),
        gte(appointmentSchema.startTime, input.asOf),
      ),
    ),
    input.clientPhoneVariants
      ? inArray(appointmentSchema.clientPhone, input.clientPhoneVariants)
      : undefined,
    input.technicianId
      ? eq(appointmentSchema.technicianId, input.technicianId)
      : undefined,
  ));

  const appointmentIds = appointments.map(appointment => appointment.id);
  let depositRows: Array<typeof appointmentDepositSchema.$inferSelect> = [];
  let paymentRows: Array<typeof appointmentPaymentSchema.$inferSelect> = [];
  if (appointmentIds.length > 0) {
    [depositRows, paymentRows] = await Promise.all([
      db.select().from(appointmentDepositSchema).where(and(
        eq(appointmentDepositSchema.salonId, input.salonId),
        inArray(appointmentDepositSchema.appointmentId, appointmentIds),
      )),
      db.select().from(appointmentPaymentSchema).where(and(
        inArray(appointmentPaymentSchema.appointmentId, appointmentIds),
      )),
    ]);
  }
  const depositsByAppointment = new Map<string, typeof depositRows>();
  for (const deposit of depositRows) {
    const rows = depositsByAppointment.get(deposit.appointmentId) ?? [];
    rows.push(deposit);
    depositsByAppointment.set(deposit.appointmentId, rows);
  }
  const paymentsByAppointment = new Map<string, typeof paymentRows>();
  for (const payment of paymentRows) {
    const rows = paymentsByAppointment.get(payment.appointmentId) ?? [];
    rows.push(payment);
    paymentsByAppointment.set(payment.appointmentId, rows);
  }

  const result: ResolvedBalanceRows = {
    completedRows: [],
    completedUnresolvedRows: [],
    completedUnresolvedCount: 0,
    upcomingBalanceCents: 0,
    upcomingAppointmentCount: 0,
    unresolvedUpcomingAppointmentCount: 0,
    settledByLegacyPaymentStatusCount: 0,
    unknownCurrencyAppointmentCount: 0,
    excludedForeignCurrencyAppointmentCount: 0,
  };

  for (const appointment of appointments) {
    const isCompleted = appointment.status === 'completed';
    const recordCompletedUnresolved = () => {
      if (isCompleted) {
        result.completedUnresolvedRows.push({
          appointmentId: appointment.id,
          salonClientId: appointment.salonClientId,
          clientPhone: appointment.clientPhone,
        });
      }
    };
    const normalizedCurrency = appointment.invoiceCurrency?.trim().toUpperCase() ?? null;
    if (normalizedCurrency !== 'CAD' && normalizedCurrency !== 'USD') {
      result.unknownCurrencyAppointmentCount += 1;
      if (isCompleted) {
        result.completedUnresolvedCount += 1;
      }
      recordCompletedUnresolved();
      continue;
    }
    if (normalizedCurrency !== input.reportingCurrency) {
      result.excludedForeignCurrencyAppointmentCount += 1;
      recordCompletedUnresolved();
      continue;
    }

    let finalPriceCents: number | null;
    let taxAmountCents: number | null;
    let taxSnapshotResolved = true;

    if (isCompleted) {
      if (appointment.finalTaxSnapshot !== null) {
        const revenue = resolveCompletedRevenueCandidate(appointment);
        taxSnapshotResolved = revenue.ok;
        finalPriceCents = revenue.ok ? revenue.serviceValueCents : null;
        taxAmountCents = revenue.ok ? revenue.taxCents : null;
      } else if (
        appointment.bookingTaxSnapshot !== null
        || appointment.rescheduleTaxSnapshot !== null
      ) {
        finalPriceCents = null;
        taxAmountCents = null;
        taxSnapshotResolved = false;
      } else {
        finalPriceCents = appointment.finalPriceCents ?? appointment.totalPrice;
        taxAmountCents = appointment.taxAmountCents ?? 0;
        taxSnapshotResolved = isMinorUnits(finalPriceCents)
        && isMinorUnits(taxAmountCents)
        && isMinorUnits(appointment.tipCents ?? 0);
      }
    } else {
      const snapshotChain = validateAppointmentTaxSnapshotChain({
        status: appointment.status,
        completedAt: appointment.completedAt,
        totalPrice: appointment.totalPrice,
        finalPriceCents: appointment.finalPriceCents,
        taxableSubtotalCents: appointment.taxableSubtotalCents,
        taxAmountCents: appointment.taxAmountCents,
        taxExempt: appointment.taxExempt,
        taxExemptReason: appointment.taxExemptReason,
        invoiceCurrency: normalizedCurrency,
        bookingTaxSnapshot: appointment.bookingTaxSnapshot,
        rescheduleTaxSnapshot: appointment.rescheduleTaxSnapshot,
        finalTaxSnapshot: appointment.finalTaxSnapshot,
      });
      if (!snapshotChain.ok) {
        finalPriceCents = null;
        taxAmountCents = null;
        taxSnapshotResolved = false;
      } else if (snapshotChain.active.snapshot === null) {
        finalPriceCents = appointment.totalPrice;
        taxAmountCents = 0;
        taxSnapshotResolved = isMinorUnits(appointment.totalPrice);
      } else {
        const validated = validateInvoiceTaxSnapshot(
          snapshotChain.active.snapshot,
          {
            expectedKind: 'booking_estimate',
            expectedCurrency: normalizedCurrency,
          },
        );
        if (!validated.ok) {
          finalPriceCents = null;
          taxAmountCents = null;
          taxSnapshotResolved = false;
        } else {
          finalPriceCents = validated.invoiceMoney.finalPriceCents;
          taxAmountCents = validated.invoiceMoney.taxAmountCents;
        }
      }
    }

    const paymentLedger = resolveAppointmentPaymentLedger({
      cachedAmountPaidCents: appointment.amountPaidCents,
      paymentRows: paymentsByAppointment.get(appointment.id) ?? [],
      expectedSalonId: input.salonId,
      appointmentStatus: appointment.status,
      paymentStatus: appointment.paymentStatus,
    });
    const financial = taxSnapshotResolved && paymentLedger.ok
      ? resolveAppointmentDepositFinancials({
        deposits: depositsByAppointment.get(appointment.id) ?? [],
        invoiceCurrency: normalizedCurrency,
        finalPriceCents: finalPriceCents ?? appointment.totalPrice,
        taxAmountCents,
        tipCents: isCompleted ? appointment.tipCents : 0,
        appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      })
      : null;
    if (
      financial === null
      || !financial.depositResolution.ok
      || !financial.financials.ok
      || financial.financials.excessDepositCents !== 0
      || financial.financials.tenderExcessCents !== 0
    ) {
      if (isCompleted) {
        result.completedUnresolvedCount += 1;
        recordCompletedUnresolved();
      } else {
        result.unresolvedUpcomingAppointmentCount += 1;
      }
      continue;
    }
    const resolvedFinancials = financial.financials;

    if (isCompleted) {
      result.completedRows.push({
        appointmentId: appointment.id,
        salonClientId: appointment.salonClientId,
        clientPhone: appointment.clientPhone,
        startTime: appointment.startTime,
        completedOutstandingCents: resolvedFinancials.remainingBalanceCents,
        financialState: 'resolved',
        source: appointment.finalPriceCents === null ? 'legacy' : 'finalized',
        serviceValueCents: appointment.finalPriceCents ?? appointment.totalPrice,
        financiallySettled: resolvedFinancials.financiallySettled,
      });
      if (resolvedFinancials.legacyPaidAssumed) {
        result.settledByLegacyPaymentStatusCount += 1;
      }
    } else {
      result.upcomingBalanceCents += resolvedFinancials.remainingBalanceCents;
      result.upcomingAppointmentCount += 1;
    }
  }

  return result;
}

/** Load point-in-time balances through the canonical snapshot and ledgers. */
export async function getFinancialBalanceSummary(
  input: FinancialBalanceSummaryInput,
): Promise<FinancialBalanceSummary> {
  assertSalonId(input.salonId);
  const reportingCurrency = normalizeReportingCurrency(input.currency);
  if (input.clientPhoneVariants && input.clientPhoneVariants.length === 0) {
    throw new TypeError('clientPhoneVariants must not be empty when provided');
  }
  const asOf = input.asOf ?? new Date();
  assertValidDate(asOf, 'asOf');
  const rows = await loadResolvedBalanceRows({
    salonId: input.salonId,
    reportingCurrency,
    asOf,
    clientPhoneVariants: input.clientPhoneVariants,
  });
  const finalizedRows = rows.completedRows.filter(row => row.source === 'finalized');
  const legacyRows = rows.completedRows.filter(row => row.source === 'legacy');
  const completedOutstandingProvenance = buildReportingProvenance({
    finalizedAppointmentCount: finalizedRows.length,
    legacyAppointmentCount: legacyRows.length,
    unresolvedAppointmentCount: rows.completedUnresolvedCount,
    finalizedAmountCents: finalizedRows.reduce(
      (sum, row) => sum + row.completedOutstandingCents,
      0,
    ),
    legacyFallbackAmountCents: legacyRows.reduce(
      (sum, row) => sum + row.completedOutstandingCents,
      0,
    ),
  });
  return {
    completedOutstandingCents:
      completedOutstandingProvenance.finalizedAmountCents
      + completedOutstandingProvenance.legacyFallbackAmountCents,
    upcomingBalanceCents: rows.upcomingBalanceCents,
    completedOutstandingProvenance,
    upcomingAppointmentCount: rows.upcomingAppointmentCount,
    unresolvedUpcomingAppointmentCount: rows.unresolvedUpcomingAppointmentCount,
    settledByLegacyPaymentStatusCount: rows.settledByLegacyPaymentStatusCount,
    unknownCurrencyAppointmentCount: rows.unknownCurrencyAppointmentCount,
    excludedForeignCurrencyAppointmentCount:
      rows.excludedForeignCurrencyAppointmentCount,
    depositDue: UNSUPPORTED_DEPOSIT_DUE,
    asOf,
  };
}

/**
 * Return resolved completed balances per appointment for client segmentation.
 * This is the same eligibility and payment-ledger calculation used by
 * getFinancialBalanceSummary, exposed as one tenant-scoped set query so Client
 * Insights never performs a balance lookup per client.
 */
export async function getCompletedOutstandingRows(input: {
  salonId: string;
  currency: string;
  asOf?: Date;
}): Promise<CompletedOutstandingRow[]> {
  const resolution = await getCompletedFinancialResolution(input);
  return [
    ...resolution.resolvedRows.map(row => ({
      appointmentId: row.appointmentId,
      salonClientId: row.salonClientId,
      clientPhone: row.clientPhone,
      completedOutstandingCents: row.completedOutstandingCents,
      financialState: 'resolved' as const,
    })),
    ...resolution.unresolvedRows.map(row => ({
      ...row,
      completedOutstandingCents: 0,
      financialState: 'under_review' as const,
    })),
  ];
}

type CompletedFinancialResolutionInput = {
  salonId: string;
  currency: string;
  asOf?: Date;
  clientPhoneVariants?: string[];
  technicianId?: string;
};

/** Canonical per-completion facts plus identities blocked by reconciliation. */
export async function getCompletedFinancialResolution(
  input: CompletedFinancialResolutionInput,
): Promise<{
    resolvedRows: CompletedFinancialRow[];
    unresolvedRows: ResolvedBalanceRows['completedUnresolvedRows'];
  }> {
  assertSalonId(input.salonId);
  const reportingCurrency = normalizeReportingCurrency(input.currency);
  const asOf = input.asOf ?? new Date();
  assertValidDate(asOf, 'asOf');
  const rows = await loadResolvedBalanceRows({
    salonId: input.salonId,
    reportingCurrency,
    asOf,
    clientPhoneVariants: input.clientPhoneVariants,
    technicianId: input.technicianId,
  });
  return {
    resolvedRows: rows.completedRows,
    unresolvedRows: rows.completedUnresolvedRows,
  };
}

/** Canonical resolved per-completion facts for currency-scoped consumers. */
export async function getCompletedFinancialRows(
  input: CompletedFinancialResolutionInput,
): Promise<CompletedFinancialRow[]> {
  return (await getCompletedFinancialResolution(input)).resolvedRows;
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
      currency: input.currency,
      ...ranges.today,
    }),
    getFinancialReportingRangeSummary({
      salonId: input.salonId,
      currency: input.currency,
      ...ranges.weekToDate,
    }),
    getFinancialReportingRangeSummary({
      salonId: input.salonId,
      currency: input.currency,
      ...ranges.monthToDate,
    }),
    getFinancialBalanceSummary({
      salonId: input.salonId,
      currency: input.currency,
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
