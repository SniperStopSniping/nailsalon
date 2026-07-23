/**
 * Canonical, storage-agnostic reporting rules.
 *
 * The database reporting layer can aggregate these same classifications in
 * SQL, while these pure helpers keep provenance and balance decisions explicit
 * and independently testable.
 */

export type ReportingProvenanceMode = 'empty' | 'finalized' | 'legacy' | 'mixed';

export type ReportingProvenanceInput = {
  finalizedAppointmentCount: number;
  legacyAppointmentCount: number;
  unresolvedAppointmentCount: number;
  finalizedAmountCents: number;
  legacyFallbackAmountCents: number;
};

export type ReportingProvenance = ReportingProvenanceInput & {
  mode: ReportingProvenanceMode;
  isEstimated: boolean;
};

export function buildReportingProvenance(
  input: ReportingProvenanceInput,
): ReportingProvenance {
  const hasFinalized = input.finalizedAppointmentCount > 0;
  const hasLegacy = input.legacyAppointmentCount > 0;
  const mode: ReportingProvenanceMode = hasFinalized && hasLegacy
    ? 'mixed'
    : hasLegacy
      ? 'legacy'
      : hasFinalized
        ? 'finalized'
        : 'empty';

  return {
    ...input,
    mode,
    // Legacy booked totals are estimates. An unresolved row also means the
    // aggregate is incomplete even when every included dollar was finalized.
    isEstimated: hasLegacy || input.unresolvedAppointmentCount > 0,
  };
}

export type CompletedAppointmentRevenueInput = {
  status: string | null;
  deletedAt?: Date | string | null;
  paymentStatus?: string | null;
  finalPriceCents: number | null;
  legacyBookedTotalCents: number | null;
};

export type CompletedAppointmentRevenueResolution = {
  amountCents: number;
  source: 'excluded' | 'finalized' | 'legacy' | 'unresolved';
};

