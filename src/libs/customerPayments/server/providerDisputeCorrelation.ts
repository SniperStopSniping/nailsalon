import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { db } from '@/libs/DB';
import { customerPaymentChargeCandidateSchema as charges, customerPaymentChargeClaimSchema as chargeClaims } from '@/models/customerPaymentCorrelationSchema';
import { customerPaymentDisputeBalanceCandidateSchema as balanceCandidates, customerPaymentDisputeBalanceClaimSchema as balanceClaims, customerPaymentDisputeCandidateSchema as disputeCandidates, customerPaymentDisputeClaimSchema as disputeClaims, customerPaymentDisputeCorrelationLinkSchema as links, customerPaymentDisputeCorrelationSchema as correlations, customerPaymentDisputeProjectionSchema as projections } from '@/models/customerPaymentDisputeCorrelationSchema';
import { customerPaymentProviderConflictSchema as conflicts, customerPaymentProviderInboxSchema as inboxes } from '@/models/customerPaymentProviderSchema';

import { providerCorrelationFingerprint } from '../provider/correlation';
import { correlateProviderDisputeFixture, type ProviderDisputeBalanceCandidate, type ProviderDisputeCandidate, type ProviderDisputeCorrelationResult } from '../provider/disputeCorrelation';
import { assertVerifiedOfflineDisputeProjection, type VerifiedDisputeEvidence } from '../provider/disputeEvidence';
import { assertVerifiedProviderReceipt, type VerifiedProviderReceipt } from '../provider/evidence';
import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import { loadProviderCorrelationSource, withProviderCorrelationSnapshot } from './providerCorrelation';

