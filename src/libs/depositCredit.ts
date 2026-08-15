/**
 * Canonical deposit-credit resolution and balance arithmetic.
 *
 * This module is deliberately pure and provider-agnostic. It consumes every
 * deposit row for an appointment, refuses ambiguous money state, and keeps the
 * deposit outside the appointment_payment ledger.
 */

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import {
  type ForfeitureTaxSnapshot,
  validateForfeitureTaxSnapshot,
} from '@/libs/taxConfig';

export const DEPOSIT_CREDIT_BLOCK_CODES = [
  'DEPOSIT_INVALID_MONEY',
  'DEPOSIT_CURRENCY_MISMATCH',
  'DEPOSIT_REFUND_IN_FLIGHT',
  'DEPOSIT_REFUND_UNRESOLVED',
  'DEPOSIT_PARTIAL_REFUND_UNSUPPORTED',
  'DEPOSIT_REFUND_CONFLICT',
  'DEPOSIT_RECONCILIATION_REQUIRED',
] as const;

export type DepositCreditBlockCode = (typeof DEPOSIT_CREDIT_BLOCK_CODES)[number];

export type DepositCreditRow = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  stripePaymentIntentId: string | null;
  stripeRefundId: string | null;
  refundedAt: Date | null;
  refundStatus: string | null;
  refundStatusChangedAt: Date | null;
  refundAmountCents: number | null;
  refundRequestedAt: Date | null;
  refundTrigger: string | null;
  refundLastErrorCode: string | null;
  refundFailureReason: string | null;
  externalRefundObservedCents: number | null;
  refundConflictFlag: boolean;
  refundTerminalFailureCount: number;
  priorRefundIds: readonly string[];
  forfeitedAt: Date | null;
  forfeitureTaxSnapshot: ForfeitureTaxSnapshot | null;
  createdAt: Date;
};

export type ResolvedDepositCredit = {
  ok: true;
  state: 'none' | 'creditable' | 'fully_refunded' | 'forfeited';
  collectedDepositCents: number;
  succeededRefundedCents: number;
  forfeitedDepositCents: number;
  eligibleCreditCents: number;
  creditedDepositIds: string[];
  refundedDepositIds: string[];
  forfeitedDepositIds: string[];
};

export type BlockedDepositCredit = {
  ok: false;
  state: 'blocked';
  code: DepositCreditBlockCode;
  depositIds: string[];
  detail: string;
};

export type DepositCreditResolution = ResolvedDepositCredit | BlockedDepositCredit;

export type ResolveDepositCreditInput = {
  deposits: readonly DepositCreditRow[];
  /** ISO currency of the invoice; case is normalized at this API boundary. */
  invoiceCurrency: string;
};

const DEPOSIT_STATUSES = new Set([
  'checkout_created',
  'paid',
  'expired',
  'canceled',
  'refunded',
  'waived',
]);
const UNCOLLECTED_STATUSES = new Set(['checkout_created', 'expired', 'canceled', 'waived']);

function block(
  code: DepositCreditBlockCode,
  deposits: readonly Pick<DepositCreditRow, 'id'>[],
  detail: string,
): BlockedDepositCredit {
  return {
    ok: false,
    state: 'blocked',
    code,
    depositIds: deposits.map(deposit => deposit.id),
    detail,
  };
}

function isMoney(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT;
}

function isPositiveMoney(value: number): boolean {
  return isMoney(value) && value > 0;
}

function addMoney(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum)
    && sum >= 0
    && sum <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    ? sum
    : null;
}

function normalizeCurrency(value: string): string | null {
  const normalized = value.toLowerCase();
  return /^[a-z]{3}$/.test(normalized) ? normalized : null;
}

