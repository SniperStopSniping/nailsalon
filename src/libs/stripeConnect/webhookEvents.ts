import 'server-only';

import { and, eq, lt, lte, or, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { type StripeWebhookEvent, stripeWebhookEventSchema } from '@/models/Schema';

/**
 * The durable receipt / claim layer for Stripe webhook deliveries.
 *
 * THE EVENT-ROW INSERT LIVES HERE AND ONLY HERE. A later PR attaches money
 * events to this same route and this same table; a revert of that PR alone must
 * still leave the receipt layer recording, which it cannot do if the insert has
 * been inlined into a processor module.
 */

// =============================================================================
// THE COMPLETE, NORMATIVE VOCABULARY
// =============================================================================

/**
 * `status` = THIS WRITER'S PROCESSING LIFECYCLE — where the row sits in the
 * claim / retry / finalize state machine. It is what the claim INSERT writes,
 * what the reclaim CAS writes and predicates on, what the fenced finalize
 * predicates on, and what a later PR's sweep selects on via the
 * `(status, available_at)` index.
 *
 * This writer emits ONLY these four literals and never puts an `ignored_*`
 * literal in `status`. That is a rule about this code, not about the table:
 * 0065's `stripe_webhook_event_status_valid` CHECK is the UNION of these four
 * and a later writer's eleven terminal statuses (six of which ARE `ignored_*`
 * literals, used there as absorbing lifecycle positions). Do not narrow that
 * CHECK to these four — doing so rejects the other writer's every terminal row.
 *
 * `poisoned` is DECLARED AND RESERVED: D2 writes it at NO site. A later PR's
 * reconcile sweep owns the generic escalation, and a CHECK that rejected the
 * literal would break that PR after D2 had already merged.
 */
export const STRIPE_WEBHOOK_EVENT_STATUSES = [
  'processing',
  'failed_retryable',
  'processed',
  'poisoned',
  // D5's eleven terminal statuses. They were always admitted by 0065's CHECK —
  // the constraint is the union of both writers' vocabularies — and are listed
  // here now that a writer emits them, so this constant IS the CHECK rather
  // than a subset of it. The Connect account-lifecycle handlers above still
  // emit only the first four; widening this array does not widen them.
  'held_mismatch',
  'held_duplicate_session',
  'account_mismatch',
  'unbound_unresolved',
  'orphan_unresolved',
  'ignored_non_connect_scope',
  'ignored_livemode',
  'ignored_unhandled',
  'ignored_foreign_session',
  'ignored_unpaid',
  'ignored_over_cap',
] as const;

/**
 * `outcome` = THE CROSS-ROUTE BUSINESS DISPOSITION — what happened to this
 * event, in a vocabulary that means the same thing regardless of which route
 * received it. Nullable, no CHECK.
 *
 * READ RULE for anything that queries this table: a question about *what
 * happened to these events* keys on `outcome`; a question about *where are these
 * rows in the pipeline* keys on `status`. A cross-route disposition keyed on
 * `status` silently returns ZERO of this writer's rows, because every
 * disposition here lands on `status = 'processed'`.
 */
export const STRIPE_WEBHOOK_EVENT_OUTCOMES = [
  'ignored_livemode',
  'ignored_unhandled',
  'ignored_non_connect_scope',
  'ignored_revoked_binding',
  'unbound_account',
  'unbound_unresolved',
  'permanent_provider_error',
  'disabled_by_flag',
  'processed',
  'poisoned',
  // D5's business dispositions. `outcome` carries NO CHECK, so this array is an
  // app-level union rather than a DDL contract — but every terminal row must
  // carry a non-null value from it, because `outcome` is the only column both
  // routes agree on.
  'confirmed',
  'already_confirmed',
  'already_confirmed_late_refund',
  'healed_deposit',
  'healed_deposit_late',
  'restored',
  'refunded',
  'deferred_no_deposit',
  'session_expired',
  'awaiting_async_payment',
  'refund_failed_unreconciled',
  'payment_failed',
  // D5 mirrors each of its terminal STATUSES into `outcome` as well. That
  // mirror is what keeps a cross-route disposition query complete: this route's
  // handlers land every disposition on `status='processed'`, so a query keyed
  // on `status` would return none of them.
  'held_mismatch',
  'held_duplicate_session',
  'account_mismatch',
  'orphan_unresolved',
  'ignored_foreign_session',
  'ignored_unpaid',
  'ignored_over_cap',
] as const;

export type StripeWebhookEventStatus = (typeof STRIPE_WEBHOOK_EVENT_STATUSES)[number];
export type StripeWebhookEventOutcome = (typeof STRIPE_WEBHOOK_EVENT_OUTCOMES)[number];

/** A row is TERMINAL iff its status is neither `processing` nor `failed_retryable`. */
export function isTerminalStatus(status: string): boolean {
  return status !== 'processing' && status !== 'failed_retryable';
}

/** Stale-claim horizon: a crashed worker's claim becomes reclaimable after this. */
export const CLAIM_STALE_AFTER_MS = 15 * 60_000;

/** Unbound-account backoff: 1 min, doubling, capped at 60 min. */
export function unboundBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(60 * 60_000, 60_000 * 2 ** exponent);
}

