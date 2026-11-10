import { z } from 'zod';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';

const cents = z.number().int().min(0).max(MAX_SUPPORTED_MINOR_UNIT_AMOUNT);
const identity = z.string().min(1).max(200);
const scope = { salonId: identity, appointmentId: identity };

/** Final service principal includes tax; tips remain separately attributable. */
export const adjustedBillSchema = z.object({
  ...scope,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  serviceCents: cents,
  taxCents: cents,
  tipCents: cents,
}).strict();

export const adjustmentPaymentSchema = z.object({
  ...scope,
  id: identity,
  /** A deposit must be included here OR in another tender, never both. */
  movementId: identity,
  requestId: identity.optional(),
  kind: z.enum(['online', 'deposit', 'manual']),
  principalCents: cents,
  tipCents: cents,
  state: z.enum(['confirmed', 'under_review']),
}).strict();

export const adjustmentRefundSchema = z.object({
  ...scope,
  id: identity,
  paymentId: identity,
  principalCents: cents,
  tipCents: cents,
  state: z.enum(['requested', 'pending', 'succeeded', 'failed', 'canceled', 'under_review']),
  /** A void corrects recorded tender; it does not claim money was refunded. */
  kind: z.enum(['refund', 'manual_void', 'deposit_refund', 'deposit_forfeit']).optional(),
}).strict();

export const adjustmentRequestSchema = z.object({
  ...scope,
  id: identity,
  billRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  principalCents: cents,
  tipCents: cents,
  /** An expired UI link is not proof the provider can no longer accept payment. */
  state: z.enum(['reserved', 'open', 'processing', 'uncertain', 'paid', 'expired', 'canceled']),
}).strict();

const inputSchema = z.object({
  /** Aggregate revision changes on bills, payments, refunds and request outcomes. */
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  bill: adjustedBillSchema,
  payments: z.array(adjustmentPaymentSchema).max(1000),
  refunds: z.array(adjustmentRefundSchema).max(1000),
  requests: z.array(adjustmentRequestSchema).max(1000),
}).strict();

export type AdjustmentBill = z.infer<typeof adjustedBillSchema>;
export type AdjustmentPayment = z.infer<typeof adjustmentPaymentSchema>;
export type AdjustmentRefund = z.infer<typeof adjustmentRefundSchema>;
export type AdjustmentRequest = z.infer<typeof adjustmentRequestSchema>;
export type AdjustmentBalanceInput = z.infer<typeof inputSchema>;

export class PaymentAdjustmentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PaymentAdjustmentError';
  }
}

function fail(code: string): never {
  throw new PaymentAdjustmentError(code);
}

function sum(...values: number[]): number {
  const result = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_SUPPORTED_MINOR_UNIT_AMOUNT) {
    fail('ADJUSTMENT_AMOUNT_OUT_OF_RANGE');
  }
  return result;
}

function unique(rows: readonly { id: string }[]): void {
  if (new Set(rows.map(row => row.id)).size !== rows.length) {
    fail('ADJUSTMENT_DUPLICATE_EVIDENCE');
  }
}

/**
 * Pure accounting over authoritative server facts, not provider verification.
 * The caller must verify receipts, resolve legacy deposit credit and lock the
 * appointment before using this projection to reserve a financial operation.
 */
