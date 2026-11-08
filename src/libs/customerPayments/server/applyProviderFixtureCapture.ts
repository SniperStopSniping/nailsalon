import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import type { db } from '@/libs/DB';
import { customerPaymentChargeCandidateSchema as candidates, customerPaymentChargeClaimSchema as claims, customerPaymentCorrelationLinkSchema as links, customerPaymentCorrelationSchema as correlations } from '@/models/customerPaymentCorrelationSchema';
import { customerPaymentFixtureApplicationSchema as applications, customerPaymentFixtureHoldSchema as holds, customerPaymentFixturePlatformSchema as platforms } from '@/models/customerPaymentFixtureApplicationSchema';
import { customerPaymentProviderConflictSchema as conflicts, customerPaymentProviderInboxSchema as inboxes, customerPaymentProviderOperationSchema as operations } from '@/models/customerPaymentProviderSchema';
import { customerPaymentCaptureSchema as captures, customerPaymentPolicySchema, customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';
import { appointmentAccessTokenSchema, appointmentAddOnSchema, appointmentDepositSchema, appointmentPaymentSchema, appointmentSchema, appointmentServicesSchema, salonSchema, salonStripeAccountSchema } from '@/models/Schema';

import { requireCustomerPaymentFixtureApplicationEnabled } from '../fixtureApplicationGate';
import { verifyOfflineFixtureCaptureTender } from '../provenance';
import { providerCorrelationFingerprint } from '../provider/correlation';
import { buildCustomerPaymentQuoteMaterial } from '../quoteMaterial';
import { customerPaymentDraftResponse } from '../settings';
import { customerPaymentFingerprint } from './preparationRepository';
import { loadProviderCorrelationSource } from './providerCorrelation';
import { withProviderFixtureTransaction } from './providerFixtureFence';

type Database = Pick<typeof db, 'select' | 'transaction'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Application = typeof applications.$inferSelect;
const request = z.object({ operationId: z.string().uuid() }).strict();
const allowedEvents = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded', 'charge.succeeded', 'application_fee.created']);
const plain = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));
function result(state: 'applied' | 'replayed' | 'held', application: Pick<Application, 'id' | 'captureId' | 'tenderId'> | null, reasons: string[] = []) {
  return { state, source: 'offline_fixture_test' as const, financialPostingAllowed: false as const, applicationId: application?.id ?? null, captureId: application?.captureId ?? null, tenderId: application?.tenderId ?? null, reasons };
}

/** Full platform scan deliberately over-holds unknown/unallocated fixture money. */
async function currentSource(tx: Transaction, operationId: string) {
  const data = await loadProviderCorrelationSource(tx, operationId, [], false, { ignoreRetainedLinks: true });
  const platformId = data.input.operation.identity.platformId;
  const rows = await tx.select().from(inboxes).where(eq(inboxes.platformId, platformId)).orderBy(asc(inboxes.id)).limit(1025);
  const conflictRows = rows.length ? await tx.select().from(conflicts).where(inArray(conflicts.inboxId, rows.map(row => row.id))).orderBy(asc(conflicts.id)).limit(1025) : [];
  const selected = new Set(data.inboxIds);
  const blocked = rows.length > 1024 || conflictRows.length > 0 || rows.some(row =>
    row.mode !== 'test' || row.receipt.source !== 'offline_signed_fixture'
    || !allowedEvents.has(String(row.receipt.eventType))
    || (!selected.has(row.id) && row.receipt.classification !== 'accepted'));
  const source = plain({ ...data.source, platformEvidence: rows.map(row => ({ id: row.id, fingerprint: row.fingerprint })), platformConflicts: conflictRows.map(row => ({ id: row.id, inboxId: row.inboxId, fingerprint: row.fingerprint })), blocked });
  return { ...data, source, sourceRevision: providerCorrelationFingerprint(source), blocked, scope: rows };
}