function isValidTimestamp(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function hasValidForfeitureSnapshot(
  snapshot: ForfeitureTaxSnapshot,
  deposit: DepositCreditRow,
  invoiceCurrency: string,
): boolean {
  return normalizeCurrency(deposit.currency) === invoiceCurrency
    && validateForfeitureTaxSnapshot(snapshot, {
      expectedCurrency: invoiceCurrency,
      expectedGrossForfeitedCents: deposit.amountCents,
      expectedCapturedAt: deposit.forfeitedAt,
    }).ok;
}

function hasUnresolvedRefundMarkers(deposit: DepositCreditRow): boolean {
  return deposit.stripeRefundId !== null
    || deposit.refundedAt !== null
    || deposit.refundStatusChangedAt !== null
    || deposit.refundAmountCents !== null
    || deposit.refundRequestedAt !== null
    || deposit.refundTrigger !== null
    || deposit.refundLastErrorCode !== null
    || deposit.refundFailureReason !== null
    || deposit.refundTerminalFailureCount !== 0
    || deposit.priorRefundIds.length !== 0;
}

/**
 * Resolve all deposit rows to one safe credit decision.
 *
 * D6 supports full refunds only. `externalRefundObservedCents` is deliberately
 * never used as subtraction input: it is a maximum observed partial object,
 * not a cumulative succeeded-refund ledger.
 */
export function resolveDepositCredit(input: ResolveDepositCreditInput): DepositCreditResolution {
  const invoiceCurrency = normalizeCurrency(input.invoiceCurrency);

  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const deposit of input.deposits) {
    if (seenIds.has(deposit.id)) {
      duplicateIds.add(deposit.id);
    }
    seenIds.add(deposit.id);
  }
  if (duplicateIds.size > 0) {
    return block(
      'DEPOSIT_RECONCILIATION_REQUIRED',
      input.deposits.filter(deposit => duplicateIds.has(deposit.id)),
      'The deposit input contains duplicate row identities.',
    );
  }

  let collectedDepositCents = 0;
  let succeededRefundedCents = 0;
  let forfeitedDepositCents = 0;
  let eligibleCreditCents = 0;
  const creditedDepositIds: string[] = [];
  const refundedDepositIds: string[] = [];
  const forfeitedDepositIds: string[] = [];
  const retainedForfeitedDepositIds: string[] = [];

  for (const deposit of input.deposits) {
    if (!deposit.id || !DEPOSIT_STATUSES.has(deposit.status)) {
      return block('DEPOSIT_RECONCILIATION_REQUIRED', [deposit], 'Deposit identity or status is invalid.');
    }
    if (
      !isPositiveMoney(deposit.amountCents)
      || !isMoney(deposit.refundTerminalFailureCount)
      || (deposit.refundAmountCents !== null && !isPositiveMoney(deposit.refundAmountCents))
      || (
        deposit.externalRefundObservedCents !== null
        && !isPositiveMoney(deposit.externalRefundObservedCents)
      )
    ) {
      return block('DEPOSIT_INVALID_MONEY', [deposit], 'Deposit money fields must be safe positive integer cents.');
    }

    const moneyBearing = deposit.status === 'paid'
      || deposit.status === 'refunded'
      || deposit.stripePaymentIntentId !== null
      || deposit.refundStatus !== null
      || hasUnresolvedRefundMarkers(deposit)
      || deposit.externalRefundObservedCents !== null
      || deposit.refundConflictFlag
      || deposit.forfeitedAt !== null
      || deposit.forfeitureTaxSnapshot !== null;
    const depositCurrency = normalizeCurrency(deposit.currency);
    if (
      moneyBearing
      && (!invoiceCurrency || !depositCurrency || depositCurrency !== invoiceCurrency)
    ) {
      return block('DEPOSIT_CURRENCY_MISMATCH', [deposit], 'Deposit and invoice currencies do not match.');
    }
    if (deposit.refundConflictFlag) {
      return block('DEPOSIT_REFUND_CONFLICT', [deposit], 'The deposit has a provider refund identity conflict.');
    }
    if (deposit.externalRefundObservedCents !== null) {
      return block(
        'DEPOSIT_PARTIAL_REFUND_UNSUPPORTED',
        [deposit],
        'An external partial refund was observed and requires manual reconciliation.',
      );
    }

    const hasForfeitedAt = deposit.forfeitedAt !== null;
    const hasForfeitureSnapshot = deposit.forfeitureTaxSnapshot !== null;
    const hasForfeiture = hasForfeitedAt && hasForfeitureSnapshot;
    if (
      hasForfeitedAt !== hasForfeitureSnapshot
      || (
        hasForfeiture
        && (
          (deposit.status !== 'paid' && deposit.status !== 'refunded')
          || !deposit.stripePaymentIntentId
          || !hasValidForfeitureSnapshot(
            deposit.forfeitureTaxSnapshot!,
            deposit,
            invoiceCurrency ?? '',
          )
        )
      )
    ) {
      return block(
        'DEPOSIT_RECONCILIATION_REQUIRED',
        [deposit],
        'The deposit forfeiture evidence is partial, conflicting, or invalid.',
      );
    }

    if (deposit.refundStatus === 'requested' || deposit.refundStatus === 'pending') {
      return block('DEPOSIT_REFUND_IN_FLIGHT', [deposit], 'The deposit refund is still in flight.');
    }
    if (deposit.refundStatus === 'failed') {
      return block(
        'DEPOSIT_REFUND_UNRESOLVED',
        [deposit],
        'The failed refund remains retryable or requires terminal reconciliation.',
      );
    }
    if (deposit.refundStatus !== null && deposit.refundStatus !== 'succeeded') {
      return block('DEPOSIT_RECONCILIATION_REQUIRED', [deposit], 'The deposit has an unknown refund status.');
    }

    if (deposit.refundStatus === 'succeeded') {
      if (
        deposit.refundAmountCents !== null
        && deposit.refundAmountCents > 0
        && deposit.refundAmountCents < deposit.amountCents
      ) {
        return block(
          'DEPOSIT_PARTIAL_REFUND_UNSUPPORTED',
          [deposit],
          'A succeeded partial refund is outside the D6 full-refund contract.',
        );
      }
      if (
        deposit.status !== 'refunded'
        || !deposit.stripePaymentIntentId
        || !deposit.stripeRefundId
        || deposit.refundAmountCents !== deposit.amountCents
        || !isValidTimestamp(deposit.refundedAt)
        || !isValidTimestamp(deposit.refundStatusChangedAt)
      ) {
        return block(
          'DEPOSIT_RECONCILIATION_REQUIRED',
          [deposit],
          'The succeeded refund is missing its exact full-refund identity or timestamps.',
        );
      }

      const nextCollected = addMoney(collectedDepositCents, deposit.amountCents);
      const nextRefunded = addMoney(succeededRefundedCents, deposit.amountCents);
      const nextForfeited = hasForfeiture
        ? addMoney(forfeitedDepositCents, deposit.amountCents)
        : forfeitedDepositCents;
      if (nextCollected === null || nextRefunded === null || nextForfeited === null) {
        return block('DEPOSIT_INVALID_MONEY', [deposit], 'Aggregate deposit money exceeds safe integer cents.');
      }
      collectedDepositCents = nextCollected;
      succeededRefundedCents = nextRefunded;
      forfeitedDepositCents = nextForfeited;
      refundedDepositIds.push(deposit.id);
      if (hasForfeiture) {
        forfeitedDepositIds.push(deposit.id);
      }
      continue;
    }

    if (deposit.status === 'paid') {
      if (!deposit.stripePaymentIntentId || hasUnresolvedRefundMarkers(deposit)) {
        return block(
          'DEPOSIT_RECONCILIATION_REQUIRED',
          [deposit],
          'A paid deposit lacks collection identity or has unreconciled refund history.',
        );
      }
      const nextCollected = addMoney(collectedDepositCents, deposit.amountCents);
      const nextEligible = hasForfeiture
        ? eligibleCreditCents
        : addMoney(eligibleCreditCents, deposit.amountCents);
      const nextForfeited = hasForfeiture
        ? addMoney(forfeitedDepositCents, deposit.amountCents)
        : forfeitedDepositCents;
      if (nextCollected === null || nextEligible === null || nextForfeited === null) {
        return block('DEPOSIT_INVALID_MONEY', [deposit], 'Aggregate deposit money exceeds safe integer cents.');
      }
      collectedDepositCents = nextCollected;
      eligibleCreditCents = nextEligible;
      forfeitedDepositCents = nextForfeited;
      if (hasForfeiture) {
        forfeitedDepositIds.push(deposit.id);
        retainedForfeitedDepositIds.push(deposit.id);
      } else {
        creditedDepositIds.push(deposit.id);
      }
      continue;
    }

    if (
      deposit.status === 'refunded'
      || deposit.stripePaymentIntentId !== null
      || hasUnresolvedRefundMarkers(deposit)
    ) {
      return block(
        'DEPOSIT_RECONCILIATION_REQUIRED',
        [deposit],
        'Historical or contradictory refund state cannot be used as settled money.',
      );
    }

    if (!UNCOLLECTED_STATUSES.has(deposit.status)) {
      return block('DEPOSIT_RECONCILIATION_REQUIRED', [deposit], 'Deposit state is not creditable.');
    }
  }

  const retainedDepositIds = [...creditedDepositIds, ...retainedForfeitedDepositIds];
  if (retainedDepositIds.length > 1) {
    return block(
      'DEPOSIT_RECONCILIATION_REQUIRED',
      input.deposits.filter(deposit => retainedDepositIds.includes(deposit.id)),
      'More than one collected deposit remains retained for the appointment.',
    );
  }

  return {
    ok: true,
    state: eligibleCreditCents > 0
      ? 'creditable'
      : retainedForfeitedDepositIds.length > 0
        ? 'forfeited'
        : collectedDepositCents > 0
          ? 'fully_refunded'
          : 'none',
    collectedDepositCents,
    succeededRefundedCents,
    forfeitedDepositCents,
    eligibleCreditCents,
    creditedDepositIds,
    refundedDepositIds,
    forfeitedDepositIds,
  };
}

