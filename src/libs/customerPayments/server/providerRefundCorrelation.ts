import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { db } from '@/libs/DB';
import { customerPaymentChargeCandidateSchema as charges, customerPaymentChargeClaimSchema as chargeClaims } from '@/models/customerPaymentCorrelationSchema';
import { customerPaymentProviderInboxSchema as inboxes, customerPaymentProviderOperationStateSchema as states } from '@/models/customerPaymentProviderSchema';
import { customerPaymentMovementCandidateSchema as candidates, customerPaymentMovementClaimSchema as claims, customerPaymentRefundCorrelationLinkSchema as links, customerPaymentRefundCorrelationSchema as correlations, customerPaymentRefundProjectionSchema as projections } from '@/models/customerPaymentRefundCorrelationSchema';

import { providerCorrelationFingerprint } from '../provider/correlation';
import { assertVerifiedProviderReceipt, type VerifiedProviderReceipt } from '../provider/evidence';
import { type OperationState, validateOperationState } from '../provider/operations';
import { correlateProviderRefundFixture, type ProviderRefundCorrelationResult } from '../provider/refundCorrelation';
import { assertVerifiedOfflineRefundProjection, type VerifiedRefundEvidence } from '../provider/refundEvidence';
import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import { loadProviderCorrelationSource, withProviderCorrelationSnapshot } from './providerCorrelation';

