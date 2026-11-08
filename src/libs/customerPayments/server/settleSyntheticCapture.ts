import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { db } from '@/libs/DB';
import { customerPaymentCaptureEventSchema, customerPaymentCaptureSchema, customerPaymentPolicySchema, customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';
import { appointmentAccessTokenSchema, appointmentAddOnSchema, appointmentDepositSchema, appointmentPaymentSchema, appointmentSchema, appointmentServicesSchema, salonSchema, salonStripeAccountSchema } from '@/models/Schema';

import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import { verifyCustomerPaymentTender } from '../provenance';
import { buildCustomerPaymentQuoteMaterial } from '../quoteMaterial';
import { customerPaymentDraftResponse } from '../settings';
import { customerPaymentFingerprint } from './preparationRepository';

const evidenceSchema = z.object({
  quoteId: z.string().min(1).max(200),
  eventId: z.string().min(1).max(200),
  paymentIntentId: z.string().regex(/^pi_[\w-]+$/).max(200),
  stripeAccountId: z.string().regex(/^acct_[a-z0-9]+$/i).max(200),
  source: z.literal('synthetic_test'),
  livemode: z.literal(false),
  currency: z.string().regex(/^[a-z]{3}$/),
  amountCents: z.number().int().positive().max(MAX_SUPPORTED_MINOR_UNIT_AMOUNT),
  applicationFeeCents: z.number().int().nonnegative().max(MAX_SUPPORTED_MINOR_UNIT_AMOUNT),
  capturedAt: z.date(),
}).strict().refine(value => value.applicationFeeCents < value.amountCents, 'Fee must be below capture');
export type SyntheticCustomerPaymentCapture = z.infer<typeof evidenceSchema>;
type Database = Pick<typeof db, 'select' | 'transaction'>;

/**
 * Internal synthetic fixture seam only, deliberately no route/provider adapter.
 * Accepted capture facts and their active/review marker are one atomic write.
 * Review never revives a booking or erases previously accounted-for tender.
 */
export async function settleSyntheticCustomerPaymentCapture(database: Database, input: SyntheticCustomerPaymentCapture) {
  if (!isCustomerPaymentLedgerTestEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_LEDGER_TEST_DISABLED');
  }
  const evidence = evidenceSchema.parse(input);
  if (evidence.capturedAt.getTime() > Date.now()) {
    throw new Error('CUSTOMER_PAYMENT_CAPTURE_FUTURE_TIMESTAMP');
  }
  const [identity] = await database.select().from(customerPaymentPreparedQuoteSchema).where(eq(customerPaymentPreparedQuoteSchema.id, evidence.quoteId)).limit(1);
  if (!identity) {
    throw new Error('CUSTOMER_PAYMENT_CAPTURE_QUOTE_NOT_FOUND');
  }
  // Never attribute another account's event to this salon. A future verified
  // inbox must retain unmatched foreign evidence separately, outside this seam.
  if (identity.stripeAccountId !== evidence.stripeAccountId) {
    throw new Error('CUSTOMER_PAYMENT_CAPTURE_ACCOUNT_MISMATCH');
  }
  const { eventId, ...captureEvidence } = evidence;
  const fingerprint = customerPaymentFingerprint({ ...captureEvidence, capturedAt: evidence.capturedAt.toISOString() });
  return database.transaction(async (tx) => {
    const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, identity.appointmentId), eq(appointmentSchema.salonId, identity.salonId))).for('update').limit(1);
    if (!appointment) {
      throw new Error('CUSTOMER_PAYMENT_CAPTURE_APPOINTMENT_NOT_FOUND');
    }
    const [quote] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(eq(customerPaymentPreparedQuoteSchema.id, identity.id)).limit(1);
    if (!quote) {
      throw new Error('CUSTOMER_PAYMENT_CAPTURE_QUOTE_NOT_FOUND');
    }
    const [receipt] = await tx.select().from(customerPaymentCaptureEventSchema).where(and(eq(customerPaymentCaptureEventSchema.stripeAccountId, evidence.stripeAccountId), eq(customerPaymentCaptureEventSchema.mode, 'test'), eq(customerPaymentCaptureEventSchema.eventId, eventId))).limit(1);
    if (receipt && receipt.fingerprint !== fingerprint) {
      throw new Error('CUSTOMER_PAYMENT_CAPTURE_EVENT_CONFLICT');
    }
    const [existing] = await tx.select().from(customerPaymentCaptureSchema).where(and(eq(customerPaymentCaptureSchema.stripeAccountId, evidence.stripeAccountId), eq(customerPaymentCaptureSchema.mode, 'test'), eq(customerPaymentCaptureSchema.paymentIntentId, evidence.paymentIntentId))).limit(1);
    if (existing) {
      if (existing.fingerprint !== fingerprint || (receipt && receipt.captureId !== existing.id)) {
        throw new Error('CUSTOMER_PAYMENT_CAPTURE_IDENTITY_CONFLICT');
      }
      if (!receipt) {
        await tx.insert(customerPaymentCaptureEventSchema).values({ id: randomUUID(), captureId: existing.id, stripeAccountId: evidence.stripeAccountId, eventId, fingerprint });
      }
      return existing;
    }
    if (receipt) {
      throw new Error('CUSTOMER_PAYMENT_CAPTURE_EVENT_CONFLICT');
    }
    try {
      // Pin the FK target without waiting while holding appointment. If an
      // exclusive salon writer owns it, no evidence was accepted: caller must
      // retry. A future verified inbox must retain delivery independently.
      await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, appointment.salonId)).for('key share', { noWait: true }).limit(1);
    } catch (error) {
      const cause = error as { code?: string; cause?: { code?: string } };
      if ((cause.cause?.code ?? cause.code) === '55P03') {
        throw new Error('CUSTOMER_PAYMENT_CAPTURE_RETRY_REQUIRED');
      }
      throw error;
    }
    let recordedAt = new Date();
    let reviewReason: string | null = null;
    if (recordedAt >= quote.expiresAt || evidence.capturedAt >= quote.expiresAt) {
      reviewReason = 'CAPTURE_LATE';
    } else if (evidence.capturedAt < quote.createdAt) {
      reviewReason = 'CAPTURE_BEFORE_QUOTE';
    } else if (evidence.currency !== quote.snapshot.currency || evidence.amountCents !== quote.snapshot.chargeCents || evidence.applicationFeeCents !== quote.snapshot.applicationFeeCents) {
      reviewReason = 'CAPTURE_AMOUNT_MISMATCH';
    }
    if (reviewReason === null) {
      const [policy] = await tx.select().from(customerPaymentPolicySchema).where(eq(customerPaymentPolicySchema.salonId, appointment.salonId)).for('update').limit(1);
      const capabilityId = (quote.context.capability as { tokenId?: unknown } | undefined)?.tokenId;
      const [capability] = typeof capabilityId === 'string'
        ? await tx.select({ tokenId: appointmentAccessTokenSchema.id, salonId: appointmentAccessTokenSchema.salonId, appointmentId: appointmentAccessTokenSchema.appointmentId, expiresAt: appointmentAccessTokenSchema.expiresAt, revokedAt: appointmentAccessTokenSchema.revokedAt }).from(appointmentAccessTokenSchema).where(and(eq(appointmentAccessTokenSchema.id, capabilityId), eq(appointmentAccessTokenSchema.salonId, appointment.salonId), eq(appointmentAccessTokenSchema.appointmentId, appointment.id))).for('update').limit(1)
        : [];
      let salon: { id: string; status: string | null; publicationStatus: string; deletedAt: Date | null } | undefined;
      try {
        // A salon-first writer may already wait on our policy/app lock. Never
        // wait back on it. Recover only lock contention inside this savepoint.
        salon = await tx.transaction(async (savepoint) => {
          const [row] = await savepoint.select({ id: salonSchema.id, status: salonSchema.status, publicationStatus: salonSchema.publicationStatus, deletedAt: salonSchema.deletedAt }).from(salonSchema).where(eq(salonSchema.id, appointment.salonId)).for('share', { noWait: true }).limit(1);
          return row;
        });
      } catch (error) {
        const cause = error as { code?: string; cause?: { code?: string } };
        if ((cause.cause?.code ?? cause.code) !== '55P03') {
          throw error;
        }
        reviewReason = 'CAPTURE_SOURCE_BUSY';
      }
      if (reviewReason === null) {
        const bindings = await tx.select().from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, appointment.salonId), isNull(salonStripeAccountSchema.revokedAt))).for('share').limit(2);
        const services = await tx.select().from(appointmentServicesSchema).where(eq(appointmentServicesSchema.appointmentId, appointment.id)).orderBy(asc(appointmentServicesSchema.id)).for('share');
        const addOns = await tx.select().from(appointmentAddOnSchema).where(eq(appointmentAddOnSchema.appointmentId, appointment.id)).orderBy(asc(appointmentAddOnSchema.id)).for('share');
        const payments = await tx.select().from(appointmentPaymentSchema).where(eq(appointmentPaymentSchema.appointmentId, appointment.id)).orderBy(asc(appointmentPaymentSchema.id));
        const deposits = await tx.select().from(appointmentDepositSchema).where(eq(appointmentDepositSchema.appointmentId, appointment.id)).orderBy(asc(appointmentDepositSchema.id));
        // Source validation failures are reviewable money, not permission to drop
        // the capture. Database failures above still roll back the entire write.
        try {
          recordedAt = new Date();
          if (!policy || !capability || !salon || bindings.length !== 1) {
            throw new Error('CAPTURE_SOURCE_MISSING');
          }
          const material = buildCustomerPaymentQuoteMaterial({ appointment, salon, capability, binding: bindings[0]!, policy: customerPaymentDraftResponse(policy.revision, policy.settings), services, addOns, payments, deposits, tipCents: quote.snapshot.tipCents, existingExpiresAt: quote.expiresAt, now: recordedAt });
          const currentFingerprint = customerPaymentFingerprint({ salonId: quote.salonId, appointmentId: quote.appointmentId, policyRevision: policy.revision, stripeAccountId: material.stripeAccountId, snapshot: material.snapshot, context: material.context, expiresAt: material.expiresAt.toISOString(), mode: 'test', executable: false });
          if (currentFingerprint !== quote.fingerprint) {
            throw new Error('CAPTURE_QUOTE_STALE');
          }
        } catch {
          reviewReason = 'CAPTURE_SOURCE_REVIEW_REQUIRED';
        }
      }
    }
    recordedAt = new Date();
    if (reviewReason === null && recordedAt >= quote.expiresAt) {
      reviewReason = 'CAPTURE_LATE';
    }
    const id = randomUUID();
    const tenderId = `cpay_${id}`;
    const state = reviewReason === null ? 'posted' as const : 'held_review' as const;
    const [tender] = await tx.insert(appointmentPaymentSchema).values({ id: tenderId, salonId: quote.salonId, appointmentId: quote.appointmentId, amountCents: evidence.amountCents, method: 'online', reference: `customer_payment_capture:${id}`, recordedByType: 'system', recordedAt: evidence.capturedAt, createdAt: recordedAt, voidedAt: state === 'held_review' ? recordedAt : null, voidedBy: state === 'held_review' ? 'customer_payment_review' : null }).returning();
    const [capture] = await tx.insert(customerPaymentCaptureSchema).values({ id, salonId: quote.salonId, appointmentId: quote.appointmentId, quoteId: quote.id, stripeAccountId: evidence.stripeAccountId, source: 'synthetic_test', mode: 'test', paymentIntentId: evidence.paymentIntentId, tenderId, currency: evidence.currency, amountCents: evidence.amountCents, applicationFeeCents: evidence.applicationFeeCents, principalCents: quote.snapshot.chargeCents - quote.snapshot.tipCents, tipCents: quote.snapshot.tipCents, quotedApplicationFeeCents: quote.snapshot.applicationFeeCents, state, reviewReason, capturedAt: evidence.capturedAt, recordedAt, fingerprint }).returning();
    if (!capture) {
      throw new Error('CUSTOMER_PAYMENT_CAPTURE_NOT_PERSISTED');
    }
    await tx.insert(customerPaymentCaptureEventSchema).values({ id: randomUUID(), captureId: capture.id, stripeAccountId: evidence.stripeAccountId, eventId, fingerprint, recordedAt });
    if (state === 'posted') {
      if (!tender) {
        throw new Error('CUSTOMER_PAYMENT_CAPTURE_TENDER_MISSING');
      }
      const proven = verifyCustomerPaymentTender(tender, { ...capture, synthetic: true });
      const ledger = resolveAppointmentPaymentLedger({ cachedAmountPaidCents: evidence.amountCents, paymentRows: [proven], expectedSalonId: quote.salonId, appointmentStatus: appointment.status, paymentStatus: appointment.paymentStatus });
      if (!ledger.ok) {
        throw new Error('CUSTOMER_PAYMENT_CAPTURE_LEDGER_CONFLICT');
      }
      // The strict authoritative material gate proves zero previous tender/tip.
      // Do not modify lifecycle/paymentStatus scalars or any legacy deposit.
      await tx.update(appointmentSchema).set({ tipCents: quote.snapshot.tipCents, amountPaidCents: ledger.ledgerPaymentsCents, updatedAt: recordedAt }).where(and(eq(appointmentSchema.id, quote.appointmentId), eq(appointmentSchema.salonId, quote.salonId)));
    }
    return capture;
  });
}
