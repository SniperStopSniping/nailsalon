import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { customerPaymentChargeCandidateSchema as chargeCandidates, customerPaymentChargeClaimSchema as chargeClaims } from '@/models/customerPaymentCorrelationSchema';
import { customerPaymentDisputeProjectionSchema as disputeProjections } from '@/models/customerPaymentDisputeCorrelationSchema';
import type { CustomerPaymentFixtureApplication } from '@/models/customerPaymentFixtureApplicationSchema';
import { customerPaymentProviderConflictSchema as conflicts, customerPaymentProviderInboxSchema as inboxes, customerPaymentProviderOperationSchema as operations, customerPaymentProviderOperationStateSchema as states } from '@/models/customerPaymentProviderSchema';
import { customerPaymentRefundProjectionSchema as refundProjections } from '@/models/customerPaymentRefundCorrelationSchema';

import { requireCustomerPaymentFixtureMovementsEnabled } from '../fixtureMovementsGate';
import { correlateProviderFixture, providerCorrelationFingerprint } from '../provider/correlation';
import { correlateProviderDisputeFixture } from '../provider/disputeCorrelation';
import type { VerifiedDisputeEvidence } from '../provider/disputeEvidence';
import { type OperationState, validateOperationState } from '../provider/operations';
import { correlateProviderRefundFixture } from '../provider/refundCorrelation';
import type { VerifiedRefundEvidence } from '../provider/refundEvidence';
import { loadProviderCorrelationSource } from './providerCorrelation';
import type { ProviderFixtureTransaction } from './providerFixtureFence';

export const fixtureMovementPlain = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));
const refundEvents = new Set(['refund.created', 'refund.updated', 'refund.failed', 'application_fee.refund.updated']);
const disputeEvents = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']);
const captureEvents = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded', 'charge.succeeded', 'application_fee.created']);
const withoutArrival = (value: Record<string, unknown>) => {
  const { receivedAt: _arrival, ...facts } = value;
  return facts;
};
const projectionEdges = (p: Record<string, unknown>) => [p.disputeId, p.chargeId, p.paymentIntentId, ...(Array.isArray(p.transactionReferences) ? p.transactionReferences : []).flatMap((v: any) => [v?.id, v?.sourceId]), ...(Array.isArray(p.balanceTransactions) ? p.balanceTransactions : []).flatMap((v: any) => [v?.id, v?.sourceId])].filter((v): v is string => typeof v === 'string');

