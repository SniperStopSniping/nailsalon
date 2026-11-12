import { resolveAppointmentDepositFinancials } from '@/libs/appointmentDepositFinancials';
import type { AppointmentPaymentLedgerRow } from '@/libs/appointmentPaymentLedger';
import { resolveAppointmentPaymentLedgerForReconciliation } from '@/libs/appointmentPaymentLedger';
import type { AppointmentTaxSnapshotInput } from '@/libs/appointmentTaxSnapshot';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { DepositCreditRow } from '@/libs/depositCredit';

import { assertCents } from './money';
import { customerPaymentTenderSummary, isCustomerPaymentTender } from './provenance';
import { calculateApplicationFeeRefund } from './refunds';

export type CustomerPaymentTenderRow = AppointmentPaymentLedgerRow & {
  id: string;
  salonId: string;
  appointmentId: string;
  reference: string | null;
};

/** Separate customer-payment evidence. These records are NEVER deposit rows. */
export type CustomerPrepaymentCredit = {
  referenceId: string;
  salonId: string;
  appointmentId: string;
  stripeAccountId: string;
  paymentIntentId: string;
  currency: 'CAD';
  /** Invoice contribution, excluding the additional tip chosen at this payment. */
  principalCents: number;
  tipCents: number;
  refundedPrincipalCents: number;
  refundedTipCents: number;
  applicationFeeCents: number;
  applicationFeeRefundedCents: number;
  /** Null means credit is still separate from appointment_payment. */
  canonicalPaymentId: string | null;
  invoiceGeneration: number;
  reviewRequired: boolean;
};

/**
 * All rows must be loaded tenant-scoped under one appointment/money lock.
 * Revision changes on ANY invoice, tip, tender, deposit, refund or account change.
 * Generation increments on reopen/cancellation recovery. Neither is a DB column
 * added by this module: the future atomic adapter must own these invariants.
 */
export type CustomerPaymentAccountingInput = {
  appointment: AppointmentTaxSnapshotInput & {
    id: string;
    salonId: string;
    tipCents: number;
    amountPaidCents: number | null;
    paymentStatus: string | null;
  };
  stripeAccountId: string;
  moneyRevision: number;
  invoiceGeneration: number;
  collectionHold: 'none' | 'refund_reconciliation_required';
  payments: readonly CustomerPaymentTenderRow[];
  deposits: readonly (DepositCreditRow & { salonId: string; appointmentId: string })[];
  prepayments: readonly CustomerPrepaymentCredit[];
};

function money(value: number): number {
  assertCents(value, 'accounting');
  if (value > MAX_SUPPORTED_MINOR_UNIT_AMOUNT) {
    throw new Error('CUSTOMER_PAYMENT_MONEY_OUT_OF_RANGE');
  }
  return value;
}

function unique(values: readonly string[]): void {
  if (values.some(value => !value.trim()) || new Set(values).size !== values.length) {
    throw new Error('CUSTOMER_PAYMENT_DUPLICATE_IDENTITY');
  }
}

