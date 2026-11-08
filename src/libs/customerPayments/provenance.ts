/** Reserved canonical tender identity; never accepted from manual payment forms. */
export function isCustomerPaymentTender(row: { id?: string; reference?: string | null }): boolean {
  return row.id?.startsWith('cpay_') === true || row.reference?.startsWith('customer_payment_capture:') === true;
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
};

const proof = Symbol('verified-customer-payment-tender');
type Proof = { id: string; salonId: string; appointmentId: string; amountCents: number; tipCents: number; refundedPrincipalCents: number; refundedTipCents: number; refundedCents: number; netCents: number; collectionHold: boolean };

type ProvenTender = Tender & { [proof]?: Proof };

/** Pure bridge for an authoritative immutable test capture loaded by the server. */
export function verifyCustomerPaymentTender<T extends Tender>(row: T, capture: CustomerPaymentProvenanceCapture, refunds: readonly CustomerPaymentProvenanceRefund[]): T {
  if (capture.mode !== 'test' || capture.synthetic !== true || capture.state !== 'posted'
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
  return { ...row, [proof]: Object.freeze({ refundedPrincipalCents, refundedTipCents, refundedCents, netCents: capture.amountCents - refundedCents, collectionHold: refunds.length > 0, id: row.id, salonId: capture.salonId, appointmentId: capture.appointmentId, amountCents: capture.amountCents, tipCents: capture.tipCents }) };
}

export function hasVerifiedCustomerPaymentTender(row: Tender): boolean {
  const evidence = (row as ProvenTender)[proof];
  return evidence !== undefined && row.id === evidence.id && row.salonId === evidence.salonId
    && row.appointmentId === evidence.appointmentId && row.amountCents === evidence.amountCents
    && row.reference === `customer_payment_capture:${evidence.id.slice(5)}` && row.voidedAt === null
    && row.method === 'online' && row.recordedByType === 'system';
}

/** Read-only gross/net evidence. A net balance never grants permission to collect. */
export function customerPaymentTenderSummary(row: Tender) {
  if (!hasVerifiedCustomerPaymentTender(row)) {
    throw new Error('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
  }
  const evidence = (row as ProvenTender)[proof]!;
  return Object.freeze({ grossCents: evidence.amountCents, grossTipCents: evidence.tipCents, refundedPrincipalCents: evidence.refundedPrincipalCents, refundedTipCents: evidence.refundedTipCents, refundedCents: evidence.refundedCents, netCents: evidence.netCents, collectionHold: evidence.collectionHold });
}

export function customerPaymentTipFloor(rows: readonly Tender[]): number {
  let tip = 0;
  for (const row of rows) {
    if (!isCustomerPaymentTender(row)) {
      continue;
    }
    if (!hasVerifiedCustomerPaymentTender(row)) {
      throw new Error('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
    }
    const summary = customerPaymentTenderSummary(row);
    if (summary.collectionHold) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED');
    }
    tip += summary.grossTipCents;
    if (!Number.isSafeInteger(tip)) {
      throw new TypeError('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
    }
  }
  return tip;
}

export function customerPaymentCompletionTip(rows: readonly Tender[], requestedTip: number | undefined, storedTip: number): number {
  const floor = customerPaymentTipFloor(rows);
  const tip = requestedTip ?? (rows.some(isCustomerPaymentTender) ? Math.max(storedTip, floor) : 0);
  if (!Number.isSafeInteger(tip) || tip < floor) {
    throw new Error('CUSTOMER_PAYMENT_PREPAID_TIP_REQUIRED');
  }
  return tip;
}