type Database = Pick<typeof db, 'select' | 'transaction'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const uuid = z.string().uuid();
const events = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']);
const plain = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));
function withoutArrival(value: VerifiedProviderReceipt | VerifiedDisputeEvidence) {
  const { receivedAt: _arrival, ...facts } = value;
  return facts;
}
function review(result: ProviderDisputeCorrelationResult, reason: string): ProviderDisputeCorrelationResult {
  return { ...result, state: 'review', reasons: [...new Set([...result.reasons, reason])].sort() };
}
function edges(row: Record<string, unknown>) {
  const transactions = Array.isArray(row.balanceTransactions) ? row.balanceTransactions : [];
  const references = Array.isArray(row.transactionReferences) ? row.transactionReferences : [];
  return [row.disputeId, row.chargeId, row.paymentIntentId, ...[...transactions, ...references].flatMap(t => t && typeof t === 'object' ? [(t as Record<string, unknown>).id, (t as Record<string, unknown>).sourceId] : [])].filter((v): v is string => typeof v === 'string' && v.length > 0);
}
async function load(tx: Transaction, operationId: string, explicit: readonly string[], write: boolean) {
  const retained = await tx.select().from(links).where(eq(links.operationId, operationId)).orderBy(asc(links.inboxId)).limit(1025);
  const requested = new Set([...explicit, ...retained.map(r => r.inboxId)]);
  let parent = await loadProviderCorrelationSource(tx, operationId, [...requested], write);
  const scope = parent.input.operation.identity;
  // Original inbox normalization has no embedded txn IDs. Traverse signed
  // supplements too, including exact retained conflicting-payload projections.
  const scoped = await tx.select().from(projections).where(and(sql`${projections.projection}->>'platformId' = ${scope.platformId}`, or(sql`${projections.projection}->>'accountId' = ${scope.accountId}`, sql`${projections.projection}->>'expectedAccountId' = ${scope.accountId}`))).orderBy(asc(projections.id)).limit(1025);
  const scopeInboxes = await tx.select().from(inboxes).where(and(eq(inboxes.platformId, scope.platformId), or(eq(inboxes.accountKey, scope.accountId ?? ''), sql`${inboxes.receipt}->>'expectedAccountId' = ${scope.accountId}`))).orderBy(asc(inboxes.id)).limit(1025);
  const scopeConflicts = scopeInboxes.length ? await tx.select().from(conflicts).where(inArray(conflicts.inboxId, scopeInboxes.map(r => r.id))).orderBy(asc(conflicts.id)).limit(1025) : [];
  const disputeSources = [...scopeInboxes.map(r => ({ inboxId: r.id, id: r.id, conflictId: null as string | null, fingerprint: r.fingerprint, receipt: r.receipt })), ...scopeConflicts.map(r => ({ inboxId: r.inboxId, id: r.id, conflictId: r.id, fingerprint: r.fingerprint, receipt: r.receipt }))].filter(r => (typeof r.receipt.eventType === 'string' && r.receipt.eventType.startsWith('charge.dispute.')) || (r.receipt.normalizedFacts as Record<string, unknown> | undefined)?.objectType === 'dispute');
  const missingProjections = disputeSources.filter(r => !scoped.some(p => p.inboxId === r.inboxId && p.receiptFingerprint === r.fingerprint && p.conflictId === r.conflictId));
  const unknownCoverage = scoped.filter(row => row.projection.transactionReferenceCoverage !== 'complete');
  for (const row of missingProjections) {
    requested.add(row.inboxId);
  }
  if (missingProjections.length) {
    parent = await loadProviderCorrelationSource(tx, operationId, [...requested], write);
  }
  if (unknownCoverage.length) {
    for (const row of unknownCoverage) {
      requested.add(row.inboxId);
    }
    parent = await loadProviderCorrelationSource(tx, operationId, [...requested], write);
  }
  let changed = true;
  let rounds = 0;
  while (changed && rounds < 257) {
    rounds += 1;
    changed = false;
    const selected = new Set(parent.inboxIds);
    const related = new Set(parent.input.receipts.flatMap(r => [r.receipt.objectId, r.receipt.normalizedFacts.chargeId, r.receipt.normalizedFacts.paymentIntentId]).filter((v): v is string => typeof v === 'string'));
    for (const row of scoped) {
      if (selected.has(row.inboxId)) {
        edges(row.projection).forEach(e => related.add(e));
      }
    }
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const row of scoped) {
        const relation = edges(row.projection);
        if (selected.has(row.inboxId) || relation.some(e => related.has(e))) {
          if (!selected.has(row.inboxId)) {
            selected.add(row.inboxId);
            requested.add(row.inboxId);
            changed = true;
          }
          for (const edge of relation) {
            if (!related.has(edge)) {
              related.add(edge);
              expanded = true;
            }
          }
        }
      }
    }
    if (changed) {
      parent = await loadProviderCorrelationSource(tx, operationId, [...requested], write);
    }
  }
  const selected = new Set(parent.inboxIds);
  const rows = scoped.filter(r => selected.has(r.inboxId));
  const disputes = parent.input.receipts.filter(r => events.has(r.receipt.eventType ?? '')).map((r) => {
    const matching = rows.filter(p => p.inboxId === r.inboxId);
    const original = matching.filter(p => p.conflictId === null);
    return { ...r, hasConflict: r.hasConflict || matching.length > 1 || matching.some(p => p.conflictId !== null), dispute: original.length === 1 ? original[0]!.projection as unknown as VerifiedDisputeEvidence : null };
  });
  let result = correlateProviderDisputeFixture({ parent: parent.input, disputes, ownershipConflict: false });
  const over = parent.overflow || scoped.length > 1024 || scopeInboxes.length > 1024 || scopeConflicts.length > 1024 || retained.length > 1024 || rounds >= 257;
  if (unknownCoverage.length || missingProjections.length) {
    result = review(result, 'DISPUTE_REFERENCE_COVERAGE_INCOMPLETE');
  }
  if (over) {
    result = review(result, 'EVIDENCE_SET_OVERFLOW');
  }
  const parentClaims = await tx.select().from(chargeClaims).where(eq(chargeClaims.operationId, operationId)).orderBy(asc(chargeClaims.id)).limit(257);
  const matchingParent = parentClaims.filter(c => c.fingerprint === result.parentCaptureFingerprint);
  let parentOwnership: unknown[] = [];
  if (result.parentCaptureFingerprint) {
    if (matchingParent.length !== 1) {
      result = review(result, 'PARENT_CAPTURE_OWNERSHIP_UNPROVEN');
    } else {
      const id = matchingParent[0]!.candidateId;
      const [candidate] = await tx.select().from(charges).where(eq(charges.id, id)).limit(1);
      const owners = await tx.select().from(chargeClaims).where(eq(chargeClaims.candidateId, id)).orderBy(asc(chargeClaims.id)).limit(257);
      parentOwnership = owners.map(c => ({ id: c.id, operationId: c.operationId, fingerprint: c.fingerprint }));
      if (!candidate || candidate.firstOperationId !== operationId || owners.length > 256 || owners.some(c => c.operationId !== operationId || c.fingerprint !== result.parentCaptureFingerprint)) {
        result = review(result, 'PARENT_CAPTURE_OWNERSHIP_CONFLICT');
      }
    }
  }
  const { now: _now, ...parentInput } = parent.input;
  const source = plain({ parent: parentInput, disputes, parentEvidence: parent.source, missingProjections: missingProjections.map(r => ({ id: r.id, inboxId: r.inboxId, conflictId: r.conflictId, fingerprint: r.fingerprint })), projections: rows.map(p => ({ id: p.id, inboxId: p.inboxId, conflictId: p.conflictId, fingerprint: p.fingerprint, receiptFingerprint: p.receiptFingerprint, projection: p.projection })), overflow: over });
  return { source, sourceRevision: providerCorrelationFingerprint(source), result, inboxIds: parent.inboxIds, parentOwnership, asOf: parent.asOf, evaluatedAt: parent.evaluatedAt };
}
async function ownDispute(tx: Transaction, operationId: string, candidate: ProviderDisputeCandidate, reserve: boolean) {
  const keyHash = providerCorrelationFingerprint(candidate.disputeKey);
  if (reserve) {
    await tx.insert(disputeCandidates).values({ id: randomUUID(), keyHash, key: plain(candidate.disputeKey), firstOperationId: operationId }).onConflictDoNothing();
  }
  const [stored] = await tx.select().from(disputeCandidates).where(eq(disputeCandidates.keyHash, keyHash)).limit(1);
  if (reserve && !stored) {
    throw new Error('CUSTOMER_PAYMENT_DISPUTE_CANDIDATE_WRITE_FAILED');
  }
  const existing = stored ? await tx.select().from(disputeClaims).where(eq(disputeClaims.candidateId, stored.id)).orderBy(asc(disputeClaims.operationId), asc(disputeClaims.fingerprint)).limit(257) : [];
  const facts = existing.map(c => ({ operationId: c.operationId, fingerprint: c.fingerprint }));
  const missingClaim = !facts.some(c => c.operationId === operationId && c.fingerprint === candidate.fingerprint);
  if (reserve && missingClaim) {
    facts.push({ operationId, fingerprint: candidate.fingerprint });
  }
  facts.sort((a, b) => a.operationId.localeCompare(b.operationId) || a.fingerprint.localeCompare(b.fingerprint));
  const conflict = existing.length > 256 || (stored && stored.firstOperationId !== operationId) || facts.some(c => c.operationId !== operationId || c.fingerprint !== candidate.fingerprint);
  return { candidate, keyHash, candidateId: stored?.id ?? null, missingClaim, facts, conflict: Boolean(conflict), unrecorded: !reserve && missingClaim };
}
async function ownBalance(tx: Transaction, operationId: string, candidate: ProviderDisputeBalanceCandidate, reserve: boolean) {
  const keyHash = providerCorrelationFingerprint(candidate.movementKey);
  if (reserve) {
    await tx.insert(balanceCandidates).values({ id: randomUUID(), keyHash, key: plain(candidate.movementKey), firstOperationId: operationId }).onConflictDoNothing();
  }
  const [stored] = await tx.select().from(balanceCandidates).where(eq(balanceCandidates.keyHash, keyHash)).limit(1);
  if (reserve && !stored) {
    throw new Error('CUSTOMER_PAYMENT_DISPUTE_BALANCE_CANDIDATE_WRITE_FAILED');
  }
  const existing = stored ? await tx.select().from(balanceClaims).where(eq(balanceClaims.candidateId, stored.id)).orderBy(asc(balanceClaims.operationId), asc(balanceClaims.fingerprint)).limit(257) : [];
  const facts = existing.map(c => ({ operationId: c.operationId, fingerprint: c.fingerprint }));
  const missingClaim = !facts.some(c => c.operationId === operationId && c.fingerprint === candidate.fingerprint);
  if (reserve && missingClaim) {
    facts.push({ operationId, fingerprint: candidate.fingerprint });
  }
  facts.sort((a, b) => a.operationId.localeCompare(b.operationId) || a.fingerprint.localeCompare(b.fingerprint));
  const conflict = existing.length > 256 || (stored && stored.firstOperationId !== operationId) || facts.some(c => c.operationId !== operationId || c.fingerprint !== candidate.fingerprint);
  return { candidate, keyHash, candidateId: stored?.id ?? null, missingClaim, facts, conflict: Boolean(conflict), unrecorded: !reserve && missingClaim };
}
async function ownership(tx: Transaction, operationId: string, result: ProviderDisputeCorrelationResult, reserve: boolean) {
  const dispute = result.disputeCandidate ? await ownDispute(tx, operationId, result.disputeCandidate, reserve) : null;
  const balances = [];
  for (const candidate of result.balanceCandidates) {
    balances.push(await ownBalance(tx, operationId, candidate, reserve));
  }
  let effective = result;
  if (dispute?.conflict || balances.some(b => b.conflict)) {
    effective = review(effective, 'DISPUTE_MOVEMENT_OWNERSHIP_CONFLICT');
  }
  if (dispute?.unrecorded || balances.some(b => b.unrecorded)) {
    effective = review(effective, 'DISPUTE_CANDIDATE_NOT_RECORDED');
  }
  return { result: effective, dispute, balances, facts: { dispute: dispute ? { keyHash: dispute.keyHash, facts: dispute.facts } : null, balances: balances.map(b => ({ keyHash: b.keyHash, facts: b.facts })).sort((a, b) => a.keyHash.localeCompare(b.keyHash)) } };
}
/** Offline current-evidence view, never financial authority or hold clearing. */
export function createProviderDisputeCorrelation(database: Database) {
  return {
    async persistDisputeProjection(inboxId: string, receipt: VerifiedProviderReceipt, dispute: VerifiedDisputeEvidence) {
      requireCustomerPaymentProviderFixtureEnabled();
      uuid.parse(inboxId);
      assertVerifiedProviderReceipt(receipt);
      assertVerifiedOfflineDisputeProjection(dispute, receipt);
      const receiptFingerprint = providerCorrelationFingerprint(withoutArrival(receipt));
      const fingerprint = providerCorrelationFingerprint(withoutArrival(dispute));
      return withProviderCorrelationSnapshot(database, true, async (tx) => {
        const [inbox] = await tx.select().from(inboxes).where(eq(inboxes.id, inboxId)).limit(1);
        if (!inbox) {
          throw new Error('CUSTOMER_PAYMENT_DISPUTE_ORIGINAL_RECEIPT_MISMATCH');
        }
        let conflictId: string | null = null;
        if (inbox.fingerprint !== receiptFingerprint) {
          const [conflict] = await tx.select().from(conflicts).where(and(eq(conflicts.inboxId, inboxId), eq(conflicts.fingerprint, receiptFingerprint))).limit(1);
          if (!conflict) {
            throw new Error('CUSTOMER_PAYMENT_DISPUTE_ORIGINAL_RECEIPT_MISMATCH');
          }
          conflictId = conflict.id;
        }
        await tx.insert(projections).values({ id: randomUUID(), inboxId, conflictId, projectionVersion: 1, receiptFingerprint, fingerprint, projection: plain(dispute) }).onConflictDoNothing();
        const [stored] = await tx.select().from(projections).where(and(eq(projections.inboxId, inboxId), eq(projections.receiptFingerprint, receiptFingerprint), eq(projections.fingerprint, fingerprint))).limit(1);
        if (!stored || stored.conflictId !== conflictId) {
          throw new Error('CUSTOMER_PAYMENT_DISPUTE_PROJECTION_WRITE_FAILED');
        }
        return stored;
      });
    },
    async correlateOperation(operationId: string, inboxIds: readonly string[] = []) {
      requireCustomerPaymentProviderFixtureEnabled();
      uuid.parse(operationId);
      z.array(uuid).max(256).parse(inboxIds);
      return withProviderCorrelationSnapshot(database, true, async (tx) => {
        const data = await load(tx, operationId, inboxIds, true);
        for (const inboxId of data.inboxIds) {
          await tx.insert(links).values({ id: randomUUID(), operationId, inboxId }).onConflictDoNothing();
          const [stored] = await tx.select().from(links).where(and(eq(links.operationId, operationId), eq(links.inboxId, inboxId))).limit(1);
          if (!stored) {
            throw new Error('CUSTOMER_PAYMENT_DISPUTE_LINK_WRITE_FAILED');
          }
        }
        const owned = await ownership(tx, operationId, data.result, true);
        const ownershipRevision = providerCorrelationFingerprint({ own: owned.facts, parent: data.parentOwnership });
        const [latest] = await tx.select().from(correlations).where(eq(correlations.operationId, operationId)).orderBy(desc(correlations.version)).limit(1);
        const timestamps = { asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt };
        if (latest && latest.sourceRevision === data.sourceRevision && latest.ownershipRevision === ownershipRevision && providerCorrelationFingerprint(latest.result) === providerCorrelationFingerprint(owned.result)) {
          return { ...latest, result: owned.result, replayed: true, ...timestamps };
        }
        const [saved] = await tx.insert(correlations).values({ id: randomUUID(), operationId, version: (latest?.version ?? 0) + 1, sourceRevision: data.sourceRevision, ownershipRevision, source: data.source, result: plain(owned.result) }).returning();
        if (!saved) {
          throw new Error('CUSTOMER_PAYMENT_DISPUTE_CORRELATION_WRITE_FAILED');
        }
        if (owned.dispute?.missingClaim && owned.dispute.candidateId) {
          const inserted = await tx.insert(disputeClaims).values({ id: randomUUID(), candidateId: owned.dispute.candidateId, operationId, correlationId: saved.id, fingerprint: owned.dispute.candidate.fingerprint, facts: plain(owned.dispute.candidate) }).onConflictDoNothing().returning();
          if (inserted.length !== 1) {
            throw new Error('CUSTOMER_PAYMENT_DISPUTE_CLAIM_WRITE_FAILED');
          }
        }
        for (const balance of owned.balances) {
          if (balance.missingClaim && balance.candidateId) {
            const inserted = await tx.insert(balanceClaims).values({ id: randomUUID(), candidateId: balance.candidateId, operationId, correlationId: saved.id, fingerprint: balance.candidate.fingerprint, facts: plain(balance.candidate) }).onConflictDoNothing().returning();
            if (inserted.length !== 1) {
              throw new Error('CUSTOMER_PAYMENT_DISPUTE_BALANCE_CLAIM_WRITE_FAILED');
            }
          }
        }
        return { ...saved, result: owned.result, replayed: false, ...timestamps };
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
        const data = await load(tx, operationId, [], false);
        const owned = await ownership(tx, operationId, data.result, false);
        const ownershipRevision = providerCorrelationFingerprint({ own: owned.facts, parent: data.parentOwnership });
        return { operationId, version: latest.version, sourceRevision: data.sourceRevision, ownershipRevision, result: owned.result, asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt, recordedSnapshotMatches: latest.sourceRevision === data.sourceRevision && latest.ownershipRevision === ownershipRevision && providerCorrelationFingerprint(latest.result) === providerCorrelationFingerprint(owned.result) };
      });
    },
  };
}
export type ProviderDisputeCorrelationJournal = ReturnType<typeof createProviderDisputeCorrelation>;