export type DepositCreditFinancialInput = {
  finalPriceCents: number | null;
  taxAmountCents: number | null;
  tipCents: number | null;
  tenderedCents: number | null;
  eligibleDepositCreditCents: number;
  appointmentStatus?: string | null;
  paymentStatus?: string | null;
};

export type DepositCreditFinancials = {
  ok: true;
  serviceInvoiceCents: number;
  totalDueCents: number;
  depositCreditAppliedCents: number;
  excessDepositCents: number;
  serviceBalanceAfterCreditCents: number;
  tenderedCents: number;
  amountAlreadyPaidCents: number;
  remainingBalanceCents: number;
  tenderExcessCents: number;
  complimentary: boolean;
  legacyPaidAssumed: boolean;
  financiallySettled: boolean;
} | {
  ok: false;
  code: 'DEPOSIT_INVALID_MONEY';
  field: string;
};

/**
 * Apply a resolved deposit to the service invoice, then account for tip and
 * tender. The credit cap/excess deliberately exclude tip.
 */
export function computeDepositCreditFinancials(
  input: DepositCreditFinancialInput,
): DepositCreditFinancials {
  const values = {
    finalPriceCents: input.finalPriceCents ?? 0,
    taxAmountCents: input.taxAmountCents ?? 0,
    tipCents: input.tipCents ?? 0,
    eligibleDepositCreditCents: input.eligibleDepositCreditCents,
    ...(input.tenderedCents === null ? {} : { tenderedCents: input.tenderedCents }),
  };
  for (const [field, value] of Object.entries(values)) {
    if (!isMoney(value)) {
      return { ok: false, code: 'DEPOSIT_INVALID_MONEY', field };
    }
  }

  const serviceInvoiceCents = addMoney(values.finalPriceCents, values.taxAmountCents);
  if (serviceInvoiceCents === null) {
    return { ok: false, code: 'DEPOSIT_INVALID_MONEY', field: 'serviceInvoiceCents' };
  }
  const totalDueCents = addMoney(serviceInvoiceCents, values.tipCents);
  if (totalDueCents === null) {
    return { ok: false, code: 'DEPOSIT_INVALID_MONEY', field: 'totalDueCents' };
  }

  const complimentary = input.paymentStatus === 'comp';
  // A complimentary appointment has no service invoice against which client
  // money may be applied. Any collected deposit is owed back in full.
  const depositCreditCapCents = complimentary ? 0 : serviceInvoiceCents;
  const depositCreditAppliedCents = Math.min(
    values.eligibleDepositCreditCents,
    depositCreditCapCents,
  );
  const excessDepositCents = values.eligibleDepositCreditCents - depositCreditAppliedCents;
  const serviceBalanceAfterCreditCents = serviceInvoiceCents - depositCreditAppliedCents;
  const balanceBeforeTenderCents = serviceBalanceAfterCreditCents + values.tipCents;
  const legacyPaidAssumed = input.appointmentStatus === 'completed'
    && input.paymentStatus === 'paid'
    && input.tenderedCents === null;
  const tenderedCents = legacyPaidAssumed
    ? balanceBeforeTenderCents
    : (input.tenderedCents ?? 0);
  const amountAlreadyPaidCents = addMoney(depositCreditAppliedCents, tenderedCents);
  if (amountAlreadyPaidCents === null) {
    return { ok: false, code: 'DEPOSIT_INVALID_MONEY', field: 'amountAlreadyPaidCents' };
  }
  const remainingBalanceCents = complimentary || legacyPaidAssumed
    ? 0
    : Math.max(0, balanceBeforeTenderCents - tenderedCents);
  const tenderCapacityCents = complimentary ? 0 : balanceBeforeTenderCents;
  const tenderExcessCents = Math.max(0, tenderedCents - tenderCapacityCents);

  return {
    ok: true,
    serviceInvoiceCents,
    totalDueCents,
    depositCreditAppliedCents,
    excessDepositCents,
    serviceBalanceAfterCreditCents,
    tenderedCents,
    amountAlreadyPaidCents,
    remainingBalanceCents,
    tenderExcessCents,
    complimentary,
    legacyPaidAssumed,
    financiallySettled: remainingBalanceCents === 0
      && excessDepositCents === 0
      && tenderExcessCents === 0,
  };
}