export function resolveAdjustmentBalance(input: AdjustmentBalanceInput) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('ADJUSTMENT_INVALID_EVIDENCE');
  }
  const { bill, payments, refunds, requests } = parsed.data;
  for (const rows of [payments, refunds, requests]) {
    unique(rows);
    if (rows.some(row => row.salonId !== bill.salonId || row.appointmentId !== bill.appointmentId)) {
      fail('ADJUSTMENT_SCOPE_MISMATCH');
    }
  }
  if (new Set(payments.map(payment => payment.movementId)).size !== payments.length) {
    fail('ADJUSTMENT_DUPLICATE_MOVEMENT');
  }
  const paymentMap = new Map(payments.map(payment => [payment.id, payment]));
  let grossPrincipal = 0;
  let grossTip = 0;
  let refundedPrincipal = 0;
  let refundedTip = 0;
  let creditRemovedCents = 0;
  let refundReserved = 0;
  let underReviewPaymentCents = 0;
  let underReviewRefundCents = 0;
  const blockedReasons = new Set<string>();
  for (const payment of payments) {
    if (sum(payment.principalCents, payment.tipCents) === 0) {
      fail('ADJUSTMENT_EMPTY_PAYMENT');
    }
    if (payment.kind === 'deposit' && payment.tipCents !== 0) {
      fail('ADJUSTMENT_DEPOSIT_TIP_UNSUPPORTED');
    }
    if (payment.state === 'under_review') {
      underReviewPaymentCents = sum(underReviewPaymentCents, payment.principalCents, payment.tipCents);
      blockedReasons.add('PAYMENT_UNDER_REVIEW');
      continue;
    }
    grossPrincipal = sum(grossPrincipal, payment.principalCents);
    grossTip = sum(grossTip, payment.tipCents);
  }
  const allocations = new Map<string, { principal: number; tip: number }>();
  for (const refund of refunds) {
    const payment = paymentMap.get(refund.paymentId);
    const amount = sum(refund.principalCents, refund.tipCents);
    if (!payment || amount === 0) {
      fail('ADJUSTMENT_INVALID_REFUND_PARENT');
    }
    if ((refund.kind === 'deposit_refund' || refund.kind === 'deposit_forfeit') && (payment.kind !== 'deposit' || refund.tipCents !== 0)) {
      fail('ADJUSTMENT_INVALID_REFUND_PARENT');
    }
    if (refund.state === 'failed' || refund.state === 'canceled') {
      continue;
    }
    const allocated = allocations.get(payment.id) ?? { principal: 0, tip: 0 };
    allocated.principal = sum(allocated.principal, refund.principalCents);
    allocated.tip = sum(allocated.tip, refund.tipCents);
    if (allocated.principal > payment.principalCents || allocated.tip > payment.tipCents) {
      fail('ADJUSTMENT_REFUND_EXCEEDS_PAYMENT');
    }
    allocations.set(payment.id, allocated);
    if (refund.state === 'under_review' || payment.state !== 'confirmed') {
      underReviewRefundCents = sum(underReviewRefundCents, amount);
      blockedReasons.add('REFUND_UNDER_REVIEW');
      continue;
    }
    if (refund.state === 'succeeded') {
      refundedPrincipal = sum(refundedPrincipal, refund.principalCents);
      refundedTip = sum(refundedTip, refund.tipCents);
      if (refund.kind === 'manual_void' || refund.kind === 'deposit_forfeit') {
        creditRemovedCents = sum(creditRemovedCents, amount);
      }
    } else {
      refundReserved = sum(refundReserved, amount);
      blockedReasons.add('REFUND_PENDING');
    }
  }
  const activeRequests = requests.filter(request => ['reserved', 'open', 'processing', 'uncertain'].includes(request.state));
  for (const request of requests.filter(row => row.state === 'paid')) {
    const matching = payments.filter(row => row.requestId === request.id);
    if (matching.length !== 1 || matching[0]!.state !== 'confirmed' || matching[0]!.kind !== 'online'
      || matching[0]!.principalCents !== request.principalCents || matching[0]!.tipCents !== request.tipCents) {
      blockedReasons.add('PAYMENT_CONFIRMATION_PENDING');
    }
  }
  if (activeRequests.length > 1) {
    blockedReasons.add('MULTIPLE_PAYMENT_REQUESTS');
  }
  for (const request of activeRequests) {
    if (sum(request.principalCents, request.tipCents) === 0) {
      fail('ADJUSTMENT_EMPTY_REQUEST');
    }
    blockedReasons.add(request.billRevision === bill.revision ? 'PAYMENT_REQUEST_ACTIVE' : 'PAYMENT_REQUEST_STALE');
    if (request.state === 'uncertain') {
      blockedReasons.add('PAYMENT_OUTCOME_UNKNOWN');
    }
  }
  const principal = sum(bill.serviceCents, bill.taxCents);
  const total = sum(principal, bill.tipCents);
  const netPrincipal = grossPrincipal - refundedPrincipal;
  const netTip = grossTip - refundedTip;
  const netPaid = sum(netPrincipal, netTip);
  // A prepaid tip cannot silently become credit for a new service or vice versa.
  const principalDue = Math.max(0, principal - netPrincipal);
  const tipDue = Math.max(0, bill.tipCents - netTip);
  const principalExcess = Math.max(0, netPrincipal - principal);
  const tipExcess = Math.max(0, netTip - bill.tipCents);
  const due = sum(principalDue, tipDue);
  const excess = sum(principalExcess, tipExcess);
  if (due > 0 && excess > 0) {
    blockedReasons.add('COMPONENT_REALLOCATION_REQUIRED');
  }
  const refundable = payments.filter(payment => payment.state === 'confirmed').map((payment) => {
    const used = allocations.get(payment.id) ?? { principal: 0, tip: 0 };
    return { paymentId: payment.id, kind: payment.kind, principalCents: payment.principalCents - used.principal, tipCents: payment.tipCents - used.tip };
  });
  return Object.freeze({
    revision: parsed.data.revision,
    totalCents: total,
    grossPaidCents: sum(grossPrincipal, grossTip),
    refundedCents: sum(refundedPrincipal, refundedTip) - creditRemovedCents,
    creditRemovedCents,
    netPaidCents: netPaid,
    pendingRefundCents: refundReserved,
    underReviewPaymentCents,
    underReviewRefundCents,
    balanceDueCents: due,
    overpaidCents: excess,
    principalDueCents: principalDue,
    tipDueCents: tipDue,
    principalOverpaidCents: principalExcess,
    tipOverpaidCents: tipExcess,
    blockedReasons: Object.freeze([...blockedReasons]),
    canReservePayment: blockedReasons.size === 0 && due > 0 && excess === 0,
    canReserveRefund: blockedReasons.size === 0 && excess > 0 && due === 0,
    refundable: Object.freeze(refundable.map(row => Object.freeze(row))),
  });
}

