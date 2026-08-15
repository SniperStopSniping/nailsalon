import {
  computeDepositCreditFinancials,
  type DepositCreditFinancials,
  type DepositCreditResolution,
  type DepositCreditRow,
  resolveDepositCredit,
} from '@/libs/depositCredit';

export type DepositCreditSummary = {
  state: 'resolved' | 'blocked';
  blockedCode: string | null;
  blockedDetail: string | null;
  collectedCents: number;
  refundedCents: number;
  forfeitedCents: number;
  eligibleCents: number;
};

export type AppointmentFinancialBreakdown = {
  serviceInvoiceTotalCents: number;
  totalDueCents: number;
  appointmentPaymentsCents: number;
  depositCreditAppliedCents: number;
  amountAlreadyPaidCents: number;
  balanceCents: number;
  excessDepositCents: number;
  tenderExcessCents: number;
  legacyPaidAssumed: boolean;
};

export const APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED
  = 'APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED' as const;

/**
 * A deposit that arrives after other tender can push an otherwise valid
 * completed invoice above its total.  Keep this separate from deposit-only
 * excess: neither condition is a collectible balance, and both require an
 * explicit refund/reconciliation decision before a definitive receipt or
 * payment instruction may be shown.
 */
export function appointmentFinancialOverpayment(
  resolution: AppointmentDepositFinancialResolution,
): {
  code: typeof APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED;
  excessDepositCents: number;
  tenderExcessCents: number;
} | null {
  if (!resolution.financials.ok) {
    return null;
  }
  if (
    resolution.financials.excessDepositCents === 0
    && resolution.financials.tenderExcessCents === 0
  ) {
    return null;
  }
  return {
    code: APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
    excessDepositCents: resolution.financials.excessDepositCents,
    tenderExcessCents: resolution.financials.tenderExcessCents,
  };
}

export type AppointmentDepositFinancialResolution = {
  depositResolution: DepositCreditResolution;
  depositCredit: DepositCreditSummary;
  financials: DepositCreditFinancials;
  balance: AppointmentFinancialBreakdown | null;
};

export type AppointmentDepositPresentationState
  = | 'none'
    | 'creditable'
    | 'refund_candidate'
    | 'refund_in_flight'
    | 'refund_review'
    | 'refunded'
    | 'forfeited'
    | 'blocked';

/** Project canonical money evidence into a terminal-safe display state. */
export function resolveAppointmentDepositPresentation(input: {
  appointmentStatus: string | null;
  resolution: DepositCreditResolution;
}): AppointmentDepositPresentationState {
  const terminal = input.appointmentStatus === 'cancelled'
    || input.appointmentStatus === 'no_show';
  if (!terminal) {
    if (!input.resolution.ok) {
      return 'blocked';
    }
    if (input.resolution.state === 'fully_refunded') {
      return 'refunded';
    }
    return input.resolution.state;
  }
  if (!input.resolution.ok) {
    if (input.resolution.code === 'DEPOSIT_REFUND_IN_FLIGHT') {
      return 'refund_in_flight';
    }
    if (input.resolution.code === 'DEPOSIT_REFUND_UNRESOLVED') {
      return 'refund_review';
    }
    return 'blocked';
  }
  if (input.resolution.succeededRefundedCents > 0) {
    return 'refunded';
  }
  if (input.resolution.forfeitedDepositCents > 0) {
    return 'forfeited';
  }
  if (input.resolution.collectedDepositCents === 0) {
    return 'none';
  }
  return input.appointmentStatus === 'cancelled'
    ? 'refund_candidate'
    : 'refund_review';
}

export function summarizeDepositCredit(
  resolution: DepositCreditResolution,
): DepositCreditSummary {
  if (!resolution.ok) {
    return {
      state: 'blocked',
      blockedCode: resolution.code,
      blockedDetail: resolution.detail,
      collectedCents: 0,
      refundedCents: 0,
      forfeitedCents: 0,
      eligibleCents: 0,
    };
  }
  return {
    state: 'resolved',
    blockedCode: null,
    blockedDetail: null,
    collectedCents: resolution.collectedDepositCents,
    refundedCents: resolution.succeededRefundedCents,
    forfeitedCents: resolution.forfeitedDepositCents,
    eligibleCents: resolution.eligibleCreditCents,
  };
}

