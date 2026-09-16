/**
 * Billing Stripe-event claim machinery — Gate C2 (contract §8.2), hardened
 * in P3b (re-derived from PR #176's ideas on top of #195's state machine).
 *
 * `billing_stripe_event` (Migration A, inert through Gate B) becomes the
 * idempotency backbone of /api/webhooks/stripe-billing:
 *
 *   claim     INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING — exactly
 *             one delivery of a Stripe event ever processes; replays exit 200.
 *   reclaim   a failed_retryable row past its backoff, OR a `processing` row
 *             whose PROCESSING LEASE has lapsed (its worker crashed or timed
 *             out without ever writing a terminal status), becomes
 *             processable again by THIS delivery, so Stripe's retry schedule
 *             (or a redelivery arriving after the lease) drives recovery
 *             with no cron.
 *   in_flight a `processing` row still WITHIN its lease is a live concurrent
 *             delivery, not a terminal replay — the route answers 503 so
 *             Stripe redelivers later, instead of acknowledging a delivery
 *             nobody actually finished.
 *   poison    the 8th failed attempt parks the event for a human (Sentry) and
 *             returns 200 so Stripe stops retrying a poison pill.
 *
 * Every terminal write (`resolveBillingEvent`/`failBillingEvent`) is
 * CAS-fenced on `(status = 'processing', attempts = <the claimer's value>)`:
 * only the worker that CURRENTLY owns the row may move it to a terminal
 * status. If another worker reclaimed the row (our lease lapsed while we
 * were still mid-flight), our late write is a no-op — the newer owner's
 * outcome is never overwritten.
 *
 * Financial effects NEVER rely on event ordering (§8.3): every handler is
 * idempotent on object-derived keys, and this table only guarantees each
 * event id runs to a terminal status exactly once (races over who reaches
 * that terminal status first do not double-run the FINANCIAL effect, since
 * handlers guard themselves independently).
 */

import 'server-only';

import { and, eq, lt, lte, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { billingStripeEventSchema, salonSchema } from '@/models/Schema';

export const BILLING_EVENT_MAX_ATTEMPTS = 8;

/**
 * How long a claim owns a row before another delivery may reclaim it. Must
 * comfortably exceed the slowest realistic handler run (a handful of Stripe
 * calls plus a few DB transactions) while staying short enough that a
 * genuinely crashed worker's event recovers well within Stripe's own retry
 * cadence.
 */
export const BILLING_EVENT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type BillingEventClaim =
  | { claimed: true; attempts: number }
  | { claimed: false; reason: 'already_processed' }
  | { claimed: false; reason: 'in_flight'; leaseExpiresAt: Date };

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

  // Y12 (D19c §2.3 item 5): a row parked as `ignored_livemode_mismatch`
  // becomes claimable again. The route reaches this function ONLY after the
  // event's `livemode` matched the CURRENT expectation, so arriving here with
  // a mismatch row means exactly one thing: the deployment's mode
  // configuration has since been corrected and Stripe has redelivered an
  // event we previously could not act on. Before this branch such a row was
  // permanently terminal, and the only recovery was a manual replay — which
  // INV-A10 forbids. `attempts` moves 0 → 1 (the mismatch row never claimed
  // an attempt), so the poison ladder still bounds it normally.
  //
  // `processed_at` is CLEARED here, unlike the other two reclaims. Those
  // reclaim rows that never carried one (`failed_retryable` only stamps it
  // when it poisons; a lapsed `processing` row never got that far), but
  // recordIgnoredBillingEvent writes the mismatch row ALREADY terminal, with
  // `processed_at` set. Carrying that forward would leave a reclaimed row
  // that then fails mid-handler sitting in `failed_retryable` wearing a
  // terminal timestamp — a state every ops query and forensic read would
  // misreport.
  const reclaimedLivemode = await db
    .update(billingStripeEventSchema)
    .set({
      status: 'processing',
      attempts: sql`${billingStripeEventSchema.attempts} + 1`,
      lastError: null,
      processedAt: null,
    })
    .where(and(
      eq(billingStripeEventSchema.eventId, input.eventId),
      eq(billingStripeEventSchema.status, 'ignored_livemode_mismatch'),
    ))
    .returning();
  if (reclaimedLivemode.length === 1) {
    return { claimed: true, attempts: reclaimedLivemode[0]!.attempts };
  }

  // P3b: a `processing` row whose lease has LAPSED means the worker that
  // claimed it crashed, timed out, or was killed before ever writing a
  // terminal status — nothing will ever CAS it out of `processing`
  // otherwise. `updated_at` is bumped by the table's own BEFORE UPDATE
  // trigger on every write (including this one), so reclaiming refreshes
  // the lease clock for the new owner exactly like a fresh claim would.
  const reclaimedLease = await db
    .update(billingStripeEventSchema)
    .set({
      status: 'processing',
      attempts: sql`${billingStripeEventSchema.attempts} + 1`,
      lastError: null,
    })
    .where(and(
      eq(billingStripeEventSchema.eventId, input.eventId),
      eq(billingStripeEventSchema.status, 'processing'),
      lt(billingStripeEventSchema.updatedAt, new Date(now.getTime() - BILLING_EVENT_PROCESSING_LEASE_MS)),
    ))
    .returning();
  if (reclaimedLease.length === 1) {
    return { claimed: true, attempts: reclaimedLease[0]!.attempts };
  }

  const [existing] = await db
    .select({ status: billingStripeEventSchema.status, updatedAt: billingStripeEventSchema.updatedAt })
    .from(billingStripeEventSchema)
    .where(eq(billingStripeEventSchema.eventId, input.eventId))
    .limit(1);
  // A `processing` row reaching this point is, by construction, STILL within
  // its lease (a lapsed one would have been reclaimed above) — a genuine
  // concurrent delivery, distinct from a terminal replay. A failed_retryable
  // row not yet past its own backoff stays classified with the terminal
  // replay (unchanged §8.2 behaviour): Stripe's own retry cadence, not this
  // route, decides when that redelivery is worth a fresh look.
  //
  // Y12: `already_processed` now means "terminal AND not reclaimable". It no
  // longer covers `ignored_livemode_mismatch`, which the branch above
  // reclaims whenever a redelivery arrives under a matching expectation.
  if (existing?.status === 'processing') {
    return {
      claimed: false,
      reason: 'in_flight',
      leaseExpiresAt: new Date(existing.updatedAt.getTime() + BILLING_EVENT_PROCESSING_LEASE_MS),
    };
  }
  return { claimed: false, reason: 'already_processed' };
}

