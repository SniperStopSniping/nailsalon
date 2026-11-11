import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { CustomerPaymentFixtureApplication, CustomerPaymentFixtureHold } from '@/models/customerPaymentFixtureApplicationSchema';
import type { CustomerPaymentCapture, customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';
import type { customerPaymentLiveSettlementSchema } from '@/models/customerPaymentWorkspaceSchema';

import { calculatePaymentSnapshot } from './money';
import type { PaymentWorkspaceState } from './server/workspaceContract';

/** Reserved canonical tender identity; never accepted from manual payment forms. */
export function isCustomerPaymentTender(row: { id?: string; reference?: string | null }): boolean {
  return row.id?.startsWith('cpay_') === true || row.reference?.startsWith('customer_payment_capture:') === true
    || row.id?.startsWith('lpay_') === true || row.reference?.startsWith('customer_payment_live:') === true;
}

export type CustomerPaymentProvenanceCapture = {
  id: string;
  salonId: string;
  appointmentId: string;
  amountCents: number;
  tipCents: number;
  state: 'posted' | 'held_review';
  mode: 'test';
  synthetic: true;
};

export type CustomerPaymentProvenanceRefund = {
  id: string;
  refundId: string;
  captureId: string;
  salonId: string;
  appointmentId: string;
  amountCents: number;
  principalCents: number;
  tipCents: number;
  state: 'applied' | 'held_review';
};

type Tender = {
  id?: string;
  reference?: string | null;
  salonId?: string;
  appointmentId?: string;
  amountCents: number;
  method?: string | null;
  recordedByType?: string;
  voidedAt: Date | string | null;
  recordedAt?: Date | string;
};

const proof = Symbol('verified-customer-payment-tender');
type Proof = { source: 'synthetic_test' | 'offline_fixture_test' | 'stripe_verified'; recordedAt?: number; applicationId?: string; id: string; salonId: string; appointmentId: string; amountCents: number; tipCents: number; refundedPrincipalCents: number; refundedTipCents: number; refundedCents: number; netCents: number; collectionHold: boolean };

type ProvenTender = Tender & { [proof]?: Proof };

/** Pure bridge for an authoritative immutable test capture loaded by the server. */
export function verifyCustomerPaymentTender<T extends Tender>(row: T, capture: CustomerPaymentProvenanceCapture, refunds: readonly CustomerPaymentProvenanceRefund[]): T {
  if (((capture as { source?: unknown }).source !== undefined && (capture as { source?: unknown }).source !== 'synthetic_test') || capture.mode !== 'test' || capture.synthetic !== true || capture.state !== 'posted'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capture.id)
    || row.id !== `cpay_${capture.id}` || row.reference !== `customer_payment_capture:${capture.id}`
    || row.salonId !== capture.salonId || row.appointmentId !== capture.appointmentId
    || row.amountCents !== capture.amountCents || row.method !== 'online' || row.recordedByType !== 'system'
    || row.voidedAt !== null || !Number.isSafeInteger(capture.amountCents) || capture.amountCents <= 0
    || !Number.isSafeInteger(capture.tipCents) || capture.tipCents < 0 || capture.tipCents > capture.amountCents) {
    throw new Error('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
  }
  if (!Array.isArray(refunds)) {
    throw new TypeError('CUSTOMER_PAYMENT_REFUND_EVIDENCE_REQUIRED');
  }
  const ids = new Set<string>();
  const refundIds = new Set<string>();
  let refundedPrincipalCents = 0;
  let refundedTipCents = 0;
  for (const refund of refunds) {
    if (!refund.id || !refund.refundId || ids.has(refund.id) || refundIds.has(refund.refundId)
      || refund.captureId !== capture.id || refund.salonId !== capture.salonId || refund.appointmentId !== capture.appointmentId
      || !['applied', 'held_review'].includes(refund.state)
      || !Number.isSafeInteger(refund.amountCents) || refund.amountCents <= 0
      || !Number.isSafeInteger(refund.principalCents) || refund.principalCents < 0
      || !Number.isSafeInteger(refund.tipCents) || refund.tipCents < 0) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
    }
    ids.add(refund.id);
    refundIds.add(refund.refundId);
    // Review evidence never alters the credited cache, but always blocks collection.
    if (refund.state === 'applied') {
      if (refund.amountCents !== refund.principalCents + refund.tipCents) {
        throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
      }
      refundedPrincipalCents += refund.principalCents;
      refundedTipCents += refund.tipCents;
      if (!Number.isSafeInteger(refundedPrincipalCents) || !Number.isSafeInteger(refundedTipCents)
        || refundedPrincipalCents > capture.amountCents - capture.tipCents || refundedTipCents > capture.tipCents) {
        throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
      }
    }
  }
  const refundedCents = refundedPrincipalCents + refundedTipCents;
  return { ...row, [proof]: Object.freeze({ source: 'synthetic_test' as const, refundedPrincipalCents, refundedTipCents, refundedCents, netCents: capture.amountCents - refundedCents, collectionHold: refunds.length > 0, id: row.id, salonId: capture.salonId, appointmentId: capture.appointmentId, amountCents: capture.amountCents, tipCents: capture.tipCents }) };
}