export function resolveCustomerPaymentAccounting(input: CustomerPaymentAccountingInput) {
  const { appointment } = input;
  assertCents(input.moneyRevision, 'moneyRevision');
  assertCents(input.invoiceGeneration, 'invoiceGeneration');
  if (!['none', 'refund_reconciliation_required'].includes(input.collectionHold)) {
    throw new Error('CUSTOMER_PAYMENT_INVALID_COLLECTION_HOLD');
  }
  if (!appointment.id.trim() || !appointment.salonId.trim() || !/^acct_[a-z0-9]+$/i.test(input.stripeAccountId)) {
    throw new Error('CUSTOMER_PAYMENT_INVALID_IDENTITY');
  }
  for (const row of [...input.payments, ...input.deposits, ...input.prepayments]) {
    if (row.salonId !== appointment.salonId || row.appointmentId !== appointment.id) {
      throw new Error('CUSTOMER_PAYMENT_FOREIGN_MONEY');
    }
  }
  unique(input.payments.map(row => row.id));
  unique(input.deposits.map(row => row.id));
  unique(input.prepayments.map(row => row.referenceId));
  unique(input.prepayments.map(row => row.paymentIntentId));
  const tax = validateAppointmentTaxSnapshotChain(appointment);
  if (!tax.ok) {
    throw new Error(`CUSTOMER_PAYMENT_TAX_INVALID:${tax.code}`);
  }
  // No historical inference or mutable salon-currency fallback for new collection.
  if (tax.invoiceCurrency !== 'CAD' || appointment.invoiceCurrency !== 'CAD' || !tax.active.snapshot) {
    throw new Error('CUSTOMER_PAYMENT_FROZEN_INVOICE_REQUIRED');
  }
  const ledger = resolveAppointmentPaymentLedgerForReconciliation({
    // Validate gross sources first; linked immutable refunds are reconciled below.
    cachedAmountPaidCents: input.payments.length === 0 ? appointment.amountPaidCents : null,
    paymentRows: input.payments,
    expectedSalonId: appointment.salonId,
    appointmentStatus: appointment.status,
    paymentStatus: appointment.paymentStatus,
  });
  if (!ledger.ok || ledger.legacyPaidAssumed || ledger.appointmentPaymentsCents === null) {
    throw new Error('CUSTOMER_PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
  }
  let ordinaryLinkedRefundsCents = 0;
  let refundHold = ledger.collectionHold;
  let unpostedCreditCents = 0;
  let prepaidTipCents = 0;
  const linkedIds: string[] = [];
  let staleGeneration = false;
  for (const credit of input.prepayments) {
    if (credit.stripeAccountId !== input.stripeAccountId || credit.currency !== 'CAD'
      || !/^pi_[a-z0-9]+$/i.test(credit.paymentIntentId) || credit.reviewRequired) {
      throw new Error('CUSTOMER_PAYMENT_CREDIT_RECONCILIATION_REQUIRED');
    }
    for (const field of ['principalCents', 'tipCents', 'refundedPrincipalCents', 'refundedTipCents', 'applicationFeeCents', 'applicationFeeRefundedCents', 'invoiceGeneration'] as const) {
      money(credit[field]);
    }
    const gross = money(credit.principalCents + credit.tipCents);
    if (gross <= 0 || credit.refundedPrincipalCents > credit.principalCents || credit.refundedTipCents > credit.tipCents) {
      throw new Error('CUSTOMER_PAYMENT_INVALID_CREDIT');
    }
    const refunded = money(credit.refundedPrincipalCents + credit.refundedTipCents);
    if (credit.applicationFeeCents >= gross || credit.applicationFeeRefundedCents > credit.applicationFeeCents) {
      throw new Error('CUSTOMER_PAYMENT_INVALID_FEE_REFUND');
    }
    // Actual fee return is independent of the proportional plan.
    refundHold ||= refunded > 0;
    const net = gross - refunded;
    prepaidTipCents = money(prepaidTipCents + credit.tipCents - credit.refundedTipCents);
    staleGeneration ||= net > 0 && credit.invoiceGeneration !== input.invoiceGeneration;
    const matching = input.payments.filter(row => row.reference === credit.referenceId && row.voidedAt === null);
    if (credit.canonicalPaymentId === null) {
      if (matching.length > 0) {
        throw new Error('CUSTOMER_PAYMENT_UNLINKED_TENDER');
      }
      unpostedCreditCents = money(unpostedCreditCents + net);
    } else {
      linkedIds.push(credit.canonicalPaymentId);
      const row = input.payments.find(row => row.id === credit.canonicalPaymentId);
      if (!row || row.voidedAt !== null || row.reference !== credit.referenceId || row.amountCents !== gross || matching.length !== 1) {
        throw new Error('CUSTOMER_PAYMENT_POSTED_TENDER_MISMATCH');
      }
      if (isCustomerPaymentTender(row)) {
        const summary = customerPaymentTenderSummary(row);
        if (summary.refundedPrincipalCents !== credit.refundedPrincipalCents
          || summary.refundedTipCents !== credit.refundedTipCents) {
          throw new Error('CUSTOMER_PAYMENT_REFUND_EVIDENCE_MISMATCH');
        }
      } else {
        ordinaryLinkedRefundsCents = money(ordinaryLinkedRefundsCents + refunded);
      }
    }
    if (input.deposits.some(row => row.stripePaymentIntentId === credit.paymentIntentId)) {
      throw new Error('CUSTOMER_PAYMENT_DUPLICATE_DEPOSIT_CREDIT');
    }
  }
  unique(linkedIds);
  const canonicalTenderCents = money(ledger.appointmentPaymentsCents - ordinaryLinkedRefundsCents);
  if (appointment.amountPaidCents !== null && appointment.amountPaidCents !== canonicalTenderCents) {
    throw new Error('CUSTOMER_PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
  }
  if ((appointment.status === 'completed' || appointment.finalTaxSnapshot !== null) && money(appointment.tipCents) < prepaidTipCents) {
    throw new Error('CUSTOMER_PAYMENT_FINAL_TIP_RECONCILIATION_REQUIRED');
  }
  const effectiveTipCents = money(Math.max(money(appointment.tipCents), prepaidTipCents));
  const combinedTenderCents = money(canonicalTenderCents + unpostedCreditCents);
  const canonical = resolveAppointmentDepositFinancials({
    deposits: input.deposits,
    invoiceCurrency: tax.invoiceCurrency,
    finalPriceCents: tax.active.snapshot.serviceSubtotalCents,
    taxAmountCents: tax.active.snapshot.taxAmountCents,
    tipCents: effectiveTipCents,
    appointmentPaymentsCents: combinedTenderCents,
    appointmentStatus: appointment.status,
    paymentStatus: appointment.paymentStatus,
  });
  if (!canonical.depositResolution.ok) {
    throw new Error(`CUSTOMER_PAYMENT_DEPOSIT_BLOCKED:${canonical.depositResolution.code}`);
  }
  if (!canonical.financials.ok || !canonical.balance) {
    throw new Error('CUSTOMER_PAYMENT_INVALID_FINANCIALS');
  }
  const terminal = appointment.status === 'cancelled' || appointment.status === 'no_show';
  const knownStatus = ['pending', 'confirmed', 'in_progress', 'awaiting_payment', 'completed'].includes(appointment.status ?? '');
  const overpaid = canonical.balance.excessDepositCents > 0 || canonical.balance.tenderExcessCents > 0;
  const collectionBlock = terminal
    ? 'TERMINAL_APPOINTMENT'
    : input.collectionHold !== 'none' || refundHold
      ? 'REFUND_RECONCILIATION_REQUIRED'
      : !knownStatus
          ? 'UNKNOWN_APPOINTMENT_STATUS'
          : staleGeneration
            ? 'REOPEN_RECONCILIATION_REQUIRED'
            : appointment.paymentStatus === 'comp'
              ? 'COMPLIMENTARY_APPOINTMENT'
              : overpaid ? 'OVERPAYMENT_RECONCILIATION_REQUIRED' : null;
  return Object.freeze({
    moneyRevision: input.moneyRevision,
    invoiceGeneration: input.invoiceGeneration,
    servicePrincipalCents: tax.active.snapshot.serviceSubtotalCents,
    taxCents: tax.active.snapshot.taxAmountCents,
    effectiveTipCents,
    prepaidTipCents,
    unpostedCreditCents,
    canonicalTenderCents,
    collectionBlock,
    ...canonical.balance,
  });
}

export function assertCustomerPaymentCollectibleQuote(input: CustomerPaymentAccountingInput, request: {
  expectedRevision: number;
  principalCents: number;
  additionalTipCents: number;
}) {
  const accounting = resolveCustomerPaymentAccounting(input);
  if (request.expectedRevision !== input.moneyRevision) {
    throw new Error('CUSTOMER_PAYMENT_STALE_QUOTE');
  }
  if (accounting.collectionBlock) {
    throw new Error(accounting.collectionBlock);
  }
  money(request.principalCents);
  money(request.additionalTipCents);
  if ((input.appointment.status === 'completed' || input.appointment.finalTaxSnapshot !== null)
    && request.additionalTipCents > 0) {
    throw new Error('CUSTOMER_PAYMENT_FINAL_TIP_CHANGE_REQUIRES_REISSUE');
  }
  if (request.principalCents <= 0 || request.principalCents > accounting.balanceCents) {
    throw new Error('CUSTOMER_PAYMENT_EXCEEDS_BALANCE');
  }
  return Object.freeze({ ...accounting, principalCents: request.principalCents, additionalTipCents: request.additionalTipCents, chargeCents: money(request.principalCents + request.additionalTipCents) });
}

/**
 * Verified success only; returned credit still needs an atomic insert and receipt.
 * Persist immutable raw capture evidence BEFORE invoking this projector. A stale,
 * terminal, overpaid or otherwise rejected projection must retain the captured
 * money in refund/review state, never discard the successful provider payment.
 */
export function projectCustomerPaymentSettlement(input: CustomerPaymentAccountingInput, evidence: {
  expectedRevision: number;
  referenceId: string;
  paymentIntentId: string;
  stripeAccountId: string;
  livemode: false;
  currency: 'CAD';
  principalCents: number;
  tipCents: number;
  applicationFeeCents: number;
}) {
  if (evidence.livemode !== false || evidence.stripeAccountId !== input.stripeAccountId || evidence.currency !== 'CAD') {
    throw new Error('CUSTOMER_PAYMENT_SETTLEMENT_IDENTITY_MISMATCH');
  }
  assertCustomerPaymentCollectibleQuote(input, { expectedRevision: evidence.expectedRevision, principalCents: evidence.principalCents, additionalTipCents: evidence.tipCents });
  const credit: CustomerPrepaymentCredit = {
    referenceId: evidence.referenceId,
    paymentIntentId: evidence.paymentIntentId,
    salonId: input.appointment.salonId,
    appointmentId: input.appointment.id,
    stripeAccountId: evidence.stripeAccountId,
    currency: evidence.currency,
    principalCents: evidence.principalCents,
    tipCents: evidence.tipCents,
    applicationFeeCents: evidence.applicationFeeCents,
    applicationFeeRefundedCents: 0,
    refundedPrincipalCents: 0,
    refundedTipCents: 0,
    canonicalPaymentId: null,
    invoiceGeneration: input.invoiceGeneration,
    reviewRequired: false,
  };
  const before = resolveCustomerPaymentAccounting(input);
  const next: CustomerPaymentAccountingInput = { ...input, moneyRevision: input.moneyRevision + 1, appointment: { ...input.appointment, tipCents: money(before.effectiveTipCents + evidence.tipCents) }, prepayments: [...input.prepayments, credit] };
  const after = resolveCustomerPaymentAccounting(next);
  return { credit: Object.freeze(credit), next, accounting: after };
}

/**
 * Project immutable refund allocations, never void/rewrite the original tender.
 * A posted reserved tender requires freshly verified refund evidence from the
 * adapter. This pure plan does not create receipts or prove a fee refund happened.
 * Gross invoice tip stays unchanged and every customer refund imposes a hold.
 */
export function projectCustomerPaymentRefund(input: CustomerPaymentAccountingInput, request: {
  expectedRevision: number;
  referenceId: string;
  refundedAt: Date;
  principalRefundCents: number;
  tipRefundCents: number;
  /** Reserved gross tender reloaded with complete applied/refund-review proof. */
  refundedTender?: CustomerPaymentTenderRow;
}) {
  resolveCustomerPaymentAccounting(input);
  if (request.expectedRevision !== input.moneyRevision) {
    throw new Error('CUSTOMER_PAYMENT_STALE_QUOTE');
  }
  if (!(request.refundedAt instanceof Date) || !Number.isFinite(request.refundedAt.getTime())) {
    throw new TypeError('CUSTOMER_PAYMENT_INVALID_REFUND_TIMESTAMP');
  }
  money(request.principalRefundCents);
  money(request.tipRefundCents);
  const credit = input.prepayments.find(row => row.referenceId === request.referenceId);
  if (!credit || request.principalRefundCents + request.tipRefundCents <= 0
    || request.principalRefundCents > credit.principalCents - credit.refundedPrincipalCents
    || request.tipRefundCents > credit.tipCents - credit.refundedTipCents) {
    throw new Error('CUSTOMER_PAYMENT_INVALID_REFUND_ALLOCATION');
  }
  const updated = { ...credit, refundedPrincipalCents: credit.refundedPrincipalCents + request.principalRefundCents, refundedTipCents: credit.refundedTipCents + request.tipRefundCents };
  const feePlan = calculateApplicationFeeRefund({ originalChargeCents: credit.principalCents + credit.tipCents, originalApplicationFeeCents: credit.applicationFeeCents, cumulativeChargeRefundedCents: updated.refundedPrincipalCents + updated.refundedTipCents, applicationFeeAlreadyRefundedCents: 0 });
  const original = input.payments.find(row => row.id === credit.canonicalPaymentId);
  let payments = input.payments;
  if (original && isCustomerPaymentTender(original)) {
    const reloaded = request.refundedTender;
    if (!reloaded || reloaded.id !== original.id || reloaded.amountCents !== original.amountCents) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_EVIDENCE_REQUIRED');
    }
    const summary = customerPaymentTenderSummary(reloaded);
    if (!summary.collectionHold || summary.refundedPrincipalCents !== updated.refundedPrincipalCents
      || summary.refundedTipCents !== updated.refundedTipCents) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_EVIDENCE_MISMATCH');
    }
    payments = input.payments.map(row => row.id === original.id ? reloaded : row);
  }
  const cache = credit.canonicalPaymentId
    ? money(resolveCustomerPaymentAccounting(input).canonicalTenderCents - request.principalRefundCents - request.tipRefundCents)
    : input.appointment.amountPaidCents;
  const next: CustomerPaymentAccountingInput = { ...input, moneyRevision: input.moneyRevision + 1, payments, collectionHold: 'refund_reconciliation_required', appointment: { ...input.appointment, amountPaidCents: cache }, prepayments: input.prepayments.map(row => row.referenceId === credit.referenceId ? updated : row) };
  return { next, accounting: resolveCustomerPaymentAccounting(next), applicationFeeRefundDueCents: Math.max(0, feePlan.targetFeeRefundCents - credit.applicationFeeRefundedCents) };
}