/** The unbound path is the ONLY D2-side retry escalation. */
export const UNBOUND_MAX_ATTEMPTS = 8;

// =============================================================================
// CLAIM / RECLAIM / FINALIZE
// =============================================================================

export type ClaimResult =
  | { claimed: true; id: string; attempts: number }
  | { claimed: false };

/**
 * The normalized projection columns, EVERY ONE NULLABLE.
 *
 * Nullability is the contract, not an oversight: a `mode=setup` or
 * `mode=subscription` Checkout Session legitimately carries no `amount_total`,
 * no `currency` and no `payment_intent`, and treating an absent optional field
 * as a failure would poison — with a retained payload — every card-saving
 * session a full-Dashboard salon generates.
 */
export type WebhookEventProjection = {
  sessionId: string | null;
  paymentIntentId: string | null;
  paymentStatus: string | null;
  amountTotal: number | null;
  currency: string | null;
  metadataAppointmentId: string | null;
  metadataSalonId: string | null;
  metadataDepositId: string | null;
  clientReferenceId: string | null;
  projectionStatus: 'ok' | 'failed';
  rawPayload: unknown | null;
  payloadPurgeAfter: Date | null;
};

/**
 * FUSED CLAIM — the single insert path for every recorded outcome.
 *
 * The row is born CLAIMED (`status='processing'`, `attempts=1`). Scope and
 * livemode are evaluated AFTER the claim and stamped as terminal outcomes, so
 * "recorded before any state mutation" holds literally on every path.
 *
 * There is deliberately no second, plain INSERT on the livemode branch: with no
 * `ON CONFLICT` it would raise 23505 → 500 → a retry loop on every redelivery of
 * a mismatched event.
 */
export async function claimWebhookEvent(input: {
  eventId: string;
  type: string;
  account: string | null;
  livemode: boolean;
  /**
   * The normalized Checkout-Session projection, for the types that carry one.
   *
   * Passed IN rather than derived here so this module keeps no knowledge of
   * Stripe payload shapes, and so the extraction stays TYPE-SCOPED at its call
   * site: `account.*` deliveries store a NULL projection and never a payload.
   * Omit it entirely and the row is exactly what it was before D5.
   */
  projection?: WebhookEventProjection | null;
  salonId?: string | null;
}): Promise<ClaimResult> {
  const projection = input.projection ?? null;
  const rows = await db
    .insert(stripeWebhookEventSchema)
    .values({
      id: `swe_${crypto.randomUUID()}`,
      eventId: input.eventId,
      type: input.type,
      account: input.account,
      livemode: input.livemode,
      status: 'processing',
      attempts: 1,
      receivedAt: sql`now()`,
      salonId: input.salonId ?? null,
      ...(projection
        ? {
            sessionId: projection.sessionId,
            paymentIntentId: projection.paymentIntentId,
            paymentStatus: projection.paymentStatus,
            amountTotal: projection.amountTotal,
            currency: projection.currency,
            metadataAppointmentId: projection.metadataAppointmentId,
            metadataSalonId: projection.metadataSalonId,
            metadataDepositId: projection.metadataDepositId,
            clientReferenceId: projection.clientReferenceId,
            projectionStatus: projection.projectionStatus,
            rawPayload: projection.rawPayload,
            payloadPurgeAfter: projection.payloadPurgeAfter,
          }
        : {}),
    })
    .onConflictDoNothing({ target: stripeWebhookEventSchema.eventId })
    .returning();

  const row = rows[0];
  if (!row) {
    return { claimed: false };
  }
  return { claimed: true, id: row.id, attempts: row.attempts };
}