export function hasVerifiedCustomerPaymentTender(row: Tender): boolean {
  const evidence = (row as ProvenTender)[proof];
  return evidence !== undefined && row.id === evidence.id && row.salonId === evidence.salonId
    && row.appointmentId === evidence.appointmentId && row.amountCents === evidence.amountCents
    && row.reference === `${evidence.source === 'stripe_verified' ? 'customer_payment_live' : 'customer_payment_capture'}:${evidence.id.slice(5)}` && row.voidedAt === null
    && row.method === 'online' && row.recordedByType === 'system'
    && (evidence.source === 'synthetic_test' || (row.recordedAt instanceof Date && row.recordedAt.getTime() === evidence.recordedAt));
}

/** The server loads these immutable settlements and workspace in one DB snapshot. */
export function verifyLiveWorkspaceTender<T extends Tender>(row: T, state: PaymentWorkspaceState, settlements: readonly (typeof customerPaymentLiveSettlementSchema.$inferSelect)[], livemode: boolean): T {
  const capture = settlements.find(item => item.kind === 'payment' && row.id === `lpay_${item.operationId}`);
  const payment = state.payments.find(item => item.id === row.id && item.kind === 'online' && item.state === 'confirmed');
  const op = capture && state.operations.find(item => item.id === capture.operationId && item.kind === 'payment');
  if (!capture || !payment || !op || !['succeeded', 'review'].includes(op.state) || capture.livemode !== livemode
    || row.salonId !== state.bill.salonId || row.appointmentId !== state.bill.appointmentId
    || capture.salonId !== row.salonId || capture.appointmentId !== row.appointmentId
    || capture.principalCents !== payment.principalCents || capture.tipCents !== payment.tipCents
    || capture.chargeId !== payment.movementId || capture.operationId !== payment.requestId
    || capture.objectId !== op.providerObjectId || capture.accountId !== op.binding.connectedAccountId
    || capture.platformAccountId !== op.binding.platformAccountId || capture.livemode !== op.binding.livemode
    || row.amountCents !== capture.principalCents + capture.tipCents || row.reference !== `customer_payment_live:${capture.operationId}`
    || row.method !== 'online' || row.recordedByType !== 'system' || row.voidedAt !== null || !(row.recordedAt instanceof Date)) {
    throw new Error('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
  }
  let refundedPrincipalCents = 0;
  let refundedTipCents = 0;
  const receipts = settlements.filter(item => item.kind === 'refund' && item.parentOperationId === capture.operationId);
  const refunds = state.refunds.filter(item => item.paymentId === payment.id && item.state === 'succeeded');
  if (receipts.length !== refunds.length || new Set(receipts.map(item => item.operationId)).size !== receipts.length) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
  }
  for (const refund of refunds) {
    const receipt = receipts.find(item => item.operationId === refund.id);
    const refundOp = state.operations.find(item => item.id === refund.id && item.kind === 'refund');
    if (!receipt || !refundOp || !['succeeded', 'review'].includes(refundOp.state) || !refundOp.approvedBy
      || receipt.salonId !== row.salonId || receipt.appointmentId !== row.appointmentId || receipt.livemode !== livemode
      || receipt.accountId !== capture.accountId || receipt.platformAccountId !== capture.platformAccountId
      || receipt.chargeId !== capture.chargeId || receipt.paymentIntentId !== capture.paymentIntentId
      || receipt.principalCents !== refund.principalCents || receipt.tipCents !== refund.tipCents
      || receipt.objectId !== refundOp.providerObjectId) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
    }
    refundedPrincipalCents += receipt.principalCents;
    refundedTipCents += receipt.tipCents;
  }
  if (refundedPrincipalCents > capture.principalCents || refundedTipCents > capture.tipCents) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
  }
  const refundedCents = refundedPrincipalCents + refundedTipCents;
  return { ...row, [proof]: Object.freeze({ source: 'stripe_verified' as const, id: row.id!, salonId: capture.salonId, appointmentId: capture.appointmentId, recordedAt: row.recordedAt.getTime(), amountCents: row.amountCents, tipCents: capture.tipCents, refundedPrincipalCents, refundedTipCents, refundedCents, netCents: row.amountCents - refundedCents, collectionHold: state.operations.some(item => !['succeeded', 'failed', 'canceled'].includes(item.state)) }) };
}

