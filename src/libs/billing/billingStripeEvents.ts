/**
 * Billing Stripe-event claim machinery — Gate C2 (contract §8.2).
 *
 * `billing_stripe_event` (Migration A, inert through Gate B) becomes the
 * idempotency backbone of /api/webhooks/stripe-billing:
 *
 *   claim     INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING — exactly
 *             one delivery of a Stripe event ever processes; replays exit 200.
 *   reclaim   a failed_retryable row past its backoff becomes processable
 *             again by THIS delivery (CAS on status), so Stripe's retry
 *             schedule drives recovery with no cron.
 *   poison    the 8th failed attempt parks the event for a human (Sentry) and
 *             returns 200 so Stripe stops retrying a poison pill.
 *
 * Financial effects NEVER rely on event ordering (§8.3): every handler is
 * idempotent on object-derived keys, and this table only guarantees each
 * event id runs to a terminal status exactly once.
 */

import 'server-only';

import { and, eq, lte, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { billingStripeEventSchema } from '@/models/Schema';

export const BILLING_EVENT_MAX_ATTEMPTS = 8;

export type BillingEventClaim =
  | { claimed: true; attempts: number }
  | { claimed: false; reason: 'already_processed' | 'in_flight' };

/**
 * Claim an event id for processing. Extracted object ids are persisted at
 * claim time so audit/ops can see what an event touched even after
 * raw_payload purges (§8.2 — the payload is purge-scheduled, the columns
 * are not).
 */
export async function claimBillingEvent(input: {
  eventId: string;
  eventType: string;
  livemode: boolean;
  apiCreatedAt: Date;
  salonId?: string | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  priceId?: string | null;
  rawPayload?: Record<string, unknown> | null;
  now?: Date;
}): Promise<BillingEventClaim> {
  const now = input.now ?? new Date();
  const inserted = await db
    .insert(billingStripeEventSchema)
    .values({
      id: `bse_${crypto.randomUUID()}`,
      eventId: input.eventId,
      eventType: input.eventType,
      livemode: input.livemode,
      apiCreatedAt: input.apiCreatedAt,
      salonId: input.salonId ?? null,
      status: 'processing',
      attempts: 1,
      subscriptionId: input.subscriptionId ?? null,
      invoiceId: input.invoiceId ?? null,
      checkoutSessionId: input.checkoutSessionId ?? null,
      paymentIntentId: input.paymentIntentId ?? null,
      priceId: input.priceId ?? null,
      rawPayload: input.rawPayload ?? null,
      // 30-day payload retention; the extracted columns are the durable part.
      payloadPurgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      receivedAt: now,
    })
    .onConflictDoNothing({ target: billingStripeEventSchema.eventId })
    .returning();
  if (inserted.length === 1) {
    return { claimed: true, attempts: inserted[0]!.attempts };
  }

  // Reclaim: only a failed_retryable row past its backoff may run again.
  const reclaimed = await db
    .update(billingStripeEventSchema)
    .set({
      status: 'processing',
      attempts: sql`${billingStripeEventSchema.attempts} + 1`,
      lastError: null,
    })
    .where(and(
      eq(billingStripeEventSchema.eventId, input.eventId),
      eq(billingStripeEventSchema.status, 'failed_retryable'),
      lte(billingStripeEventSchema.availableAt, now),
    ))
    .returning();
  if (reclaimed.length === 1) {
    return { claimed: true, attempts: reclaimed[0]!.attempts };
  }

  const [existing] = await db
    .select({ status: billingStripeEventSchema.status })
    .from(billingStripeEventSchema)
    .where(eq(billingStripeEventSchema.eventId, input.eventId))
    .limit(1);
  return {
    claimed: false,
    reason: existing?.status === 'processing' || existing?.status === 'failed_retryable'
      ? 'in_flight'
      : 'already_processed',
  };
}

/** Terminal success / classification statuses. */
export async function resolveBillingEvent(
  eventId: string,
  status: 'processed' | 'ignored_unhandled' | 'ignored_livemode_mismatch' | 'ignored_foreign' | 'superseded_stale' | 'held_anomaly',
  detail?: string,
): Promise<void> {
  await db
    .update(billingStripeEventSchema)
    .set({ status, processedAt: new Date(), ...(detail !== undefined ? { lastError: detail.slice(0, 500) } : {}) })
    .where(eq(billingStripeEventSchema.eventId, eventId));
}

/**
 * Handler failure: exponential backoff (1m, 2m, 4m, … capped at 1h) until
 * the poison threshold, matching Stripe's own retry cadence closely enough
 * that the reclaim path is always eligible when the retry arrives.
 */
export async function failBillingEvent(input: {
  eventId: string;
  attempts: number;
  error: string;
  now?: Date;
}): Promise<{ poisoned: boolean }> {
  const now = input.now ?? new Date();
  if (input.attempts >= BILLING_EVENT_MAX_ATTEMPTS) {
    await db
      .update(billingStripeEventSchema)
      .set({ status: 'poisoned', lastError: input.error.slice(0, 500), processedAt: now })
      .where(eq(billingStripeEventSchema.eventId, input.eventId));
    return { poisoned: true };
  }
  const backoffMs = Math.min(60_000 * 2 ** (input.attempts - 1), 60 * 60 * 1000);
  await db
    .update(billingStripeEventSchema)
    .set({
      status: 'failed_retryable',
      lastError: input.error.slice(0, 500),
      availableAt: new Date(now.getTime() + backoffMs),
    })
    .where(eq(billingStripeEventSchema.eventId, input.eventId));
  return { poisoned: false };
}
