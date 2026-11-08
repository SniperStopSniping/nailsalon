import type { ProviderCaptureCandidate, ProviderCorrelationInput } from './correlation';
import { correlateProviderFixture, providerCorrelationFingerprint } from './correlation';
import type { VerifiedProviderReceipt } from './evidence';
import type { OperationState } from './operations';
import { validateOperationState } from './operations';
import type { VerifiedRefundEvidence } from './refundEvidence';

export type ProviderRefundCorrelationInput = {
  parent: ProviderCorrelationInput;
  operation: OperationState;
  /** Complete current movement closure, including unclaimed sibling movements. */
  movements: readonly { inboxId: string; receipt: VerifiedProviderReceipt; hasConflict: boolean; refund: VerifiedRefundEvidence | null }[];
  /** Current parent capture or movement ownership/fact conflict, not a saved flag. */
  ownershipConflict: boolean;
};
export type ProviderRefundCandidate = Readonly<{
  kind: 'customer_refund' | 'application_fee_refund';
  movementKey: Readonly<{ platformId: string; accountScope: 'connected' | 'platform'; accountId: string | null; mode: 'test'; kind: 'customer_refund' | 'application_fee_refund'; movementId: string }>;
  parentChargeKey: ProviderCaptureCandidate['chargeKey'];
  operationId: string;
  chargeId: string;
  paymentIntentId: string;
  applicationFeeId: string | null;
  amountCents: number;
  currency: 'cad';
  fingerprint: string;
}>;
export type ProviderRefundCorrelationResult = Readonly<{
  source: 'offline_fixture_refund_correlation';
  state: 'pending' | 'correlated' | 'review';
  reasons: readonly string[];
  financialPostingAllowed: false;
  parentCaptureFingerprint: string | null;
  candidate: ProviderRefundCandidate | null;
  /** Successful distinct movements after a complete scan; null means unknown, never zero cash. */
  totals: Readonly<{ customerRefundCents: number; applicationFeeRefundCents: number }> | null;
}>;
const movementEvents = new Set(['refund.created', 'refund.updated', 'refund.failed', 'application_fee.refund.updated']);
const harmless = new Set(['UNMATCHED_OBJECT', 'INSUFFICIENT_MONEY_EXPECTATION', 'INSUFFICIENT_RELATIONSHIP_EXPECTATION']);
const id = (value: unknown, prefix: string): value is string => typeof value === 'string' && value.length <= 255 && value.startsWith(prefix) && /^[A-Z0-9]+$/i.test(value.slice(prefix.length));
const seconds = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 253402300799;