/**
 * One projection shared by checkout, payment, receipt, email, and reporting
 * adapters. A blocked deposit is never silently converted into a collectible
 * zero-credit balance: callers must inspect `depositResolution.ok` before any
 * money write or payment instruction.
 */
export function resolveAppointmentDepositFinancials(input: {
  deposits: readonly DepositCreditRow[];
  invoiceCurrency: string | null;
  finalPriceCents: number | null;
  taxAmountCents: number | null;
  tipCents: number | null;
  appointmentPaymentsCents: number | null;
  appointmentStatus?: string | null;
  paymentStatus?: string | null;
}): AppointmentDepositFinancialResolution {
  const terminalWithoutServiceInvoice = input.appointmentStatus === 'cancelled'
    || input.appointmentStatus === 'no_show';
  // A NULL currency is an explicit historical fact. It is harmless when there
  // is no deposit to compare, but a collected/historical deposit must never be
  // reconciled against a guessed current salon currency.
  const depositResolution: DepositCreditResolution
    = input.invoiceCurrency === null && input.deposits.length > 0
      ? {
          ok: false,
          state: 'blocked',
          code: 'DEPOSIT_CURRENCY_MISMATCH',
          depositIds: input.deposits.map(deposit => deposit.id),
          detail: 'The historical appointment has no frozen invoice currency.',
        }
      : resolveDepositCredit({
          deposits: input.deposits,
          // Currency has no financial effect when there are no deposit rows;
          // this sentinel only satisfies the pure resolver's ISO boundary.
          invoiceCurrency: input.invoiceCurrency ?? 'CAD',
        });
  const mayUseLegacyPaidInference = depositResolution.ok
    && (depositResolution.state === 'none' || depositResolution.state === 'creditable');
  // A paid deposit on an ordinary cancellation remains collected money and an
  // owner refund/retain decision; it is not credit against a service that will
  // no longer occur. No-show retention is represented separately by immutable
  // forfeiture evidence. Both terminal states have no collectible service
  // balance.
  const eligibleCreditCents = terminalWithoutServiceInvoice
    ? 0
    : depositResolution.ok
      ? depositResolution.eligibleCreditCents
      : 0;
  const financials = computeDepositCreditFinancials({
    finalPriceCents: terminalWithoutServiceInvoice ? 0 : input.finalPriceCents,
    taxAmountCents: terminalWithoutServiceInvoice ? 0 : input.taxAmountCents,
    tipCents: terminalWithoutServiceInvoice ? 0 : input.tipCents,
    // A definitive refund or forfeiture can leave the old paid scalar stale, so
    // it must not invent tender. Clean uncollected or creditable history remains
    // compatible with the explicit legacy completed+paid contract.
    tenderedCents: input.appointmentPaymentsCents === null && !mayUseLegacyPaidInference
      ? 0
      : input.appointmentPaymentsCents,
    eligibleDepositCreditCents: eligibleCreditCents,
    appointmentStatus: input.appointmentStatus,
    paymentStatus: input.paymentStatus,
  });

  return {
    depositResolution,
    depositCredit: {
      ...summarizeDepositCredit(depositResolution),
      ...(terminalWithoutServiceInvoice ? { eligibleCents: 0 } : {}),
    },
    financials,
    balance: financials.ok
      ? {
          serviceInvoiceTotalCents: financials.serviceInvoiceCents,
          totalDueCents: financials.totalDueCents,
          appointmentPaymentsCents: financials.tenderedCents,
          depositCreditAppliedCents: financials.depositCreditAppliedCents,
          amountAlreadyPaidCents: financials.amountAlreadyPaidCents,
          balanceCents: financials.remainingBalanceCents,
          excessDepositCents: financials.excessDepositCents,
          tenderExcessCents: financials.tenderExcessCents,
          legacyPaidAssumed: financials.legacyPaidAssumed,
        }
      : null,
  };
}