/** Current-balance projection only; caller must also adapt movement reporting. */
export function projectCustomerPrepaymentApplication(input: CustomerPaymentAccountingInput, request: {
  expectedRevision: number;
  referenceId: string;
  canonicalPaymentId: string;
}) {
  const before = resolveCustomerPaymentAccounting(input);
  if (input.moneyRevision !== request.expectedRevision) {
    throw new Error('CUSTOMER_PAYMENT_STALE_QUOTE');
  }
  if (before.collectionBlock || input.appointment.status !== 'completed') {
    throw new Error('CUSTOMER_PAYMENT_APPLICATION_REQUIRES_FINAL_INVOICE');
  }
  const credit = input.prepayments.find(row => row.referenceId === request.referenceId);
  if (!credit || credit.canonicalPaymentId !== null || !request.canonicalPaymentId.trim()
    || input.payments.some(row => row.id === request.canonicalPaymentId)) {
    throw new Error('CUSTOMER_PAYMENT_INVALID_APPLICATION');
  }
  const amountCents = credit.principalCents + credit.tipCents - credit.refundedPrincipalCents - credit.refundedTipCents;
  if (amountCents <= 0) {
    throw new Error('CUSTOMER_PAYMENT_NO_CREDIT_TO_APPLY');
  }
  const tender: CustomerPaymentTenderRow = {
    id: request.canonicalPaymentId,
    salonId: credit.salonId,
    appointmentId: credit.appointmentId,
    reference: credit.referenceId,
    amountCents,
    voidedAt: null,
  };
  const next: CustomerPaymentAccountingInput = { ...input, moneyRevision: input.moneyRevision + 1, payments: [...input.payments, tender], appointment: { ...input.appointment, tipCents: before.effectiveTipCents, amountPaidCents: money(before.canonicalTenderCents + amountCents) }, prepayments: input.prepayments.map(row => row.referenceId === credit.referenceId ? { ...row, canonicalPaymentId: tender.id } : row) };
  return { next, tender, accounting: resolveCustomerPaymentAccounting(next) };
}
