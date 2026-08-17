/**
 * Checkout-attempt serialization primitives — contract §8.5.
 *
 * B1 persists and serializes ONLY: no Stripe SDK import, no session
 * creation, no route. At most one ACTIVE subscription attempt per salon
 * (purpose-scoped partial unique — a pending subscription attempt must
 * never block top-ups); repeated requests reuse the active attempt; the
 * Stripe idempotency key derives deterministically from the persisted
 * attempt id and is never browser-supplied. A salon with a LIVE paid
 * subscription cannot begin a new-subscription attempt
 * (ACTIVE_SUBSCRIPTION_EXISTS): upgrades are never a second subscription.
 */

import 'server-only';

import { and, eq, inArray, lt } from 'drizzle-orm';

import {
  billingCheckoutAttemptSchema,
  billingSubscriptionSchema,
} from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

export const CHECKOUT_ATTEMPT_TTL_MS = 60 * 60 * 1000;

export function deriveStripeIdempotencyKey(attemptId: string): string {
  return `billing-attempt:${attemptId}`;
}

export type BeginAttemptResult =
  | { ok: true; attemptId: string; stripeIdempotencyKey: string; reused: boolean }
  | { ok: false; reason: 'ACTIVE_SUBSCRIPTION_EXISTS' };

export async function beginCheckoutAttempt(
  tx: BillingDbTransaction,
  input: {
    salonId: string;
    purpose: 'plan_subscription' | 'sms_topup';
    billingOfferKey?: string | null;
    topupOfferKey?: string | null;
    promotionKey?: string | null;
    now?: Date;
  },
): Promise<BeginAttemptResult> {
  const now = input.now ?? new Date();

  if (input.purpose === 'plan_subscription') {
    const live = await tx
      .select({ id: billingSubscriptionSchema.id })
      .from(billingSubscriptionSchema)
      .where(and(
        eq(billingSubscriptionSchema.salonId, input.salonId),
        inArray(billingSubscriptionSchema.status, ['active', 'past_due', 'trialing', 'paused', 'unpaid', 'incomplete']),
      ))
      .limit(1);
    if (live.length > 0) {
      return { ok: false, reason: 'ACTIVE_SUBSCRIPTION_EXISTS' };
    }
  }

  // Supersede attempts past their TTL, then reuse any still-active one.
  await tx
    .update(billingCheckoutAttemptSchema)
    .set({ status: 'expired' })
    .where(and(
      eq(billingCheckoutAttemptSchema.salonId, input.salonId),
      inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
      lt(billingCheckoutAttemptSchema.expiresAt, now),
    ));

  if (input.purpose === 'plan_subscription') {
    const active = await tx
      .select({
        id: billingCheckoutAttemptSchema.id,
        stripeIdempotencyKey: billingCheckoutAttemptSchema.stripeIdempotencyKey,
      })
      .from(billingCheckoutAttemptSchema)
      .where(and(
        eq(billingCheckoutAttemptSchema.salonId, input.salonId),
        eq(billingCheckoutAttemptSchema.purpose, 'plan_subscription'),
        inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
      ))
      .limit(1);
    if (active.length > 0) {
      return {
        ok: true,
        attemptId: active[0]!.id,
        stripeIdempotencyKey: active[0]!.stripeIdempotencyKey,
        reused: true,
      };
    }
  }

  const attemptId = `bca_${crypto.randomUUID()}`;
  const stripeIdempotencyKey = deriveStripeIdempotencyKey(attemptId);
  // Targetless ON CONFLICT DO NOTHING (it also covers the PARTIAL active
  // unique) instead of catch-and-continue: a unique violation would abort
  // the caller's transaction, poisoning every later statement (25P02).
  const inserted = await tx.insert(billingCheckoutAttemptSchema).values({
    id: attemptId,
    salonId: input.salonId,
    purpose: input.purpose,
    billingOfferKey: input.billingOfferKey ?? null,
    topupOfferKey: input.topupOfferKey ?? null,
    promotionKey: input.promotionKey ?? null,
    status: 'creating',
    stripeIdempotencyKey,
    expiresAt: new Date(now.getTime() + CHECKOUT_ATTEMPT_TTL_MS),
  }).onConflictDoNothing().returning();
  if (inserted.length === 0) {
    // Partial-unique race: a concurrent request created the active attempt
    // between our check and insert — reuse it.
    const active = await tx
      .select({
        id: billingCheckoutAttemptSchema.id,
        stripeIdempotencyKey: billingCheckoutAttemptSchema.stripeIdempotencyKey,
      })
      .from(billingCheckoutAttemptSchema)
      .where(and(
        eq(billingCheckoutAttemptSchema.salonId, input.salonId),
        eq(billingCheckoutAttemptSchema.purpose, input.purpose),
        inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
      ))
      .limit(1);
    if (active.length > 0) {
      return {
        ok: true,
        attemptId: active[0]!.id,
        stripeIdempotencyKey: active[0]!.stripeIdempotencyKey,
        reused: true,
      };
    }
    throw new Error('CHECKOUT_ATTEMPT_CONFLICT_UNRESOLVED');
  }
  return { ok: true, attemptId, stripeIdempotencyKey, reused: false };
}

export async function markAttemptCheckoutCreated(
  tx: BillingDbTransaction,
  input: { attemptId: string; stripeCheckoutSessionId: string },
): Promise<{ updated: boolean }> {
  const updated = await tx
    .update(billingCheckoutAttemptSchema)
    .set({ status: 'checkout_created', stripeCheckoutSessionId: input.stripeCheckoutSessionId })
    .where(and(
      eq(billingCheckoutAttemptSchema.id, input.attemptId),
      eq(billingCheckoutAttemptSchema.status, 'creating'),
    ))
    .returning();
  return { updated: updated.length === 1 };
}

export async function completeAttempt(
  tx: BillingDbTransaction,
  input: { stripeCheckoutSessionId: string },
): Promise<{ completed: boolean }> {
  const updated = await tx
    .update(billingCheckoutAttemptSchema)
    .set({ status: 'completed' })
    .where(and(
      eq(billingCheckoutAttemptSchema.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
      inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
    ))
    .returning();
  return { completed: updated.length === 1 };
}

export async function failAttempt(
  tx: BillingDbTransaction,
  input: { attemptId: string },
): Promise<{ failed: boolean }> {
  const updated = await tx
    .update(billingCheckoutAttemptSchema)
    .set({ status: 'failed' })
    .where(and(
      eq(billingCheckoutAttemptSchema.id, input.attemptId),
      inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
    ))
    .returning();
  return { failed: updated.length === 1 };
}
