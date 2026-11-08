import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { db } from '@/libs/DB';
import { customerPaymentDisputeBalanceClaimSchema as balanceClaims, customerPaymentDisputeClaimSchema as disputeClaims, customerPaymentDisputeCorrelationSchema as disputeCorrelations } from '@/models/customerPaymentDisputeCorrelationSchema';
import { customerPaymentFixtureApplicationSchema as applications, customerPaymentFixturePlatformSchema as platforms } from '@/models/customerPaymentFixtureApplicationSchema';
import { customerPaymentFixtureMovementSchema as movements, customerPaymentFixtureReconciliationSchema as reconciliations } from '@/models/customerPaymentFixtureMovementSchema';
import { customerPaymentMovementClaimSchema as refundClaims, customerPaymentRefundCorrelationSchema as refundCorrelations } from '@/models/customerPaymentRefundCorrelationSchema';
import { customerPaymentCaptureSchema as captures, customerPaymentPreparedQuoteSchema as quotes } from '@/models/customerPaymentSchema';
import { appointmentPaymentSchema as tenders, appointmentSchema as appointments } from '@/models/Schema';

import { requireCustomerPaymentFixtureMovementsEnabled } from '../fixtureMovementsGate';
import { verifyOfflineFixtureCaptureTender } from '../provenance';
import { providerCorrelationFingerprint } from '../provider/correlation';
import { fixtureMovementPlain as plain, loadFixtureMovementSource } from './fixtureMovementSource';
import { reserveProviderDisputeOwnership } from './providerDisputeCorrelation';
import { withProviderFixtureTransaction } from './providerFixtureFence';
import { reserveProviderRefundOwnership } from './providerRefundCorrelation';

type Database = Pick<typeof db, 'select' | 'transaction'>;
type Movement = typeof movements.$inferInsert;
const request = z.object({ captureApplicationId: z.string().uuid() }).strict();
const report = (state: 'applied' | 'replayed' | 'held', reconciliationId: string | null, movementIds: string[], reasons: string[] = []) => ({ state, source: 'offline_fixture_test' as const, financialPostingAllowed: false as const, reconciliationId, movementIds, reasons });
class HeldMovementBatch extends Error {
  constructor(readonly result: ReturnType<typeof report>) {
    super('CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_BATCH_HELD');
  }
}
const claimFacts = (rows: readonly { id: string; candidateId: string; operationId: string; fingerprint: string }[]) => rows.map(({ id, candidateId, operationId, fingerprint }) => ({ id, candidateId, operationId, fingerprint })).sort((a, b) => a.id.localeCompare(b.id));
function monetaryFingerprint(row: Movement) {
  return providerCorrelationFingerprint({ applicationId: row.applicationId, kind: row.kind, movementKeyHash: row.movementKeyHash, operationId: row.operationId, chargeId: row.chargeId, paymentIntentId: row.paymentIntentId, applicationFeeId: row.applicationFeeId ?? null, disputeId: row.disputeId ?? null, amountCents: row.amountCents, feeCents: row.feeCents ?? null, netCents: row.netCents ?? null, currency: row.currency, objectCreatedAt: row.objectCreatedAt.toISOString(), occurredAt: row.occurredAt.toISOString() });
}