/** Read-only gross/net evidence. A net balance never grants permission to collect. */
export function customerPaymentTenderSummary(row: Tender) {
  if (!hasVerifiedCustomerPaymentTender(row)) {
    throw new Error('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
  }
  const evidence = (row as ProvenTender)[proof]!;
  return Object.freeze({ grossCents: evidence.amountCents, grossTipCents: evidence.tipCents, refundedPrincipalCents: evidence.refundedPrincipalCents, refundedTipCents: evidence.refundedTipCents, refundedCents: evidence.refundedCents, netCents: evidence.netCents, collectionHold: evidence.collectionHold });
}

/** Display/replay allowance only; a refund still requires a locked workspace command. */
export function liveCustomerPaymentRefundablePrincipal(rows: readonly Tender[]): number {
  return rows.reduce((sum, row) => {
    if (!row.id?.startsWith('lpay_') || row.voidedAt !== null) {
      return sum;
    }
    const proof = customerPaymentTenderSummary(row);
    return proof.collectionHold ? sum : sum + proof.grossCents - proof.grossTipCents - proof.refundedPrincipalCents;
  }, 0);
}

/** Read-only recorded tips; callers must retain any collection hold separately. */
export function customerPaymentTipFloorForReconciliation(rows: readonly Tender[]): number {
  let tip = 0;
  for (const row of rows) {
    if (!isCustomerPaymentTender(row)) {
      continue;
    }
    if (!hasVerifiedCustomerPaymentTender(row)) {
      throw new Error('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
    }
    const summary = customerPaymentTenderSummary(row);
    tip += (row as ProvenTender)[proof]?.source === 'stripe_verified' ? summary.grossTipCents - summary.refundedTipCents : summary.grossTipCents;
    if (!Number.isSafeInteger(tip)) {
      throw new TypeError('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
    }
  }
  return tip;
}

/** Mutation callers must never treat held money as permission to proceed. */
export function customerPaymentTipFloor(rows: readonly Tender[]): number {
  if (rows.some(row => isCustomerPaymentTender(row) && customerPaymentTenderSummary(row).collectionHold)) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
  }
  return customerPaymentTipFloorForReconciliation(rows);
}

export function customerPaymentCompletionTip(rows: readonly Tender[], requestedTip: number | undefined, storedTip: number): number {
  const floor = customerPaymentTipFloor(rows);
  const tip = requestedTip ?? (rows.some(isCustomerPaymentTender) ? Math.max(storedTip, floor) : 0);
  if (!Number.isSafeInteger(tip) || tip < floor) {
    throw new Error('CUSTOMER_PAYMENT_PREPAID_TIP_REQUIRED');
  }
  return tip;
}

export type OfflineFixtureCaptureEvidence = {
  application: CustomerPaymentFixtureApplication;
  quote: Pick<typeof customerPaymentPreparedQuoteSchema.$inferSelect, 'id' | 'salonId' | 'appointmentId' | 'stripeAccountId' | 'mode' | 'fingerprint' | 'snapshot' | 'createdAt' | 'expiresAt'>;
  currentPlatformRevision: number;
  holds: readonly CustomerPaymentFixtureHold[];
};

/**
 * Separate trusted-reader bridge. Before calling, the server reader/writer must
 * recompute sourceEvidence/ownershipEvidence with providerCorrelationFingerprint
 * and match their revisions; SQL validates those immutable hashes independently.
 * This shared pure module deliberately has no server crypto or caller hash callback.
 * No application write flag gates existing cash.
 */
export function verifyOfflineFixtureCaptureTender<T extends Tender>(row: T, capture: CustomerPaymentCapture, evidence: OfflineFixtureCaptureEvidence): T {
  const fail = (): never => {
    throw new Error('CUSTOMER_PAYMENT_FIXTURE_PROVENANCE_RECONCILIATION_REQUIRED');
  };
  const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const id = (value: unknown, prefix: string) => typeof value === 'string' && value.length <= 200 && value.startsWith(prefix) && /^[A-Z0-9]+$/i.test(value.slice(prefix.length));
  const cents = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT;
  const timestamp = (value: unknown): number => value instanceof Date && Number.isSafeInteger(value.getTime()) ? value.getTime() : fail();
  const a = evidence.application;
  const q = evidence.quote;
  if (!a || !q || !Array.isArray(evidence.holds)) {
    fail();
  }
  if (a.sourceEvidence === null || typeof a.sourceEvidence !== 'object' || Array.isArray(a.sourceEvidence)
    || Object.getPrototypeOf(a.sourceEvidence) !== Object.prototype || Object.keys(a.sourceEvidence).length === 0
    || !Array.isArray(a.ownershipEvidence) || a.ownershipEvidence.length !== 1
    || a.ownershipEvidence[0]?.operationId !== a.operationId || !hash(a.ownershipEvidence[0]?.fingerprint)) {
    fail();
  }
  if (capture.source !== 'offline_fixture_test' || capture.mode !== 'test' || capture.state !== 'posted' || capture.reviewReason !== null
    || a.source !== 'offline_fixture_test' || a.mode !== 'test' || q.mode !== 'test'
    || ![capture.id, a.id, a.operationId, a.quoteId, a.candidateId, a.correlationId, a.successInboxId].every(uuid)
    || ![a.sourceRevision, a.ownershipRevision, a.captureFingerprint, a.quoteFingerprint, a.successReceiptFingerprint, capture.fingerprint, q.fingerprint].every(hash)
    || !id(a.platformId, 'acct_') || !id(a.accountId, 'acct_') || a.platformId === a.accountId || !id(a.chargeId, 'ch_') || !id(a.paymentIntentId, 'pi_')
    || a.captureId !== capture.id || a.tenderId !== capture.tenderId || row.id !== a.tenderId || row.id !== `cpay_${capture.id}`
    || row.reference !== `customer_payment_capture:${capture.id}` || row.method !== 'online' || row.recordedByType !== 'system' || row.voidedAt !== null
    || !a.salonId || !a.appointmentId || a.salonId !== capture.salonId || a.salonId !== row.salonId || a.salonId !== q.salonId
    || a.appointmentId !== capture.appointmentId || a.appointmentId !== row.appointmentId || a.appointmentId !== q.appointmentId
    || a.quoteId !== q.id || a.quoteId !== capture.quoteId || a.accountId !== capture.stripeAccountId || a.accountId !== q.stripeAccountId
    || a.paymentIntentId !== capture.paymentIntentId || a.captureFingerprint !== capture.fingerprint || a.quoteFingerprint !== q.fingerprint
    || a.currency !== 'cad' || capture.currency !== 'cad' || q.snapshot.currency !== 'cad'
    || ![capture.amountCents, capture.principalCents, capture.tipCents, capture.applicationFeeCents, capture.quotedApplicationFeeCents].every(cents)
    || capture.amountCents <= 0 || capture.applicationFeeCents >= capture.amountCents || capture.amountCents !== capture.principalCents + capture.tipCents
    || capture.quotedApplicationFeeCents !== capture.applicationFeeCents
    || a.amountCents !== capture.amountCents || row.amountCents !== capture.amountCents || a.principalCents !== capture.principalCents
    || a.tipCents !== capture.tipCents || a.applicationFeeCents !== capture.applicationFeeCents
    || !Number.isSafeInteger(a.platformRevision) || a.platformRevision < 0
    || !Number.isSafeInteger(evidence.currentPlatformRevision) || evidence.currentPlatformRevision < a.platformRevision) {
    fail();
  }
  const observedAt = timestamp(a.successEventAt);
  if (observedAt % 1000 !== 0 || timestamp(capture.capturedAt) !== observedAt || timestamp(row.recordedAt) !== observedAt
    || observedAt < timestamp(q.createdAt) || observedAt >= timestamp(q.expiresAt)
    || timestamp(a.createdAt) < observedAt || timestamp(capture.recordedAt) !== timestamp(a.createdAt)) {
    fail();
  }
  const s = q.snapshot;
  let calculated;
  try {
    calculated = calculatePaymentSnapshot({ currency: s.currency, servicesCents: s.servicesCents, discountCents: s.discountCents, taxCents: s.taxCents, tipCents: s.tipCents, collection: 'full', feePolicy: { payer: s.feePayer, taxTreatment: s.feeTaxTreatment, refundPolicy: s.feeRefundPolicy, feeCents: s.configuredFeeCents } });
  } catch {
    return fail();
  }
  if (Object.entries(calculated).some(([key, value]) => s[key as keyof typeof s] !== value)
    || s.chargeCents !== capture.amountCents || s.serviceTotalCents !== capture.principalCents || s.tipCents !== capture.tipCents
    || s.applicationFeeCents !== capture.applicationFeeCents) {
    fail();
  }
  const holds = new Set<string>();
  for (const hold of evidence.holds) {
    if (!uuid(hold.id) || holds.has(hold.id) || hold.applicationId !== a.id || hold.platformId !== a.platformId
      || !Number.isSafeInteger(hold.platformRevision) || hold.platformRevision < a.platformRevision || hold.platformRevision > evidence.currentPlatformRevision
      || !hold.reason || !hold.sourceTable || !hold.sourceId || timestamp(hold.createdAt) < timestamp(a.createdAt)) {
      fail();
    }
    holds.add(hold.id);
  }
  return { ...row, [proof]: Object.freeze({ source: 'offline_fixture_test' as const, applicationId: a.id, recordedAt: observedAt, id: row.id!, salonId: capture.salonId, appointmentId: capture.appointmentId, amountCents: capture.amountCents, tipCents: capture.tipCents, refundedPrincipalCents: 0, refundedTipCents: 0, refundedCents: 0, netCents: capture.amountCents, collectionHold: evidence.holds.length > 0 || evidence.currentPlatformRevision !== a.platformRevision }) };
}
