import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { db } from '@/libs/DB';
import { customerPaymentChargeCandidateSchema as candidates, customerPaymentChargeClaimSchema as claims, customerPaymentCorrelationLinkSchema as links, customerPaymentCorrelationMutexSchema as mutex, customerPaymentCorrelationSchema as correlations, customerPaymentSessionProjectionSchema as projections } from '@/models/customerPaymentCorrelationSchema';
import { customerPaymentProviderConflictSchema as conflicts, customerPaymentProviderInboxSchema as inboxes, customerPaymentProviderOperationSchema as operations, customerPaymentProviderOperationStateSchema as states } from '@/models/customerPaymentProviderSchema';
import { customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';

import { correlateProviderFixture, type ProviderCaptureCandidate, providerCorrelationFingerprint, type ProviderCorrelationInput, type ProviderCorrelationResult } from '../provider/correlation';
import { assertVerifiedProviderReceipt, type VerifiedProviderReceipt } from '../provider/evidence';
import { type OperationState, validateOperationState } from '../provider/operations';
import { assertVerifiedOfflineSessionProjection, type VerifiedCheckoutSessionEvidence } from '../provider/sessionEvidence';
import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';

type Database = Pick<typeof db, 'select' | 'transaction'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const idSchema = z.string().uuid();
const SCOPE_LIMIT = 1024;
const CLOSURE_LIMIT = 256;
function plain(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value));
}
function withoutArrival(value: VerifiedProviderReceipt | VerifiedCheckoutSessionEvidence) {
  const { receivedAt: _arrival, ...facts } = value;
  return facts;
}
function review(result: ProviderCorrelationResult, reason: string): ProviderCorrelationResult {
  return { ...result, state: 'review', reasons: [...new Set([...result.reasons, reason])].sort() };
}
function overflow(): ProviderCorrelationResult {
  return { source: 'offline_fixture_correlation', state: 'review', reasons: ['EVIDENCE_SET_OVERFLOW'], financialPostingAllowed: false, captureCandidate: null, fee: { state: 'review', feeId: null } };
}
async function snapshot<T>(database: Database, write: boolean, body: (tx: Transaction) => Promise<T>): Promise<T> {
  requireCustomerPaymentProviderFixtureEnabled();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.transaction(async (tx) => {
        // Fixture-only global writer serialization, not an inbox ingestion fence.
        if (write) {
          const locked = await tx.update(mutex).set({ revision: sql`${mutex.revision} + 1` }).where(eq(mutex.id, 1)).returning();
          if (locked.length !== 1) {
            throw new Error('CUSTOMER_PAYMENT_CORRELATION_MUTEX_MISSING');
          }
        }
        return body(tx);
      }, { isolationLevel: 'repeatable read' });
    } catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if (!write || attempt >= 2 || !['40001', '40P01'].includes(failure.cause?.code ?? failure.code ?? '')) {
        throw error;
      }
      // A serialization failure rolls the complete fixture transaction back.
      // Retry the same deterministic inputs, never a provider action.
    }
  }
}
async function clock(tx: Transaction) {
  const [row] = await tx.select({ now: sql<string>`clock_timestamp()`, snapshotStartedAt: sql<string>`transaction_timestamp()` }).from(sql`(SELECT 1) AS correlation_clock`);
  return { evaluatedAt: new Date(row!.now), snapshotStartedAt: new Date(row!.snapshotStartedAt) };
}
async function load(tx: Transaction, operationId: string, explicit: readonly string[], write: boolean) {
  requireCustomerPaymentProviderFixtureEnabled();
  let operationQuery = tx.select().from(operations).where(eq(operations.id, operationId)).limit(1).$dynamic();
  if (write) {
    operationQuery = operationQuery.for('update');
  }
  const [operationRow] = await operationQuery;
  if (!operationRow) {
    throw new Error('CUSTOMER_PAYMENT_CORRELATION_OPERATION_NOT_FOUND');
  }
  const [stateRow] = await tx.select().from(states).where(eq(states.operationId, operationId)).limit(1);
  if (!stateRow) {
    throw new Error('CUSTOMER_PAYMENT_CORRELATION_OPERATION_NOT_FOUND');
  }
  const operation = validateOperationState(stateRow.state as unknown as OperationState);
  const [quoteRow] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(eq(customerPaymentPreparedQuoteSchema.id, operation.identity.quoteId)).limit(1);
  if (!quoteRow) {
    throw new Error('CUSTOMER_PAYMENT_CORRELATION_QUOTE_NOT_FOUND');
  }
  const quote = { id: quoteRow.id, salonId: quoteRow.salonId, appointmentId: quoteRow.appointmentId, stripeAccountId: quoteRow.stripeAccountId, mode: quoteRow.mode, fingerprint: quoteRow.fingerprint, createdAt: quoteRow.createdAt, expiresAt: quoteRow.expiresAt, snapshot: { currency: quoteRow.snapshot.currency, chargeCents: quoteRow.snapshot.chargeCents, applicationFeeCents: quoteRow.snapshot.applicationFeeCents } };
  const retained = await tx.select().from(links).where(eq(links.operationId, operationId)).orderBy(asc(links.inboxId)).limit(SCOPE_LIMIT + 1);
  const requested = [...new Set([...explicit, ...retained.map(row => row.inboxId)])].sort();
  const scoped = await tx.select().from(inboxes).where(and(eq(inboxes.platformId, operation.identity.platformId), or(
    eq(inboxes.accountScope, 'platform'),
    eq(inboxes.accountKey, operation.identity.accountId ?? ''),
    sql`${inboxes.receipt}->>'expectedAccountId' = ${operation.identity.accountId ?? ''}`,
    ...(requested.length ? [inArray(inboxes.id, requested)] : []),
  ))).orderBy(asc(inboxes.id)).limit(SCOPE_LIMIT + 1);
  if (scoped.length <= SCOPE_LIMIT && explicit.some(id => !scoped.some(row => row.id === id))) {
    throw new Error('CUSTOMER_PAYMENT_CORRELATION_EVIDENCE_SCOPE');
  }
  const ids = scoped.map(row => row.id);
  const sessionRows = ids.length ? await tx.select().from(projections).where(inArray(projections.inboxId, ids)).orderBy(asc(projections.id)).limit(SCOPE_LIMIT + 1) : [];
  const conflictRows = ids.length ? await tx.select().from(conflicts).where(inArray(conflicts.inboxId, ids)).orderBy(asc(conflicts.id)).limit(SCOPE_LIMIT + 1) : [];
  const selected = new Set(requested);
  const related = new Set<string>();
  if (operation.result && 'objectId' in operation.result) {
    related.add(operation.result.objectId);
  }
  // Discover the complete bounded Session→PI→charge→fee closure. Explicit IDs
  // retain extra evidence but cannot hide newly relevant facts or conflicts.
  let changed = true;
  while (changed) {
    changed = false;
    const remember = (value: unknown) => {
      if (typeof value === 'string' && value && !related.has(value)) {
        related.add(value);
        changed = true;
      }
    };
    for (const row of sessionRows) {
      const s = row.projection;
      if (selected.has(row.inboxId) || (typeof s.sessionId === 'string' && related.has(s.sessionId))) {
        if (!selected.has(row.inboxId)) {
          selected.add(row.inboxId);
          changed = true;
        }
        remember(s.sessionId);
        remember(s.paymentIntentId);
      }
    }
    for (const row of [...scoped.map(row => ({ id: row.id, receipt: row.receipt })), ...conflictRows.map(row => ({ id: row.inboxId, receipt: row.receipt }))]) {
      const r = row.receipt as unknown as VerifiedProviderReceipt;
      const relationships = [r.objectId, r.normalizedFacts.paymentIntentId, r.normalizedFacts.chargeId, r.normalizedFacts.applicationFeeId];
      if (selected.has(row.id) || relationships.some(value => typeof value === 'string' && related.has(value))) {
        if (!selected.has(row.id)) {
          selected.add(row.id);
          changed = true;
        }
        relationships.forEach(remember);
      }
    }
  }
  const receipts = scoped.filter(row => selected.has(row.id)).map(row => ({ inboxId: row.id, receipt: row.receipt as unknown as VerifiedProviderReceipt, hasConflict: conflictRows.some(conflict => conflict.inboxId === row.id) || sessionRows.filter(projection => projection.inboxId === row.id).length > 1 }));
  const sessions = sessionRows.filter(row => selected.has(row.inboxId)).map(row => ({ inboxId: row.inboxId, session: row.projection as unknown as VerifiedCheckoutSessionEvidence }));
  const { evaluatedAt, snapshotStartedAt } = await clock(tx);
  const asOf = snapshotStartedAt;
  const input: ProviderCorrelationInput = { operation, quote, receipts, sessions, now: evaluatedAt };
  const over = scoped.length > SCOPE_LIMIT || retained.length > SCOPE_LIMIT || sessionRows.length > SCOPE_LIMIT || conflictRows.length > SCOPE_LIMIT || receipts.length > CLOSURE_LIMIT || sessions.length > CLOSURE_LIMIT;
  const conflictEvidence = conflictRows.filter(row => selected.has(row.inboxId)).map(row => ({ id: row.id, inboxId: row.inboxId, fingerprint: row.fingerprint })).sort((a, b) => a.id.localeCompare(b.id));
  const projectionEvidence = sessionRows.filter(row => selected.has(row.inboxId)).map(row => ({ id: row.id, inboxId: row.inboxId, fingerprint: row.fingerprint })).sort((a, b) => a.id.localeCompare(b.id));
  const source = plain({ operation, quote, receipts, sessions, conflictEvidence, projectionEvidence, overflow: over });
  const result = over ? overflow() : correlateProviderFixture(input);
  return { input, overflow: over, source, sourceRevision: providerCorrelationFingerprint(source), result, inboxIds: receipts.map(row => row.inboxId).sort(), asOf, evaluatedAt };
}
function candidateWhere(candidate: ProviderCaptureCandidate) {
  const key = candidate.chargeKey;
  return and(eq(candidates.platformId, key.platformId), eq(candidates.accountId, key.accountId), eq(candidates.mode, key.mode), eq(candidates.chargeId, key.chargeId));
}
async function ownership(tx: Transaction, operationId: string, result: ProviderCorrelationResult, reserve: boolean) {
  const candidate = result.captureCandidate;
  if (!candidate) {
    return { result, candidateId: null, claims: [], ownershipRevision: providerCorrelationFingerprint([]), missingClaim: false };
  }
  if (reserve) {
    await tx.insert(candidates).values({ id: randomUUID(), ...candidate.chargeKey, firstOperationId: operationId }).onConflictDoNothing();
  }
  const [stored] = await tx.select().from(candidates).where(candidateWhere(candidate)).limit(1);
  if (reserve && !stored) {
    throw new Error('CUSTOMER_PAYMENT_CHARGE_CANDIDATE_WRITE_FAILED');
  }
  const existing = stored ? await tx.select().from(claims).where(eq(claims.candidateId, stored.id)).orderBy(asc(claims.operationId), asc(claims.fingerprint)) : [];
  const facts = existing.map(row => ({ operationId: row.operationId, fingerprint: row.fingerprint }));
  const missingClaim = !facts.some(row => row.operationId === operationId && row.fingerprint === candidate.fingerprint);
  if (reserve && missingClaim) {
    facts.push({ operationId, fingerprint: candidate.fingerprint });
  }
  facts.sort((a, b) => a.operationId.localeCompare(b.operationId) || a.fingerprint.localeCompare(b.fingerprint));
  let effective = result;
  if (facts.some(row => row.operationId !== operationId) || (stored && stored.firstOperationId !== operationId)) {
    effective = review(effective, 'CHARGE_OWNERSHIP_CONFLICT');
  }
  if (facts.some(row => row.fingerprint !== candidate.fingerprint)) {
    effective = review(effective, 'CHARGE_FACTS_CONFLICT');
  }
  if (!reserve && missingClaim) {
    effective = review(effective, 'CHARGE_CANDIDATE_NOT_RECORDED');
  }
  return { result: effective, candidateId: stored?.id ?? null, claims: facts, ownershipRevision: providerCorrelationFingerprint(facts), missingClaim };
}
/** Offline-only derived graph. Results are as-of snapshots, never money authority. */
export function createProviderCorrelation(database: Database) {
  return {
    async persistSessionProjection(inboxId: string, receipt: VerifiedProviderReceipt, session: VerifiedCheckoutSessionEvidence) {
      requireCustomerPaymentProviderFixtureEnabled();
      idSchema.parse(inboxId);
      assertVerifiedProviderReceipt(receipt);
      assertVerifiedOfflineSessionProjection(session, receipt);
      const receiptFingerprint = providerCorrelationFingerprint(withoutArrival(receipt));
      const fingerprint = providerCorrelationFingerprint(withoutArrival(session));
      return snapshot(database, true, async (tx) => {
        const [inbox] = await tx.select().from(inboxes).where(eq(inboxes.id, inboxId)).limit(1);
        if (!inbox || inbox.fingerprint !== receiptFingerprint) {
          throw new Error('CUSTOMER_PAYMENT_SESSION_ORIGINAL_RECEIPT_MISMATCH');
        }
        await tx.insert(projections).values({ id: randomUUID(), inboxId, projectionVersion: 1, fingerprint, receiptFingerprint, projection: plain(session) }).onConflictDoNothing();
        const [stored] = await tx.select().from(projections).where(and(eq(projections.inboxId, inboxId), eq(projections.projectionVersion, 1), eq(projections.fingerprint, fingerprint))).limit(1);
        if (!stored) {
          throw new Error('CUSTOMER_PAYMENT_SESSION_PROJECTION_WRITE_FAILED');
        }
        return stored;
      });
    },
    async correlateOperation(operationId: string, inboxIds: readonly string[] = []) {
      requireCustomerPaymentProviderFixtureEnabled();
      idSchema.parse(operationId);
      z.array(idSchema).max(CLOSURE_LIMIT).parse(inboxIds);
      return snapshot(database, true, async (tx) => {
        const data = await load(tx, operationId, inboxIds, true);
        for (const inboxId of data.inboxIds) {
          await tx.insert(links).values({ id: randomUUID(), operationId, inboxId }).onConflictDoNothing();
          const [retained] = await tx.select({ id: links.id }).from(links).where(and(eq(links.operationId, operationId), eq(links.inboxId, inboxId))).limit(1);
          if (!retained) {
            throw new Error('CUSTOMER_PAYMENT_CORRELATION_LINK_WRITE_FAILED');
          }
        }
        const owned = await ownership(tx, operationId, data.result, true);
        const [latest] = await tx.select().from(correlations).where(eq(correlations.operationId, operationId)).orderBy(desc(correlations.version)).limit(1);
        if (latest && latest.sourceRevision === data.sourceRevision && latest.ownershipRevision === owned.ownershipRevision
          && providerCorrelationFingerprint(latest.result) === providerCorrelationFingerprint(owned.result)) {
          return { ...latest, result: owned.result, asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt, candidateId: owned.candidateId, replayed: true };
        }
        const [saved] = await tx.insert(correlations).values({ id: randomUUID(), operationId, version: (latest?.version ?? 0) + 1, sourceRevision: data.sourceRevision, ownershipRevision: owned.ownershipRevision, source: data.source, result: plain(owned.result) }).returning();
        if (!saved) {
          throw new Error('CUSTOMER_PAYMENT_CORRELATION_WRITE_FAILED');
        }
        if (owned.missingClaim && owned.candidateId && data.result.captureCandidate) {
          const inserted = await tx.insert(claims).values({ id: randomUUID(), candidateId: owned.candidateId, operationId, correlationId: saved.id, fingerprint: data.result.captureCandidate.fingerprint, facts: plain(data.result.captureCandidate) }).onConflictDoNothing().returning();
          if (inserted.length !== 1) {
            throw new Error('CUSTOMER_PAYMENT_CHARGE_CLAIM_WRITE_FAILED');
          }
        }
        return { ...saved, result: owned.result, asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt, candidateId: owned.candidateId, replayed: false };
      });
    },
    async getCorrelation(operationId: string) {
      requireCustomerPaymentProviderFixtureEnabled();
      idSchema.parse(operationId);
      return snapshot(database, false, async (tx) => {
        const [latest] = await tx.select().from(correlations).where(eq(correlations.operationId, operationId)).orderBy(desc(correlations.version)).limit(1);
        if (!latest) {
          return null;
        }
        const data = await load(tx, operationId, [], false);
        const owned = await ownership(tx, operationId, data.result, false);
        return { operationId, version: latest.version, sourceRevision: data.sourceRevision, ownershipRevision: owned.ownershipRevision, asOf: data.asOf, snapshotStartedAt: data.asOf, evaluatedAt: data.evaluatedAt, result: owned.result, candidateId: owned.candidateId, recordedSnapshotMatches: latest.sourceRevision === data.sourceRevision && latest.ownershipRevision === owned.ownershipRevision
          && providerCorrelationFingerprint(latest.result) === providerCorrelationFingerprint(owned.result) };
      });
    },
  };
}
export type ProviderCorrelationJournal = ReturnType<typeof createProviderCorrelation>;

// Internal fixture consumers must recompute current facts inside the same RR
// transaction and check current charge ownership; saved snapshots are not proof.
export { load as loadProviderCorrelationSource, snapshot as withProviderCorrelationSnapshot };
