import 'server-only';

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { withClientLifecycleTransactionRetry } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { appointmentSchema, customerBookingOperationSchema as operations } from '@/models/Schema';

import type { CustomerBookingFailure, CustomerBookingMaterial, CustomerBookingOperationReference } from './bookingOperationContracts';
import type { CustomerContact } from './contact';
import { createCustomerContactBinding } from './contact.server';

export type CustomerBookingOperation = typeof operations.$inferSelect;
export type CustomerBookingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const RECOVERY_LIFETIME_MS = 100 * 24 * 60 * 60_000;
const REVIEW_LIFETIME_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCKED = Symbol('locked customer booking operation');
type OperationClock = Date | (() => Date);
const lockedTransactions = new WeakMap<LockedCustomerBookingOperation, CustomerBookingTransaction>();

export type LockedCustomerBookingOperation = CustomerBookingOperation & { readonly [LOCKED]: true };

function currentTime(clock?: OperationClock): Date {
  return typeof clock === 'function' ? clock() : clock ?? new Date();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function customerBookingMaterialFingerprint(material: CustomerBookingMaterial, contactBinding: string): string {
  const { fingerprint: _fingerprint, expiresAt: _expiresAt, ...review } = material.review;
  return createHash('sha256').update(JSON.stringify(canonical({
    domain: 'luster.customer-booking-material.v1',
    contactBinding,
    material: { ...material, review },
  }))).digest('hex');
}

function materialWithDeadline(material: CustomerBookingMaterial, fingerprint: string, expiresAt: Date): CustomerBookingMaterial {
  return { ...material, review: { ...material.review, fingerprint, expiresAt: expiresAt.toISOString() } };
}

export class CustomerBookingOperationError extends Error {
  constructor(
    readonly code: 'invalid_operation' | 'operation_expired' | 'review_expired' | 'revision_changed' | 'contact_changed' | CustomerBookingFailure,
    readonly operation?: CustomerBookingOperation,
  ) {
    super('CUSTOMER_BOOKING_OPERATION_REJECTED');
    this.name = 'CustomerBookingOperationError';
  }
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(secret: string, salonId: string, id: string, sessionId: string): string {
  if (secret.length < 32) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
  return createHmac('sha256', secret)
    .update(JSON.stringify(['luster.customer-booking-operation.v1', salonId, id, sessionId]))
    .digest('base64url');
}

/** Reproducible after an interrupted prepare, without storing the bearer secret. */
export function customerBookingOperationReference(operation: CustomerBookingOperation, secret: string): CustomerBookingOperationReference {
  return {
    capability: `v1.${operation.id}.${operation.sessionId}.${signature(secret, operation.salonId, operation.id, operation.sessionId)}`,
    revision: operation.revision,
    fingerprint: operation.requestHash,
    expiresAt: operation.reviewExpiresAt.toISOString(),
  };
}

function verifyCapability(capability: string, salonId: string, secret: string): { id: string; sessionId: string } {
  if (capability.length > 200) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
  const [version, id, sessionId, mac, extra] = capability.split('.');
  if (version !== 'v1' || !id || !sessionId || !UUID.test(id) || !UUID.test(sessionId) || !mac || extra
    || !equalSecret(mac, signature(secret, salonId, id, sessionId))) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
  return { id, sessionId };
}

function assertRecovery(operation: CustomerBookingOperation | undefined, sessionId: string, now: Date): asserts operation is CustomerBookingOperation {
  if (!operation || operation.sessionId !== sessionId || operation.keyVersion !== 1) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
  if (operation.recoveryExpiresAt <= now) {
    throw new CustomerBookingOperationError('operation_expired');
  }
}

export async function readCustomerBookingOperation(args: {
  salonId: string;
  capability: string;
  secret: string;
  now?: OperationClock;
}): Promise<CustomerBookingOperation> {
  const identity = verifyCapability(args.capability, args.salonId, args.secret);
  const [operation] = await db.select().from(operations).where(and(
    eq(operations.id, identity.id),
    eq(operations.salonId, args.salonId),
  )).limit(1);
  assertRecovery(operation, identity.sessionId, currentTime(args.now));
  return operation;
}

/** A session can prepare revisions, but can never acquire a second operation. */
export async function prepareCustomerBookingOperation(args: {
  salonId: string;
  sessionId: string;
  secret: string;
  contact: CustomerContact;
  material: CustomerBookingMaterial;
  expectedRevision: number;
  now?: OperationClock;
}): Promise<CustomerBookingOperation> {
  const id = randomUUID();
  const contactBinding = createCustomerContactBinding(args);
  const requestHash = customerBookingMaterialFingerprint(args.material, contactBinding);
  if (args.secret.length < 32 || !UUID.test(args.sessionId)
    || args.material.review.status !== 'READY' || args.material.review.salon.id !== args.salonId
    || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
  return withClientLifecycleTransactionRetry(() => db.transaction(async (tx) => {
    const insertTime = currentTime(args.now);
    const insertExpiry = new Date(insertTime.getTime() + REVIEW_LIFETIME_MS);
    await tx.insert(operations).values({
      id,
      salonId: args.salonId,
      sessionId: args.sessionId,
      contactBinding,
      requestHash,
      material: materialWithDeadline(args.material, requestHash, insertExpiry),
      reviewExpiresAt: insertExpiry,
      recoveryExpiresAt: new Date(insertTime.getTime() + RECOVERY_LIFETIME_MS),
      createdAt: insertTime,
      updatedAt: insertTime,
    }).onConflictDoNothing({ target: [operations.salonId, operations.sessionId] });
    const [current] = await tx.select().from(operations).where(and(
      eq(operations.salonId, args.salonId),
      eq(operations.sessionId, args.sessionId),
    )).for('update');
    const now = currentTime(args.now);
    const reviewExpiresAt = new Date(now.getTime() + REVIEW_LIFETIME_MS);
    assertRecovery(current, args.sessionId, now);
    if (current.appointmentId) {
      return current;
    }
    if (current.id === id) {
      if (args.expectedRevision !== 0) {
        throw new CustomerBookingOperationError('revision_changed');
      }
      const [inserted] = await tx.update(operations).set({
        material: materialWithDeadline(args.material, requestHash, reviewExpiresAt),
        reviewExpiresAt,
        updatedAt: now,
      }).where(eq(operations.id, id)).returning();
      return inserted!;
    }
    if (!current.lastFailure && current.requestHash === requestHash
      && equalSecret(current.contactBinding, contactBinding) && current.reviewExpiresAt > now) {
      return current;
    }
    if (current.revision !== args.expectedRevision) {
      throw new CustomerBookingOperationError('revision_changed', current);
    }
    const [updated] = await tx.update(operations).set({
      material: materialWithDeadline(args.material, requestHash, reviewExpiresAt),
      requestHash,
      contactBinding,
      revision: current.revision + 1,
      reviewExpiresAt,
      lastFailure: null,
      updatedAt: now,
    }).where(and(eq(operations.id, current.id), eq(operations.salonId, args.salonId), isNull(operations.appointmentId))).returning();
    if (!updated) {
      throw new CustomerBookingOperationError('invalid_operation');
    }
    return updated;
  }));
}

/** Must be the first lock in the appointment transaction, before client writes. */
export async function lockCustomerBookingOperation(tx: CustomerBookingTransaction, args: {
  salonId: string;
  capability: string;
  secret: string;
  revision: number;
  fingerprint: string;
  contact: CustomerContact;
  now?: OperationClock;
}): Promise<{ kind: 'replay'; operation: CustomerBookingOperation } | { kind: 'create'; operation: LockedCustomerBookingOperation }> {
  const identity = verifyCapability(args.capability, args.salonId, args.secret);
  const [operation] = await tx.select().from(operations).where(and(
    eq(operations.id, identity.id),
    eq(operations.salonId, args.salonId),
  )).for('update');
  const now = currentTime(args.now);
  assertRecovery(operation, identity.sessionId, now);
  // Once linked, even changed contact/revision or an expired review recovers
  // the original appointment. It never opens a new creation opportunity.
  if (operation.appointmentId) {
    return { kind: 'replay', operation };
  }
  if (operation.revision !== args.revision || operation.requestHash !== args.fingerprint) {
    throw new CustomerBookingOperationError('revision_changed', operation);
  }
  if (operation.lastFailure) {
    throw new CustomerBookingOperationError(operation.lastFailure, operation);
  }
  if (operation.reviewExpiresAt <= now) {
    throw new CustomerBookingOperationError('review_expired', operation);
  }
  const binding = createCustomerContactBinding({ ...args, sessionId: operation.sessionId });
  if (!equalSecret(binding, operation.contactBinding)) {
    throw new CustomerBookingOperationError('contact_changed', operation);
  }
  const locked: LockedCustomerBookingOperation = { ...operation, [LOCKED]: true };
  lockedTransactions.set(locked, tx);
  return { kind: 'create', operation: locked };
}

export async function linkCustomerBookingOperation(tx: CustomerBookingTransaction, operation: LockedCustomerBookingOperation, appointmentId: string, now = new Date()): Promise<void> {
  if (operation[LOCKED] !== true || lockedTransactions.get(operation) !== tx) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
  const [appointment] = await tx.select({ id: appointmentSchema.id }).from(appointmentSchema).where(and(
    eq(appointmentSchema.id, appointmentId),
    eq(appointmentSchema.salonId, operation.salonId),
  )).limit(1);
  if (!appointment) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
  const [linked] = await tx.update(operations).set({ appointmentId, committedAt: now, updatedAt: now, lastFailure: null }).where(and(
    eq(operations.id, operation.id),
    eq(operations.salonId, operation.salonId),
    eq(operations.revision, operation.revision),
    eq(operations.requestHash, operation.requestHash),
    isNull(operations.appointmentId),
    isNull(operations.lastFailure),
  )).returning();
  if (!linked) {
    throw new CustomerBookingOperationError('invalid_operation');
  }
}

/** An old failed request cannot overwrite a newer review or a committed booking. */
export async function recordCustomerBookingFailure(args: {
  salonId: string;
  capability: string;
  secret: string;
  revision: number;
  failure: CustomerBookingFailure;
  now?: OperationClock;
}): Promise<CustomerBookingOperation> {
  const identity = verifyCapability(args.capability, args.salonId, args.secret);
  return withClientLifecycleTransactionRetry(() => db.transaction(async (tx) => {
    const [current] = await tx.select().from(operations).where(and(
      eq(operations.id, identity.id),
      eq(operations.salonId, args.salonId),
    )).for('update');
    const now = currentTime(args.now);
    assertRecovery(current, identity.sessionId, now);
    if (current.appointmentId || current.revision !== args.revision) {
      return current;
    }
    const [updated] = await tx.update(operations).set({ lastFailure: args.failure, updatedAt: now }).where(and(
      eq(operations.id, current.id),
      eq(operations.salonId, args.salonId),
    )).returning();
    if (!updated) {
      throw new CustomerBookingOperationError('invalid_operation');
    }
    return updated;
  }));
}
