import { createHash } from 'node:crypto';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';

import type { VerifiedProviderReceipt } from './evidence';
import type { OperationState } from './operations';
import { validateOperationState } from './operations';
import type { VerifiedCheckoutSessionEvidence } from './sessionEvidence';

export type CustomerPaymentCorrelationQuote = {
  id: string;
  salonId: string;
  appointmentId: string;
  stripeAccountId: string;
  mode: string;
  fingerprint: string;
  createdAt: Date;
  expiresAt: Date;
  snapshot: { currency: string; chargeCents: number; applicationFeeCents: number };
};
export type ProviderCorrelationInput = {
  operation: OperationState;
  quote: CustomerPaymentCorrelationQuote;
  /** Complete bounded candidate closure, not a tenant-wide unrelated inbox dump. */
  receipts: readonly { inboxId: string; receipt: VerifiedProviderReceipt; hasConflict: boolean }[];
  sessions: readonly { inboxId: string; session: VerifiedCheckoutSessionEvidence }[];
  now: Date;
};
export type ProviderCaptureCandidate = Readonly<{
  chargeKey: Readonly<{ platformId: string; accountId: string; mode: 'test'; chargeId: string }>;
  fingerprint: string;
  sessionId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: 'cad';
  /** Quoted expectation only. Actual fee agreement is independently projected. */
  applicationFeeCents: number;
}>;
export type ProviderCorrelationResult = Readonly<{
  source: 'offline_fixture_correlation';
  state: 'pending' | 'correlated' | 'review';
  reasons: readonly string[];
  financialPostingAllowed: false;
  captureCandidate: ProviderCaptureCandidate | null;
  fee: Readonly<{ state: 'pending' | 'matched' | 'not_required' | 'review'; feeId: string | null }>;
}>;

