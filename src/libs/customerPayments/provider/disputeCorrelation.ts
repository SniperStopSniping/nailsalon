import type { ProviderCaptureCandidate, ProviderCorrelationInput } from './correlation';
import { correlateProviderFixture, providerCorrelationFingerprint } from './correlation';
import type { VerifiedDisputeEvidence } from './disputeEvidence';
import type { VerifiedProviderReceipt } from './evidence';

export type ProviderDisputeCorrelationInput = {
  parent: ProviderCorrelationInput;
  disputes: readonly { inboxId: string; receipt: VerifiedProviderReceipt; hasConflict: boolean; dispute: VerifiedDisputeEvidence | null }[];
  ownershipConflict: boolean;
};
type Scope = { platformId: string; accountScope: 'connected'; accountId: string; mode: 'test' };
export type ProviderDisputeCandidate = Readonly<{
  disputeKey: Readonly<Scope & { disputeId: string }>;
  parentChargeKey: ProviderCaptureCandidate['chargeKey'];
  chargeId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: 'cad';
  status: string;
  fingerprint: string;
}>;
export type ProviderDisputeBalanceCandidate = Readonly<{
  movementKey: Readonly<Scope & { balanceTransactionId: string }>;
  disputeId: string;
  chargeId: string;
  paymentIntentId: string;
  category: 'dispute' | 'dispute_reversal';
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: 'cad';
  created: number;
  fingerprint: string;
}>;
export type ProviderDisputeCorrelationResult = Readonly<{
  source: 'offline_fixture_dispute_correlation';
  state: 'pending' | 'correlated' | 'review';
  reasons: readonly string[];
  financialPostingAllowed: false;
  parentCaptureFingerprint: string | null;
  disputeCandidate: ProviderDisputeCandidate | null;
  balanceCandidates: readonly ProviderDisputeBalanceCandidate[];
  totals: Readonly<{ withdrawnCents: number; reinstatedCents: number; feeCents: number; netCents: number }> | null;
}>;
const events = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']);
const explained = new Set(['UNMATCHED_OBJECT', 'INSUFFICIENT_MONEY_EXPECTATION', 'INSUFFICIENT_RELATIONSHIP_EXPECTATION', 'UNSUPPORTED_EVENT_OR_OBJECT', 'INVALID_MONEY_FACTS']);
const transitions: Record<string, readonly string[]> = {
  warning_needs_response: ['warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost'],
  warning_under_review: ['warning_closed', 'needs_response', 'under_review', 'won', 'lost'],
  warning_closed: [],
  needs_response: ['under_review', 'won', 'lost'],
  under_review: ['won', 'lost'],
  won: [],
  lost: [],
};
const id = (v: unknown, prefix: string): v is string => typeof v === 'string' && v.length <= 255 && v.startsWith(prefix) && /^[A-Z0-9]+$/i.test(v.slice(prefix.length));
const seconds = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 253402300799;
const money = (v: unknown): v is number => Number.isSafeInteger(v) && Math.abs(Number(v)) <= 50_000_000;