export async function readWebhookEvent(
  eventId: string,
): Promise<StripeWebhookEvent | null> {
  const rows = await db
    .select()
    .from(stripeWebhookEventSchema)
    .where(eq(stripeWebhookEventSchema.eventId, eventId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * RECLAIM CAS. Returns the NEW attempts value, which becomes this delivery's
 * fencing token, or null when another worker won the reclaim.
 *
 * The predicate must cover BOTH arms. A predicate of only `status='processing'`
 * matches zero `failed_retryable` rows and strands every retry.
 */
export async function reclaimWebhookEvent(input: {
  id: string;
  now: Date;
  staleCutoff: Date;
}): Promise<number | null> {
  const rows = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'processing',
      attempts: sql`${stripeWebhookEventSchema.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, input.id),
      or(
        and(
          eq(stripeWebhookEventSchema.status, 'failed_retryable'),
          lte(stripeWebhookEventSchema.availableAt, input.now),
        ),
        and(
          eq(stripeWebhookEventSchema.status, 'processing'),
          lt(stripeWebhookEventSchema.updatedAt, input.staleCutoff),
        ),
      ),
    ))
    .returning();

  return rows[0]?.attempts ?? null;
}

/**
 * FENCED FINALIZE.
 *
 * `attempts` MUST be the value RETURNED by the claim INSERT or by the reclaim
 * CAS — never recomputed, never re-read, and never assumed to be 1. Assuming 1
 * works for a first delivery and silently disables fencing for every reclaimed
 * one, which is the exact case fencing exists for.
 *
 * EVERY TERMINAL ROW MUST CARRY A NON-NULL `outcome`: it is the only thing that
 * makes the disposition vocabulary complete across both routes that write here.
 */
export async function finalizeWebhookEvent(input: {
  id: string;
  attempts: number;
  status: StripeWebhookEventStatus;
  outcome: StripeWebhookEventOutcome | null;
  lastError?: string | null;
  availableAt?: Date | null;
  processedAt?: Date | null;
}): Promise<boolean> {
  const rows = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: input.status,
      outcome: input.outcome,
      processedAt: input.processedAt ?? null,
      lastError: input.lastError ?? null,
      availableAt: input.availableAt ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, input.id),
      eq(stripeWebhookEventSchema.status, 'processing'),
      eq(stripeWebhookEventSchema.attempts, input.attempts),
    ))
    .returning();

  return rows.length === 1;
}

/** Convenience: finalize a terminal disposition. Always stamps `processed_at`. */
export async function finalizeTerminal(input: {
  id: string;
  attempts: number;
  outcome: StripeWebhookEventOutcome;
  lastError?: string | null;
}): Promise<boolean> {
  return finalizeWebhookEvent({
    id: input.id,
    attempts: input.attempts,
    status: 'processed',
    outcome: input.outcome,
    lastError: input.lastError ?? null,
    processedAt: new Date(),
    availableAt: null,
  });
}

/**
 * Convenience: finalize a retryable failure. Deliberately carries NO attempts
 * cap — every transient failure outside the unbound path is bounded by Stripe's
 * own ≤3-day retry horizon and, after that, by a later PR's reconcile sweep.
 */
export async function finalizeRetryable(input: {
  id: string;
  attempts: number;
  outcome: StripeWebhookEventOutcome | null;
  lastError?: string | null;
  availableAt: Date;
}): Promise<boolean> {
  return finalizeWebhookEvent({
    id: input.id,
    attempts: input.attempts,
    status: 'failed_retryable',
    outcome: input.outcome,
    lastError: input.lastError ?? null,
    availableAt: input.availableAt,
    processedAt: null,
  });
}