/** Complete local fake-evidence reconciliation; no provider transport or booking credit. */
export function createProviderFixtureMovementApplication(database: Database) {
  return {
    async reconcileMovements(raw: { captureApplicationId: string }) {
      requireCustomerPaymentFixtureMovementsEnabled();
      const { captureApplicationId } = request.parse(raw);
      try {
        return await withProviderFixtureTransaction(database, async (tx) => {
          const [application] = await tx.select().from(applications).where(eq(applications.id, captureApplicationId)).limit(1);
          if (!application) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_APPLICATION_NOT_FOUND');
          }
          const [appointment] = await tx.select().from(appointments).where(and(eq(appointments.id, application.appointmentId), eq(appointments.salonId, application.salonId))).for('update', { noWait: true }).limit(1);
          const [capture] = await tx.select().from(captures).where(eq(captures.id, application.captureId)).limit(1);
          const [tender] = await tx.select().from(tenders).where(eq(tenders.id, application.tenderId)).limit(1);
          const [quote] = await tx.select().from(quotes).where(eq(quotes.id, application.quoteId)).limit(1);
          const [platform] = await tx.select().from(platforms).where(eq(platforms.platformId, application.platformId)).for('share', { noWait: true }).limit(1);
          if (!appointment || !capture || !tender || !quote || !platform) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_PARENT_MISSING');
          }
          if (providerCorrelationFingerprint(application.sourceEvidence) !== application.sourceRevision || providerCorrelationFingerprint(application.ownershipEvidence) !== application.ownershipRevision) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_PARENT_BINDING_INVALID');
          }
          // This verifies historical immutable facts; current revision changes
          // produce a collection hold, not erasure of the captured cash.
          verifyOfflineFixtureCaptureTender(tender, capture, { application, quote, holds: [], currentPlatformRevision: platform.revision });
          const existing = await tx.select().from(movements).where(eq(movements.applicationId, application.id)).orderBy(asc(movements.movementKeyHash));
          const held = (reasons: string[]): never => {
            throw new HeldMovementBatch(report('held', null, existing.map(r => r.id), reasons));
          };
          const data = await loadFixtureMovementSource(tx, application);
          if (data.reasons.length) {
            return held(data.reasons);
          }
          const reconciliationId = randomUUID();
          const recordedAt = new Date();
          const proposed: Movement[] = [];
          const refundCandidateIds: string[] = [];
          const disputeCandidateIds: string[] = [];
          const balanceCandidateIds: string[] = [];
          const common = { reconciliationId, applicationId: application.id, captureId: capture.id, salonId: application.salonId, appointmentId: application.appointmentId, platformId: application.platformId, source: 'offline_fixture_test' as const, mode: 'test' as const, chargeId: application.chargeId, paymentIntentId: application.paymentIntentId, currency: 'cad' as const, recordedAt };
          for (const refund of data.refunds) {
            const candidate = refund.result.candidate!;
            const owned = await reserveProviderRefundOwnership(tx, refund.operation.identity.id, refund.result, true);
            if (owned.result.state !== 'correlated' || !owned.candidateId) {
              return held(['MOVEMENT_OWNERSHIP_CONFLICT']);
            }
            refundCandidateIds.push(owned.candidateId);
            let [claim] = await tx.select().from(refundClaims).where(and(eq(refundClaims.candidateId, owned.candidateId), eq(refundClaims.operationId, refund.operation.identity.id), eq(refundClaims.fingerprint, candidate.fingerprint))).limit(1);
            if (!claim) {
              const [latest] = await tx.select().from(refundCorrelations).where(eq(refundCorrelations.operationId, refund.operation.identity.id)).orderBy(desc(refundCorrelations.version)).limit(1);
              const auditSource = { ...data.source, operation: plain(refund.operation) };
              const [audit] = await tx.insert(refundCorrelations).values({ id: randomUUID(), operationId: refund.operation.identity.id, parentOperationId: application.operationId, version: (latest?.version ?? 0) + 1, sourceRevision: providerCorrelationFingerprint(auditSource), ownershipRevision: providerCorrelationFingerprint(owned.facts), source: auditSource, result: plain(owned.result) }).returning();
              [claim] = await tx.insert(refundClaims).values({ id: randomUUID(), candidateId: owned.candidateId, operationId: refund.operation.identity.id, correlationId: audit!.id, fingerprint: candidate.fingerprint, facts: plain(candidate) }).returning();
            }
            const prior = existing.find(r => r.movementKeyHash === providerCorrelationFingerprint(candidate.movementKey));
            const eligible = data.refundDescriptors.filter(r => r.refund?.movementId === candidate.movementKey.movementId && r.refund.kind === candidate.kind && (candidate.kind === 'customer_refund' ? r.refund.status === 'succeeded' : r.refund.outcome === 'fee_return_observed')).sort((a, b) => a.refund!.eventCreated! - b.refund!.eventCreated! || a.inboxId.localeCompare(b.inboxId));
            const success = prior ? eligible.find(r => r.inboxId === prior.evidence.inboxId && r.refund!.eventCreated! * 1000 === prior.occurredAt.getTime()) : eligible[0];
            if (!success?.refund || !claim) {
              throw new Error('CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_SUCCESS_MISSING');
            }
            const projection = data.refundRows.find(r => r.inboxId === success.inboxId)!;
            const row: Movement = { ...common, id: randomUUID(), operationId: refund.operation.identity.id, accountScope: candidate.movementKey.accountScope, accountId: candidate.movementKey.accountId, kind: candidate.kind, movementId: candidate.movementKey.movementId, movementKeyHash: providerCorrelationFingerprint(candidate.movementKey), applicationFeeId: candidate.applicationFeeId, disputeId: null, amountCents: candidate.amountCents, feeCents: null, netCents: null, objectCreatedAt: new Date(success.refund.objectCreated! * 1000), occurredAt: new Date(success.refund.eventCreated! * 1000), fingerprint: '', evidence: plain({ candidateId: owned.candidateId, claimId: claim.id, candidateFingerprint: candidate.fingerprint, projectionId: projection.id, inboxId: success.inboxId, receiptFingerprint: projection.receiptFingerprint, projectionFingerprint: projection.fingerprint, movementKey: candidate.movementKey, candidateFacts: candidate }) };
            row.fingerprint = monetaryFingerprint(row);
            proposed.push(row);
          }
          if (data.dispute) {
            const owned = await reserveProviderDisputeOwnership(tx, application.operationId, data.dispute, true);
            if (owned.result.state !== 'correlated' || !owned.dispute?.candidateId || owned.balances.some(b => !b.candidateId)) {
              return held(['MOVEMENT_OWNERSHIP_CONFLICT']);
            }
            disputeCandidateIds.push(owned.dispute.candidateId);
            balanceCandidateIds.push(...owned.balances.map(b => b.candidateId!));
            if (owned.dispute.missingClaim || owned.balances.some(b => b.missingClaim)) {
              const [latest] = await tx.select().from(disputeCorrelations).where(eq(disputeCorrelations.operationId, application.operationId)).orderBy(desc(disputeCorrelations.version)).limit(1);
              const [audit] = await tx.insert(disputeCorrelations).values({ id: randomUUID(), operationId: application.operationId, version: (latest?.version ?? 0) + 1, sourceRevision: data.sourceRevision, ownershipRevision: providerCorrelationFingerprint(owned.facts), source: data.source, result: plain(owned.result) }).returning();
              if (owned.dispute.missingClaim) {
                await tx.insert(disputeClaims).values({ id: randomUUID(), candidateId: owned.dispute.candidateId, operationId: application.operationId, correlationId: audit!.id, fingerprint: owned.dispute.candidate.fingerprint, facts: plain(owned.dispute.candidate) });
              }
              for (const balance of owned.balances) {
                if (balance.missingClaim) {
                  await tx.insert(balanceClaims).values({ id: randomUUID(), candidateId: balance.candidateId!, operationId: application.operationId, correlationId: audit!.id, fingerprint: balance.candidate.fingerprint, facts: plain(balance.candidate) });
                }
              }
            }
            for (const balance of owned.balances) {
              const candidate = balance.candidate;
              const [claim] = await tx.select().from(balanceClaims).where(and(eq(balanceClaims.candidateId, balance.candidateId!), eq(balanceClaims.operationId, application.operationId), eq(balanceClaims.fingerprint, candidate.fingerprint))).limit(1);
              const success = data.disputeDescriptors.filter(r => r.dispute?.balanceTransactions.some(b => b.id === candidate.movementKey.balanceTransactionId)).sort((a, b) => a.dispute!.eventCreated! - b.dispute!.eventCreated! || a.inboxId.localeCompare(b.inboxId))[0]!;
              const projection = data.disputeRows.find(r => r.inboxId === success.inboxId)!;
              if (!claim) {
                throw new Error('CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_CLAIM_MISSING');
              }
              const row: Movement = { ...common, id: randomUUID(), operationId: application.operationId, accountScope: 'connected', accountId: candidate.movementKey.accountId, kind: candidate.category === 'dispute' ? 'dispute_withdrawal' : 'dispute_reinstatement', movementId: candidate.movementKey.balanceTransactionId, movementKeyHash: providerCorrelationFingerprint(candidate.movementKey), applicationFeeId: null, disputeId: candidate.disputeId, amountCents: candidate.amountCents, feeCents: candidate.feeCents, netCents: candidate.netCents, objectCreatedAt: new Date(success.dispute!.objectCreated! * 1000), occurredAt: new Date(candidate.created * 1000), fingerprint: '', evidence: plain({ candidateId: balance.candidateId, claimId: claim.id, candidateFingerprint: candidate.fingerprint, projectionId: projection.id, inboxId: success.inboxId, receiptFingerprint: projection.receiptFingerprint, projectionFingerprint: projection.fingerprint, movementKey: candidate.movementKey, candidateFacts: candidate }) };
              row.fingerprint = monetaryFingerprint(row);
              proposed.push(row);
            }
          }
          // A complete scan must still account for every previously recorded fact.
          if (existing.some(row => !proposed.some(p => p.movementKeyHash === row.movementKeyHash && p.fingerprint === row.fingerprint))) {
            return held(['MOVEMENT_HISTORY_CONTRADICTION']);
          }
          for (const row of proposed) {
            const matches = await tx.select().from(movements).where(eq(movements.movementKeyHash, row.movementKeyHash)).limit(2);
            if (matches.length > 1 || matches.some(r => r.applicationId !== application.id || r.fingerprint !== row.fingerprint)) {
              return held(['MOVEMENT_IDENTITY_CONFLICT']);
            }
          }
          const finalRefundClaims = refundCandidateIds.length ? await tx.select().from(refundClaims).where(inArray(refundClaims.candidateId, refundCandidateIds)).orderBy(asc(refundClaims.id)) : [];
          const finalDisputeClaims = disputeCandidateIds.length ? await tx.select().from(disputeClaims).where(inArray(disputeClaims.candidateId, disputeCandidateIds)).orderBy(asc(disputeClaims.id)) : [];
          const finalBalanceClaims = balanceCandidateIds.length ? await tx.select().from(balanceClaims).where(inArray(balanceClaims.candidateId, balanceCandidateIds)).orderBy(asc(balanceClaims.id)) : [];
          const ownershipEvidence = { parent: claimFacts(data.parentClaims), refund: claimFacts(finalRefundClaims), dispute: claimFacts(finalDisputeClaims), balance: claimFacts(finalBalanceClaims) };
          const ownershipRevision = providerCorrelationFingerprint(ownershipEvidence);
          const [finalPlatform] = await tx.select().from(platforms).where(eq(platforms.platformId, application.platformId)).for('share', { noWait: true }).limit(1);
          if (!finalPlatform) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_PLATFORM_MISSING');
          }
          const rows = proposed.map(row => existing.find(r => r.movementKeyHash === row.movementKeyHash) ?? row).sort((a, b) => a.movementKeyHash.localeCompare(b.movementKeyHash));
          const movementEvidence = rows.map(r => ({ id: r.id, movementKeyHash: r.movementKeyHash, fingerprint: r.fingerprint }));
          const [latest] = await tx.select().from(reconciliations).where(eq(reconciliations.applicationId, application.id)).orderBy(desc(reconciliations.createdAt), desc(reconciliations.id)).limit(1);
          if (latest && latest.platformRevision === finalPlatform.revision && latest.sourceRevision === data.sourceRevision && latest.ownershipRevision === ownershipRevision && providerCorrelationFingerprint(latest.movementEvidence) === providerCorrelationFingerprint(movementEvidence)) {
            return report('replayed', latest.id, rows.map(r => r.id));
          }
          const insertedReconciliations = await tx.insert(reconciliations).values({ id: reconciliationId, applicationId: application.id, platformRevision: finalPlatform.revision, sourceRevision: data.sourceRevision, sourceEvidence: data.source, ownershipRevision, ownershipEvidence, movementEvidence, createdAt: recordedAt }).returning();
          if (insertedReconciliations.length !== 1) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_WRITE_FAILED');
          }
          for (const row of rows) {
            if (!existing.some(r => r.id === row.id)) {
              const inserted = await tx.insert(movements).values(row).returning();
              if (inserted.length !== 1) {
                throw new Error('CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_WRITE_FAILED');
              }
            }
          }
          const written = await tx.select().from(movements).where(eq(movements.applicationId, application.id)).orderBy(asc(movements.movementKeyHash));
          if (providerCorrelationFingerprint(written.map(r => ({ id: r.id, movementKeyHash: r.movementKeyHash, fingerprint: r.fingerprint }))) !== providerCorrelationFingerprint(movementEvidence)) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_SET_WRITE_FAILED');
          }
          return report('applied', reconciliationId, rows.map(r => r.id));
        });
      } catch (error) {
        if (error instanceof HeldMovementBatch) {
          return error.result;
        }
        throw error;
      }
    },
  };
}