/** Offline relationship projection only. Lifecycle never manufactures cash or clears a hold. */
export function correlateProviderDisputeFixture(input: ProviderDisputeCorrelationInput): ProviderDisputeCorrelationResult {
  let parentCaptureFingerprint: string | null = null;
  let disputeCandidate: ProviderDisputeCandidate | null = null;
  let balanceCandidates: readonly ProviderDisputeBalanceCandidate[] = [];
  let totals: ProviderDisputeCorrelationResult['totals'] = null;
  const finish = (state: ProviderDisputeCorrelationResult['state'], reason?: string): ProviderDisputeCorrelationResult => Object.freeze({
    source: 'offline_fixture_dispute_correlation',
    state,
    reasons: Object.freeze(reason ? [reason] : []),
    financialPostingAllowed: false,
    parentCaptureFingerprint,
    disputeCandidate,
    balanceCandidates: Object.freeze([...balanceCandidates]),
    totals,
  });
  if (input.ownershipConflict !== false || input.disputes.length > 256) {
    return finish('review', 'DISPUTE_OWNERSHIP_OR_LIMIT');
  }
  const scope = input.parent.operation.identity;
  const descriptors = new Map<string, ProviderDisputeCorrelationInput['disputes'][number]>();
  for (const row of input.disputes) {
    const originals = input.parent.receipts.filter(r => r.inboxId === row.inboxId);
    if (row.hasConflict !== false || originals.length !== 1 || originals[0]!.hasConflict !== false || descriptors.has(row.inboxId)
      || !events.has(row.receipt.eventType ?? '') || providerCorrelationFingerprint(originals[0]!.receipt) !== providerCorrelationFingerprint(row.receipt)) {
      return finish('review', 'DISPUTE_CLOSURE_MISMATCH');
    }
    descriptors.set(row.inboxId, row);
  }
  if (input.parent.receipts.some(r => events.has(r.receipt.eventType ?? '') && !descriptors.has(r.inboxId))) {
    return finish('review', 'DISPUTE_CLOSURE_INCOMPLETE');
  }
  let missing = false;
  const observations: VerifiedDisputeEvidence[] = [];
  for (const { receipt: r, dispute: s } of descriptors.values()) {
    if (r.version !== 1 || r.source !== 'offline_signed_fixture' || !id(r.eventId, 'evt_') || r.receiptIdentity !== r.eventId
      || !['accepted', 'review'].includes(r.classification) || !Array.isArray(r.reviewReasons)
      || (r.classification === 'review' && !r.reviewReasons.length)
      || !/^[a-f0-9]{64}$/.test(r.payloadDigest) || !Number.isFinite(Date.parse(r.receivedAt))
      || r.platformId !== scope.platformId || r.accountScope !== 'connected' || r.accountId !== scope.accountId || r.expectedAccountId !== scope.accountId
      || r.mode !== 'test' || r.apiVersion !== scope.apiVersion || r.reviewReasons.some(reason => !explained.has(reason))) {
      return finish('review', 'DISPUTE_ORIGINAL_REVIEW');
    }
    if (!s) {
      missing = true;
      continue;
    }
    if (s.version !== 1 || s.projectionVersion !== 1 || s.source !== 'offline_signed_fixture_dispute' || s.classification !== 'correlatable' || s.reviewReasons.length
      || !Number.isFinite(Date.parse(s.receivedAt)) || s.transactionReferenceCoverage !== 'complete') {
      return finish('review', 'DISPUTE_SUPPLEMENT_UNPROVEN');
    }
    for (const key of ['payloadDigest', 'eventId', 'eventType', 'receiptIdentity', 'endpointId', 'platformId', 'accountScope', 'expectedAccountId', 'accountId', 'mode', 'apiVersion'] as const) {
      if (s[key] !== r[key]) {
        return finish('review', 'DISPUTE_RECEIPT_BINDING_MISMATCH');
      }
    }
    if (!id(s.disputeId, 'dp_') || s.disputeId !== r.objectId || !id(s.chargeId, 'ch_') || !id(s.paymentIntentId, 'pi_')
      || (s.eventType === 'charge.dispute.closed' && !['won', 'lost', 'warning_closed'].includes(s.status ?? ''))
      || !money(s.amountCents) || s.amountCents <= 0 || s.currency !== 'cad' || !Object.hasOwn(transitions, s.status ?? '')
      || !seconds(s.eventCreated) || !seconds(s.objectCreated) || s.objectCreated > s.eventCreated
      || s.eventCreated > Math.floor(Date.parse(r.receivedAt) / 1000)) {
      return finish('review', 'DISPUTE_FACTS_INVALID');
    }
    observations.push(s);
  }
  const parent = correlateProviderFixture({ ...input.parent, receipts: input.parent.receipts.filter(r => !descriptors.has(r.inboxId)) });
  const capture = parent.captureCandidate;
  if (parent.state !== 'correlated' || !capture) {
    return finish(parent.state === 'pending' ? 'pending' : 'review', 'PARENT_CAPTURE_UNPROVEN');
  }
  parentCaptureFingerprint = capture.fingerprint;
  const rawIdentities = new Set<string>();
  const rawAmounts = new Set<number>();
  for (const { receipt: r } of descriptors.values()) {
    if (id(r.objectId, 'dp_')) {
      rawIdentities.add(r.objectId);
    }
    if (typeof r.normalizedFacts.objectAmountCents === 'number') {
      rawAmounts.add(r.normalizedFacts.objectAmountCents);
    }
    if ((r.normalizedFacts.chargeId !== null && r.normalizedFacts.chargeId !== capture.chargeKey.chargeId)
      || (r.normalizedFacts.paymentIntentId !== null && r.normalizedFacts.paymentIntentId !== capture.paymentIntentId)
      || (r.normalizedFacts.currency !== null && r.normalizedFacts.currency !== 'cad')
      || (r.normalizedFacts.objectAmountCents !== null && (!money(r.normalizedFacts.objectAmountCents)
        || r.normalizedFacts.objectAmountCents <= 0 || r.normalizedFacts.objectAmountCents > capture.amountCents))) {
      return finish('review', 'DISPUTE_PARENT_MISMATCH');
    }
  }
  if (rawIdentities.size > 1 || rawAmounts.size > 1) {
    return finish('review', 'DISPUTE_IDENTITY_CONFLICT');
  }
  const earliestCapture = Math.min(...input.parent.receipts.filter(r => r.receipt.eventType === 'charge.succeeded' && r.receipt.objectId === capture.chargeKey.chargeId).map(r => Number(r.receipt.normalizedFacts.created)));
  for (const s of observations) {
    if (s.chargeId !== capture.chargeKey.chargeId || s.paymentIntentId !== capture.paymentIntentId || s.amountCents! > capture.amountCents || s.objectCreated! < earliestCapture) {
      return finish('review', 'DISPUTE_PARENT_MISMATCH');
    }
  }
  const first = observations[0];
  if (!first) {
    return finish('pending', missing ? 'DISPUTE_SUPPLEMENT_MISSING' : 'DISPUTE_EVIDENCE_MISSING');
  }
  if (observations.some(s => s.disputeId !== first.disputeId || s.objectCreated !== first.objectCreated || s.amountCents !== first.amountCents)) {
    return finish('review', 'DISPUTE_IDENTITY_CONFLICT');
  }
  const ordered = [...observations].sort((a, b) => a.eventCreated! - b.eventCreated! || String(a.status).localeCompare(String(b.status)));
  for (let i = 1; i < ordered.length; i++) {
    const prior = ordered[i - 1]!;
    const current = ordered[i]!;
    if (prior.status !== current.status && (prior.eventCreated === current.eventCreated || !transitions[prior.status!]!.includes(current.status!))) {
      return finish('review', 'DISPUTE_LIFECYCLE_CONFLICT');
    }
  }
  const candidates = new Map<string, ProviderDisputeBalanceCandidate>();
  for (const s of observations) {
    for (const bt of s.balanceTransactions) {
      if (!id(bt.id, 'txn_') || bt.sourceId !== s.disputeId || bt.type !== 'adjustment' || !['dispute', 'dispute_reversal'].includes(bt.reportingCategory ?? '')
        || bt.currency !== 'cad' || !money(bt.amountCents) || !money(bt.feeCents) || !money(bt.netCents) || bt.netCents !== bt.amountCents - bt.feeCents
        || (bt.reportingCategory === 'dispute' ? bt.amountCents >= 0 : bt.amountCents <= 0)
        || !['pending', 'available'].includes(bt.status ?? '') || !seconds(bt.availableOn)
        || !seconds(bt.created) || bt.created < s.objectCreated! || bt.created > s.eventCreated!) {
        return finish('review', 'DISPUTE_BALANCE_FACTS_INVALID');
      }
      const movementKey = Object.freeze({ platformId: scope.platformId, accountScope: 'connected' as const, accountId: capture.chargeKey.accountId, mode: 'test' as const, balanceTransactionId: bt.id });
      const facts = { movementKey, disputeId: s.disputeId!, chargeId: s.chargeId!, paymentIntentId: s.paymentIntentId!, category: bt.reportingCategory as 'dispute' | 'dispute_reversal', amountCents: bt.amountCents, feeCents: bt.feeCents, netCents: bt.netCents, currency: 'cad' as const, created: bt.created };
      const candidate = Object.freeze({ ...facts, fingerprint: providerCorrelationFingerprint(facts) });
      const prior = candidates.get(bt.id);
      if (prior && prior.fingerprint !== candidate.fingerprint) {
        return finish('review', 'DISPUTE_BALANCE_IDENTITY_CONFLICT');
      }
      candidates.set(bt.id, candidate);
    }
  }
  const knownWithdrawal = [...candidates.values()].filter(r => r.category === 'dispute').reduce((sum, r) => sum - r.amountCents, 0);
  if (knownWithdrawal > first.amountCents!) {
    return finish('review', 'DISPUTE_BALANCE_BOUND_EXCEEDED');
  }
  if (missing) {
    return finish('pending', 'DISPUTE_SUPPLEMENT_MISSING');
  }
  const disputeKey = Object.freeze({ platformId: scope.platformId, accountScope: 'connected' as const, accountId: capture.chargeKey.accountId, mode: 'test' as const, disputeId: first.disputeId! });
  const facts = { disputeKey, parentChargeKey: capture.chargeKey, chargeId: first.chargeId!, paymentIntentId: first.paymentIntentId!, amountCents: first.amountCents!, currency: 'cad' as const };
  disputeCandidate = Object.freeze({ ...facts, status: ordered[ordered.length - 1]!.status!, fingerprint: providerCorrelationFingerprint(facts) });
  const rows = [...candidates.values()].sort((a, b) => a.movementKey.balanceTransactionId.localeCompare(b.movementKey.balanceTransactionId));
  const withdrawnCents = rows.filter(r => r.category === 'dispute').reduce((sum, r) => sum - r.amountCents, 0);
  const reinstatedCents = rows.filter(r => r.category === 'dispute_reversal').reduce((sum, r) => sum + r.amountCents, 0);
  if (withdrawnCents > first.amountCents! || reinstatedCents > withdrawnCents) {
    return finish('review', 'DISPUTE_BALANCE_BOUND_EXCEEDED');
  }
  let outstanding = 0;
  const chronological = [...rows].sort((a, b) => a.created - b.created);
  for (let i = 0; i < chronological.length; i++) {
    const row = chronological[i]!;
    if (i > 0 && row.created === chronological[i - 1]!.created && row.category !== chronological[i - 1]!.category) {
      return finish('review', 'DISPUTE_BALANCE_TIME_AMBIGUOUS');
    }
    outstanding -= row.amountCents;
    if (outstanding < 0 || outstanding > first.amountCents!) {
      return finish('review', 'DISPUTE_BALANCE_CHRONOLOGY_INVALID');
    }
  }
  if (ordered[ordered.length - 1]!.status!.startsWith('warning_') && rows.length) {
    return finish('review', 'INQUIRY_WITH_BALANCE_MOVEMENT');
  }
  if (!rows.length) {
    return finish('pending', 'DISPUTE_BALANCE_EVIDENCE_MISSING');
  }
  balanceCandidates = rows;
  totals = Object.freeze({ withdrawnCents, reinstatedCents, feeCents: rows.reduce((sum, r) => sum + r.feeCents, 0), netCents: rows.reduce((sum, r) => sum + r.netCents, 0) });
  return finish('correlated');
}