/** Revalidate the same authoritative material as the synthetic seam, without changing it. */
async function sourceMaterial(tx: Transaction, appointment: typeof appointmentSchema.$inferSelect, quote: typeof customerPaymentPreparedQuoteSchema.$inferSelect) {
  const [policy] = await tx.select().from(customerPaymentPolicySchema).where(eq(customerPaymentPolicySchema.salonId, appointment.salonId)).for('update', { noWait: true }).limit(1);
  const capabilityId = (quote.context.capability as { tokenId?: unknown } | undefined)?.tokenId;
  const [capability] = typeof capabilityId === 'string'
    ? await tx.select({ tokenId: appointmentAccessTokenSchema.id, salonId: appointmentAccessTokenSchema.salonId, appointmentId: appointmentAccessTokenSchema.appointmentId, expiresAt: appointmentAccessTokenSchema.expiresAt, revokedAt: appointmentAccessTokenSchema.revokedAt }).from(appointmentAccessTokenSchema).where(and(eq(appointmentAccessTokenSchema.id, capabilityId), eq(appointmentAccessTokenSchema.salonId, appointment.salonId), eq(appointmentAccessTokenSchema.appointmentId, appointment.id))).for('update', { noWait: true }).limit(1)
    : [];
  let salon: { id: string; status: string | null; publicationStatus: string; deletedAt: Date | null } | undefined;
  try {
    salon = await tx.transaction(async (savepoint) => {
      const [row] = await savepoint.select({ id: salonSchema.id, status: salonSchema.status, publicationStatus: salonSchema.publicationStatus, deletedAt: salonSchema.deletedAt }).from(salonSchema).where(eq(salonSchema.id, appointment.salonId)).for('share', { noWait: true }).limit(1);
      return row;
    });
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure.cause?.code ?? failure.code) !== '55P03') {
      throw error;
    }
    return 'CAPTURE_SOURCE_BUSY';
  }
  const bindings = await tx.select().from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, appointment.salonId), isNull(salonStripeAccountSchema.revokedAt))).for('share', { noWait: true }).limit(2);
  const services = await tx.select().from(appointmentServicesSchema).where(eq(appointmentServicesSchema.appointmentId, appointment.id)).orderBy(asc(appointmentServicesSchema.id)).for('share', { noWait: true });
  const addOns = await tx.select().from(appointmentAddOnSchema).where(eq(appointmentAddOnSchema.appointmentId, appointment.id)).orderBy(asc(appointmentAddOnSchema.id)).for('share', { noWait: true });
  const payments = await tx.select().from(appointmentPaymentSchema).where(eq(appointmentPaymentSchema.appointmentId, appointment.id)).orderBy(asc(appointmentPaymentSchema.id));
  const deposits = await tx.select().from(appointmentDepositSchema).where(eq(appointmentDepositSchema.appointmentId, appointment.id)).orderBy(asc(appointmentDepositSchema.id));
  // Database failures above must roll back, not be mistaken for an ordinary hold.
  try {
    if (!policy || !capability || !salon || bindings.length !== 1) {
      return 'CAPTURE_SOURCE_MISSING';
    }
    const material = buildCustomerPaymentQuoteMaterial({ appointment, salon, capability, binding: bindings[0]!, policy: customerPaymentDraftResponse(policy.revision, policy.settings), services, addOns, payments, deposits, tipCents: quote.snapshot.tipCents, existingExpiresAt: quote.expiresAt, now: new Date() });
    const fingerprint = customerPaymentFingerprint({ salonId: quote.salonId, appointmentId: quote.appointmentId, policyRevision: policy.revision, stripeAccountId: material.stripeAccountId, snapshot: material.snapshot, context: material.context, expiresAt: material.expiresAt.toISOString(), mode: 'test', executable: false });
    return fingerprint === quote.fingerprint ? null : 'CAPTURE_QUOTE_STALE';
  } catch {
    return 'CAPTURE_SOURCE_REVIEW_REQUIRED';
  }
}

/**
 * Canonical rehearsal only. Reads already persisted, closed fake-transport facts.
 * No provider calls, no original-review promotion, no refund/dispute allocation.
 */
