import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { appointmentSchema, publicBookingAttemptSchema as attempts } from '@/models/Schema';

import { hashPublicBookingRecoveryKey } from './publicBookingRecovery.server';

const uuid = z.string().uuid();
const startedAt = z.string().max(40).datetime({ offset: true });
const STALE_IN_FLIGHT_MS = 10 * 60_000;

export type PublicBookingAttemptTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DirectPublicBookingAttempt = { attemptId: string; recoveryKeyHash: string; requestHash?: string };

export function readDirectPublicBookingAttempt(request: Request): DirectPublicBookingAttempt | null {
  if (request.headers.get('X-Booking-Attempt-Version') !== '2') {
    return null;
  }
  const attemptId = uuid.safeParse(request.headers.get('Idempotency-Key'));
  const recoveryKey = uuid.safeParse(request.headers.get('X-Booking-Recovery-Key'));
  return attemptId.success && recoveryKey.success
    ? { attemptId: attemptId.data, recoveryKeyHash: hashPublicBookingRecoveryKey(recoveryKey.data) }
    : null;
}

export class PublicBookingAttemptError extends Error {
  constructor(readonly kind: 'replay' | 'failed' | 'in_flight' | 'proof_mismatch', readonly appointmentId?: string) {
    super(`PUBLIC_BOOKING_ATTEMPT_${kind.toUpperCase()}`);
  }
}

/** Registers v2 before validation so an authoritative 4xx can close it. */
export async function registerPublicBookingAttempt(input: DirectPublicBookingAttempt & { salonId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(attempts).values({ salonId: input.salonId, attemptId: input.attemptId, recoveryKeyHash: input.recoveryKeyHash, state: 'in_flight' }).onConflictDoNothing();
    const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.salonId, input.salonId), eq(attempts.attemptId, input.attemptId))).for('update');
    if (!attempt || attempt.recoveryKeyHash !== input.recoveryKeyHash) {
      throw new PublicBookingAttemptError('proof_mismatch');
    }
  });
}

/** First statement in the appointment transaction for a v2 direct attempt. */
export async function lockPublicBookingAttempt(
  tx: PublicBookingAttemptTransaction,
  input: DirectPublicBookingAttempt & { salonId: string },
): Promise<void> {
  await tx.insert(attempts).values({
    salonId: input.salonId,
    attemptId: input.attemptId,
    recoveryKeyHash: input.recoveryKeyHash,
    state: 'in_flight',
  }).onConflictDoNothing();
  const [attempt] = await tx.select().from(attempts).where(and(
    eq(attempts.salonId, input.salonId),
    eq(attempts.attemptId, input.attemptId),
  )).for('update');
  if (!attempt || attempt.recoveryKeyHash !== input.recoveryKeyHash) {
    throw new PublicBookingAttemptError('proof_mismatch');
  }
  if (input.requestHash && attempt.requestHash && attempt.requestHash !== input.requestHash) {
    throw new PublicBookingAttemptError('proof_mismatch');
  }
  if (attempt.state === 'succeeded' && attempt.appointmentId) {
    throw new PublicBookingAttemptError('replay', attempt.appointmentId);
  }
  if (attempt.state === 'failed') {
    throw new PublicBookingAttemptError('failed');
  }
  if (attempt.state !== 'in_flight' || attempt.appointmentId) {
    throw new PublicBookingAttemptError('in_flight');
  }
  if (input.requestHash && !attempt.requestHash) {
    const [bound] = await tx.update(attempts).set({ requestHash: input.requestHash, updatedAt: new Date() }).where(and(
      eq(attempts.salonId, input.salonId),
      eq(attempts.attemptId, input.attemptId),
      eq(attempts.recoveryKeyHash, input.recoveryKeyHash),
      isNull(attempts.requestHash),
    )).returning();
    if (!bound) {
      throw new PublicBookingAttemptError('proof_mismatch');
    }
  }
}

/** The appointment and durable attempt link commit or roll back together. */
export async function linkPublicBookingAttempt(
  tx: PublicBookingAttemptTransaction,
  input: DirectPublicBookingAttempt & { salonId: string; appointmentId: string },
): Promise<void> {
  const [linked] = await tx.update(attempts).set({
    state: 'succeeded',
    appointmentId: input.appointmentId,
    failureCode: null,
    updatedAt: new Date(),
  }).where(and(
    eq(attempts.salonId, input.salonId),
    eq(attempts.attemptId, input.attemptId),
    eq(attempts.recoveryKeyHash, input.recoveryKeyHash),
    eq(attempts.state, 'in_flight'),
    isNull(attempts.appointmentId),
  )).returning();
  if (!linked) {
    throw new PublicBookingAttemptError('in_flight');
  }
}

