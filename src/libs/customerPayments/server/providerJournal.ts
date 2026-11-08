import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { db } from '@/libs/DB';
import { customerPaymentProviderConflictSchema as conflicts, customerPaymentProviderDeliverySchema as deliveries, customerPaymentProviderInboxSchema as inboxes, customerPaymentProviderOperationSchema as operations, customerPaymentProviderOperationStateSchema as states } from '@/models/customerPaymentProviderSchema';
import { customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';

import { assertVerifiedProviderReceipt, type VerifiedProviderReceipt } from '../provider/evidence';
import { applyOperationCommand, claimOperation as claimPure, createOperation, type OperationCommand, type OperationIdentity, type OperationState, validateOperationIdentity, validateOperationState } from '../provider/operations';
import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import { customerPaymentFingerprint } from './preparationRepository';
import { withProviderFixtureTransaction } from './providerFixtureFence';

type Database = Pick<typeof db, 'select' | 'transaction'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const consumerSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const workerSchema = z.string().min(1).max(200).refine(value => value.trim().length > 0);
const leaseSchema = z.number().int().min(1000).max(300000);
const versionSchema = z.number().int().nonnegative().max(2147483646);
const tokenSchema = z.string().uuid();
async function now(database: Pick<typeof db, 'select'>): Promise<number> {
  const [result] = await database.select({ value: sql<string>`floor(extract(epoch FROM clock_timestamp())*1000)::bigint` }).from(sql`(SELECT 1) AS provider_clock`);
  return Number(result!.value);
}
function json(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
function inboxKey(receipt: VerifiedProviderReceipt) {
  return and(eq(inboxes.endpointId, receipt.endpointId), eq(inboxes.platformId, receipt.platformId), eq(inboxes.accountScope, receipt.accountScope), eq(inboxes.accountKey, receipt.accountId ?? ''), eq(inboxes.mode, receipt.mode), eq(inboxes.receiptIdentity, receipt.receiptIdentity));
}
async function lockDelivery(tx: Transaction, id: string) {
  const [known] = await tx.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
  if (!known) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_DELIVERY_NOT_FOUND');
  }
  const [inbox] = await tx.select().from(inboxes).where(eq(inboxes.id, known.inboxId)).for('update').limit(1);
  const [delivery] = await tx.select().from(deliveries).where(eq(deliveries.id, id)).for('update').limit(1);
  if (!inbox || !delivery) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_DELIVERY_NOT_FOUND');
  }
  const [conflict] = await tx.select({ id: conflicts.id }).from(conflicts).where(eq(conflicts.inboxId, inbox.id)).limit(1);
  if (conflict || inbox.receipt.classification !== 'accepted') {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_INBOX_REVIEW');
  }
  return delivery;
}
/** Inert fixture persistence only. No provider SDK, global DB or financial writes. */
export function createProviderJournal(database: Database) {
  return {
    async databaseNow() {
      requireCustomerPaymentProviderFixtureEnabled();
      return now(database);
    },
    async ingestReceipt(receipt: VerifiedProviderReceipt) {
      requireCustomerPaymentProviderFixtureEnabled();
      assertVerifiedProviderReceipt(receipt);
      const { receivedAt: _receivedAt, ...content } = receipt;
      const fingerprint = customerPaymentFingerprint(content);
      const result = await withProviderFixtureTransaction(database, async (tx) => {
        await tx.insert(inboxes).values({ id: randomUUID(), endpointId: receipt.endpointId, platformId: receipt.platformId, accountScope: receipt.accountScope, accountKey: receipt.accountId ?? '', mode: receipt.mode, receiptIdentity: receipt.receiptIdentity, fingerprint, receipt: json(receipt) }).onConflictDoNothing();
        const [existing] = await tx.select().from(inboxes).where(inboxKey(receipt)).for('update').limit(1);
        if (!existing) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_INBOX_WRITE_FAILED');
        }
        if (existing.fingerprint !== fingerprint) {
          await tx.insert(conflicts).values({ id: randomUUID(), inboxId: existing.id, fingerprint, receipt: json(receipt) }).onConflictDoNothing();
          return { conflict: true, inbox: existing };
        }
        const [conflict] = await tx.select({ id: conflicts.id }).from(conflicts).where(eq(conflicts.inboxId, existing.id)).limit(1);
        return { conflict: !!conflict, inbox: existing };
      });
      // Conflict evidence remains durable even though callers must fail closed.
      if (result.conflict) {
        throw new Error('CUSTOMER_PAYMENT_PROVIDER_INBOX_CONFLICT_RETAINED');
      }
      return result.inbox;
    },
    async getInbox(id: string) {
      requireCustomerPaymentProviderFixtureEnabled();
      return withProviderFixtureTransaction(database, async (tx) => {
        const [row] = await tx.select().from(inboxes).where(eq(inboxes.id, id)).for('share').limit(1);
        if (!row) {
          return null;
        }
        const [conflict] = await tx.select({ id: conflicts.id }).from(conflicts).where(eq(conflicts.inboxId, id)).limit(1);
        return { ...row, hasConflict: !!conflict };
      });
    },
    async ensureDelivery(inboxId: string, consumer: string, consumerVersion: number) {
      requireCustomerPaymentProviderFixtureEnabled();
      consumerSchema.parse(consumer);
      z.number().int().min(1).max(1000000).parse(consumerVersion);
      return withProviderFixtureTransaction(database, async (tx) => {
        const [inbox] = await tx.select().from(inboxes).where(eq(inboxes.id, inboxId)).for('update').limit(1);
        if (!inbox) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_INBOX_NOT_FOUND');
        }
        const [conflict] = await tx.select({ id: conflicts.id }).from(conflicts).where(eq(conflicts.inboxId, inboxId)).limit(1);
        await tx.insert(deliveries).values({ id: randomUUID(), inboxId, consumer, consumerVersion, state: conflict || inbox.receipt.classification !== 'accepted' ? 'review' : 'pending' }).onConflictDoNothing();
        const [row] = await tx.select().from(deliveries).where(and(eq(deliveries.inboxId, inboxId), eq(deliveries.consumer, consumer), eq(deliveries.consumerVersion, consumerVersion))).limit(1);
        if (!row) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_DELIVERY_WRITE_FAILED');
        }
        return row;
      });
    },
    async getDelivery(id: string) {
      requireCustomerPaymentProviderFixtureEnabled();
      const [row] = await database.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
      return row ?? null;
    },
    async claimDelivery(id: string, input: { workerId: string; leaseMs: number }) {
      requireCustomerPaymentProviderFixtureEnabled();
      workerSchema.parse(input.workerId);
      leaseSchema.parse(input.leaseMs);
      return withProviderFixtureTransaction(database, async (tx) => {
        const row = await lockDelivery(tx, id);
        const time = await now(tx);
        if (!['pending', 'retry', 'processing'].includes(row.state) || (row.leaseUntil !== null && row.leaseUntil.getTime() > time)) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_DELIVERY_NOT_CLAIMABLE');
        }
        const [claimed] = await tx.update(deliveries).set({ state: 'processing', version: row.version + 1, workerId: input.workerId, leaseToken: randomUUID(), leaseUntil: new Date(time + input.leaseMs), detail: null }).where(and(eq(deliveries.id, id), eq(deliveries.version, row.version))).returning();
        if (!claimed) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_DELIVERY_FENCE');
        }
        return claimed;
      });
    },
    async finishDelivery(id: string, input: { expectedVersion: number; leaseToken: string; outcome: 'completed' | 'review' | 'retry'; detail?: string }) {
      requireCustomerPaymentProviderFixtureEnabled();
      versionSchema.parse(input.expectedVersion);
      tokenSchema.parse(input.leaseToken);
      z.enum(['completed', 'review', 'retry']).parse(input.outcome);
      z.string().max(1000).optional().parse(input.detail);
      return withProviderFixtureTransaction(database, async (tx) => {
        const row = await lockDelivery(tx, id);
        if (row.version !== input.expectedVersion || row.leaseToken !== input.leaseToken || row.state !== 'processing' || !row.leaseUntil || row.leaseUntil.getTime() <= await now(tx)) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_DELIVERY_FENCE');
        }
        const [saved] = await tx.update(deliveries).set({ state: input.outcome, version: row.version + 1, leaseToken: null, leaseUntil: null, detail: input.detail ?? null }).where(and(eq(deliveries.id, id), eq(deliveries.version, input.expectedVersion), eq(deliveries.leaseToken, input.leaseToken))).returning();
        if (!saved) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_DELIVERY_FENCE');
        }
        return saved;
      });
    },
    async prepareOperation(raw: OperationIdentity) {
      requireCustomerPaymentProviderFixtureEnabled();
      const identity = validateOperationIdentity(raw);
      const fingerprint = customerPaymentFingerprint(identity);
      return withProviderFixtureTransaction(database, async (tx) => {
        const [quote] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(eq(customerPaymentPreparedQuoteSchema.id, identity.quoteId)).limit(1);
        if (!quote || quote.salonId !== identity.salonId || quote.appointmentId !== identity.appointmentId || quote.mode !== 'test' || quote.fingerprint !== identity.contextHash
          || (identity.accountScope === 'connected' && identity.accountId !== quote.stripeAccountId)) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_SCOPE');
        }
        if (identity.kind === 'checkout_create' && (identity.parameters.client_reference_id !== quote.id
          || identity.parameters.line_items[0].price_data.currency !== 'cad' || identity.parameters.line_items[0].price_data.unit_amount !== quote.snapshot.chargeCents
          || identity.parameters.payment_intent_data.application_fee_amount !== quote.snapshot.applicationFeeCents)) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_CHECKOUT_QUOTE_MISMATCH');
        }
        await tx.insert(operations).values({ id: identity.id, salonId: identity.salonId, appointmentId: identity.appointmentId, quoteId: identity.quoteId, requestId: identity.requestId, fingerprint, identity: json(identity) }).onConflictDoNothing();
        const [saved] = await tx.select().from(operations).where(and(eq(operations.salonId, identity.salonId), eq(operations.requestId, identity.requestId))).for('update').limit(1);
        if (!saved || saved.id !== identity.id || saved.fingerprint !== fingerprint) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_IDENTITY_CONFLICT');
        }
        const [existing] = await tx.select().from(states).where(eq(states.operationId, saved.id)).limit(1);
        if (existing) {
          return validateOperationState(existing.state as unknown as OperationState);
        }
        const state = createOperation(identity, await now(tx));
        const inserted = await tx.insert(states).values({ operationId: identity.id, version: state.version, state: json(state), command: { type: 'prepare', acceptedAt: state.updatedAt } }).returning();
        if (inserted.length !== 1) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_WRITE_FAILED');
        }
        return validateOperationState(inserted[0]!.state as unknown as OperationState);
      });
    },
    async getOperation(id: string) {
      requireCustomerPaymentProviderFixtureEnabled();
      const [row] = await database.select().from(states).where(eq(states.operationId, id)).limit(1);
      return row ? validateOperationState(row.state as unknown as OperationState) : null;
    },
    async claimOperation(id: string, input: { workerId: string; leaseMs: number; purpose: 'dispatch' | 'reconcile' }) {
      requireCustomerPaymentProviderFixtureEnabled();
      workerSchema.parse(input.workerId);
      leaseSchema.parse(input.leaseMs);
      z.enum(['dispatch', 'reconcile']).parse(input.purpose);
      return withProviderFixtureTransaction(database, async (tx) => {
        const [row] = await tx.select().from(states).where(eq(states.operationId, id)).for('update').limit(1);
        if (!row) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_NOT_FOUND');
        }
        const current = validateOperationState(row.state as unknown as OperationState);
        const next = claimPure(current, { expectedVersion: current.version, leaseToken: randomUUID(), leaseDurationMs: input.leaseMs, purpose: input.purpose, now: await now(tx) });
        const changed = await tx.update(states).set({ version: next.version, state: json(next), command: { type: 'claim', workerId: input.workerId, purpose: input.purpose, previousVersion: current.version, acceptedAt: next.updatedAt } }).where(and(eq(states.operationId, id), eq(states.version, current.version))).returning();
        if (changed.length !== 1) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_WRITE_FAILED');
        }
        return validateOperationState(changed[0]!.state as unknown as OperationState);
      });
    },
    async advanceOperation(id: string, input: { expectedVersion: number; leaseToken: string; command: OperationCommand }) {
      requireCustomerPaymentProviderFixtureEnabled();
      versionSchema.parse(input.expectedVersion);
      tokenSchema.parse(input.leaseToken);
      return withProviderFixtureTransaction(database, async (tx) => {
        const [row] = await tx.select().from(states).where(eq(states.operationId, id)).for('update').limit(1);
        if (!row) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_NOT_FOUND');
        }
        const current = validateOperationState(row.state as unknown as OperationState);
        // Preserve private runtime observation branding; never JSON-clone commands.
        const next = applyOperationCommand(current, { expectedVersion: input.expectedVersion, leaseToken: input.leaseToken, now: await now(tx) }, input.command);
        const changed = await tx.update(states).set({ version: next.version, state: json(next), command: { ...input.command, previousVersion: current.version, leaseToken: input.leaseToken, acceptedAt: next.updatedAt } }).where(and(eq(states.operationId, id), eq(states.version, input.expectedVersion))).returning();
        if (changed.length !== 1) {
          throw new Error('CUSTOMER_PAYMENT_PROVIDER_OPERATION_WRITE_FAILED');
        }
        return validateOperationState(changed[0]!.state as unknown as OperationState);
      });
    },
  };
}
export type ProviderJournal = ReturnType<typeof createProviderJournal>;