/** Fresh bounded natural closure, never persisted inspection links or saved match flags. */
export async function loadFixtureMovementSource(tx: ProviderFixtureTransaction, application: CustomerPaymentFixtureApplication) {
  requireCustomerPaymentFixtureMovementsEnabled();
  const reasons = new Set<string>();
  const platformRows = await tx.select().from(inboxes).where(eq(inboxes.platformId, application.platformId)).orderBy(asc(inboxes.id)).limit(1025);
  const platformIds = platformRows.map(r => r.id);
  const conflictRows = platformIds.length ? await tx.select().from(conflicts).where(inArray(conflicts.inboxId, platformIds)).orderBy(asc(conflicts.id)).limit(1025) : [];
  const refundRows = platformIds.length ? await tx.select().from(refundProjections).where(inArray(refundProjections.inboxId, platformIds)).orderBy(asc(refundProjections.id)).limit(1025) : [];
  const disputeRows = platformIds.length ? await tx.select().from(disputeProjections).where(inArray(disputeProjections.inboxId, platformIds)).orderBy(asc(disputeProjections.id)).limit(1025) : [];
  if ([platformRows, conflictRows, refundRows, disputeRows].some(rows => rows.length > 1024)) {
    reasons.add('MOVEMENT_EVIDENCE_OVERFLOW');
  }
  // Conflicts and unknown platform evidence remain conservative blockers even
  // where their monetary relationship cannot be determined safely.
  if (conflictRows.length || platformRows.some(r => r.mode !== 'test' || r.receipt.source !== 'offline_signed_fixture' || ![...captureEvents, ...refundEvents, ...disputeEvents].includes(String(r.receipt.eventType)))) {
    reasons.add('MOVEMENT_PLATFORM_REVIEW_REQUIRED');
  }
  if (platformRows.some(r => disputeEvents.has(String(r.receipt.eventType)) && !disputeRows.some(p => p.inboxId === r.id && p.receiptFingerprint === r.fingerprint && p.conflictId === null))) {
    reasons.add('DISPUTE_REFERENCE_COVERAGE_INCOMPLETE');
  }
  let parent = await loadProviderCorrelationSource(tx, application.operationId, [], false, { ignoreRetainedLinks: true });
  const requested = new Set(parent.inboxIds);
  const edges = new Set<string>([application.chargeId, application.paymentIntentId]);
  let changed = true;
  let rounds = 0;
  while (changed && rounds++ < 257) {
    changed = false;
    for (const row of disputeRows) {
      const relation = projectionEdges(row.projection);
      if (requested.has(row.inboxId) || relation.some(edge => edges.has(edge))) {
        if (!requested.has(row.inboxId)) {
          requested.add(row.inboxId);
          changed = true;
        }
        for (const edge of relation) {
          if (!edges.has(edge)) {
            edges.add(edge);
            changed = true;
          }
        }
      }
    }
    if (changed) {
      parent = await loadProviderCorrelationSource(tx, application.operationId, [...requested], false, { ignoreRetainedLinks: true });
      for (const id of parent.inboxIds) {
        requested.add(id);
      }
    }
  }
  if (rounds >= 257 || parent.overflow) {
    reasons.add('MOVEMENT_EVIDENCE_OVERFLOW');
  }
  // Unknown transaction-reference coverage can hide a collision with this
  // capture; do not silently discard an incomplete sibling supplement.
  if (disputeRows.some(r => r.projection.transactionReferenceCoverage !== 'complete')) {
    reasons.add('DISPUTE_REFERENCE_COVERAGE_INCOMPLETE');
  }
  const receipts = parent.input.receipts;
  const selectedRefundRows = refundRows.filter(r => parent.inboxIds.includes(r.inboxId));
  const selectedDisputeRows = disputeRows.filter(r => parent.inboxIds.includes(r.inboxId));
  for (const row of [...selectedRefundRows, ...selectedDisputeRows]) {
    const original = platformRows.find(r => r.id === row.inboxId);
    if (!original || row.receiptFingerprint !== original.fingerprint || providerCorrelationFingerprint(withoutArrival(row.projection)) !== row.fingerprint) {
      reasons.add('MOVEMENT_PROJECTION_BINDING_INVALID');
    }
  }
  const refundDescriptors = receipts.filter(r => refundEvents.has(r.receipt.eventType ?? '')).map((r) => {
    const rows = selectedRefundRows.filter(p => p.inboxId === r.inboxId);
    return { ...r, hasConflict: r.hasConflict || rows.length > 1, refund: rows.length === 1 ? rows[0]!.projection as unknown as VerifiedRefundEvidence : null };
  });
  const disputeDescriptors = receipts.filter(r => disputeEvents.has(r.receipt.eventType ?? '')).map((r) => {
    const rows = selectedDisputeRows.filter(p => p.inboxId === r.inboxId);
    return { ...r, hasConflict: r.hasConflict || rows.length > 1 || rows.some(p => p.conflictId !== null), dispute: rows.length === 1 ? rows[0]!.projection as unknown as VerifiedDisputeEvidence : null };
  });
  const base = { ...parent.input, receipts: receipts.filter(r => !refundEvents.has(r.receipt.eventType ?? '') && !disputeEvents.has(r.receipt.eventType ?? '')) };
  const capture = correlateProviderFixture(base);
  if (capture.state !== 'correlated' || !capture.captureCandidate || capture.captureCandidate.chargeKey.chargeId !== application.chargeId || capture.captureCandidate.paymentIntentId !== application.paymentIntentId || capture.captureCandidate.amountCents !== application.amountCents || capture.captureCandidate.applicationFeeCents !== application.applicationFeeCents) {
    reasons.add('MOVEMENT_PARENT_CAPTURE_UNPROVEN');
  }
  const [charge] = await tx.select().from(chargeCandidates).where(eq(chargeCandidates.id, application.candidateId)).limit(1);
  const parentClaims = await tx.select().from(chargeClaims).where(eq(chargeClaims.candidateId, application.candidateId)).orderBy(asc(chargeClaims.id)).limit(257);
  if (!charge || charge.firstOperationId !== application.operationId || parentClaims.length !== 1 || parentClaims[0]!.operationId !== application.operationId || parentClaims[0]!.fingerprint !== capture.captureCandidate?.fingerprint || parentClaims[0]!.fingerprint !== application.ownershipEvidence[0]?.fingerprint) {
    reasons.add('MOVEMENT_PARENT_OWNERSHIP_CONFLICT');
  }
  const operationRows = await tx.select().from(operations).where(and(eq(operations.salonId, application.salonId), eq(operations.appointmentId, application.appointmentId), eq(operations.quoteId, application.quoteId))).orderBy(asc(operations.id)).limit(257);
  const stateRows = operationRows.length ? await tx.select().from(states).where(inArray(states.operationId, operationRows.map(r => r.id))).orderBy(asc(states.operationId)) : [];
  if (stateRows.length !== operationRows.length) {
    reasons.add('MOVEMENT_OPERATION_BINDING_INVALID');
  }
  if (operationRows.length > 256) {
    reasons.add('MOVEMENT_OPERATION_OVERFLOW');
  }
  const validOperations: OperationState[] = [];
  for (const row of stateRows) {
    try {
      const operation = validateOperationState(row.state as unknown as OperationState);
      const identity = operationRows.find(r => r.id === row.operationId);
      if (!identity || operation.identity.id !== identity.id || providerCorrelationFingerprint(operation.identity) !== providerCorrelationFingerprint(identity.identity)) {
        reasons.add('MOVEMENT_OPERATION_BINDING_INVALID');
      } else {
        validOperations.push(operation);
      }
    } catch {
      reasons.add('MOVEMENT_OPERATION_BINDING_INVALID');
    }
  }
  const refunds: { operation: OperationState; result: ReturnType<typeof correlateProviderRefundFixture> }[] = [];
  const refundIds = new Set(refundDescriptors.map(r => `${r.refund?.kind}:${r.refund?.movementId}`));
  for (const key of refundIds) {
    const descriptor = refundDescriptors.find(r => `${r.refund?.kind}:${r.refund?.movementId}` === key)!;
    if (!descriptor.refund?.movementId || !descriptor.refund.kind) {
      reasons.add('MOVEMENT_SUPPLEMENT_MISSING');
      continue;
    }
    const matching = validOperations.filter(o => o.identity.kind === descriptor.refund!.kind && o.state === 'succeeded' && o.result && 'objectId' in o.result && o.result.objectId === descriptor.refund!.movementId);
    if (matching.length !== 1) {
      reasons.add('MOVEMENT_OPERATION_UNPROVEN');
      continue;
    }
    const operation = matching[0]!;
    const result = correlateProviderRefundFixture({ parent: { ...base, receipts: [...base.receipts, ...refundDescriptors.map(({ refund: _refund, ...r }) => r)] }, operation, movements: refundDescriptors, ownershipConflict: false });
    if (result.state !== 'correlated' || !result.candidate) {
      reasons.add('MOVEMENT_REFUND_REVIEW_REQUIRED');
    }
    refunds.push({ operation, result });
  }
  for (const operation of validOperations.filter(o => o.identity.kind !== 'checkout_create')) {
    if (operation.state !== 'succeeded' || !operation.result || !('objectId' in operation.result) || !refundDescriptors.some(r => r.refund?.kind === operation.identity.kind && r.refund?.movementId === (operation.result as { objectId: string }).objectId)) {
      reasons.add('MOVEMENT_OPERATION_EVIDENCE_INCOMPLETE');
    }
  }
  const dispute = disputeDescriptors.length ? correlateProviderDisputeFixture({ parent: { ...base, receipts: [...base.receipts, ...disputeDescriptors.map(({ dispute: _dispute, ...r }) => r)] }, disputes: disputeDescriptors, ownershipConflict: false }) : null;
  if (dispute && (dispute.state !== 'correlated' || !dispute.balanceCandidates.length)) {
    reasons.add('MOVEMENT_DISPUTE_REVIEW_REQUIRED');
  }
  const source = fixtureMovementPlain({ platformEvidence: platformRows.map(r => ({ id: r.id, fingerprint: r.fingerprint })), platformConflicts: conflictRows.map(r => ({ id: r.id, inboxId: r.inboxId, fingerprint: r.fingerprint })), refundProjections: refundRows.map(r => ({ id: r.id, inboxId: r.inboxId, receiptFingerprint: r.receiptFingerprint, fingerprint: r.fingerprint })), disputeProjections: disputeRows.map(r => ({ id: r.id, inboxId: r.inboxId, conflictId: r.conflictId, receiptFingerprint: r.receiptFingerprint, fingerprint: r.fingerprint })), parent: parent.source, operations: operationRows.map(r => ({ id: r.id, identityFingerprint: r.fingerprint, state: stateRows.find(s => s.operationId === r.id)?.state ?? null })) });
  return { reasons: [...reasons].sort(), source, sourceRevision: providerCorrelationFingerprint(source), parentClaims, refunds, dispute, refundDescriptors, disputeDescriptors, refundRows: selectedRefundRows, disputeRows: selectedDisputeRows };
}