export type AdjustmentBalance = ReturnType<typeof resolveAdjustmentBalance>;

/** Owner-only refunds initially; role and appointment access come from auth. */
export function adjustmentPermissions(actor: {
  role: 'owner' | 'staff' | 'admin' | 'customer';
  hasAppointmentAccess: boolean;
  impersonating: boolean;
  canEditItems: boolean;
  canRecordPayment: boolean;
}) {
  const permitted = actor.hasAppointmentAccess && !actor.impersonating;
  const staff = actor.role !== 'customer';
  return Object.freeze({
    canView: permitted,
    canAdjustBill: permitted && staff && actor.canEditItems,
    canRequestPayment: permitted && (!staff || actor.canRecordPayment),
    canRecordPayment: permitted && staff && actor.canRecordPayment,
    canRequestRefund: permitted && staff && actor.canRecordPayment,
    canIssueRefund: permitted && actor.role === 'owner',
  });
}

/** Deposit credit excludes refunded or forfeited money; gross history stays intact. */
export function netWorkspaceDepositCredit(payments: readonly AdjustmentPayment[], refunds: readonly AdjustmentRefund[]) {
  const deposits = payments.filter(payment => payment.kind === 'deposit' && payment.state === 'confirmed');
  return deposits.reduce((sum, payment) => sum + payment.principalCents, 0)
    - refunds.filter(refund => refund.state === 'succeeded' && deposits.some(payment => payment.id === refund.paymentId)).reduce((sum, refund) => sum + refund.principalCents, 0);
}