type Database = Pick<typeof db, 'select' | 'transaction'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const uuid = z.string().uuid();
const events = new Set(['refund.created', 'refund.updated', 'refund.failed', 'application_fee.refund.updated']);
const plain = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));
function withoutArrival(value: VerifiedProviderReceipt | VerifiedRefundEvidence) {
  const { receivedAt: _arrival, ...facts } = value;
  return facts;
}
function review(result: ProviderRefundCorrelationResult, reason: string): ProviderRefundCorrelationResult {
  return { ...result, state: 'review', reasons: [...new Set([...result.reasons, reason])].sort() };
}
async function load(tx: Transaction, operationId: string, parentOperationId: string, explicit: readonly string[], write: boolean) {
  const [state] = await tx.select().from(states).where(eq(states.operationId, operationId)).limit(1);
  if (!state) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_OPERATION_NOT_FOUND');
  }
  const operation = validateOperationState(state.state as unknown as OperationState);
  const retained = await tx.select().from(links).where(eq(links.operationId, operationId)).orderBy(asc(links.inboxId)).limit(1025);
  const parent = await loadProviderCorrelationSource(tx, parentOperationId, [...new Set([...explicit, ...retained.map(r => r.inboxId)])], write);
  const ids = parent.input.receipts.map(r => r.inboxId);
  const projectionRows = ids.length ? await tx.select().from(projections).where(inArray(projections.inboxId, ids)).orderBy(asc(projections.id)).limit(1025) : [];
  const movements = parent.input.receipts.filter(r => events.has(r.receipt.eventType ?? '')).map((r) => {
    const matching = projectionRows.filter(p => p.inboxId === r.inboxId);
    return { ...r, hasConflict: r.hasConflict || matching.length > 1, refund: matching.length === 1 ? matching[0]!.projection as unknown as VerifiedRefundEvidence : null };
  });
  let result = correlateProviderRefundFixture({ parent: parent.input, operation, movements, ownershipConflict: false });
  if (parent.overflow || projectionRows.length > 1024 || retained.length > 1024) {
    result = review(result, 'EVIDENCE_SET_OVERFLOW');
  }
  // Current parent ownership, never the saved parent correlation result.
  const parentClaims = await tx.select().from(chargeClaims).where(eq(chargeClaims.operationId, parentOperationId)).orderBy(asc(chargeClaims.id)).limit(257);
  const matchingParent = parentClaims.filter(c => c.fingerprint === result.parentCaptureFingerprint);
  let parentOwnership: unknown[] = [];
  if (result.parentCaptureFingerprint) {
    if (matchingParent.length !== 1) {
      result = review(result, 'PARENT_CAPTURE_OWNERSHIP_UNPROVEN');
    } else {
      const candidateId = matchingParent[0]!.candidateId;
      const [candidate] = await tx.select().from(charges).where(eq(charges.id, candidateId)).limit(1);
      const competing = await tx.select().from(chargeClaims).where(eq(chargeClaims.candidateId, candidateId)).orderBy(asc(chargeClaims.id)).limit(257);
      parentOwnership = competing.map(c => ({ id: c.id, operationId: c.operationId, fingerprint: c.fingerprint }));
      if (!candidate || candidate.firstOperationId !== parentOperationId || competing.length > 256 || competing.some(c => c.operationId !== parentOperationId || c.fingerprint !== result.parentCaptureFingerprint)) {
        result = review(result, 'PARENT_CAPTURE_OWNERSHIP_CONFLICT');
      }
    }
  }
  const movementHashes = movements.flatMap((m) => {
    const r = m.refund;
    return r?.kind && r.movementId ? [providerCorrelationFingerprint({ platformId: r.platformId, accountScope: r.accountScope, accountId: r.accountId, mode: r.mode, kind: r.kind, movementId: r.movementId })] : [];
  });
  const siblings = movementHashes.length ? await tx.select().from(candidates).where(inArray(candidates.movementKeyHash, movementHashes)).orderBy(asc(candidates.id)).limit(257) : [];
  const siblingClaims = siblings.length ? await tx.select().from(claims).where(inArray(claims.candidateId, siblings.map(c => c.id))).orderBy(asc(claims.id)).limit(257) : [];
  if (siblings.length > 256 || siblingClaims.length > 256) {
    result = review(result, 'MOVEMENT_OWNERSHIP_LIMIT');
  }
  for (const c of siblings) {
    const owned = siblingClaims.filter(row => row.candidateId === c.id);
    if (new Set(owned.map(row => row.operationId)).size > 1 || new Set(owned.map(row => row.fingerprint)).size > 1) {
      result = review(result, 'SIBLING_MOVEMENT_OWNERSHIP_CONFLICT');
    }
  }
  const { now: _now, ...parentInput } = parent.input;
  const source = plain({ parent: parentInput, operation, movements, parentEvidence: parent.source, refundProjections: projectionRows.map(p => ({ id: p.id, inboxId: p.inboxId, fingerprint: p.fingerprint })), overflow: parent.overflow || projectionRows.length > 1024 || retained.length > 1024 });
  return { source, sourceRevision: providerCorrelationFingerprint(source), result, inboxIds: ids, parentOwnership, siblingClaims, asOf: parent.asOf, evaluatedAt: parent.evaluatedAt };
}
async function ownership(tx: Transaction, operationId: string, result: ProviderRefundCorrelationResult, reserve: boolean) {
  requireCustomerPaymentProviderFixtureEnabled();
  const candidate = result.candidate;
  if (!candidate) {
    return { result, candidateId: null, missingClaim: false, facts: [] };
  }
  const movementKeyHash = providerCorrelationFingerprint(candidate.movementKey);
  if (reserve) {
    await tx.insert(candidates).values({ id: randomUUID(), movementKeyHash, movementKey: plain(candidate.movementKey), firstOperationId: operationId }).onConflictDoNothing();
  }
  const [stored] = await tx.select().from(candidates).where(eq(candidates.movementKeyHash, movementKeyHash)).limit(1);
  if (reserve && !stored) {
    throw new Error('CUSTOMER_PAYMENT_MOVEMENT_CANDIDATE_WRITE_FAILED');
  }
  const existing = stored ? await tx.select().from(claims).where(eq(claims.candidateId, stored.id)).orderBy(asc(claims.operationId), asc(claims.fingerprint)).limit(257) : [];
  const facts = existing.map(c => ({ operationId: c.operationId, fingerprint: c.fingerprint }));
  const missingClaim = !facts.some(c => c.operationId === operationId && c.fingerprint === candidate.fingerprint);
  if (reserve && missingClaim) {
    facts.push({ operationId, fingerprint: candidate.fingerprint });
  }
  facts.sort((a, b) => a.operationId.localeCompare(b.operationId) || a.fingerprint.localeCompare(b.fingerprint));
  let effective = result;
  if (existing.length > 256 || (stored && stored.firstOperationId !== operationId) || facts.some(c => c.operationId !== operationId || c.fingerprint !== candidate.fingerprint)) {
    effective = review(effective, 'MOVEMENT_OWNERSHIP_CONFLICT');
  }
  if (!reserve && missingClaim) {
    effective = review(effective, 'MOVEMENT_CANDIDATE_NOT_RECORDED');
  }
  return { result: effective, candidateId: stored?.id ?? null, missingClaim, facts };
}
/** Offline derived movement graph only. No original inbox or financial mutation. */
export function createProviderRefundCorrelation(database: Database) {
  return {
    async persistRefundProjection(inboxId: string, receipt: VerifiedProviderReceipt, refund: VerifiedRefundEvidence) {
      requireCustomerPaymentProviderFixtureEnabled();
      uuid.parse(inboxId);
      assertVerifiedProviderReceipt(receipt);
      assertVerifiedOfflineRefundProjection(refund, receipt);
      const receiptFingerprint = providerCorrelationFingerprint(withoutArrival(receipt));
      const fingerprint = providerCorrelationFingerprint(withoutArrival(refund));
      return withProviderCorrelationSnapshot(database, true, async (tx) => {
        const [inbox] = await tx.select().from(inboxes).where(eq(inboxes.id, inboxId)).limit(1);
        if (!inbox || inbox.fingerprint !== receiptFingerprint) {
          throw new Error('CUSTOMER_PAYMENT_REFUND_ORIGINAL_RECEIPT_MISMATCH');
        }
        await tx.insert(projections).values({ id: randomUUID(), inboxId, projectionVersion: 1, receiptFingerprint, fingerprint, projection: plain(refund) }).onConflictDoNothing();
        const [stored] = await tx.select().from(projections).where(and(eq(projections.inboxId, inboxId), eq(projections.fingerprint, fingerprint))).limit(1);
        if (!stored) {
          throw new Error('CUSTOMER_PAYMENT_REFUND_PROJECTION_WRITE_FAILED');
        }
        return stored;
      });
    },
    async correlateOperation(operationId: string, parentOperationId: string, inboxIds: readonly string[] = []) {
      requireCustomerPaymentProviderFixtureEnabled();
      uuid.parse(operationId);
      uuid.parse(parentOperationId);
      z.array(uuid).max(256).parse(inboxIds);
      return withProviderCorrelationSnapshot(database, true, async (tx) => {
        const data = await load(tx, operationId, parentOperationId, inboxIds, true);
        const [latest] = await tx.select().from(correlations).where(eq(correlations.operationId, operationId)).orderBy(desc(correlations.version)).limit(1);
        if (latest && latest.parentOperationId !== parentOperationId) {
          throw new Error('CUSTOMER_PAYMENT_REFUND_PARENT_CONFLICT');
        }
        for (const inboxId of data.inboxIds) {
          await tx.insert(links).values({ id: randomUUID(), operationId, inboxId }).onConflictDoNothing();
          const [stored] = await tx.select().from(links).where(and(eq(links.operationId, operationId), eq(links.inboxId, inboxId))).limit(1);
          if (!stored) {
            throw new Error('CUSTOMER_PAYMENT_REFUND_LINK_WRITE_FAILED');
          }
        }
        const owned = await ownership(tx, operationId, data.result, true);
        const ownershipRevision = providerCorrelationFingerprint({ own: owned.facts, parent: data.parentOwnership, siblings: data.siblingClaims.map(c => ({ operationId: c.operationId, fingerprint: c.fingerprint, candidateId: c.candidateId })).filter(c => c.operationId !== operationId) });
        if (latest && latest.sourceRevision === data.sourceRevision && latest.ownershipRevision === ownershipRevision && providerCorrelationFingerprint(latest.result) === providerCorrelationFingerprint(owned.result)) {
          return { ...latest, result: owned.result, candidateId: owned.candidateId, replayed: true, asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt };
        }
        const [saved] = await tx.insert(correlations).values({ id: randomUUID(), operationId, parentOperationId, version: (latest?.version ?? 0) + 1, sourceRevision: data.sourceRevision, ownershipRevision, source: data.source, result: plain(owned.result) }).returning();
        if (!saved) {
          throw new Error('CUSTOMER_PAYMENT_REFUND_CORRELATION_WRITE_FAILED');
        }
        if (owned.missingClaim && owned.candidateId && owned.result.candidate) {
          const inserted = await tx.insert(claims).values({ id: randomUUID(), candidateId: owned.candidateId, operationId, correlationId: saved.id, fingerprint: owned.result.candidate.fingerprint, facts: plain(owned.result.candidate) }).onConflictDoNothing().returning();
          if (inserted.length !== 1) {
            throw new Error('CUSTOMER_PAYMENT_MOVEMENT_CLAIM_WRITE_FAILED');
          }
        }
        return { ...saved, result: owned.result, candidateId: owned.candidateId, replayed: false, asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt };
      });
    },
    async getCorrelation(operationId: string) {
      requireCustomerPaymentProviderFixtureEnabled();
      uuid.parse(operationId);
      return withProviderCorrelationSnapshot(database, false, async (tx) => {
        const [latest] = await tx.select().from(correlations).where(eq(correlations.operationId, operationId)).orderBy(desc(correlations.version)).limit(1);
        if (!latest) {
          return null;
        }
        const data = await load(tx, operationId, latest.parentOperationId, [], false);
        const owned = await ownership(tx, operationId, data.result, false);
        const ownershipRevision = providerCorrelationFingerprint({ own: owned.facts, parent: data.parentOwnership, siblings: data.siblingClaims.map(c => ({ operationId: c.operationId, fingerprint: c.fingerprint, candidateId: c.candidateId })).filter(c => c.operationId !== operationId) });
        return { operationId, parentOperationId: latest.parentOperationId, version: latest.version, sourceRevision: data.sourceRevision, ownershipRevision, candidateId: owned.candidateId, result: owned.result, asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt, recordedSnapshotMatches: latest.sourceRevision === data.sourceRevision && latest.ownershipRevision === ownershipRevision && providerCorrelationFingerprint(latest.result) === providerCorrelationFingerprint(owned.result) };
      });
    },
  };
}
export type ProviderRefundCorrelationJournal = ReturnType<typeof createProviderRefundCorrelation>;

/** Internal canonical writer seam; caller owns the admission-fenced transaction. */
export { ownership as reserveProviderRefundOwnership };