/** Pure, persisted-fixture DTO projection. Never settlement or hold-clearing authority. */
export function correlateProviderRefundFixture(input: ProviderRefundCorrelationInput): ProviderRefundCorrelationResult {
  let parentCaptureFingerprint: string | null = null;
  let candidate: ProviderRefundCandidate | null = null;
  let customerRefundCents = 0;
  let applicationFeeRefundCents = 0;
  let totalsComplete = false;
  const finish = (state: ProviderRefundCorrelationResult['state'], reason?: string): ProviderRefundCorrelationResult => Object.freeze({
    source: 'offline_fixture_refund_correlation',
    state,
    reasons: Object.freeze(reason ? [reason] : []),
    financialPostingAllowed: false,
    parentCaptureFingerprint,
    candidate,
    totals: totalsComplete ? Object.freeze({ customerRefundCents, applicationFeeRefundCents }) : null,
  });
  if (input.ownershipConflict !== false || input.movements.length > 256) {
    return finish('review', 'MOVEMENT_OWNERSHIP_OR_LIMIT');
  }
  try {
    validateOperationState(input.operation);
  } catch {
    return finish('review', 'INVALID_REFUND_OPERATION');
  }
  const op = input.operation;
  const identity = op.identity;
  const parentIdentity = input.parent.operation.identity;
  if (!['customer_refund', 'application_fee_refund'].includes(identity.kind)
    || identity.salonId !== parentIdentity.salonId || identity.appointmentId !== parentIdentity.appointmentId
    || identity.quoteId !== parentIdentity.quoteId || identity.contextHash !== parentIdentity.contextHash
    || identity.platformId !== parentIdentity.platformId || identity.apiVersion !== parentIdentity.apiVersion
    || identity.mode !== 'test' || (identity.kind === 'customer_refund' && identity.accountId !== parentIdentity.accountId)) {
    return finish('review', 'REFUND_OPERATION_PARENT_MISMATCH');
  }
  const movementMap = new Map<string, ProviderRefundCorrelationInput['movements'][number]>();
  for (const m of input.movements) {
    const original = input.parent.receipts.filter(r => r.inboxId === m.inboxId);
    if (m.hasConflict !== false || !movementEvents.has(m.receipt.eventType ?? '') || original.length !== 1
      || original[0]!.hasConflict !== false || providerCorrelationFingerprint(original[0]!.receipt) !== providerCorrelationFingerprint(m.receipt)) {
      return finish('review', 'MOVEMENT_CLOSURE_MISMATCH');
    }
    if (movementMap.has(m.inboxId)) {
      return finish('review', 'DUPLICATE_MOVEMENT_DESCRIPTOR');
    }
    movementMap.set(m.inboxId, m);
  }
  if (input.parent.receipts.some(r => movementEvents.has(r.receipt.eventType ?? '') && !movementMap.has(r.inboxId))) {
    return finish('review', 'MOVEMENT_CLOSURE_INCOMPLETE');
  }
  // Independent authenticated blockers take precedence even if parent evidence
  // or a supplement is incomplete. This does not infer missing relationships.
  for (const { receipt: r, refund: s } of movementMap.values()) {
    const feeReceipt = r.eventType === 'application_fee.refund.updated';
    const allowed = new Set(harmless);
    if (!feeReceipt && ['pending', 'requires_action', 'failed', 'canceled'].includes(String(r.normalizedFacts.status))) {
      allowed.add('UNSUPPORTED_OBJECT_STATE');
    }
    if (r.eventType === 'refund.failed' && s?.status === 'failed') {
      allowed.add('UNSUPPORTED_EVENT_OR_OBJECT');
      allowed.add('INVALID_MONEY_FACTS');
    }
    if (r.platformId !== parentIdentity.platformId || r.mode !== 'test' || r.apiVersion !== parentIdentity.apiVersion
      || (feeReceipt
        ? r.accountScope !== 'platform' || r.accountId !== null || r.expectedAccountId !== null
        : r.accountScope !== 'connected' || r.accountId !== parentIdentity.accountId || r.expectedAccountId !== parentIdentity.accountId)
        || r.reviewReasons.some(reason => !allowed.has(reason))
        || ['failed', 'canceled', 'requires_action'].includes(String(r.normalizedFacts.status))) {
      return finish('review', 'MOVEMENT_ORIGINAL_REVIEW');
    }
  }
  const parent = correlateProviderFixture({ ...input.parent, receipts: input.parent.receipts.filter(r => !movementMap.has(r.inboxId)) });
  const capture = parent.captureCandidate;
  if (parent.state !== 'correlated' || !capture) {
    return finish(parent.state === 'pending' ? 'pending' : 'review', 'PARENT_CAPTURE_UNPROVEN');
  }
  parentCaptureFingerprint = capture.fingerprint;
  const groups = new Map<string, VerifiedRefundEvidence[]>();
  let missingSupplement = false;
  const rawFacts = new Map<string, string>();
  for (const { receipt: r, refund: s } of movementMap.values()) {
    if (r.version !== 1 || r.source !== 'offline_signed_fixture' || !id(r.eventId, 'evt_') || r.receiptIdentity !== r.eventId
      || !/^[a-f0-9]{64}$/.test(r.payloadDigest) || !Number.isFinite(Date.parse(r.receivedAt))
      || !['accepted', 'review'].includes(r.classification) || !Array.isArray(r.reviewReasons)) {
      return finish('review', 'MOVEMENT_EVIDENCE_UNPROVEN');
    }
    const feeReceipt = r.eventType === 'application_fee.refund.updated';
    if (r.platformId !== parentIdentity.platformId || r.mode !== 'test' || r.apiVersion !== parentIdentity.apiVersion
      || (feeReceipt
        ? r.accountScope !== 'platform' || r.accountId !== null || r.expectedAccountId !== null
        : r.accountScope !== 'connected' || r.accountId !== capture.chargeKey.accountId || r.expectedAccountId !== capture.chargeKey.accountId)) {
      return finish('review', 'MOVEMENT_FACTS_MISMATCH');
    }
    const factsKey = `${feeReceipt}:${r.objectId}`;
    const factsHash = providerCorrelationFingerprint({ amount: r.normalizedFacts.amountCents, currency: r.normalizedFacts.currency, charge: r.normalizedFacts.chargeId, intent: r.normalizedFacts.paymentIntentId, fee: r.normalizedFacts.applicationFeeId });
    if (rawFacts.has(factsKey) && rawFacts.get(factsKey) !== factsHash) {
      return finish('review', 'MOVEMENT_IMMUTABLE_FACTS_CONFLICT');
    }
    rawFacts.set(factsKey, factsHash);
    if (!s) {
      missingSupplement = true;
      if (r.reviewReasons.some(reason => !harmless.has(reason) && reason !== 'UNSUPPORTED_OBJECT_STATE')
        || ['failed', 'canceled', 'requires_action'].includes(String(r.normalizedFacts.status))
        || r.normalizedFacts.currency !== 'cad' || !Number.isSafeInteger(r.normalizedFacts.amountCents)
        || Number(r.normalizedFacts.amountCents) <= 0 || Number(r.normalizedFacts.amountCents) > 50_000_000
        || (feeReceipt
          ? (r.normalizedFacts.applicationFeeId !== parent.fee.feeId
            || (r.normalizedFacts.chargeId !== null && r.normalizedFacts.chargeId !== capture.chargeKey.chargeId)
            || (r.normalizedFacts.paymentIntentId !== null && r.normalizedFacts.paymentIntentId !== capture.paymentIntentId))
          : r.normalizedFacts.paymentIntentId !== capture.paymentIntentId || r.normalizedFacts.chargeId !== capture.chargeKey.chargeId)
          || (op.result && 'objectId' in op.result && r.objectId === op.result.objectId
            && identity.kind !== 'checkout_create' && r.normalizedFacts.amountCents !== identity.parameters.amount)) {
        return finish('review', 'MOVEMENT_ORIGINAL_REVIEW');
      }
      continue;
    }
    if (r.version !== 1 || r.source !== 'offline_signed_fixture' || !id(r.eventId, 'evt_') || r.receiptIdentity !== r.eventId
      || !/^[a-f0-9]{64}$/.test(r.payloadDigest) || !Number.isFinite(Date.parse(r.receivedAt))
      || !['accepted', 'review'].includes(r.classification) || !Array.isArray(r.reviewReasons)
      || s.version !== 1 || s.projectionVersion !== 1 || s.source !== 'offline_signed_fixture_refund'
      || !Number.isFinite(Date.parse(s.receivedAt)) || s.classification !== 'correlatable' || s.reviewReasons.length !== 0) {
      return finish('review', 'MOVEMENT_EVIDENCE_UNPROVEN');
    }
    for (const key of ['payloadDigest', 'eventId', 'eventType', 'receiptIdentity', 'endpointId', 'platformId', 'accountScope', 'expectedAccountId', 'accountId', 'mode', 'apiVersion'] as const) {
      if (s[key] !== r[key]) {
        return finish('review', 'MOVEMENT_RECEIPT_BINDING_MISMATCH');
      }
    }
    // refund.failed is unsupported by the old normalizer; only its exact signed
    // supplemental failure can explain that limitation, never make it success.
    const allowed = new Set(harmless);
    if (s.kind === 'customer_refund' && ['pending', 'requires_action', 'failed', 'canceled'].includes(s.status ?? '') && s.outcome === s.status) {
      allowed.add('UNSUPPORTED_OBJECT_STATE');
    }
    if (r.eventType === 'refund.failed' && s.status === 'failed') {
      allowed.add('UNSUPPORTED_EVENT_OR_OBJECT');
      allowed.add('INVALID_MONEY_FACTS');
    }
    if (r.reviewReasons.some(reason => !allowed.has(reason)) || (r.classification === 'review' && !r.reviewReasons.length)) {
      return finish('review', 'MOVEMENT_ORIGINAL_REVIEW');
    }
    const customer = s.kind === 'customer_refund';
    if (customer ? !['refund.created', 'refund.updated', 'refund.failed'].includes(r.eventType ?? '') : r.eventType !== 'application_fee.refund.updated') {
      return finish('review', 'MOVEMENT_KIND_EVENT_MISMATCH');
    }
    if (!['customer_refund', 'application_fee_refund'].includes(s.kind ?? '') || s.movementId !== r.objectId
      || !id(s.movementId, customer ? 're_' : 'fr_') || r.platformId !== parentIdentity.platformId
      || r.mode !== 'test' || r.apiVersion !== parentIdentity.apiVersion || s.currency !== 'cad'
      || !Number.isSafeInteger(s.amountCents) || s.amountCents! <= 0 || s.amountCents! > 50_000_000
      || (customer
        ? (r.accountScope !== 'connected' || r.accountId !== capture.chargeKey.accountId || r.expectedAccountId !== capture.chargeKey.accountId
          || s.paymentIntentId !== capture.paymentIntentId || s.chargeId !== capture.chargeKey.chargeId || s.applicationFeeId !== null)
        : (r.accountScope !== 'platform' || r.accountId !== null || r.expectedAccountId !== null
          || (s.chargeId !== null && s.chargeId !== capture.chargeKey.chargeId)
          || (s.paymentIntentId !== null && s.paymentIntentId !== capture.paymentIntentId)
          || !parent.fee.feeId || s.applicationFeeId !== parent.fee.feeId || s.status !== null || s.outcome !== 'fee_return_observed'))) {
      return finish('review', 'MOVEMENT_FACTS_MISMATCH');
    }
    const parentTimes = input.parent.receipts.filter(({ receipt }) => receipt.eventType === (customer ? 'charge.succeeded' : 'application_fee.created')
      && receipt.objectId === (customer ? capture.chargeKey.chargeId : parent.fee.feeId)).map(({ receipt }) => receipt.normalizedFacts.created);
    const earliestParentTime = Math.min(...parentTimes.map(value => typeof value === 'number' ? value : Number.NaN));
    if (!seconds(earliestParentTime) || !seconds(s.eventCreated) || !seconds(s.objectCreated) || s.objectCreated > s.eventCreated
      || s.objectCreated < earliestParentTime
      || s.eventCreated > Math.floor(Date.parse(r.receivedAt) / 1000)) {
      return finish('review', 'MOVEMENT_TIME_INVALID');
    }
    const key = `${s.kind}:${s.movementId}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const successful = new Map<string, VerifiedRefundEvidence>();
  let hasPending = false;
  for (const [key, group] of groups) {
    const first = group[0]!;
    if (group.some(s => s.amountCents !== first.amountCents || s.currency !== first.currency || s.paymentIntentId !== first.paymentIntentId
      || s.chargeId !== first.chargeId || s.applicationFeeId !== first.applicationFeeId || s.objectCreated !== first.objectCreated)) {
      return finish('review', 'MOVEMENT_IMMUTABLE_FACTS_CONFLICT');
    }
    if (first.kind === 'customer_refund') {
      if (group.some(s => !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(s.status ?? '') || s.outcome !== s.status
        || s.status === 'failed' || s.status === 'canceled' || s.status === 'requires_action')) {
        return finish('review', 'CUSTOMER_REFUND_NOT_SUCCESSFUL');
      }
      const succeeded = group.filter(s => s.status === 'succeeded');
      if (!succeeded.length) {
        hasPending = true;
        continue;
      }
      if (group.some(s => s.status === 'pending' && s.eventCreated! >= Math.min(...succeeded.map(s => s.eventCreated!)))) {
        return finish('review', 'REFUND_LIFECYCLE_CONFLICT');
      }
      customerRefundCents += first.amountCents!;
    } else {
      applicationFeeRefundCents += first.amountCents!;
    }
    successful.set(key, first);
  }
  totalsComplete = !missingSupplement;
  if (customerRefundCents > capture.amountCents || applicationFeeRefundCents > capture.applicationFeeCents) {
    return finish('review', 'CUMULATIVE_REFUND_EXCEEDS_PARENT');
  }
  if (['failed', 'review'].includes(op.state)) {
    return finish('review', 'REFUND_OPERATION_NOT_SUCCESSFUL');
  }
  if (op.state !== 'succeeded' || !op.result || !('objectId' in op.result)) {
    return finish('pending', 'REFUND_OPERATION_RESULT_MISSING');
  }
  const own = successful.get(`${identity.kind}:${op.result.objectId}`);
  if (!own) {
    return finish('pending', 'REFUND_SUCCESS_EVIDENCE_MISSING');
  }
  if (identity.kind === 'checkout_create' || own.amountCents !== identity.parameters.amount || op.firstDispatchedAt === null
    || own.objectCreated! < Math.floor(op.firstDispatchedAt / 1000)
    || (identity.kind === 'customer_refund' ? identity.targetId !== capture.paymentIntentId : identity.targetId !== parent.fee.feeId)) {
    return finish('review', 'REFUND_OPERATION_FACTS_MISMATCH');
  }
  if (missingSupplement) {
    return finish('pending', 'MOVEMENT_SUPPLEMENT_MISSING');
  }
  const movementKey = Object.freeze({ platformId: identity.platformId, accountScope: identity.accountScope, accountId: identity.accountId, mode: 'test' as const, kind: identity.kind as ProviderRefundCandidate['kind'], movementId: own.movementId! });
  const facts = { kind: identity.kind as ProviderRefundCandidate['kind'], movementKey, parentChargeKey: capture.chargeKey, chargeId: capture.chargeKey.chargeId, paymentIntentId: capture.paymentIntentId, applicationFeeId: own.applicationFeeId, amountCents: own.amountCents!, currency: 'cad' as const };
  candidate = Object.freeze({ ...facts, operationId: identity.id, fingerprint: providerCorrelationFingerprint(facts) });
  return finish(hasPending ? 'pending' : 'correlated', hasPending ? 'SIBLING_REFUND_PENDING' : undefined);
}
