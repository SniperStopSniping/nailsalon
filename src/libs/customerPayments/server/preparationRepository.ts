import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { customerPaymentPolicyReceiptSchema, customerPaymentPolicySchema, customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';
import { appointmentSchema, salonSchema } from '@/models/Schema';

import { prepareCustomerPaymentAttempt } from '../attempt';
import type { CustomerPaymentSnapshot } from '../money';
import type { CustomerPaymentDraftResponse, CustomerPaymentDraftSettings } from '../settings';
import { customerPaymentDraftResponse, customerPaymentDraftWriteSchema, DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';

export type CustomerPaymentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type CustomerPaymentPreparedQuote = typeof customerPaymentPreparedQuoteSchema.$inferSelect;
type Database = Pick<typeof db, 'transaction'>;

export type CustomerPaymentQuotePrepareRequest = {
  salonId: string;
  appointmentId: string;
  requestId: string;
  requestFingerprint: string;
};
export type CustomerPaymentAuthoritativeQuote = {
  snapshot: CustomerPaymentSnapshot;
  stripeAccountId: string;
  expiresAt: Date;
  context: Record<string, unknown>;
};
export type CustomerPaymentQuoteBuilder = (
  tx: CustomerPaymentTransaction,
  appointment: typeof appointmentSchema.$inferSelect,
  policy: CustomerPaymentDraftResponse,
  existing: CustomerPaymentPreparedQuote | null,
) => Promise<CustomerPaymentAuthoritativeQuote>;

/** Stable JSON only. Reject values JSON would silently omit or coerce. */
export function customerPaymentFingerprint(value: unknown): string {
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
    if (typeof input === 'object' && input !== null && Object.getPrototypeOf(input) === Object.prototype) {
      return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${canonical((input as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    throw new Error('CUSTOMER_PAYMENT_INVALID_FINGERPRINT_INPUT');
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function identity(...values: string[]) {
  if (values.some(value => typeof value !== 'string' || !value.trim() || value.length > 255)) {
    throw new Error('CUSTOMER_PAYMENT_INVALID_IDENTITY');
  }
}

async function loadPolicy(tx: CustomerPaymentTransaction, salonId: string): Promise<CustomerPaymentDraftResponse> {
  const [row] = await tx.select().from(customerPaymentPolicySchema).where(eq(customerPaymentPolicySchema.salonId, salonId)).for('update').limit(1);
  return row ? customerPaymentDraftResponse(row.revision, row.settings) : customerPaymentDraftResponse(0, DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS);
}

export function createCustomerPaymentPreparationRepository(database: Database) {
  return {
    async readCustomerPaymentSettingsDraft(salonId: string) {
      identity(salonId);
      return database.transaction(async (tx) => {
        const [salon] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
        if (!salon) {
          throw new Error('CUSTOMER_PAYMENT_SALON_NOT_FOUND');
        }
        return loadPolicy(tx, salonId);
      });
    },
    async saveCustomerPaymentSettingsDraft(input: { salonId: string; actorId: string; expectedRevision: number; requestId: string; settings: CustomerPaymentDraftSettings }) {
      identity(input.salonId, input.actorId);
      const request = customerPaymentDraftWriteSchema.parse({ expectedRevision: input.expectedRevision, requestId: input.requestId, settings: input.settings });
      const fingerprint = customerPaymentFingerprint(request);
      return database.transaction(async (tx) => {
        // Policy writers never acquire appointment locks after this salon lock.
        // NO KEY UPDATE serializes CAS without conflicting with FK KEY SHARE
        // from quote insertion; do not upgrade this to FOR UPDATE.
        const [salon] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, input.salonId)).for('no key update').limit(1);
        if (!salon) {
          throw new Error('CUSTOMER_PAYMENT_SALON_NOT_FOUND');
        }
        const [receipt] = await tx.select().from(customerPaymentPolicyReceiptSchema).where(and(eq(customerPaymentPolicyReceiptSchema.salonId, input.salonId), eq(customerPaymentPolicyReceiptSchema.actorId, input.actorId), eq(customerPaymentPolicyReceiptSchema.requestId, request.requestId))).limit(1);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) {
            throw new Error('CUSTOMER_PAYMENT_DRAFT_REPLAY_CONFLICT');
          }
          return customerPaymentDraftResponse(receipt.result.revision, receipt.result.settings);
        }
        const current = await loadPolicy(tx, input.salonId);
        if (current.revision !== request.expectedRevision) {
          throw new Error('CUSTOMER_PAYMENT_DRAFT_REVISION_CONFLICT');
        }
        const result = customerPaymentDraftResponse(current.revision + 1, request.settings);
        await tx.insert(customerPaymentPolicySchema).values({ salonId: input.salonId, revision: result.revision, settings: result.settings }).onConflictDoUpdate({ target: customerPaymentPolicySchema.salonId, set: { revision: result.revision, settings: result.settings } });
        await tx.insert(customerPaymentPolicyReceiptSchema).values({ id: randomUUID(), salonId: input.salonId, actorId: input.actorId, requestId: request.requestId, fingerprint, result });
        return result;
      });
    },
    async prepareCustomerPaymentQuote(input: CustomerPaymentQuotePrepareRequest, buildAuthoritativeQuote: CustomerPaymentQuoteBuilder) {
      identity(input.salonId, input.appointmentId, input.requestId);
      if (!/^[a-f0-9]{64}$/.test(input.requestFingerprint)) {
        throw new Error('CUSTOMER_PAYMENT_INVALID_REQUEST_FINGERPRINT');
      }
      return database.transaction(async (tx) => {
        // Canonical lock order: appointment first, then policy. Authoritative
        // loading and replay revalidation happen inside this same transaction.
        const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, input.appointmentId), eq(appointmentSchema.salonId, input.salonId))).for('update').limit(1);
        if (!appointment) {
          throw new Error('CUSTOMER_PAYMENT_APPOINTMENT_NOT_FOUND');
        }
        const policy = await loadPolicy(tx, input.salonId);
        const [existing] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(and(eq(customerPaymentPreparedQuoteSchema.salonId, input.salonId), eq(customerPaymentPreparedQuoteSchema.appointmentId, input.appointmentId), eq(customerPaymentPreparedQuoteSchema.requestId, input.requestId))).limit(1);
        if (existing && existing.requestFingerprint !== input.requestFingerprint) {
          throw new Error('CUSTOMER_PAYMENT_QUOTE_REPLAY_CONFLICT');
        }
        if (!policy.settings.enabled || policy.revision <= 0) {
          throw new Error('CUSTOMER_PAYMENT_DRAFT_DISABLED');
        }
        const authoritative = await buildAuthoritativeQuote(tx, appointment, policy, existing ?? null);
        const now = new Date();
        if (!Number.isSafeInteger(authoritative.expiresAt.getTime()) || authoritative.expiresAt <= now
          || (existing && existing.expiresAt <= now)) {
          throw new Error('CUSTOMER_PAYMENT_QUOTE_STALE');
        }
        if (authoritative.snapshot.collection !== 'full' || authoritative.snapshot.configuredFeeCents !== policy.settings.platformFeeCents) {
          throw new Error('CUSTOMER_PAYMENT_QUOTE_POLICY_MISMATCH');
        }
        const canonical = prepareCustomerPaymentAttempt({ referenceId: existing?.id ?? randomUUID(), salonId: input.salonId, appointmentId: input.appointmentId, stripeAccountId: authoritative.stripeAccountId, snapshot: authoritative.snapshot, expiresAt: authoritative.expiresAt.getTime() });
        const fingerprint = customerPaymentFingerprint({ salonId: input.salonId, appointmentId: input.appointmentId, policyRevision: policy.revision, stripeAccountId: authoritative.stripeAccountId, snapshot: canonical.snapshot, context: authoritative.context, expiresAt: authoritative.expiresAt.toISOString(), mode: 'test', executable: false });
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new Error('CUSTOMER_PAYMENT_QUOTE_STALE');
          }
          return existing;
        }
        const drafts = await tx.select({ id: customerPaymentPreparedQuoteSchema.id }).from(customerPaymentPreparedQuoteSchema).where(and(eq(customerPaymentPreparedQuoteSchema.salonId, input.salonId), eq(customerPaymentPreparedQuoteSchema.appointmentId, input.appointmentId))).limit(50);
        if (drafts.length >= 50) {
          throw new Error('CUSTOMER_PAYMENT_QUOTE_LIMIT_REACHED');
        }
        const [created] = await tx.insert(customerPaymentPreparedQuoteSchema).values({ ...input, id: canonical.referenceId, fingerprint, policyRevision: policy.revision, stripeAccountId: authoritative.stripeAccountId, snapshot: canonical.snapshot, context: authoritative.context, expiresAt: authoritative.expiresAt, createdAt: now }).returning();
        if (!created) {
          throw new Error('CUSTOMER_PAYMENT_QUOTE_NOT_PERSISTED');
        }
        return created;
      });
    },
  };
}
