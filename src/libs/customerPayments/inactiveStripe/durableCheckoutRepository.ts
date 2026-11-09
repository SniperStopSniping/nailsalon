import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { db } from '@/libs/DB';
import { closedCheckoutAuditSchema as audits, closedCheckoutConflictSchema as conflicts, closedCheckoutObjectSchema as objects, closedCheckoutObservationSchema as observations, closedCheckoutOperationSchema as operations, type ClosedCheckoutReason, closedCheckoutStateSchema as states } from '@/models/customerPaymentClosedCheckoutSchema';
import { customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';

import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { assertInactiveStripeCheckoutOperation, checkoutAdapterError, freezeCheckoutValue, requireInactiveStripeCheckoutRuntime } from './checkoutContract';
import { inspectInactiveStripeSession } from './checkoutResponse';
import { type ClosedSdkCheckoutAuthorization, type ClosedSdkCheckoutOutcome, getSdkClosedOutcome } from './closedCheckoutSdkTransport';
import type { ClosedCheckoutFixtureTransport } from './closedCheckoutTransport';
import { assertClosedCheckoutFixtureTransport, consumeClosedCheckoutFixture } from './closedCheckoutTransport';
import { assertDurableCheckoutQuoteBinding } from './durableCheckoutQuoteBinding';
import { assertSdkCheckoutBearer, lockSdkCheckoutSources, reconstructSdkCheckoutOperation, type SdkCheckoutReserveInput, sdkCheckoutReserveSchema, type SdkCheckoutResumeInput, sdkCheckoutResumeSchema, validateSdkCheckoutSources } from './durableCheckoutSdkReservation';

type Database = Pick<typeof db, 'select' | 'transaction'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type State = typeof states.$inferSelect;
export type DurableCheckoutLease = Readonly<{ operationId: string; version: number; token: string; activity: 'create' | 'retrieve' }>;
export type DurableCheckoutExecutionKind = 'static_fixture_v1' | 'sdk_closed_http_v1';
export type DurableCheckoutResult = Readonly<State & { executionKind: DurableCheckoutExecutionKind; identityHash: string; source: 'closed_test_fixture'; providerOriginVerified: false; financialPostingAllowed: false }>;
export type ClosedCheckoutOutcome = { ok: true; response: unknown } | { ok: false };
const uuid = z.string().uuid();
const claimSchema = z.object({ operationId: uuid, version: z.number().int().min(0).max(2147483646), token: uuid, activity: z.enum(['create', 'retrieve']) }).strict();
const committedSdkAuthorizations = new WeakMap<ClosedSdkCheckoutAuthorization, { identityHash: string; parameterHash: string; claim: DurableCheckoutLease }>();
/** Actual HTTP seam only: consume a known-committed, exact-operation, one-use permit. */
export function consumeCommittedSdkAuthorization(authorization: ClosedSdkCheckoutAuthorization, operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease): ClosedSdkCheckoutAuthorization {
  gate(operation);
  const origin = committedSdkAuthorizations.get(authorization);
  if (!origin || origin.identityHash !== operation.identityHash || origin.parameterHash !== operation.parameterHash
    || origin.claim.operationId !== claim.operationId || origin.claim.version !== claim.version || origin.claim.token !== claim.token || origin.claim.activity !== claim.activity) {
    return checkoutAdapterError('SDK_COMMITTED_AUTHORIZATION_REQUIRED');
  }
  committedSdkAuthorizations.delete(authorization);
  return authorization;
}
const outcomes = new WeakMap<ClosedCheckoutOutcome, { identityHash: string; claim: DurableCheckoutLease }>();
function snapshotOperation(operation: InactiveStripeCheckoutOperation) {
  gate();
  const copy = freezeCheckoutValue(structuredClone(operation));
  assertInactiveStripeCheckoutOperation(copy);
  return copy;
}
function brandOutcome(outcome: ClosedCheckoutOutcome, operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease) {
  const immutable = freezeCheckoutValue(structuredClone(outcome));
  outcomes.set(immutable, { identityHash: operation.identityHash, claim });
  return immutable;
}
const noLease = { workerId: null, leaseToken: null, leaseUntil: null, activity: null };
function gate(operation?: InactiveStripeCheckoutOperation) {
  requireInactiveStripeCheckoutRuntime();
  if (operation) {
    assertInactiveStripeCheckoutOperation(operation);
  }
}
async function clock(tx: Pick<Transaction, 'select'>): Promise<Date> {
  const [row] = await tx.select({ value: sql<string>`floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint` }).from(sql`(SELECT 1) AS closed_checkout_clock`);
  return new Date(Number(row!.value));
}
function fresh(operation: InactiveStripeCheckoutOperation, now: number) {
  return now >= operation.material.createdAt && now < operation.material.quoteExpiresAt;
}
function resultKind(operation: InactiveStripeCheckoutOperation, state: State, executionKind: DurableCheckoutExecutionKind): DurableCheckoutResult {
  return freezeCheckoutValue({ ...state, executionKind, identityHash: operation.identityHash, source: 'closed_test_fixture' as const, providerOriginVerified: false as const, financialPostingAllowed: false as const });
}
function lease(state: State): DurableCheckoutLease {
  if (!state.leaseToken || !state.activity) {
    return checkoutAdapterError('DURABLE_LEASE_MISSING');
  }
  return Object.freeze({ operationId: state.operationId, version: state.version, token: state.leaseToken, activity: state.activity });
}
function fenced(state: State, claim: DurableCheckoutLease, now: Date, allowReviewRead = false) {
  if (state.operationId !== claim.operationId || state.version !== claim.version || state.leaseToken !== claim.token
    || state.activity !== claim.activity || !state.leaseUntil || state.leaseUntil <= now || (state.state === 'review' && !(allowReviewRead && claim.activity === 'retrieve'))) {
    checkoutAdapterError('DURABLE_LEASE_FENCED');
  }
}
/** No automatic transaction retries: a callback may consume the closed fixture once. */
async function transaction<T>(database: Database, callback: (tx: Transaction) => Promise<T>): Promise<T> {
  gate();
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
    // Independent admission, never the offline provider journal or money graph mutex.
    await tx.execute(sql`LOCK TABLE customer_payment_closed_checkout_operation IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    gate();
    return callback(tx);
  }, { isolationLevel: 'read committed' });
}
async function loadKind(tx: Transaction, operation: InactiveStripeCheckoutOperation, executionKind: DurableCheckoutExecutionKind) {
  operation = snapshotOperation(operation);
  const [identity] = await tx.select().from(operations).where(eq(operations.id, operation.material.operationId)).limit(1);
  if (identity && identity.executionKind !== executionKind) {
    return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
  }
  if (!identity || identity.identityHash !== operation.identityHash || identity.parameterHash !== operation.parameterHash
    || identity.source !== 'closed_test_fixture' || identity.mode !== 'test' || identity.financialPostingAllowed !== false || identity.providerOriginVerified !== false
    || identity.requestId !== operation.material.requestId || identity.salonId !== operation.material.salonId || identity.appointmentId !== operation.material.appointmentId
    || identity.quoteId !== operation.material.quoteId || identity.contextHash !== operation.material.contextHash
    || identity.platformAccountId !== operation.binding.platformAccountId || identity.connectedAccountId !== operation.binding.connectedAccountId
    || identity.operationCreatedAt.getTime() !== operation.material.createdAt || identity.quoteExpiresAt.getTime() !== operation.material.quoteExpiresAt || identity.sessionExpiresAt.getTime() !== operation.material.sessionExpiresAt) {
    return checkoutAdapterError('DURABLE_IDENTITY_MISMATCH');
  }
  const [state] = await tx.select().from(states).where(eq(states.operationId, identity.id)).for('update').limit(1);
  if (!state) {
    return checkoutAdapterError('DURABLE_STATE_MISSING');
  }
  return state;
}
async function save(tx: Transaction, state: State, patch: Partial<Omit<State, 'operationId' | 'version'>>) {
  const rows = await tx.update(states).set({ ...patch, version: state.version + 1 }).where(and(eq(states.operationId, state.operationId), eq(states.version, state.version))).returning();
  if (rows.length !== 1) {
    return checkoutAdapterError('DURABLE_STATE_WRITE_FAILED');
  }
  const [audit] = await tx.select().from(audits).where(and(eq(audits.operationId, state.operationId), eq(audits.version, rows[0]!.version))).limit(1);
  if (!audit) {
    return checkoutAdapterError('DURABLE_AUDIT_WRITE_FAILED');
  }
  return rows[0]!;
}
async function reviewKind(tx: Transaction, state: State, reason: ClosedCheckoutReason, sdk = false) {
  return state.state === 'review'
    ? (sdk && state.leaseToken ? save(tx, state, { ...noLease }) : state)
    : save(tx, state, { state: 'review', reason, ...noLease });
}
async function staticSourceValid(tx: Transaction, operation: InactiveStripeCheckoutOperation) {
  try {
    await assertDurableCheckoutQuoteBinding(tx, operation, await clock(tx));
    return fresh(operation, (await clock(tx)).getTime());
  } catch (error) {
    // SQL failures abort their transaction; never convert those into a successful hold.
    const failure = error as { code?: string; cause?: { code?: string } };
    if (failure.code || failure.cause?.code) {
      throw error;
    }
    return false;
  }
}
async function retainConflict(tx: Transaction, operationId: string, contenderIdentityHash: string, reason: 'identity_conflict' | 'object_ownership_conflict', objectId: string | null) {
  await tx.insert(conflicts).values({ id: randomUUID(), operationId, contenderIdentityHash, reason, objectId }).onConflictDoNothing();
  const [known] = await tx.select().from(conflicts).where(and(eq(conflicts.operationId, operationId), eq(conflicts.contenderIdentityHash, contenderIdentityHash), eq(conflicts.reason, reason), objectId === null ? sql`${conflicts.objectId} IS NULL` : eq(conflicts.objectId, objectId))).limit(1);
  if (!known) {
    checkoutAdapterError('DURABLE_CONFLICT_WRITE_FAILED');
  }
}

/**
 * One durable journal, with immutable lanes for legacy static and CLOSED HTTP SDK fixtures.
 * SDK admission adds an unresolved financial reservation, never a booking-slot hold.
 * No application database instance, real-provider authority or settlement lives here.
 */
function createRepository(database: Database, executionKind: DurableCheckoutExecutionKind) {
  gate();
  const sdk = executionKind === 'sdk_closed_http_v1';
  const load = (tx: Transaction, operation: InactiveStripeCheckoutOperation) => loadKind(tx, operation, executionKind);
  const result = (operation: InactiveStripeCheckoutOperation, state: State) => resultKind(operation, state, executionKind);
  const review = (tx: Transaction, state: State, reason: ClosedCheckoutReason) => reviewKind(tx, state, reason, sdk);
  async function sourceValid(tx: Transaction, operation: InactiveStripeCheckoutOperation, observationOnly = false) {
    if (!sdk) {
      return staticSourceValid(tx, operation);
    }
    try {
      const [identity] = await tx.select().from(operations).where(eq(operations.id, operation.material.operationId)).limit(1);
      if (!identity || identity.executionKind !== executionKind) {
        return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
      }
      const sources = await lockSdkCheckoutSources(tx, operation.material);
      await validateSdkCheckoutSources(tx, sources, operation, observationOnly ? new Date(operation.material.createdAt) : await clock(tx), identity);
      return observationOnly || fresh(operation, (await clock(tx)).getTime());
    } catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if (failure.code || failure.cause?.code) {
        throw error;
      }
      return false;
    }
  }
  const repository = {
    async reserve(operation: InactiveStripeCheckoutOperation): Promise<DurableCheckoutResult> {
      operation = snapshotOperation(operation);
      if (sdk) {
        return checkoutAdapterError('SDK_AUTHENTICATED_RESERVATION_REQUIRED');
      }
      const reserved = await transaction(database, async (tx) => {
        const m = operation.material;
        const known = await tx.select().from(operations).where(or(eq(operations.id, m.operationId), eq(operations.requestId, m.requestId), and(eq(operations.salonId, m.salonId), eq(operations.appointmentId, m.appointmentId))));
        if (known.some(owner => owner.executionKind !== executionKind)) {
          return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
        }
        if (known.some(owner => owner.salonId !== m.salonId)) {
          return checkoutAdapterError('DURABLE_IDENTITY_SCOPE_MISMATCH');
        }
        if (known.length === 1 && known[0]!.id === m.operationId && known[0]!.identityHash === operation.identityHash) {
          return { state: await load(tx, operation), conflict: false };
        }
        if (known.length) {
          for (const owner of known) {
            const [state] = await tx.select().from(states).where(eq(states.operationId, owner.id)).for('update').limit(1);
            if (!state) {
              checkoutAdapterError('DURABLE_STATE_MISSING');
            }
            await retainConflict(tx, owner.id, operation.identityHash, 'identity_conflict', null);
            await review(tx, state, 'identity_conflict');
          }
          return { state: null, conflict: true };
        }
        if (!await sourceValid(tx, operation)) {
          return checkoutAdapterError('DURABLE_QUOTE_BINDING_REJECTED');
        }
        const inserted = await tx.insert(operations).values({
          executionKind,
          id: m.operationId,
          requestId: m.requestId,
          salonId: m.salonId,
          appointmentId: m.appointmentId,
          quoteId: m.quoteId,
          contextHash: m.contextHash,
          identityHash: operation.identityHash,
          parameterHash: operation.parameterHash,
          platformAccountId: operation.binding.platformAccountId,
          connectedAccountId: operation.binding.connectedAccountId,
          operationCreatedAt: new Date(m.createdAt),
          quoteExpiresAt: new Date(m.quoteExpiresAt),
          sessionExpiresAt: new Date(m.sessionExpiresAt),
        }).returning();
        const initial = await tx.insert(states).values({ operationId: m.operationId }).returning();
        if (inserted.length !== 1 || initial.length !== 1) {
          return checkoutAdapterError('DURABLE_RESERVATION_WRITE_FAILED');
        }
        const [audit] = await tx.select().from(audits).where(and(eq(audits.operationId, m.operationId), eq(audits.version, 0))).limit(1);
        if (!audit) {
          return checkoutAdapterError('DURABLE_AUDIT_WRITE_FAILED');
        }
        return { state: initial[0]!, conflict: false };
      });
      if (reserved.conflict || !reserved.state) {
        return checkoutAdapterError('DURABLE_IDENTITY_CONFLICT_RETAINED');
      }
      return result(operation, reserved.state);
    },
    async reserveAuthenticated(input: SdkCheckoutReserveInput) {
      gate();
      if (!sdk) {
        return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
      }
      input = Object.freeze(sdkCheckoutReserveSchema.parse(input));
      const reserved = await transaction(database, async (tx) => {
        const bearer = await assertSdkCheckoutBearer(tx, input, await clock(tx));
        const sources = await lockSdkCheckoutSources(tx, input, bearer);
        const quote = sources.quote;
        const operation = reconstructSdkCheckoutOperation({ id: input.operationId, requestId: input.requestId, salonId: input.salonId, appointmentId: input.appointmentId, quoteId: quote.id, platformAccountId: input.platformAccountId, connectedAccountId: quote.stripeAccountId, contextHash: quote.fingerprint, operationCreatedAt: quote.createdAt, quoteExpiresAt: quote.expiresAt, sessionExpiresAt: new Date(Math.ceil(quote.expiresAt.getTime() / 1000) * 1000 + 1800000) }, quote);
        // Authentication, including exact locked hash, happens before collision side effects.
        const known = await tx.select().from(operations).where(or(eq(operations.id, input.operationId), eq(operations.requestId, input.requestId), and(eq(operations.salonId, input.salonId), eq(operations.appointmentId, input.appointmentId))));
        if (known.some(owner => owner.executionKind !== executionKind)) {
          return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
        }
        if (known.some(owner => owner.salonId !== input.salonId || owner.appointmentId !== input.appointmentId)) {
          return checkoutAdapterError('DURABLE_IDENTITY_SCOPE_MISMATCH');
        }
        if (known.length === 1 && known[0]!.id === input.operationId && known[0]!.identityHash === operation.identityHash) {
          return { operation, state: await load(tx, operation), conflict: false };
        }
        if (known.length) {
          for (const owner of known) {
            const [state] = await tx.select().from(states).where(eq(states.operationId, owner.id)).for('update').limit(1);
            if (!state) {
              return checkoutAdapterError('DURABLE_STATE_MISSING');
            }
            await retainConflict(tx, owner.id, operation.identityHash, 'identity_conflict', null);
            await review(tx, state, 'identity_conflict');
          }
          return { operation, state: null, conflict: true };
        }
        const reservation = await validateSdkCheckoutSources(tx, sources, operation, await clock(tx));
        if (!fresh(operation, (await clock(tx)).getTime())) {
          return checkoutAdapterError('SDK_QUOTE_EXPIRED');
        }
        const m = operation.material;
        const inserted = await tx.insert(operations).values({ executionKind, ...reservation, id: m.operationId, requestId: m.requestId, salonId: m.salonId, appointmentId: m.appointmentId, quoteId: m.quoteId, contextHash: m.contextHash, identityHash: operation.identityHash, parameterHash: operation.parameterHash, platformAccountId: operation.binding.platformAccountId, connectedAccountId: operation.binding.connectedAccountId, operationCreatedAt: new Date(m.createdAt), quoteExpiresAt: new Date(m.quoteExpiresAt), sessionExpiresAt: new Date(m.sessionExpiresAt) }).returning();
        const initial = await tx.insert(states).values({ operationId: m.operationId }).returning();
        if (inserted.length !== 1 || initial.length !== 1) {
          return checkoutAdapterError('DURABLE_RESERVATION_WRITE_FAILED');
        }
        const [audit] = await tx.select().from(audits).where(and(eq(audits.operationId, m.operationId), eq(audits.version, 0))).limit(1);
        if (!audit) {
          return checkoutAdapterError('DURABLE_AUDIT_WRITE_FAILED');
        }
        return { operation, state: initial[0]!, conflict: false };
      });
      if (reserved.conflict || !reserved.state) {
        return checkoutAdapterError('DURABLE_IDENTITY_CONFLICT_RETAINED');
      }
      return { operation: reserved.operation, result: result(reserved.operation, reserved.state) };
    },
    async resumeAuthenticated(input: SdkCheckoutResumeInput) {
      gate();
      if (!sdk) {
        return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
      }
      input = Object.freeze(sdkCheckoutResumeSchema.parse(input));
      return transaction(database, async (tx) => {
        const bearer = await assertSdkCheckoutBearer(tx, input, await clock(tx));
        const [identity] = await tx.select().from(operations).where(and(eq(operations.id, input.operationId), eq(operations.salonId, input.salonId), eq(operations.appointmentId, input.appointmentId))).limit(1);
        if (!identity || identity.executionKind !== executionKind) {
          return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
        }
        const sources = await lockSdkCheckoutSources(tx, identity, bearer);
        if (identity.capabilityId !== bearer.capabilityId || identity.reconstruction?.version !== 1 || identity.reconstruction?.returnTemplate !== 'closed_invalid_v1') {
          return checkoutAdapterError('SDK_RECONSTRUCTION_REJECTED');
        }
        const operation = reconstructSdkCheckoutOperation(identity, sources.quote);
        return { operation, result: result(operation, await load(tx, operation)) };
      });
    },
    /**
     * Trusted internal diagnostic recovery only, never customer checkout admission.
     * The immutable exact Session binding survives capability pruning/revocation.
     * Requiring an already consumed create and bound Session makes this read-only.
     */
    async restoreForReconciliation(input: { operationId: string; salonId: string; appointmentId: string }) {
      gate();
      if (!sdk) {
        return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
      }
      input = Object.freeze(z.object({ operationId: uuid, salonId: z.string().min(1).max(200), appointmentId: z.string().min(1).max(200) }).strict().parse(input));
      return transaction(database, async (tx) => {
        const [identity] = await tx.select().from(operations).where(and(eq(operations.id, input.operationId), eq(operations.salonId, input.salonId), eq(operations.appointmentId, input.appointmentId))).limit(1);
        if (!identity || identity.executionKind !== executionKind) {
          return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
        }
        const [quote] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(eq(customerPaymentPreparedQuoteSchema.id, identity.quoteId)).for('share').limit(1);
        if (!quote || identity.reconstruction?.version !== 1 || identity.reconstruction?.returnTemplate !== 'closed_invalid_v1') {
          return checkoutAdapterError('SDK_RECONSTRUCTION_REJECTED');
        }
        const operation = reconstructSdkCheckoutOperation(identity, quote);
        const state = await load(tx, operation);
        if (!state.session || !state.dispatchIntentAt || !state.createConsumedAt) {
          return checkoutAdapterError('DURABLE_EXACT_SESSION_REQUIRED');
        }
        return { operation, result: result(operation, state) };
      });
    },
    async consumeSdkPermit(operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease) {
      operation = snapshotOperation(operation);
      claim = Object.freeze(claimSchema.parse(claim));
      if (!sdk) {
        return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
      }
      // Commit uncertainty propagates: only a resolved transaction creates a permit.
      // No callback, SDK call or HTTP I/O is executed while these locks are held.
      const committed = await transaction(database, async (tx) => {
        let state = await load(tx, operation);
        fenced(state, claim, await clock(tx), true);
        if (!state.dispatchIntentAt || (claim.activity === 'create' && state.createConsumedAt) || (claim.activity === 'retrieve' && !state.session)) {
          return checkoutAdapterError('DURABLE_CONSUME_REJECTED');
        }
        if (claim.activity === 'create' && !await sourceValid(tx, operation)) {
          return { result: result(operation, await review(tx, state, 'source_context_changed')), lease: null, permit: null };
        }
        fenced(state, claim, await clock(tx), true);
        state = await save(tx, state, claim.activity === 'create' ? { createConsumedAt: await clock(tx), reason: 'create_consumed' } : { reason: 'retrieval_pending' });
        const sampleStarted = performance.now();
        const now = await clock(tx);
        fenced(state, lease(state), now, true);
        return { result: result(operation, state), lease: lease(state), permit: Object.freeze({ databaseNow: now.getTime(), sampleStarted, quoteExpiresAt: claim.activity === 'create' ? operation.material.quoteExpiresAt : null, leaseUntil: state.leaseUntil!.getTime(), sessionId: claim.activity === 'create' ? null : state.session!.sessionId }) };
      });
      const authorization = Object.freeze(committed);
      if (authorization.permit && authorization.lease) {
        committedSdkAuthorizations.set(authorization, { identityHash: operation.identityHash, parameterHash: operation.parameterHash, claim });
      }
      return authorization;
    },
    async recordSdkOutcome(operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease, outcome: ClosedSdkCheckoutOutcome): Promise<DurableCheckoutResult> {
      operation = snapshotOperation(operation);
      claim = Object.freeze(claimSchema.parse(claim));
      if (!sdk) {
        return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
      }
      const safe = getSdkClosedOutcome(outcome, operation, claim);
      return repository.recordOutcome(operation, claim, brandOutcome(safe, operation, claim));
    },
    async inspect(operation: InactiveStripeCheckoutOperation) {
      operation = snapshotOperation(operation);
      return transaction(database, async tx => result(operation, await load(tx, operation)));
    },
    async claimCreate(operation: InactiveStripeCheckoutOperation, input: { workerId: string; leaseMs: number }) {
      operation = snapshotOperation(operation);
      input = z.object({ workerId: uuid, leaseMs: z.number().int().min(10).max(300000) }).strict().parse(input);
      return transaction(database, async (tx) => {
        const state = await load(tx, operation);
        if (state.state === 'review' || state.state === 'session_observed') {
          return { result: result(operation, state), lease: null };
        }
        if (state.dispatchIntentAt !== null) {
          return checkoutAdapterError('DURABLE_RECONCILIATION_REQUIRED');
        }
        const now = await clock(tx);
        if (state.leaseUntil && state.leaseUntil > now) {
          return checkoutAdapterError('DURABLE_OPERATION_BUSY');
        }
        if (!fresh(operation, now.getTime())) {
          return { result: result(operation, await review(tx, state, 'source_context_changed')), lease: null };
        }
        const changed = await save(tx, state, { state: 'leased', reason: 'create_leased', workerId: input.workerId, leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + input.leaseMs), activity: 'create' });
        return { result: result(operation, changed), lease: lease(changed) };
      });
    },
    async recordDispatchIntent(operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease) {
      operation = snapshotOperation(operation);
      claim = Object.freeze(claimSchema.parse(claim));
      return transaction(database, async (tx) => {
        const state = await load(tx, operation);
        fenced(state, claim, await clock(tx));
        if (claim.activity !== 'create' || state.dispatchIntentAt !== null) {
          return checkoutAdapterError('DURABLE_CREATE_ALREADY_LATCHED');
        }
        if (!await sourceValid(tx, operation)) {
          return { result: result(operation, await review(tx, state, 'source_context_changed')), lease: null };
        }
        const now = await clock(tx);
        fenced(state, claim, now);
        const changed = await save(tx, state, { state: 'dispatch_intent', reason: 'dispatch_intent', dispatchIntentAt: now });
        return { result: result(operation, changed), lease: lease(changed) };
      });
    },
    async claimReconcile(operation: InactiveStripeCheckoutOperation, input: { workerId: string; leaseMs: number }) {
      operation = snapshotOperation(operation);
      input = z.object({ workerId: uuid, leaseMs: z.number().int().min(10).max(300000) }).strict().parse(input);
      return transaction(database, async (tx) => {
        const state = await load(tx, operation);
        if (state.state === 'review' && (!sdk || !state.session)) {
          return { result: result(operation, state), lease: null };
        }
        if (!state.dispatchIntentAt) {
          return checkoutAdapterError('DURABLE_NOT_DISPATCHED');
        }
        const now = await clock(tx);
        if (state.leaseUntil && state.leaseUntil > now) {
          return checkoutAdapterError('DURABLE_OPERATION_BUSY');
        }
        if (!state.session) {
          const changed = await save(tx, state, { state: 'uncertain', reason: 'no_bound_session', ...noLease });
          return { result: result(operation, changed), lease: null };
        }
        const changed = await save(tx, state, { reason: 'retrieval_pending', workerId: input.workerId, leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + input.leaseMs), activity: 'retrieve' });
        return { result: result(operation, changed), lease: lease(changed) };
      });
    },
    async consume(operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease, transport: ClosedCheckoutFixtureTransport): Promise<{ result: DurableCheckoutResult; lease: DurableCheckoutLease | null; outcome: Promise<ClosedCheckoutOutcome> | null }> {
      operation = snapshotOperation(operation);
      claim = Object.freeze(claimSchema.parse(claim));
      if (sdk) {
        return checkoutAdapterError('DURABLE_EXECUTION_KIND_MISMATCH');
      }
      assertClosedCheckoutFixtureTransport(transport);
      const latched = await transaction(database, async (tx) => {
        let state = await load(tx, operation);
        fenced(state, claim, await clock(tx));
        if (!state.dispatchIntentAt || (claim.activity === 'create' && state.createConsumedAt) || (claim.activity === 'retrieve' && !state.session)) {
          return checkoutAdapterError('DURABLE_CONSUME_REJECTED');
        }
        if (claim.activity === 'create') {
          if (!await sourceValid(tx, operation)) {
            return { result: result(operation, await review(tx, state, 'source_context_changed')), lease: null };
          }
          fenced(state, claim, await clock(tx));
          state = await save(tx, state, { createConsumedAt: await clock(tx), reason: 'create_consumed' });
        } else {
          // Advance the read fence too: the same lease cannot consume twice.
          state = await save(tx, state, { reason: 'retrieval_pending' });
        }
        return { result: result(operation, state), lease: lease(state) };
      });
      if (!latched.lease) {
        return { ...latched, outcome: null };
      }
      // COMMITTED consumed marker above. A crash, uncertain commit, failed final
      // transaction or explicit retry can never regain this create permission.
      return transaction(database, async (tx) => {
        const state = await load(tx, operation);
        fenced(state, latched.lease!, await clock(tx));
        if (claim.activity === 'create' && !await sourceValid(tx, operation)) {
          return { result: result(operation, await review(tx, state, 'source_context_changed')), lease: null, outcome: null };
        }
        const clockStarted = performance.now();
        const now = await clock(tx);
        // Conservatively count the whole DB round trip against the sampled DB deadline.
        const upperNow = now.getTime() + Math.ceil(performance.now() - clockStarted);
        gate();
        if (!state.leaseUntil || upperNow >= state.leaseUntil.getTime()
          || (claim.activity === 'create' && !fresh(operation, upperNow))) {
          return { result: result(operation, await review(tx, state, 'source_context_changed')), lease: null, outcome: null };
        }
        // Intent is ALREADY committed. No await between the final clock/runtime gate
        // and this synchronous closed-fixture consumption. Never a network SDK seam.
        const outcome: Promise<ClosedCheckoutOutcome> = consumeClosedCheckoutFixture(transport, operation, claim.activity === 'create' ? null : state.session!.sessionId, { databaseNow: now.getTime(), sampleStarted: clockStarted, quoteExpiresAt: claim.activity === 'create' ? operation.material.quoteExpiresAt : null, leaseUntil: state.leaseUntil.getTime() })
          .then(response => brandOutcome({ ok: true as const, response }, operation, lease(state)), () => brandOutcome({ ok: false as const }, operation, lease(state)));
        return { result: result(operation, state), lease: lease(state), outcome };
      });
    },
    async recordOutcome(operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease, outcome: ClosedCheckoutOutcome): Promise<DurableCheckoutResult> {
      operation = snapshotOperation(operation);
      claim = Object.freeze(claimSchema.parse(claim));
      const origin = outcomes.get(outcome);
      if (!origin || origin.identityHash !== operation.identityHash || origin.claim.operationId !== claim.operationId || origin.claim.version !== claim.version || origin.claim.token !== claim.token || origin.claim.activity !== claim.activity) {
        return checkoutAdapterError('DURABLE_CLOSED_OUTCOME_REQUIRED');
      }
      return transaction(database, async (tx) => {
        let state = await load(tx, operation);
        const [attempt] = await tx.select().from(audits).where(and(eq(audits.operationId, state.operationId), eq(audits.version, claim.version))).limit(1);
        if (!attempt || claim.operationId !== state.operationId || attempt.snapshot.lease_token !== claim.token
          || attempt.snapshot.activity !== claim.activity || !state.dispatchIntentAt
          || (claim.activity === 'create' && !attempt.snapshot.create_consumed_at)) {
          return checkoutAdapterError('DURABLE_OUTCOME_WITHOUT_CONSUMPTION');
        }
        if (sdk && !await sourceValid(tx, operation, true)) {
          state = await review(tx, state, 'source_context_changed');
        }
        const now = await clock(tx);
        const ownsLease = state.version === claim.version && state.leaseToken === claim.token
          && state.activity === claim.activity && state.leaseUntil !== null && state.leaseUntil > now;
        const current = state.state !== 'review' && state.version === claim.version && state.leaseToken === claim.token
          && state.activity === claim.activity && state.leaseUntil !== null && state.leaseUntil > now;
        if (!outcome.ok) {
          if (sdk && state.state === 'review' && ownsLease) {
            return result(operation, await save(tx, state, { reason: 'retrieval_unresolved', ...noLease }));
          }
          return current
            ? result(operation, await save(tx, state, { state: 'uncertain', reason: claim.activity === 'create' ? 'create_outcome_unknown' : 'retrieval_unresolved', ...noLease }))
            : result(operation, state);
        }
        let session;
        try {
          // Validate intrinsic response first: even a stale response may expose an
          // object identity that must remain durably owned. History application is separate.
          session = inspectInactiveStripeSession(outcome.response, operation, null);
        } catch {
          const fingerprint = createHash('sha256').update(JSON.stringify({ version: claim.version, outcome: 'rejected' })).digest('hex');
          await tx.insert(observations).values({ operationId: state.operationId, claimVersion: claim.version, fingerprint, outcome: 'rejected', late: !current }).onConflictDoNothing();
          const [rejected] = await tx.select().from(observations).where(and(eq(observations.operationId, state.operationId), eq(observations.fingerprint, fingerprint))).limit(1);
          if (!rejected) {
            return checkoutAdapterError('DURABLE_OBSERVATION_WRITE_FAILED');
          }
          return result(operation, await review(tx, state, 'session_evidence_mismatch'));
        }
        const fingerprint = createHash('sha256').update(JSON.stringify({ version: claim.version, session })).digest('hex');
        const [replayed] = await tx.select().from(observations).where(and(eq(observations.operationId, state.operationId), eq(observations.fingerprint, fingerprint))).limit(1);
        if (replayed) {
          return result(operation, state);
        }
        await tx.insert(observations).values({ operationId: state.operationId, claimVersion: claim.version, fingerprint, outcome: 'accepted', late: !current, sessionId: session.sessionId, paymentIntentId: session.paymentIntentId, chargeId: session.chargeId, status: session.status, paymentStatus: session.paymentStatus, feeCheck: session.feeCheck }).onConflictDoNothing();
        const [observed] = await tx.select().from(observations).where(and(eq(observations.operationId, state.operationId), eq(observations.fingerprint, fingerprint))).limit(1);
        if (!observed) {
          return checkoutAdapterError('DURABLE_OBSERVATION_WRITE_FAILED');
        }
        const ids = [session.sessionId, session.paymentIntentId, session.chargeId].filter((value): value is string => value !== null);
        const scope = (objectId: string) => and(eq(objects.platformAccountId, operation.binding.platformAccountId), eq(objects.connectedAccountId, operation.binding.connectedAccountId), eq(objects.mode, 'test'), eq(objects.objectId, objectId));
        let conflict = false;
        for (const id of ids) {
          const [owner] = await tx.select().from(objects).where(scope(id)).limit(1);
          if (owner && owner.operationId !== state.operationId) {
            conflict = true;
            const [otherIdentity] = await tx.select().from(operations).where(eq(operations.id, owner.operationId)).limit(1);
            if (!otherIdentity) {
              return checkoutAdapterError('DURABLE_STATE_MISSING');
            }
            if (otherIdentity.executionKind !== executionKind) {
              // Retain this lane's conflict without adopting or mutating another
              // execution kind's evidence/state authority.
              await retainConflict(tx, state.operationId, operation.identityHash, 'object_ownership_conflict', id);
              continue;
            }
            const [other] = await tx.select().from(states).where(eq(states.operationId, owner.operationId)).for('update').limit(1);
            if (!other) {
              return checkoutAdapterError('DURABLE_STATE_MISSING');
            }
            await retainConflict(tx, owner.operationId, operation.identityHash, 'object_ownership_conflict', id);
            await retainConflict(tx, state.operationId, operation.identityHash, 'object_ownership_conflict', id);
            await review(tx, other, 'object_ownership_conflict');
          }
        }
        for (const id of ids) {
          const [existing] = await tx.select().from(objects).where(scope(id)).limit(1);
          if (existing && existing.operationId !== state.operationId) {
            continue;
          }
          await tx.insert(objects).values({ platformAccountId: operation.binding.platformAccountId, connectedAccountId: operation.binding.connectedAccountId, objectId: id, operationId: state.operationId }).onConflictDoNothing();
          const [owner] = await tx.select().from(objects).where(scope(id)).limit(1);
          if (owner?.operationId !== state.operationId) {
            return checkoutAdapterError('DURABLE_OWNERSHIP_WRITE_FAILED');
          }
        }
        if (conflict) {
          return result(operation, await review(tx, state, 'object_ownership_conflict'));
        }
        if (sdk && state.session) {
          const differingIds = [
            session.sessionId !== state.session.sessionId ? session.sessionId : null,
            state.session.paymentIntentId && session.paymentIntentId !== state.session.paymentIntentId ? session.paymentIntentId : null,
            state.session.feeCheck === 'captured_charge_amount_matches' && session.chargeId !== state.session.chargeId ? session.chargeId : null,
          ].filter((id): id is string => id !== null);
          if (differingIds.length) {
            for (const id of differingIds) {
              await retainConflict(tx, state.operationId, operation.identityHash, 'object_ownership_conflict', id);
            }
            return result(operation, await review(tx, state, 'session_evidence_mismatch'));
          }
        }
        if (!current) {
          if (sdk) {
            try {
              inspectInactiveStripeSession(outcome.response, operation, state.session);
            } catch {
              return result(operation, await review(tx, state, 'session_evidence_mismatch'));
            }
            // A first valid late Session remains durably bound for exact-ID reads,
            // but neither review nor the unresolved financial reservation clears.
            return result(operation, await save(tx, state, { state: 'review', reason: state.state === 'review' ? state.reason : 'session_evidence_mismatch', session, ...noLease }));
          }
          // Retain the stale evidence/ownership, but never grant it current state authority.
          return result(operation, await review(tx, state, 'session_evidence_mismatch'));
        }
        try {
          inspectInactiveStripeSession(outcome.response, operation, state.session);
        } catch {
          return result(operation, await review(tx, state, 'session_evidence_mismatch'));
        }
        return result(operation, await save(tx, state, { state: 'session_observed', reason: 'session_response', session, ...noLease }));
      });
    },
  };
  return Object.freeze(repository);
}

/** Historical in-process fixture lane. Cannot reserve, inspect or consume SDK rows. */
export function createDurableCheckoutRepository(database: Database) {
  const { reserveAuthenticated: _reserve, resumeAuthenticated: _resume, restoreForReconciliation: _restore, consumeSdkPermit: _permit, recordSdkOutcome: _outcome, ...repository } = createRepository(database, 'static_fixture_v1');
  return Object.freeze(repository);
}

/** Unregistered diagnostic SDK lane: authentication is mandatory for reservation/reconstruction. */
export function createDurableSdkCheckoutRepository(database: Database) {
  const { reserve: _reserve, consume: _consume, recordOutcome: _outcome, ...repository } = createRepository(database, 'sdk_closed_http_v1');
  return Object.freeze(repository);
}
export type DurableCheckoutRepository = ReturnType<typeof createDurableCheckoutRepository>;
export type DurableSdkCheckoutRepository = ReturnType<typeof createDurableSdkCheckoutRepository>;
