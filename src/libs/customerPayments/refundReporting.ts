import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { CustomerPaymentCapture, customerPaymentFeeBindingSchema, customerPaymentFeeRefundSchema, CustomerPaymentRefund } from '@/models/customerPaymentSchema';
import type { AppointmentPayment } from '@/models/Schema';

import { CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED, projectCustomerPaymentCaptureReport } from './captureReporting';

type FeeBinding = typeof customerPaymentFeeBindingSchema.$inferSelect;
type FeeRefund = typeof customerPaymentFeeRefundSchema.$inferSelect;
type RefundIdentity = Pick<CustomerPaymentRefund, 'captureId' | 'salonId' | 'appointmentId' | 'stripeAccountId' | 'paymentIntentId' | 'currency' | 'mode' | 'source'>;

function fail(): never {
  throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
}
function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SUPPORTED_MINOR_UNIT_AMOUNT) {
    fail();
  }
  return value;
}
function time(value: Date): number {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime())) {
    fail();
  }
  return value.getTime();
}
function matches(row: RefundIdentity, capture: CustomerPaymentCapture, salonId: string): boolean {
  return row.captureId === capture.id && row.salonId === salonId && row.salonId === capture.salonId
    && row.appointmentId === capture.appointmentId && row.stripeAccountId === capture.stripeAccountId
    && row.paymentIntentId === capture.paymentIntentId && row.currency === 'cad' && capture.currency === 'cad'
    && row.mode === 'test' && row.source === 'synthetic_test' && capture.state === 'posted';
}

/** Successful observed cash movements; review allocations remain visibly separate. */
export function projectCustomerPaymentRefundReport(input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
  captures: readonly CustomerPaymentCapture[];
  markers: readonly AppointmentPayment[];
  refunds: readonly CustomerPaymentRefund[];
  bindings: readonly FeeBinding[];
  feeRefunds: readonly FeeRefund[];
}) {
  const start = time(input.start);
  const end = time(input.end);
  if (!input.salonId.trim() || start >= end || !['CAD', 'USD'].includes(input.currency)) {
    fail();
  }
  const captures = new Map(input.captures.map(row => [row.id, row]));
  const markers = new Map(input.markers.map(row => [row.id, row]));
  const bindings = new Map(input.bindings.map(row => [row.id, row]));
  if (captures.size !== input.captures.length || markers.size !== input.markers.length
    || captures.size !== markers.size || bindings.size !== input.bindings.length) {
    fail();
  }
  for (const capture of captures.values()) {
    const capturedAt = time(capture.capturedAt);
    const marker = markers.get(capture.tenderId);
    if (!marker) {
      fail();
    }
    // Validate original gross facts without restricting them to the refund period.
    projectCustomerPaymentCaptureReport({ salonId: input.salonId, currency: input.currency, start: new Date(capturedAt), end: new Date(capturedAt + 1), captures: [capture], markers: [marker] });
  }
  const boundCaptures = new Set<string>();
  const feeIdentities = new Set<string>();
  for (const binding of bindings.values()) {
    const capture = captures.get(binding.captureId);
    const feeIdentity = `${binding.stripeAccountId}:${binding.mode}:${binding.applicationFeeId}`;
    if (!binding.id.trim() || boundCaptures.has(binding.captureId) || feeIdentities.has(feeIdentity)
      || !capture || !matches(binding, capture, input.salonId) || !binding.applicationFeeId.trim()
      || cents(binding.amountCents) !== capture.applicationFeeCents) {
      fail();
    }
    boundCaptures.add(binding.captureId);
    feeIdentities.add(feeIdentity);
    if (time(binding.recordedAt) < time(binding.occurredAt)) {
      fail();
    }
  }
  let refundedCents = 0;
  let heldForReviewCents = 0;
  let feeRefundedCents = 0;
  let feeHeldForReviewCents = 0;
  let excludedForeignCurrencyEventCount = 0;
  const ids = new Set<string>();
  const identities = new Set<string>();
  const appliedTotals = new Map<string, { principal: number; tip: number; fee: number }>();
  for (const row of [...input.refunds, ...input.feeRefunds]) {
    const capture = captures.get(row.captureId);
    const occurredAt = time(row.occurredAt);
    const customerRefund = 'refundId' in row;
    const externalId = customerRefund ? row.refundId : row.feeRefundId;
    const identity = `${customerRefund ? 'customer' : 'fee'}:${row.stripeAccountId}:${row.mode}:${externalId}`;
    const rowIdentity = `${customerRefund ? 'customer' : 'fee'}:${row.id}`;
    if (!row.id.trim() || !externalId.trim() || ids.has(rowIdentity) || identities.has(identity)
      || !capture || !matches(row, capture, input.salonId)
      || occurredAt < start || occurredAt >= end || time(row.recordedAt) < occurredAt
      || !['applied', 'held_review'].includes(row.state) || cents(row.amountCents) === 0
      || (row.state === 'applied' ? row.reviewReason !== null : !row.reviewReason?.trim())) {
      fail();
    }
    ids.add(rowIdentity);
    identities.add(identity);
    if (row.state === 'applied' && occurredAt < time(capture.capturedAt)) {
      fail();
    }
    if (customerRefund) {
      const principal = cents(row.principalCents);
      const tip = cents(row.tipCents);
      if (row.state === 'applied' && (principal + tip !== row.amountCents
        || principal > capture.principalCents || tip > capture.tipCents)) {
        fail();
      }
    } else {
      const binding = row.bindingId === null ? undefined : bindings.get(row.bindingId);
      if (!row.applicationFeeId.trim() || (row.bindingId !== null && (!binding
        || binding.captureId !== row.captureId || binding.applicationFeeId !== row.applicationFeeId))
        || (row.state === 'applied' && (!binding || row.amountCents > binding.amountCents))) {
        fail();
      }
    }
    if (row.state === 'applied') {
      const totals = appliedTotals.get(row.captureId) ?? { principal: 0, tip: 0, fee: 0 };
      if (customerRefund) {
        totals.principal += row.principalCents;
        totals.tip += row.tipCents;
      } else {
        totals.fee += row.amountCents;
      }
      if (![totals.principal, totals.tip, totals.fee].every(Number.isSafeInteger)
        || totals.principal > capture.principalCents || totals.tip > capture.tipCents
        || totals.fee > capture.applicationFeeCents) {
        fail();
      }
      appliedTotals.set(row.captureId, totals);
    }
    if (input.currency !== 'CAD') {
      excludedForeignCurrencyEventCount++;
      continue;
    }
    if (customerRefund) {
      refundedCents += row.amountCents;
      heldForReviewCents += row.state === 'held_review' ? row.amountCents : 0;
    } else {
      feeRefundedCents += row.amountCents;
      feeHeldForReviewCents += row.state === 'held_review' ? row.amountCents : 0;
    }
    if (![refundedCents, heldForReviewCents, feeRefundedCents, feeHeldForReviewCents].every(Number.isSafeInteger)) {
      fail();
    }
  }
  return { refundedCents, heldForReviewCents, feeRefundedCents, feeHeldForReviewCents, excludedForeignCurrencyEventCount };
}