/**
 * Record a DURABLE terminal row for an event this deployment must not act on
 * as delivered — today, exclusively the §8.2 livemode mismatch. Unlike
 * claimBillingEvent, this writes the row ALREADY in its terminal status: no
 * `processing` row is ever created, and `handleEvent` is never reachable for
 * this delivery. `ON CONFLICT (event_id) DO NOTHING` makes a replayed
 * delivery under the SAME (still mismatched) expectation a no-op — the first
 * delivery's row is authoritative and is never overwritten.
 *
 * Y12: "never processed" is no longer permanent. Once the deployment's mode
 * configuration is corrected, the route's livemode gate passes and
 * `claimBillingEvent` RECLAIMS this row (see its `ignored_livemode_mismatch`
 * branch), so a redelivery is processed normally instead of being dropped as
 * a terminal replay. The row is a parked event, not a tombstone.
 */
export async function recordIgnoredBillingEvent(
  input: {
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
  },
  status: 'ignored_livemode_mismatch',
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .insert(billingStripeEventSchema)
    .values({
      id: `bse_${crypto.randomUUID()}`,
      eventId: input.eventId,
      eventType: input.eventType,
      livemode: input.livemode,
      apiCreatedAt: input.apiCreatedAt,
      salonId: input.salonId ?? null,
      status,
      attempts: 0,
      subscriptionId: input.subscriptionId ?? null,
      invoiceId: input.invoiceId ?? null,
      checkoutSessionId: input.checkoutSessionId ?? null,
      paymentIntentId: input.paymentIntentId ?? null,
      priceId: input.priceId ?? null,
      rawPayload: input.rawPayload ?? null,
      // Same 30-day payload retention as a claimed row (§7.3 / G13 purge).
      payloadPurgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      receivedAt: now,
      processedAt: now,
    })
    .onConflictDoNothing({ target: billingStripeEventSchema.eventId });
}

/**
 * Populate `price_id` on an ALREADY-CLAIMED row once it becomes known (§4,
 * G02). Subscription events carry their price id in the event body itself,
 * so the route passes it straight into `claimBillingEvent` above. Top-up
 * checkout-session events only learn their price id from a `sessions.retrieve`
 * expansion the route performs AFTER claiming (a Stripe call is too heavy to
 * place before the claim, which must stay a cheap, synchronous-shaped guard
 * against concurrent delivery) — this backfills the same column for those.
 * A no-op when the price id is still unknown (never overwrites with null).
 */
export async function recordBillingEventPriceId(eventId: string, priceId: string | null): Promise<void> {
  if (priceId === null) {
    return;
  }
  await db
    .update(billingStripeEventSchema)
    .set({ priceId })
    .where(eq(billingStripeEventSchema.eventId, eventId));
}

