/** Minimal, versioned provider evidence. Metadata never grants payment ownership. */
export type ReceiptProjection = {
  schemaVersion: 1;
  kind: 'refund' | 'charge' | 'dispute';
  objectId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  failureReason: string | null;
  deficiency: string | null;
};

export function isShadowEvent(type: string): boolean {
  return type.startsWith('refund.') || type === 'charge.refund.updated'
    || type === 'charge.refunded' || type.startsWith('charge.dispute.');
}

const supportedEvents = new Set([
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.refund.updated',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
]);

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function providerId(value: unknown): string | null {
  const id = typeof value === 'string' ? value : record(value).id;
  return typeof id === 'string' && /^[a-z]+_\w{1,240}$/.test(id) ? id : null;
}

export function shortText(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 256 ? value : null;
}

export function minorUnits(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    && value <= 2_147_483_647
    ? value
    : null;
}

export function projectShadowEvent(type: string, object: unknown): ReceiptProjection {
  const obj = record(object);
  const kind = type.startsWith('charge.dispute.')
    ? 'dispute'
    : type === 'charge.refunded' ? 'charge' : 'refund';
  const objectId = providerId(obj.id);
  const paymentIntentId = providerId(obj.payment_intent);
  const chargeId = kind === 'charge' ? objectId : providerId(obj.charge);
  return {
    schemaVersion: 1,
    kind,
    objectId,
    paymentIntentId,
    chargeId,
    status: shortText(obj.status),
    amount: minorUnits(obj.amount),
    currency: shortText(obj.currency),
    failureReason: shortText(obj.failure_reason ?? obj.code),
    deficiency: !supportedEvents.has(type)
      ? 'unsupported_event'
      : !objectId || (!paymentIntentId && !chargeId) ? 'missing_identity' : null,
  };
}

export type RefundFact = {
  id: string;
  chargeId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  failureReason: string | null;
  pendingReason?: string | null;
  nextActionType?: string | null;
  failureBalanceTransaction?: string | null;
  created: number | null;
};
export type CollectionFact = {
  id: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  paid: boolean;
  captured: boolean;
  amountCaptured: number;
  disputed: boolean | null;
  amountRefunded: number;
};
export type DisputeFact = {
  id: string;
  chargeId: string;
  paymentIntentId: string | null;
  amount: number;
  currency: string;
  status: string;
  // A provider balance debit/closed label never establishes beneficiary repayment.
  provisionalDebit: number | null;
  reimbursedPrincipal: number | null;
  restoredPrincipal: number | null;
  fees: number | null;
};
export type Observation = {
  cycleId?: string;
  account: string;
  livemode: boolean;
  collection: CollectionFact;
  refunds: RefundFact[];
  disputes: DisputeFact[];
  pagesComplete: boolean;
  disputePagesComplete: boolean;
  requestIds: string[];
  progress?: import('./shadowProgress').ShadowProgress | null;
};

export function assessObservation(input: {
  observation: Observation;
  paymentIntentId: string;
  chargeId: string | null;
  amount: number;
  currency: string;
  knownRefundIds: string[];
  unresolvedCommand: boolean;
}): { reason: string | null; succeeded: number; reserved: number; identityValid: boolean } {
  const { observation: o } = input;
  let succeeded = 0;
  let reserved = 0;
  let reason: string | null = null;
  let identityValid = true;
  const ids = new Set<string>();
  if (!o.pagesComplete || !o.disputePagesComplete) {
    reason = 'incomplete_pages';
  }
  if (!o.collection.paid || !o.collection.captured || o.collection.amountCaptured !== input.amount || o.collection.paymentIntentId !== input.paymentIntentId
    || (input.chargeId !== null && o.collection.id !== input.chargeId)
    || o.collection.amount !== input.amount || o.collection.currency !== input.currency
    || !providerId(o.collection.id)) {
    reason = 'collection_identity_conflict';
    identityValid = false;
  }
  for (const refund of o.refunds) {
    if (!providerId(refund.id) || refund.chargeId !== o.collection.id
      || refund.paymentIntentId !== input.paymentIntentId || refund.currency !== input.currency
      || minorUnits(refund.amount) === null || refund.amount === 0) {
      reason = 'refund_identity_conflict';
      identityValid = false;
      continue;
    }
    // A repeated ID does not grant the later occurrence the first one's identity.
    if (ids.has(refund.id)) {
      identityValid = false;
      reason = 'duplicate_refund';
      continue;
    }
    ids.add(refund.id);
    if (refund.status === 'succeeded') {
      succeeded += refund.amount;
    } else if (refund.status === 'pending' || refund.status === 'requires_action') {
      reserved += refund.amount;
      reason = 'refund_pending';
    } else if (refund.status === 'failed' || refund.status === 'canceled') {
      reason = 'external_intent_unresolved';
    } else {
      reason = 'unsupported_refund_status';
    }
    if (['charge_for_pending_refund_disputed', 'charge_disputed', 'refund_disputed_payment']
      .includes(refund.failureReason ?? '')) {
      reason = 'dispute_related_refund';
    }
  }
  if (input.knownRefundIds.some(id => !ids.has(id))) {
    reason = 'known_refund_missing';
  }
  if (minorUnits(succeeded + reserved) === null || succeeded + reserved > input.amount
    || o.collection.amountRefunded !== succeeded) {
    reason = 'principal_contradiction';
  }
  if (input.unresolvedCommand) {
    reason = 'legacy_operation_unknown';
  }
  if (o.collection.disputed !== false || o.disputes.length > 0) {
    reason = 'dispute_principal_unresolved';
  }
  const disputeIds = new Set<string>();
  for (const dispute of o.disputes) {
    if (!providerId(dispute.id) || disputeIds.has(dispute.id)
      || dispute.chargeId !== o.collection.id
      || (dispute.paymentIntentId !== null && dispute.paymentIntentId !== input.paymentIntentId)
      || dispute.currency !== input.currency || minorUnits(dispute.amount) === null) {
      reason = 'dispute_identity_conflict';
      identityValid = false;
    }
    disputeIds.add(dispute.id);
  }
  return { reason, succeeded, reserved, identityValid };
}
