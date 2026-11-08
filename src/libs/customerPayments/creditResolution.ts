import { createHash } from 'node:crypto';

import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { CustomerPaymentCapture, customerPaymentFeeBindingSchema, customerPaymentFeeRefundSchema, CustomerPaymentRefund } from '@/models/customerPaymentSchema';
import type { Appointment, AppointmentDeposit, AppointmentPayment } from '@/models/Schema';

import { customerPaymentTenderSummary, verifyCustomerPaymentTender } from './provenance';
import { projectCustomerPaymentRefundReport } from './refundReporting';

export const CUSTOMER_PAYMENT_CREDIT_RECONCILIATION_REQUIRED = 'CUSTOMER_PAYMENT_CREDIT_RECONCILIATION_REQUIRED';
export type CustomerPaymentCreditSource = {
  appointment: Appointment;
  captures: readonly CustomerPaymentCapture[];
  payments: readonly AppointmentPayment[];
  deposits: readonly AppointmentDeposit[];
  refunds: readonly CustomerPaymentRefund[];
  feeBindings: readonly (typeof customerPaymentFeeBindingSchema.$inferSelect)[];
  feeRefunds: readonly (typeof customerPaymentFeeRefundSchema.$inferSelect)[];
};
export type CustomerPaymentCreditNote = {
  id: string;
  salonId: string;
  appointmentId: string;
  captureId: string;
  currency: 'CAD';
  scope: 'customer_refund_credit';
  basisVersion: 1;
  evidenceFingerprint: string;
  previousDecisionId: string | null;
  deltaServiceCreditCents: number;
  deltaTaxCreditCents: number;
  deltaTipCreditCents: number;
  serviceCreditCents: number;
  taxCreditCents: number;
  tipCreditCents: number;
};
function fail(): never {
  throw new Error(CUSTOMER_PAYMENT_CREDIT_RECONCILIATION_REQUIRED);
}
function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SUPPORTED_MINOR_UNIT_AMOUNT) {
    fail();
  }
  return value;
}
function iso(value: Date): string {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime())) {
    fail();
  }
  return value.toISOString();
}
/** Deterministic source binding only; no database, provider, or other side effects. */
function fingerprint(value: unknown): string {
  function canonical(input: unknown): string {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') {
      return JSON.stringify(input);
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return JSON.stringify(input);
    }
    if (Array.isArray(input)) {
      return `[${Array.from(input, canonical).join(',')}]`;
    }
    if (typeof input === 'object' && input !== null && Object.getPrototypeOf(input) === Object.prototype) {
      return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${canonical((input as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    return fail();
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * Narrow completed-invoice evidence. Callers must load COMPLETE appointment-scoped
 * rows under the same money lock/snapshot. Fee movements are validated independently,
 * but never create customer credit or change the customer-obligation fingerprint.
 */
export function buildCustomerPaymentCreditBasis(source: CustomerPaymentCreditSource) {
  const a = source.appointment;
  const tax = validateAppointmentTaxSnapshotChain(a);
  if (!tax.ok || tax.active.source !== 'final' || a.status !== 'completed' || a.paymentStatus !== 'paid' || !a.completedAt
    || a.deletedAt !== null || a.invoiceCurrency !== 'CAD' || tax.invoiceCurrency !== 'CAD'
    || source.captures.length !== 1 || source.payments.length !== 1 || source.deposits.length !== 0
    || source.refunds.length === 0 || source.refunds.some(row => row.state !== 'applied')) {
    fail();
  }
  const capture = source.captures[0]!;
  const tender = source.payments[0]!;
  const frozen = tax.active.snapshot;
  iso(capture.recordedAt);
  if (capture.state !== 'posted' || capture.reviewReason !== null || capture.salonId !== a.salonId
    || capture.appointmentId !== a.id || capture.currency !== 'cad'
    || capture.principalCents !== frozen.invoiceTotalCents || capture.tipCents !== a.tipCents
    || capture.amountCents !== capture.principalCents + capture.tipCents
    || capture.applicationFeeCents !== capture.quotedApplicationFeeCents
    || capture.applicationFeeCents >= capture.amountCents
    || a.taxEnabledSnapshot !== frozen.configuration.enabled || a.taxNameSnapshot !== frozen.configuration.label
    || a.taxRateBps !== frozen.configuration.rateBps || a.taxInclusive !== (frozen.configuration.mode === 'included')
    || iso(tender.recordedAt) !== iso(capture.capturedAt)
    || capture.recordedAt.getTime() < capture.capturedAt.getTime()
    || capture.capturedAt.getTime() > a.completedAt.getTime() || capture.recordedAt.getTime() > a.completedAt.getTime()) {
    fail();
  }
  try {
    projectCustomerPaymentRefundReport({ salonId: a.salonId, currency: 'CAD', start: new Date(-8640000000000000), end: new Date(8640000000000000), captures: source.captures, markers: source.payments, refunds: source.refunds, bindings: source.feeBindings, feeRefunds: source.feeRefunds });
  } catch {
    fail();
  }
  const proven = verifyCustomerPaymentTender(tender, { ...capture, synthetic: true }, source.refunds);
  const summary = customerPaymentTenderSummary(proven);
  if (!summary.collectionHold || summary.refundedCents === 0 || a.amountPaidCents !== summary.netCents) {
    fail();
  }
  const original = Object.freeze({ serviceCents: cents(frozen.serviceSubtotalCents), taxCents: cents(frozen.taxAmountCents), tipCents: cents(a.tipCents), totalCents: cents(frozen.invoiceTotalCents + a.tipCents) });
  const refunded = Object.freeze({ principalCents: summary.refundedPrincipalCents, tipCents: summary.refundedTipCents, totalCents: summary.refundedCents });
  const evidenceFingerprint = fingerprint({
    version: 1,
    appointment: { id: a.id, salonId: a.salonId, status: a.status, completedAt: iso(a.completedAt), deletedAt: a.deletedAt, invoiceCurrency: a.invoiceCurrency, totalPrice: a.totalPrice, finalPriceCents: a.finalPriceCents, finalSubtotalCents: a.finalSubtotalCents, finalDiscountCents: a.finalDiscountCents, finalDiscountReason: a.finalDiscountReason, taxEnabledSnapshot: a.taxEnabledSnapshot, taxNameSnapshot: a.taxNameSnapshot, taxRateBps: a.taxRateBps, taxInclusive: a.taxInclusive, taxableSubtotalCents: a.taxableSubtotalCents, taxAmountCents: a.taxAmountCents, taxExempt: a.taxExempt, taxExemptReason: a.taxExemptReason, tipCents: a.tipCents, amountPaidCents: a.amountPaidCents, paymentStatus: a.paymentStatus, bookingTaxSnapshot: a.bookingTaxSnapshot, rescheduleTaxSnapshot: a.rescheduleTaxSnapshot, finalTaxSnapshot: a.finalTaxSnapshot },
    capture: { id: capture.id, salonId: capture.salonId, appointmentId: capture.appointmentId, quoteId: capture.quoteId, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, tenderId: capture.tenderId, currency: capture.currency, mode: capture.mode, source: capture.source, state: capture.state, reviewReason: capture.reviewReason, amountCents: capture.amountCents, principalCents: capture.principalCents, tipCents: capture.tipCents, applicationFeeCents: capture.applicationFeeCents, quotedApplicationFeeCents: capture.quotedApplicationFeeCents, capturedAt: iso(capture.capturedAt), recordedAt: iso(capture.recordedAt), fingerprint: capture.fingerprint },
    tender: { id: tender.id, salonId: tender.salonId, appointmentId: tender.appointmentId, amountCents: tender.amountCents, reference: tender.reference, method: tender.method, recordedByType: tender.recordedByType, recordedAt: iso(tender.recordedAt), voidedAt: tender.voidedAt },
    refunds: [...source.refunds].sort((left, right) => left.id.localeCompare(right.id)).map(row => ({
      id: row.id,
      captureId: row.captureId,
      salonId: row.salonId,
      appointmentId: row.appointmentId,
      stripeAccountId: row.stripeAccountId,
      paymentIntentId: row.paymentIntentId,
      currency: row.currency,
      mode: row.mode,
      source: row.source,
      refundId: row.refundId,
      amountCents: row.amountCents,
      principalCents: row.principalCents,
      tipCents: row.tipCents,
      state: row.state,
      reviewReason: row.reviewReason,
      occurredAt: iso(row.occurredAt),
      recordedAt: iso(row.recordedAt),
      fingerprint: row.fingerprint,
    })),
  });
  return Object.freeze({ version: 1 as const, evidenceFingerprint, salonId: a.salonId, appointmentId: a.id, captureId: capture.id, currency: 'CAD' as const, original, refunded, netTenderCents: summary.netCents });
}

/**
 * Read resolution only. Allocations are explicit operator instructions, not a tax
 * determination. Generic collection/lifecycle holds remain intentionally set.
 */
export function projectResolvedCustomerPaymentCredit(source: CustomerPaymentCreditSource, note: CustomerPaymentCreditNote, history: readonly CustomerPaymentCreditNote[] = []) {
  const seen = new Set<string>();
  let previous: CustomerPaymentCreditNote | null = null;
  for (const decision of [...history, note]) {
    if (!decision.id?.trim() || seen.has(decision.id) || decision.previousDecisionId !== (previous?.id ?? null)
      || decision.salonId !== note.salonId || decision.appointmentId !== note.appointmentId || decision.captureId !== note.captureId
      || decision.scope !== 'customer_refund_credit' || decision.basisVersion !== 1 || decision.currency !== 'CAD'
      || !/^[a-f0-9]{64}$/.test(decision.evidenceFingerprint)
      || cents(decision.serviceCreditCents) - (previous?.serviceCreditCents ?? 0) !== cents(decision.deltaServiceCreditCents)
      || cents(decision.taxCreditCents) - (previous?.taxCreditCents ?? 0) !== cents(decision.deltaTaxCreditCents)
      || cents(decision.tipCreditCents) - (previous?.tipCreditCents ?? 0) !== cents(decision.deltaTipCreditCents)) {
      fail();
    }
    seen.add(decision.id);
    previous = decision;
  }
  const basis = buildCustomerPaymentCreditBasis(source);
  if (!note.id?.trim() || note.salonId !== basis.salonId || note.appointmentId !== basis.appointmentId
    || note.captureId !== basis.captureId || note.currency !== 'CAD' || note.scope !== 'customer_refund_credit'
    || note.basisVersion !== 1 || note.evidenceFingerprint !== basis.evidenceFingerprint
    || cents(note.serviceCreditCents) > basis.original.serviceCents || cents(note.taxCreditCents) > basis.original.taxCents
    || cents(note.tipCreditCents) !== basis.refunded.tipCents || note.tipCreditCents > basis.original.tipCents
    || cents(note.serviceCreditCents + note.taxCreditCents) !== basis.refunded.principalCents) {
    fail();
  }
  const credit = Object.freeze({ serviceCents: note.serviceCreditCents, taxCents: note.taxCreditCents, tipCents: note.tipCreditCents, totalCents: cents(note.serviceCreditCents + note.taxCreditCents + note.tipCreditCents) });
  const adjusted = Object.freeze({ serviceCents: basis.original.serviceCents - credit.serviceCents, taxCents: basis.original.taxCents - credit.taxCents, tipCents: basis.original.tipCents - credit.tipCents, totalCents: basis.original.totalCents - credit.totalCents });
  if (adjusted.totalCents !== basis.netTenderCents) {
    fail();
  }
  return Object.freeze({ state: 'resolved' as const, currency: basis.currency, creditNoteId: note.id, evidenceFingerprint: basis.evidenceFingerprint, original: basis.original, credit, adjusted, actualNetTenderCents: basis.netTenderCents, collectibleBalanceCents: 0 as const, ordinaryActionsBlocked: true as const });
}