export function createProviderFixtureCaptureApplication(database: Database) {
  return {
    async applyCapture(raw: { operationId: string }) {
      requireCustomerPaymentFixtureApplicationEnabled();
      const { operationId } = request.parse(raw);
      return withProviderFixtureTransaction(database, async (tx) => {
        const [identity] = await tx.select().from(operations).where(eq(operations.id, operationId)).limit(1);
        if (!identity) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_OPERATION_NOT_FOUND');
        }
        const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, identity.appointmentId), eq(appointmentSchema.salonId, identity.salonId))).for('update', { noWait: true }).limit(1);
        await tx.select({ id: operations.id }).from(operations).where(eq(operations.id, operationId)).for('update', { noWait: true }).limit(1);
        if (!appointment) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_APPOINTMENT_NOT_FOUND');
        }
        const [existing] = await tx.select().from(applications).where(eq(applications.operationId, operationId)).limit(1);
        const data = await currentSource(tx, operationId);
        const candidate = data.result.captureCandidate;
        if (data.blocked || data.overflow || data.result.state !== 'correlated' || !candidate || !['matched', 'not_required'].includes(data.result.fee.state)) {
          return result('held', existing ?? null, ['FIXTURE_EVIDENCE_REVIEW_REQUIRED', ...data.result.reasons]);
        }
        const key = candidate.chargeKey;
        const [owned] = await tx.select().from(candidates).where(and(eq(candidates.platformId, key.platformId), eq(candidates.accountId, key.accountId), eq(candidates.mode, key.mode), eq(candidates.chargeId, key.chargeId))).limit(1);
        let charge = owned;
        const owners = charge ? await tx.select().from(claims).where(eq(claims.candidateId, charge.id)).orderBy(asc(claims.operationId), asc(claims.fingerprint)).limit(257) : [];
        if ((charge && charge.firstOperationId !== operationId) || owners.length > 256 || owners.some(row => row.operationId !== operationId || row.fingerprint !== candidate.fingerprint)) {
          return result('held', existing ?? null, ['CHARGE_OWNERSHIP_CONFLICT']);
        }
        if (existing) {
          const [platform] = await tx.select().from(platforms).where(eq(platforms.platformId, key.platformId)).for('share', { noWait: true }).limit(1);
          const [hold] = await tx.select({ id: holds.id }).from(holds).where(eq(holds.applicationId, existing.id)).limit(1);
          const [capture] = await tx.select().from(captures).where(eq(captures.id, existing.captureId)).limit(1);
          const exactClaim = owners.find(row => row.operationId === operationId && row.fingerprint === candidate.fingerprint);
          if (hold || !platform || platform.revision !== existing.platformRevision || !capture || !exactClaim
            || capture.source !== 'offline_fixture_test' || capture.fingerprint !== existing.captureFingerprint
            || existing.chargeId !== key.chargeId || existing.accountId !== key.accountId || existing.platformId !== key.platformId
            || existing.paymentIntentId !== candidate.paymentIntentId || existing.candidateId !== charge?.id) {
            return result('held', existing, ['FIXTURE_APPLICATION_REVIEW_REQUIRED']);
          }
          return result('replayed', existing);
        }
        const [quote] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(eq(customerPaymentPreparedQuoteSchema.id, identity.quoteId)).limit(1);
        if (!quote) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_QUOTE_NOT_FOUND');
        }
        const success = data.input.receipts.filter(row => row.receipt.eventType === 'charge.succeeded' && row.receipt.objectId === key.chargeId)
          .sort((a, b) => Number(a.receipt.normalizedFacts.created) - Number(b.receipt.normalizedFacts.created) || a.inboxId.localeCompare(b.inboxId))[0];
        const seconds = success?.receipt.normalizedFacts.created;
        if (!success || typeof seconds !== 'number' || !Number.isSafeInteger(seconds)) {
          return result('held', null, ['CAPTURE_SUCCESS_TIME_UNPROVEN']);
        }
        const successEventAt = new Date(seconds * 1000);
        if (successEventAt < quote.createdAt || successEventAt >= quote.expiresAt || successEventAt > new Date() || new Date() >= quote.expiresAt) {
          return result('held', null, ['CAPTURE_SUCCESS_TIME_REVIEW_REQUIRED']);
        }
        const materialReason = await sourceMaterial(tx, appointment, quote);
        if (materialReason) {
          return result('held', null, [materialReason]);
        }
        // Retain this already complete closure before binding the final revision.
        // A later identical correlation rerun must not create new material links.
        for (const inboxId of data.inboxIds) {
          await tx.insert(links).values({ id: randomUUID(), operationId, inboxId }).onConflictDoNothing();
          const [retained] = await tx.select({ id: links.id }).from(links).where(and(eq(links.operationId, operationId), eq(links.inboxId, inboxId))).limit(1);
          if (!retained) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_LINK_WRITE_FAILED');
          }
        }
        if (!charge) {
          [charge] = await tx.insert(candidates).values({ id: randomUUID(), ...key, firstOperationId: operationId }).returning();
          if (!charge) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_CANDIDATE_WRITE_FAILED');
          }
        }
        let claim = owners.find(row => row.operationId === operationId && row.fingerprint === candidate.fingerprint);
        const ownershipRevision = providerCorrelationFingerprint([{ operationId, fingerprint: candidate.fingerprint }]);
        if (!claim) {
          const [latest] = await tx.select().from(correlations).where(eq(correlations.operationId, operationId)).orderBy(desc(correlations.version)).limit(1);
          const [audit] = await tx.insert(correlations).values({ id: randomUUID(), operationId, version: (latest?.version ?? 0) + 1, sourceRevision: data.sourceRevision, ownershipRevision, source: data.source, result: plain(data.result) }).returning();
          if (!audit) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_CORRELATION_WRITE_FAILED');
          }
          [claim] = await tx.insert(claims).values({ id: randomUUID(), candidateId: charge.id, operationId, correlationId: audit.id, fingerprint: candidate.fingerprint, facts: plain(candidate) }).returning();
          if (!claim) {
            throw new Error('CUSTOMER_PAYMENT_FIXTURE_CLAIM_WRITE_FAILED');
          }
        }
        const finalOwners = await tx.select().from(claims).where(eq(claims.candidateId, charge.id)).orderBy(asc(claims.operationId), asc(claims.fingerprint)).limit(257);
        if (finalOwners.length !== 1 || finalOwners[0]!.id !== claim.id) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_OWNERSHIP_CHANGED');
        }
        const [platform] = await tx.select().from(platforms).where(eq(platforms.platformId, key.platformId)).for('share', { noWait: true }).limit(1);
        if (!platform) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_PLATFORM_MISSING');
        }
        const recordedAt = new Date();
        if (recordedAt >= quote.expiresAt) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_CAPTURE_LATE_RETRY_REQUIRED');
        }
        const captureId = randomUUID();
        const tenderId = `cpay_${captureId}`;
        const captureFingerprint = customerPaymentFingerprint({ source: 'offline_fixture_test', operationId, quoteId: quote.id, chargeKey: key, candidateFingerprint: candidate.fingerprint, sourceRevision: data.sourceRevision, ownershipRevision, platformRevision: platform.revision, successInboxId: success.inboxId, successEventAt: successEventAt.toISOString() });
        const [tender] = await tx.insert(appointmentPaymentSchema).values({ id: tenderId, salonId: quote.salonId, appointmentId: quote.appointmentId, amountCents: candidate.amountCents, method: 'online', reference: `customer_payment_capture:${captureId}`, recordedByType: 'system', recordedAt: successEventAt, createdAt: recordedAt }).returning();
        if (!tender) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_TENDER_WRITE_FAILED');
        }
        const [capture] = await tx.insert(captures).values({ id: captureId, salonId: quote.salonId, appointmentId: quote.appointmentId, quoteId: quote.id, stripeAccountId: key.accountId, source: 'offline_fixture_test', mode: 'test', paymentIntentId: candidate.paymentIntentId, tenderId, currency: candidate.currency, amountCents: candidate.amountCents, applicationFeeCents: candidate.applicationFeeCents, principalCents: quote.snapshot.chargeCents - quote.snapshot.tipCents, tipCents: quote.snapshot.tipCents, quotedApplicationFeeCents: quote.snapshot.applicationFeeCents, state: 'posted', reviewReason: null, capturedAt: successEventAt, recordedAt, fingerprint: captureFingerprint }).returning();
        if (!capture) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_CAPTURE_WRITE_FAILED');
        }
        const [application] = await tx.insert(applications).values({ id: randomUUID(), operationId, quoteId: quote.id, captureId, tenderId, salonId: quote.salonId, appointmentId: quote.appointmentId, platformId: key.platformId, accountId: key.accountId, mode: 'test', source: 'offline_fixture_test', chargeId: key.chargeId, paymentIntentId: candidate.paymentIntentId, candidateId: charge.id, correlationId: claim.correlationId, sourceRevision: data.sourceRevision, sourceEvidence: data.source, ownershipRevision, ownershipEvidence: [{ operationId, fingerprint: candidate.fingerprint }], platformRevision: platform.revision, captureFingerprint, quoteFingerprint: quote.fingerprint, amountCents: capture.amountCents, principalCents: capture.principalCents, tipCents: capture.tipCents, applicationFeeCents: capture.applicationFeeCents, currency: candidate.currency, successReceiptFingerprint: data.scope.find(row => row.id === success.inboxId)!.fingerprint, successInboxId: success.inboxId, successEventAt, createdAt: recordedAt }).returning();
        if (!application) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_APPLICATION_WRITE_FAILED');
        }
        if (providerCorrelationFingerprint(application.sourceEvidence) !== application.sourceRevision
          || providerCorrelationFingerprint(application.ownershipEvidence) !== application.ownershipRevision) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_EVIDENCE_DIGEST_MISMATCH');
        }
        const proven = verifyOfflineFixtureCaptureTender(tender, capture, { application, quote, currentPlatformRevision: platform.revision, holds: [] });
        const ledger = resolveAppointmentPaymentLedger({ cachedAmountPaidCents: capture.amountCents, paymentRows: [proven], expectedSalonId: quote.salonId, appointmentStatus: appointment.status, paymentStatus: appointment.paymentStatus });
        if (!ledger.ok) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_LEDGER_CONFLICT');
        }
        // Strict material validation proves zero prior tender/deposits/tip. Do
        // not change status, tax, invoice, fee allocation, or any lifecycle field.
        const updated = await tx.update(appointmentSchema).set({ amountPaidCents: ledger.ledgerPaymentsCents, tipCents: capture.tipCents, updatedAt: recordedAt }).where(and(eq(appointmentSchema.id, quote.appointmentId), eq(appointmentSchema.salonId, quote.salonId))).returning();
        if (updated.length !== 1) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_CACHE_WRITE_FAILED');
        }
        return result('applied', application);
      });
    },
  };
}