/**
 * D19c §2.3 item 4: attribute an ALREADY-CLAIMED event row to the salon it
 * actually touched, so purge (`salonPurge.ts` nulls `billing_stripe_event.salon_id`)
 * and forensics can answer "what did this salon's billing do".
 *
 * Deliberately NOT written at claim time from the raw event body. `salon_id`
 * carries a real foreign key (`ON DELETE SET NULL`), so a salon id copied out
 * of a FOREIGN object's metadata would either fail the insert — turning a
 * terminal `ignored_foreign` classification into a retry loop — or, worse,
 * attribute another deployment's event to a same-named local salon. The route
 * calls this only after a handler has ESTABLISHED that the object is ours and
 * local, passing an id that came from a locally stored row (or from metadata
 * the projection has already accepted). `ignored_foreign` rows keep a NULL
 * `salon_id`.
 *
 * The `EXISTS` fence is defence in depth against exactly that hazard: if the
 * id does not name a live local salon the update writes nothing rather than
 * raising a foreign-key error inside a webhook that has already committed its
 * financial effect. A no-op on null, like {@link recordBillingEventPriceId}.
 */
export async function recordBillingEventSalonId(eventId: string, salonId: string | null): Promise<void> {
  if (salonId === null) {
    return;
  }
  await db
    .update(billingStripeEventSchema)
    .set({ salonId })
    .where(and(
      eq(billingStripeEventSchema.eventId, eventId),
      sql`EXISTS (SELECT 1 FROM ${salonSchema} WHERE ${salonSchema.id} = ${salonId} AND ${salonSchema.deletedAt} IS NULL)`,
    ));
}

/**
 * Terminal success / classification statuses. CAS-fenced (P3b): only writes
 * when the row is STILL `processing` under the exact `attempts` value the
 * caller claimed — the only way that can be false is another worker having
 * reclaimed this event id after our own processing lease lapsed (§ above).
 * Returns whether the write actually landed so the caller (the route) can
 * tell a genuine terminal write from a lost race and never double-report.
 */
export async function resolveBillingEvent(
  eventId: string,
  attempts: number,
  status: 'processed' | 'ignored_unhandled' | 'ignored_livemode_mismatch' | 'ignored_foreign' | 'superseded_stale' | 'held_anomaly',
  detail?: string,
): Promise<{ written: boolean }> {
  const updated = await db
    .update(billingStripeEventSchema)
    .set({ status, processedAt: new Date(), ...(detail !== undefined ? { lastError: detail.slice(0, 500) } : {}) })
    .where(and(
      eq(billingStripeEventSchema.eventId, eventId),
      eq(billingStripeEventSchema.status, 'processing'),
      eq(billingStripeEventSchema.attempts, attempts),
    ))
    .returning();
  return { written: updated.length === 1 };
}

/**
 * Handler failure: exponential backoff (1m, 2m, 4m, … capped at 1h) until
 * the poison threshold, matching Stripe's own retry cadence closely enough
 * that the reclaim path is always eligible when the retry arrives.
 *
 * `poisoned` reflects the CALLER's own attempts count against the threshold
 * — it answers "does MY delivery count as the poisoning one", independent
 * of whether this write actually lands (see `written`, P3b's CAS fence:
 * another worker may have already reclaimed and resolved this event id
 * after our lease lapsed, in which case this write is correctly a no-op and
 * the caller must not report a fresh poison over a race it lost).
 */
export async function failBillingEvent(input: {
  eventId: string;
  attempts: number;
  error: string;
  now?: Date;
}): Promise<{ poisoned: boolean; written: boolean }> {
  const now = input.now ?? new Date();
  const cas = and(
    eq(billingStripeEventSchema.eventId, input.eventId),
    eq(billingStripeEventSchema.status, 'processing'),
    eq(billingStripeEventSchema.attempts, input.attempts),
  );
  if (input.attempts >= BILLING_EVENT_MAX_ATTEMPTS) {
    const updated = await db
      .update(billingStripeEventSchema)
      .set({ status: 'poisoned', lastError: input.error.slice(0, 500), processedAt: now })
      .where(cas)
      .returning();
    return { poisoned: true, written: updated.length === 1 };
  }
  const backoffMs = Math.min(60_000 * 2 ** (input.attempts - 1), 60 * 60 * 1000);
  const updated = await db
    .update(billingStripeEventSchema)
    .set({
      status: 'failed_retryable',
      lastError: input.error.slice(0, 500),
      availableAt: new Date(now.getTime() + backoffMs),
    })
    .where(cas)
    .returning();
  return { poisoned: false, written: updated.length === 1 };
}