function isValidCents(value: number | null | undefined): value is number {
  return value != null && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Resolve one appointment's contribution to completed appointment revenue.
 *
 * A present but invalid finalized value is unresolved; it never falls through
 * to the booked total. That prevents corrupt finalized data from being silently
 * relabelled as a normal legacy estimate.
 */
export function resolveCompletedAppointmentRevenue(
  input: CompletedAppointmentRevenueInput,
): CompletedAppointmentRevenueResolution {
  const isEligible = input.status === 'completed'
    && input.deletedAt == null
    && input.paymentStatus !== 'comp';

  if (!isEligible) {
    return { amountCents: 0, source: 'excluded' };
  }

  if (input.finalPriceCents != null) {
    return isValidCents(input.finalPriceCents)
      ? { amountCents: input.finalPriceCents, source: 'finalized' }
      : { amountCents: 0, source: 'unresolved' };
  }

  return isValidCents(input.legacyBookedTotalCents)
    ? { amountCents: input.legacyBookedTotalCents, source: 'legacy' }
    : { amountCents: 0, source: 'unresolved' };
}

export type CompletedAppointmentRevenueSummary = {
  completedAppointmentRevenueCents: number;
  provenance: ReportingProvenance;
};

export function summarizeCompletedAppointmentRevenue(
  appointments: CompletedAppointmentRevenueInput[],
): CompletedAppointmentRevenueSummary {
  let finalizedAppointmentCount = 0;
  let legacyAppointmentCount = 0;
  let unresolvedAppointmentCount = 0;
  let finalizedAmountCents = 0;
  let legacyFallbackAmountCents = 0;

  for (const appointment of appointments) {
    const resolved = resolveCompletedAppointmentRevenue(appointment);
    switch (resolved.source) {
      case 'finalized':
        finalizedAppointmentCount += 1;
        finalizedAmountCents += resolved.amountCents;
        break;
      case 'legacy':
        legacyAppointmentCount += 1;
        legacyFallbackAmountCents += resolved.amountCents;
        break;
      case 'unresolved':
        unresolvedAppointmentCount += 1;
        break;
      case 'excluded':
        break;
    }
  }

  const provenance = buildReportingProvenance({
    finalizedAppointmentCount,
    legacyAppointmentCount,
    unresolvedAppointmentCount,
    finalizedAmountCents,
    legacyFallbackAmountCents,
  });

  return {
    completedAppointmentRevenueCents:
      provenance.finalizedAmountCents + provenance.legacyFallbackAmountCents,
    provenance,
  };
}

export type AppointmentBalanceInput = {
  status: string | null;
  deletedAt?: Date | string | null;
  paymentStatus?: string | null;
  startTime?: Date | string | null;
  now?: Date;
  finalPriceCents: number | null;
  legacyBookedTotalCents: number | null;
  taxAmountCents?: number | null;
  tipCents?: number | null;
  /** Authoritative sum of non-voided payment rows; null means not loaded. */
  nonVoidedPaymentsCents: number | null;
  /**
   * A legacy completed row is only reportable when the caller has verified
   * that its booked total and payment history form a reliable fallback.
   */
  legacyPaymentDataReliable?: boolean;
};

export type AppointmentBalanceResolution = {
  category: 'completed_outstanding' | 'upcoming_balance' | 'excluded' | 'unresolved';
  scope: 'completed' | 'upcoming' | null;
  source: 'finalized' | 'legacy' | 'booked' | null;
  amountCents: number;
  reason:
    | 'invalid_finalized_amount'
    | 'invalid_booked_amount'
    | 'invalid_payment_amount'
    | 'invalid_snapshot_amount'
    | 'invalid_start_time'
    | 'unreliable_legacy_data'
    | null;
};

function excludedBalance(): AppointmentBalanceResolution {
  return {
    category: 'excluded',
    scope: null,
    source: null,
    amountCents: 0,
    reason: null,
  };
}

function unresolvedBalance(
  scope: 'completed' | 'upcoming',
  reason: Exclude<AppointmentBalanceResolution['reason'], null>,
): AppointmentBalanceResolution {
  return {
    category: 'unresolved',
    scope,
    source: null,
    amountCents: 0,
    reason,
  };
}

/**
 * Separate completed debt from ordinary future booking balances.
 *
 * This deliberately does not infer a deposit obligation. Salon deposit policy
 * is not equivalent to a stored per-appointment amount due.
 */
export function resolveAppointmentBalance(
  input: AppointmentBalanceInput,
): AppointmentBalanceResolution {
  if (input.deletedAt != null || input.paymentStatus === 'comp') {
    return excludedBalance();
  }

  if (input.status === 'completed') {
    if (!isValidCents(input.nonVoidedPaymentsCents)) {
      return unresolvedBalance('completed', 'invalid_payment_amount');
    }
    if (!isValidCents(input.taxAmountCents ?? 0) || !isValidCents(input.tipCents ?? 0)) {
      return unresolvedBalance('completed', 'invalid_snapshot_amount');
    }

    let source: 'finalized' | 'legacy';
    let revenueCents: number;
    if (input.finalPriceCents != null) {
      if (!isValidCents(input.finalPriceCents)) {
        return unresolvedBalance('completed', 'invalid_finalized_amount');
      }
      source = 'finalized';
      revenueCents = input.finalPriceCents;
    } else {
      if (!input.legacyPaymentDataReliable) {
        return unresolvedBalance('completed', 'unreliable_legacy_data');
      }
      if (!isValidCents(input.legacyBookedTotalCents)) {
        return unresolvedBalance('completed', 'invalid_booked_amount');
      }
      source = 'legacy';
      revenueCents = input.legacyBookedTotalCents;
    }

    const totalDueCents = revenueCents
      + (input.taxAmountCents ?? 0)
      + (input.tipCents ?? 0);

    return {
      category: 'completed_outstanding',
      scope: 'completed',
      source,
      amountCents: Math.max(0, totalDueCents - input.nonVoidedPaymentsCents),
      reason: null,
    };
  }

  if (input.status !== 'pending' && input.status !== 'confirmed') {
    return excludedBalance();
  }

  const startTime = input.startTime == null ? null : new Date(input.startTime);
  if (startTime == null || Number.isNaN(startTime.getTime())) {
    return unresolvedBalance('upcoming', 'invalid_start_time');
  }
  if (startTime.getTime() < (input.now ?? new Date()).getTime()) {
    return excludedBalance();
  }
  if (!isValidCents(input.legacyBookedTotalCents)) {
    return unresolvedBalance('upcoming', 'invalid_booked_amount');
  }
  if (!isValidCents(input.nonVoidedPaymentsCents)) {
    return unresolvedBalance('upcoming', 'invalid_payment_amount');
  }

  return {
    category: 'upcoming_balance',
    scope: 'upcoming',
    source: 'booked',
    amountCents: Math.max(
      0,
      input.legacyBookedTotalCents - input.nonVoidedPaymentsCents,
    ),
    reason: null,
  };
}

export const UNSUPPORTED_DEPOSIT_DUE = {
  supported: false,
  amountCents: null,
  reason: 'Per-appointment deposit obligations are not recorded.',
} as const;