type AttemptStatusRequest = { attemptId: string; recoveryKey: string; version?: number; startedAt?: string };
export const publicBookingAttemptStatusRequestSchema = z.object({
  attemptId: uuid,
  recoveryKey: uuid,
  version: z.literal(2).optional(),
  startedAt: startedAt.optional(),
}).strict();

function projection(appointment: typeof appointmentSchema.$inferSelect) {
  return {
    data: {
      appointmentId: appointment.id,
      appointment: {
        id: appointment.id,
        // A recovery response must not present a soft-deleted appointment as
        // confirmed merely because that was its historical booking status.
        status: appointment.deletedAt ? 'unavailable' : appointment.status,
        startTime: appointment.startTime.toISOString(),
        totalPrice: appointment.totalPrice,
        totalDurationMinutes: appointment.totalDurationMinutes,
        bookingTaxSnapshot: appointment.bookingTaxSnapshot,
      },
    },
    meta: { timestamp: appointment.createdAt.toISOString(), recovered: true },
  };
}

/** Read-only except for a v2 stale/absent attempt fence, which prevents a late POST from creating. */
export async function readPublicBookingAttemptStatus(input: AttemptStatusRequest & { salonId: string }) {
  const proofHash = hashPublicBookingRecoveryKey(input.recoveryKey);
  return db.transaction(async (tx) => {
    let [attempt] = await tx.select().from(attempts).where(and(
      eq(attempts.salonId, input.salonId),
      eq(attempts.attemptId, input.attemptId),
    )).for('update');
    if (!attempt && input.version === 2 && input.startedAt) {
      const began = new Date(input.startedAt);
      if (!Number.isNaN(began.getTime()) && Date.now() - began.getTime() >= STALE_IN_FLIGHT_MS) {
        await tx.insert(attempts).values({ salonId: input.salonId, attemptId: input.attemptId, recoveryKeyHash: proofHash, state: 'failed', failureCode: 'never_claimed' }).onConflictDoNothing();
        [attempt] = await tx.select().from(attempts).where(and(eq(attempts.salonId, input.salonId), eq(attempts.attemptId, input.attemptId))).for('update');
      }
    }
    if (!attempt || attempt.recoveryKeyHash !== proofHash) {
      return { kind: 'unknown' } as const;
    }
    if (attempt.state === 'in_flight'
      && !attempt.appointmentId
      && Date.now() - attempt.createdAt.getTime() >= STALE_IN_FLIGHT_MS) {
      const [fenced] = await tx.update(attempts).set({
        state: 'failed',
        failureCode: 'stale_in_flight',
        updatedAt: new Date(),
      }).where(and(
        eq(attempts.salonId, input.salonId),
        eq(attempts.attemptId, input.attemptId),
        eq(attempts.recoveryKeyHash, proofHash),
        eq(attempts.state, 'in_flight'),
        isNull(attempts.appointmentId),
      )).returning();
      attempt = fenced ?? attempt;
    }
    if (attempt.state === 'failed') {
      return { kind: 'resolved_failure' } as const;
    }
    if (attempt.state === 'in_flight' || !attempt.appointmentId) {
      return { kind: 'pending' } as const;
    }
    const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, attempt.appointmentId), eq(appointmentSchema.salonId, input.salonId))).limit(1);
    return appointment ? { kind: 'resolved_success', response: projection(appointment) } as const : { kind: 'unknown' } as const;
  });
}

/** Only a 4xx response that was produced after a v2 attempt is known unlinked may release it. */
export async function finalizePublicBookingAttemptFailure(input: DirectPublicBookingAttempt & { salonId: string; code: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.salonId, input.salonId), eq(attempts.attemptId, input.attemptId))).for('update');
    if (!attempt || attempt.recoveryKeyHash !== input.recoveryKeyHash || attempt.state !== 'in_flight' || attempt.appointmentId) {
      return false;
    }
    const [failed] = await tx.update(attempts).set({ state: 'failed', failureCode: input.code, updatedAt: new Date() }).where(and(eq(attempts.salonId, input.salonId), eq(attempts.attemptId, input.attemptId), eq(attempts.state, 'in_flight'), isNull(attempts.appointmentId))).returning();
    return Boolean(failed);
  });
}