/** Stable identity/audit digest. No undefined, dates, sparse arrays or coercion. */
export function providerCorrelationFingerprint(value: unknown): string {
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
    if (input !== null && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
      return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${canonical((input as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    throw new Error('CUSTOMER_PAYMENT_CORRELATION_INVALID_FINGERPRINT');
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}
const harmless = new Set(['UNMATCHED_OBJECT', 'INSUFFICIENT_MONEY_EXPECTATION', 'INSUFFICIENT_RELATIONSHIP_EXPECTATION']);
const sessionParserLimitations = new Set([...harmless, 'UNSUPPORTED_EVENT_OR_OBJECT', 'INVALID_MONEY_FACTS', 'INVALID_OBJECT_IDENTITY', 'OBJECT_IDENTITY_MISMATCH']);
const id = (value: unknown, prefix: string): value is string => typeof value === 'string' && value.length <= 255
  && value.startsWith(prefix) && /^[A-Z0-9]+$/i.test(value.slice(prefix.length));
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_SUPPORTED_MINOR_UNIT_AMOUNT;
const time = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 253402300799;
const date = (value: Date) => value instanceof Date && Number.isSafeInteger(value.getTime());

/**
 * Correlates retained, authenticated FIXTURE evidence loaded by a trusted journal.
 * Structural DTOs are not rebranded here. Output is never settlement, balance or
 * collectibility authority; existing inbox review and synthetic ledgers stay unchanged.
 */
export function correlateProviderFixture(input: ProviderCorrelationInput): ProviderCorrelationResult {
  const reasons = new Set<string>();
  let captureCandidate: ProviderCaptureCandidate | null = null;
  let fee: ProviderCorrelationResult['fee'] = Object.freeze({ state: 'pending', feeId: null });
  const finish = (state: ProviderCorrelationResult['state']): ProviderCorrelationResult => Object.freeze({
    source: 'offline_fixture_correlation',
    state,
    reasons: Object.freeze([...reasons].sort()),
    financialPostingAllowed: false,
    captureCandidate,
    fee,
  });
  const review = (reason: string) => {
    reasons.add(reason);
    return finish('review');
  };
  const pending = (reason: string) => {
    reasons.add(reason);
    if (date(input.now) && date(input.quote.expiresAt) && input.now >= input.quote.expiresAt) {
      reasons.add('QUOTE_EXPIRED_WITH_INCOMPLETE_EVIDENCE');
      return finish('review');
    }
    return finish('pending');
  };
  try {
    validateOperationState(input.operation);
  } catch {
    return review('INVALID_OPERATION');
  }
  const op = input.operation;
  const identity = op.identity;
  const q = input.quote;
  if (!date(input.now) || !date(q.createdAt) || !date(q.expiresAt) || q.expiresAt <= q.createdAt
    || identity.kind !== 'checkout_create' || identity.accountScope !== 'connected'
    || q.id !== identity.quoteId || q.salonId !== identity.salonId || q.appointmentId !== identity.appointmentId
    || q.stripeAccountId !== identity.accountId || q.mode !== 'test' || q.fingerprint !== identity.contextHash
    || q.snapshot.currency !== 'cad' || !cents(q.snapshot.chargeCents) || q.snapshot.chargeCents <= 0
    || !cents(q.snapshot.applicationFeeCents) || q.snapshot.applicationFeeCents >= q.snapshot.chargeCents
    || identity.parameters.client_reference_id !== q.id
    || identity.parameters.line_items[0].price_data.unit_amount !== q.snapshot.chargeCents
    || identity.parameters.payment_intent_data.application_fee_amount !== q.snapshot.applicationFeeCents) {
    return review('QUOTE_OPERATION_MISMATCH');
  }
  if (['failed', 'review'].includes(op.state)) {
    return review('OPERATION_NOT_SUCCESSFUL');
  }
  if (op.state !== 'succeeded' || !op.result || !('objectId' in op.result)) {
    return pending('OPERATION_RESULT_MISSING');
  }
  if (!id(op.result.objectId, 'cs_test_')) {
    return review('SESSION_RESULT_IDENTITY_INVALID');
  }
  if (op.firstDispatchedAt === null || op.firstDispatchedAt < q.createdAt.getTime() || op.firstDispatchedAt >= q.expiresAt.getTime()) {
    return review('QUOTE_STALE_AT_DISPATCH');
  }
  if (input.receipts.length > 256 || input.sessions.length > 256) {
    return review('EVIDENCE_LIMIT');
  }
  const receipts = new Map<string, VerifiedProviderReceipt>();
  const sessions = new Map<string, VerifiedCheckoutSessionEvidence>();
  for (const item of input.receipts) {
    const r = item.receipt;
    if (!item.inboxId?.trim() || item.hasConflict !== false || r.version !== 1 || r.source !== 'offline_signed_fixture'
      || !/^[a-f0-9]{64}$/.test(r.payloadDigest) || !id(r.eventId, 'evt_') || r.receiptIdentity !== r.eventId
      || !Number.isFinite(Date.parse(r.receivedAt)) || !['accepted', 'review'].includes(r.classification)
      || !Array.isArray(r.reviewReasons)) {
      return review('INBOX_EVIDENCE_CONFLICT');
    }
    if (r.platformId !== identity.platformId || r.mode !== 'test' || r.apiVersion !== identity.apiVersion) {
      return review('EVIDENCE_SCOPE_MISMATCH');
    }
    const isFee = r.eventType === 'application_fee.created';
    if (isFee
      ? (r.accountScope !== 'platform' || r.accountId !== null || r.expectedAccountId !== null)
      : (r.accountScope !== 'connected' || r.accountId !== identity.accountId || r.expectedAccountId !== identity.accountId)) {
      return review('EVIDENCE_ACCOUNT_MISMATCH');
    }
    const prior = receipts.get(item.inboxId);
    if (prior && providerCorrelationFingerprint(prior) !== providerCorrelationFingerprint(r)) {
      return review('INBOX_IDENTITY_CONFLICT');
    }
    receipts.set(item.inboxId, r);
  }
  for (const item of input.sessions) {
    const r = receipts.get(item.inboxId);
    const s = item.session;
    if (!r || s.version !== 1 || s.projectionVersion !== 1 || s.source !== 'offline_signed_fixture_session' || s.classification !== 'correlatable' || s.reviewReasons.length !== 0) {
      return review('SESSION_EVIDENCE_UNPROVEN');
    }
    for (const key of ['payloadDigest', 'eventId', 'eventType', 'receiptIdentity', 'endpointId', 'platformId', 'accountScope', 'expectedAccountId', 'accountId', 'mode', 'apiVersion'] as const) {
      if (s[key] !== r[key]) {
        return review('SESSION_RECEIPT_BINDING_MISMATCH');
      }
    }
    if (!Number.isFinite(Date.parse(s.receivedAt)) || s.sessionId !== r.objectId || !['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(s.eventType ?? '')
      || s.sessionId !== op.result.objectId || !id(s.paymentIntentId, 'pi_') || s.sessionMode !== 'payment'
      || !['complete', 'expired'].includes(s.status ?? '') || !['paid', 'unpaid'].includes(s.paymentStatus ?? '') || s.currency !== 'cad'
      || s.amountTotalCents !== q.snapshot.chargeCents || s.clientReferenceId !== q.id
      || !time(s.eventCreated) || !time(s.sessionCreated) || !time(s.expiresAt)
      || s.sessionCreated < Math.floor(op.firstDispatchedAt / 1000) || s.sessionCreated > s.eventCreated || (s.paymentStatus === 'paid' && s.eventCreated >= s.expiresAt)) {
      return review('SESSION_FACTS_MISMATCH');
    }
    const previous = sessions.get(item.inboxId);
    if (previous && providerCorrelationFingerprint(previous) !== providerCorrelationFingerprint(s)) {
      return review('SESSION_PROJECTION_CONFLICT');
    }
    sessions.set(item.inboxId, s);
  }
  const pis: VerifiedProviderReceipt[] = [];
  const charges: VerifiedProviderReceipt[] = [];
  const fees: VerifiedProviderReceipt[] = [];
  let missingSessionProjection = false;
  for (const [inboxId, r] of receipts) {
    const s = sessions.get(inboxId);
    if (!s && r.eventType?.startsWith('checkout.session.')) {
      missingSessionProjection = true;
      continue;
    }
    const allowed = s ? sessionParserLimitations : harmless;
    if (r.reviewReasons.some(reason => !allowed.has(reason)) || (r.classification === 'review' && r.reviewReasons.length === 0)) {
      return review('AUTHENTICATED_EVIDENCE_REQUIRES_REVIEW');
    }
    const created = s?.eventCreated ?? r.normalizedFacts.created;
    if (!time(created) || created < Math.floor(op.firstDispatchedAt / 1000)
      || created > Math.floor(Date.parse(r.receivedAt) / 1000)) {
      return review('EVIDENCE_TIME_INVALID');
    }
    // Fee delivery can occur later; it does not move customer cash.
    if (r.eventType !== 'application_fee.created' && (!s || s.paymentStatus === 'paid') && created * 1000 + 999 >= q.expiresAt.getTime()) {
      return review('MONEY_LATE_OR_EXPIRY_AMBIGUOUS');
    }
    if (s) {
      continue;
    }
    if (r.eventType === 'payment_intent.succeeded') {
      pis.push(r);
    } else if (r.eventType === 'charge.succeeded') {
      charges.push(r);
    } else if (r.eventType === 'application_fee.created') {
      fees.push(r);
    } else {
      return review('UNSUPPORTED_CUSTOMER_MOVEMENT');
    }
  }
  if (missingSessionProjection) {
    return pending('SESSION_PROJECTION_MISSING');
  }
  if (sessions.size === 0) {
    return pending('SESSION_EVIDENCE_MISSING');
  }
  const sessionList = [...sessions.values()];
  const session = sessionList[0]!;
  if (sessionList.some(s => s.sessionId !== session.sessionId || s.paymentIntentId !== session.paymentIntentId
    || s.sessionCreated !== session.sessionCreated || s.expiresAt !== session.expiresAt)) {
    return review('SESSION_RELATIONSHIP_CONFLICT');
  }
  if (sessionList.some(s => s.status === 'expired' || s.eventType === 'checkout.session.async_payment_failed')) {
    return review('SESSION_EXPIRED_OR_FAILED');
  }
  const paidSessions = sessionList.filter(s => s.paymentStatus === 'paid');
  if (paidSessions.length === 0) {
    return pending('SESSION_NOT_PAID');
  }
  const earliestPaidTime = Math.min(...paidSessions.map(s => s.eventCreated!));
  if (sessionList.some(s => s.paymentStatus === 'unpaid' && s.eventCreated! >= earliestPaidTime)) {
    return review('SESSION_STATE_TRANSITION_AMBIGUOUS');
  }
  if (pis.length === 0) {
    return pending('PAYMENT_INTENT_EVIDENCE_MISSING');
  }
  const pi = pis[0]!;
  if (pis.some(r => r.objectId !== session.paymentIntentId || r.normalizedFacts.objectType !== 'payment_intent'
    || r.normalizedFacts.objectLivemode !== false || r.normalizedFacts.status !== 'succeeded'
    || r.normalizedFacts.amountCents !== q.snapshot.chargeCents || r.normalizedFacts.objectAmountCents !== q.snapshot.chargeCents
    || r.normalizedFacts.amountReceivedCents !== q.snapshot.chargeCents || r.normalizedFacts.currency !== 'cad'
    || r.normalizedFacts.chargeId !== pi.normalizedFacts.chargeId)) {
    return review('PAYMENT_INTENT_FACTS_CONFLICT');
  }
  const chargeId = pi.normalizedFacts.chargeId;
  if (!id(chargeId, 'ch_')) {
    return pending('CHARGE_RELATIONSHIP_MISSING');
  }
  if (charges.length === 0) {
    return pending('CHARGE_EVIDENCE_MISSING');
  }
  const charge = charges[0]!;
  if (charges.some(r => r.objectId !== chargeId || r.normalizedFacts.objectType !== 'charge' || r.normalizedFacts.objectLivemode !== false
    || r.normalizedFacts.paymentIntentId !== session.paymentIntentId || r.normalizedFacts.currency !== 'cad'
    || r.normalizedFacts.amountCents !== q.snapshot.chargeCents || r.normalizedFacts.objectAmountCents !== q.snapshot.chargeCents
    || r.normalizedFacts.amountCapturedCents !== q.snapshot.chargeCents || r.normalizedFacts.paid !== true || r.normalizedFacts.captured !== true
    || r.normalizedFacts.applicationFeeId !== charge.normalizedFacts.applicationFeeId
    || (r.normalizedFacts.amountRefundedCents !== null && r.normalizedFacts.amountRefundedCents !== 0))) {
    return review('CHARGE_FACTS_CONFLICT');
  }
  const chargeKey = Object.freeze({ platformId: identity.platformId, accountId: identity.accountId, mode: 'test' as const, chargeId });
  const facts = { chargeKey, sessionId: session.sessionId!, paymentIntentId: session.paymentIntentId!, amountCents: q.snapshot.chargeCents, currency: 'cad' as const, applicationFeeCents: q.snapshot.applicationFeeCents };
  captureCandidate = Object.freeze({ ...facts, fingerprint: providerCorrelationFingerprint(facts) });
  if (q.snapshot.applicationFeeCents === 0) {
    if (charge.normalizedFacts.applicationFeeId !== null || fees.length > 0) {
      fee = Object.freeze({ state: 'review', feeId: null });
      return review('UNEXPECTED_APPLICATION_FEE');
    }
    fee = Object.freeze({ state: 'not_required', feeId: null });
    return finish('correlated');
  }
  const feeId = charge.normalizedFacts.applicationFeeId;
  if (!id(feeId, 'fee_') || fees.length === 0) {
    reasons.add('APPLICATION_FEE_EVIDENCE_MISSING');
    return finish('pending');
  }
  if (fees.some(r => r.objectId !== feeId || r.normalizedFacts.objectType !== 'application_fee' || r.normalizedFacts.objectLivemode !== false
    || r.normalizedFacts.chargeId !== chargeId || r.normalizedFacts.connectedAccountId !== identity.accountId
    || r.normalizedFacts.amountCents !== q.snapshot.applicationFeeCents || r.normalizedFacts.currency !== 'cad')) {
    fee = Object.freeze({ state: 'review', feeId });
    return review('APPLICATION_FEE_FACTS_CONFLICT');
  }
  fee = Object.freeze({ state: 'matched', feeId });
  return finish('correlated');
}
