import 'server-only';

import { and, count, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db } from '@/libs/DB';
import {
  CLAIM_STALE_AFTER_MS,
  type WebhookEventProjection,
} from '@/libs/stripeConnect/webhookEvents';
import {
  appointmentDepositSchema,
  appointmentSchema,
  salonStripeAccountSchema,
  stripeWebhookEventSchema,
} from '@/models/Schema';

/**
 * D5's event-row surface: projection extraction, the Luster-provenance
 * admission gate, the per-account admission cap, and the synthetic `luster.*`
 * work rows the non-webhook drivers use.
 *
 * WHAT IS DELIBERATELY NOT HERE: the physical event INSERT. It lives in
 * `src/libs/stripeConnect/webhookEvents.ts` — D2's module — and stays there, so
 * a D5-only revert leaves the receipt layer recording. Stripe never redelivers
 * a 2xx-acked event, so the rollback story rests on local rows, not on
 * redelivery, and moving the insert into a processor module would make the
 * processors and the receipt inseparable (stop condition S11).
 */

/** Payload retention horizon: PII-stripped extract survives, raw payload does not. */
export const PAYLOAD_PURGE_AFTER_MS = 14 * 24 * 60 * 60_000;

/** The orphan terminal is unreachable before an event is this old. */
export const ORPHAN_HORIZON_MS = 90 * 60_000;

/** Absolute ceiling on the per-account admission cap, independent of the K formula. */
export const ADMISSION_CAP_ABSOLUTE = 50;

/** Floor of the per-account admission cap. */
export const ADMISSION_CAP_BASE = 10;

/** A `paid` deposit counts as genuinely unsettled only inside this window. */
export const UNSETTLED_PAID_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * The MANUAL terminals. A deposit with a work row in one of these is EXCLUDED
 * from the sweep's discovery scans: the machinery has concluded, and re-entry is
 * an operator decision, not a cron decision.
 */
export const MANUAL_TERMINAL_STATUSES = [
  'held_mismatch',
  'unbound_unresolved',
  'poisoned',
  'orphan_unresolved',
  'held_duplicate_session',
  'account_mismatch',
] as const;

/** Live = the machinery still owns this row on its own schedule. */
export const LIVE_EVENT_STATUSES = ['processing', 'failed_retryable'] as const;

// =============================================================================
// PROJECTION EXTRACTION — TOTAL BY CONSTRUCTION, TYPE-SCOPED
// =============================================================================

/**
 * PII fields stripped before a raw payload is ever persisted.
 *
 * A retained payload is a debugging aid, not a customer record. The extract we
 * keep carries ids and money; the client's name, email, phone and address are
 * dropped at the door rather than purged later, because "later" is a promise
 * and this is a deletion.
 */
const PII_FIELDS = ['customer_details', 'customer_email', 'customer', 'collected_information'];

function stripPii(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const clone: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const field of PII_FIELDS) {
    delete clone[field];
  }
  return clone;
}

/** Types that carry a Checkout-Session-shaped projection. Everything else stores NULL. */
export function isProjectedType(type: string): boolean {
  return type.startsWith('checkout.session.') || type.startsWith('luster.');
}

function readString(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value === 'string') {
    return { ok: true, value };
  }
  // PRESENT but not coercible — that is a genuine extraction failure, unlike an
  // absent optional field.
  return { ok: false };
}

function readInteger(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { ok: true, value };
  }
  return { ok: false };
}

function readNestedId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  // Stripe returns either the id or an expanded object; both are legal.
  if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return readString((value as { id: unknown }).id);
  }
  return readString(value);
}

/**
 * Extracts the normalized projection from a Checkout Session payload.
 *
 * NEVER THROWS. Every column is nullable and the failure predicate is DEFINED
 * rather than "any field": `projection_status='failed'` means the payload could
 * not be parsed as a Checkout Session at all, OR a field that IS PRESENT could
 * not be coerced to its column type. An ABSENT OPTIONAL field is `'ok'` with
 * NULL — a `mode=setup` session has no `amount_total`, no `currency` and no
 * `payment_intent`, and that is a healthy session, not a broken payload.
 *
 * A `'failed'` row is RETRYABLE, never foreign: the sweep re-extracts it before
 * it can be classified, so a payload we could not read is never mistaken for a
 * payload that was not ours.
 */
export function extractCheckoutSessionProjection(input: {
  type: string;
  payload: unknown;
  receivedAt: Date;
}): WebhookEventProjection | null {
  if (!isProjectedType(input.type)) {
    // TYPE SCOPE. An `account.updated` row stores a NULL projection, is marked
    // `'ok'`, and never retains a payload.
    return {
      sessionId: null,
      paymentIntentId: null,
      paymentStatus: null,
      amountTotal: null,
      currency: null,
      metadataAppointmentId: null,
      metadataSalonId: null,
      metadataDepositId: null,
      clientReferenceId: null,
      projectionStatus: 'ok',
      rawPayload: null,
      payloadPurgeAfter: null,
    };
  }

  const failed = (): WebhookEventProjection => ({
    sessionId: null,
    paymentIntentId: null,
    paymentStatus: null,
    amountTotal: null,
    currency: null,
    metadataAppointmentId: null,
    metadataSalonId: null,
    metadataDepositId: null,
    clientReferenceId: null,
    projectionStatus: 'failed',
    rawPayload: stripPii(input.payload),
    payloadPurgeAfter: new Date(input.receivedAt.getTime() + PAYLOAD_PURGE_AFTER_MS),
  });

  if (!input.payload || typeof input.payload !== 'object') {
    return failed();
  }

  const session = input.payload as Record<string, unknown>;
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  if (session.metadata !== undefined && session.metadata !== null && typeof session.metadata !== 'object') {
    return failed();
  }

  const reads = {
    sessionId: readString(session.id),
    paymentIntentId: readNestedId(session.payment_intent),
    paymentStatus: readString(session.payment_status),
    amountTotal: readInteger(session.amount_total),
    currency: readString(session.currency),
    metadataAppointmentId: readString(metadata.appointment_id),
    metadataSalonId: readString(metadata.salon_id),
    metadataDepositId: readString(metadata.deposit_id),
    clientReferenceId: readString(session.client_reference_id),
  };

  if (Object.values(reads).some(read => !read.ok)) {
    return failed();
  }

  const value = <T>(read: { ok: true; value: T } | { ok: false }): T =>
    (read as { ok: true; value: T }).value;

  return {
    sessionId: value(reads.sessionId),
    paymentIntentId: value(reads.paymentIntentId),
    paymentStatus: value(reads.paymentStatus),
    amountTotal: value(reads.amountTotal),
    currency: value(reads.currency),
    metadataAppointmentId: value(reads.metadataAppointmentId),
    metadataSalonId: value(reads.metadataSalonId),
    metadataDepositId: value(reads.metadataDepositId),
    clientReferenceId: value(reads.clientReferenceId),
    projectionStatus: 'ok',
    // A successfully extracted payload needs no raw copy: the extract carries
    // everything any consumer reads, and it carries no PII.
    rawPayload: null,
    payloadPurgeAfter: null,
  };
}

/** Convenience for the webhook route: extract straight from a Stripe event. */
export function projectStripeEvent(event: Stripe.Event, receivedAt: Date): WebhookEventProjection | null {
  return extractCheckoutSessionProjection({
    type: event.type,
    payload: (event.data as { object?: unknown } | undefined)?.object ?? null,
    receivedAt,
  });
}

// =============================================================================
// PROVENANCE — ADMISSION ONLY, NEVER AUTHORIZATION
// =============================================================================

export type ProvenanceVerdict =
  /** No Luster assertion at all, or every assertion names a salon this account is not bound to. */
  | { admitted: false }
  /**
   * At least one assertion resolves to a salon bound (live OR revoked) to this
   * account — or the account has no binding rows at all, which is case (c) and
   * carries a NULL salon because there is genuinely nothing to name yet.
   */
  | { admitted: true; salonId: string | null };

/**
 * Resolves the salon a session's `client_reference_id` asserts, TENANT-SCOPED.
 *
 * The binding rows for the event's account are read FIRST, and the appointment
 * lookup then carries `salon_id IN (those ids)`. An unscoped
 * `WHERE id = <payload string>` would be a global read primitive driven by a
 * value anyone can set — `client_reference_id` is a documented Payment-Link URL
 * parameter, and Luster appointment ids are returned by the PUBLIC booking API.
 *
 * ITS RESULT MUST NEVER REACH A REFUND DECISION (S15). Provenance decides
 * whether an event is worth processing; only a resolved `appointment_deposit`
 * row authorizes money to move.
 */
export async function resolveProvenanceSalonForAdmission(input: {
  bindingSalonIds: string[];
  clientReferenceId: string | null;
}): Promise<string | null> {
  if (!input.clientReferenceId || input.bindingSalonIds.length === 0) {
    return null;
  }
  const [row] = await db
    .select({ salonId: appointmentSchema.salonId })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.id, input.clientReferenceId),
      inArray(appointmentSchema.salonId, input.bindingSalonIds),
    ))
    .limit(1);
  return row?.salonId ?? null;
}

/** Every binding row for an account — LIVE AND REVOKED. */
export async function getBindingSalonIds(account: string): Promise<string[]> {
  const rows = await db
    .select({ salonId: salonStripeAccountSchema.salonId })
    .from(salonStripeAccountSchema)
    .where(eq(salonStripeAccountSchema.stripeAccountId, account));
  return [...new Set(rows.map(row => row.salonId))];
}

/**
 * The three-way dispatch gate.
 *
 * Evaluated PER LEG: admission succeeds if ANY present assertion matches a
 * binding-row salon, and the foreign terminal is reached only when ALL present
 * assertions fail. Metadata-first evaluation would let a tampered
 * `metadata.salon_id` suppress a correct `client_reference_id`, which is a
 * tenant-triggerable way to withhold a confirm.
 *
 * Resolution is ROW-MATCHED, not account-matched: an assertion naming a salon
 * whose binding to this account is REVOKED still admits. A salon's one-click
 * disconnect must not strand its clients' already-captured deposits.
 */
export async function evaluateProvenance(input: {
  account: string;
  metadataSalonId: string | null;
  clientReferenceId: string | null;
}): Promise<ProvenanceVerdict> {
  const bindingSalonIds = await getBindingSalonIds(input.account);

  if (input.metadataSalonId && bindingSalonIds.includes(input.metadataSalonId)) {
    return { admitted: true, salonId: input.metadataSalonId };
  }

  const referenceSalonId = await resolveProvenanceSalonForAdmission({
    bindingSalonIds,
    clientReferenceId: input.clientReferenceId,
  });
  if (referenceSalonId) {
    return { admitted: true, salonId: referenceSalonId };
  }

  // Case (c) of the gate: Luster provenance is present but this account has NO
  // binding rows at all. Never terminal-ignore that — it is the window between
  // `accounts.create` returning and the binding INSERT landing, and it is also
  // what a fully deauthorized salon's in-flight deposits look like.
  if (bindingSalonIds.length === 0 && (input.metadataSalonId || input.clientReferenceId)) {
    return { admitted: true, salonId: input.metadataSalonId ?? null };
  }

  return { admitted: false };
}

/**
 * Resolve an orphan's metadata-nominated deposit for operator context only.
 *
 * The candidate is never adopted as the session-addressed deposit and never
 * reaches confirmation or refund code. Both tenant legs are required before
 * even its id may appear in a money-dark alert; otherwise an attacker-controlled
 * metadata id could make another salon's deposit look related to this event.
 */
export async function resolveVerifiedOrphanCandidate(input: {
  metadataDepositId: string | null;
  provenanceSalonId: string | null;
  account: string;
}): Promise<{ depositId: string } | null> {
  if (!input.metadataDepositId || !input.provenanceSalonId) {
    return null;
  }

  const [candidate] = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
      account: appointmentDepositSchema.stripeAccountId,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.id, input.metadataDepositId),
      eq(appointmentDepositSchema.salonId, input.provenanceSalonId),
      eq(appointmentDepositSchema.stripeAccountId, input.account),
    ))
    .limit(1);

  if (
    !candidate
    || candidate.salonId !== input.provenanceSalonId
    || candidate.account !== input.account
  ) {
    return null;
  }
  return { depositId: candidate.id };
}

// =============================================================================
// PER-ACCOUNT ADMISSION CAP
// =============================================================================

/**
 * `K = min(10 + <genuinely-unsettled deposits on this account>, 50)`.
 *
 * BOTH BOUNDS ARE LOAD-BEARING. "Genuinely unsettled" is `checkout_created`
 * plus `paid` inside a seven-day window — an unwindowed "paid with no refund"
 * term counts a salon's entire successful history, terminal rows are retained
 * forever, so K grew monotonically and the cap decayed toward vacuous on
 * exactly the busiest salons. The absolute 50 then makes the bound survive a
 * future edit to that definition.
 *
 * `0065` ships no `paid_at` column, so the seven-day window is measured on
 * `updated_at`, which for a `paid` deposit is the confirm CAS that set it. That
 * is a PROXY and is named as one: it moves again if a later writer touches the
 * row, which can only ever make the window more generous, never less — the
 * safe direction for a bound whose job is to stop growing.
 */
export async function resolveAdmissionCap(account: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.stripeAccountId, account),
      sql`(${appointmentDepositSchema.status} = 'checkout_created'
        OR (${appointmentDepositSchema.status} = 'paid'
            AND ${appointmentDepositSchema.updatedAt} > ${new Date(Date.now() - UNSETTLED_PAID_WINDOW_MS)}))`,
    ));

  return Math.min(ADMISSION_CAP_BASE + (row?.total ?? 0), ADMISSION_CAP_ABSOLUTE);
}

/** Live rows on this account that have not resolved a deposit yet. */
export async function countLiveNoDepositRows(account: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(stripeWebhookEventSchema)
    .where(and(
      eq(stripeWebhookEventSchema.account, account),
      inArray(stripeWebhookEventSchema.status, [...LIVE_EVENT_STATUSES]),
      eq(stripeWebhookEventSchema.outcome, 'deferred_no_deposit'),
    ));
  return row?.total ?? 0;
}

/**
 * True when this account has too many live deposit-less rows to admit another.
 *
 * Applied BEFORE an admitted-but-deposit-less row is finalized `failed_retryable`
 * for the FIRST time. Without it one account's flood of unresolvable sessions
 * fills every sweep batch and starves every other tenant's convergence.
 */
export async function isOverAdmissionCap(account: string): Promise<boolean> {
  const [live, cap] = await Promise.all([
    countLiveNoDepositRows(account),
    resolveAdmissionCap(account),
  ]);
  return live >= cap;
}

// =============================================================================
// SYNTHETIC `luster.*` WORK ROWS
// =============================================================================

export type LusterWorkRowType
  = 'luster.poll_evidence'
  | 'luster.refund_intent'
  | 'luster.owner_refund_intent'
  | 'luster.stuck_alert';

export type LusterWorkRowClaim =
  | { claimed: true; id: string; attempts: number }
  | { claimed: false; id: string | null };

/**
 * Inserts a synthetic work row, born CLAIMED, with the same
 * `ON CONFLICT (event_id) DO NOTHING` discipline as a real delivery.
 *
 * These rows are how a NON-WEBHOOK discovery becomes durable. A poll or a
 * deposit-side sweep pass that finds paid money it cannot yet act on has no
 * Stripe event to lease, so it writes its own — and because the lease is a row
 * in the same table, the same reclaim, the same fencing and the same escalation
 * schedule apply to it.
 *
 * `sessionId` and `metadataDepositId` are ALWAYS populated, even when the
 * retrieval returned nothing: the sweep's exclusion join matches on exactly
 * those two columns, so a row missing them would fail to suppress the very
 * rescan it exists to suppress.
 */
export async function claimLusterWorkRow(input: {
  eventId: string;
  type: LusterWorkRowType;
  account: string | null;
  livemode: boolean;
  salonId: string | null;
  sessionId: string | null;
  depositId: string;
  projection?: Partial<WebhookEventProjection>;
  bornTerminal?: { status: string; outcome: string };
}): Promise<LusterWorkRowClaim> {
  const born = input.bornTerminal;
  const rows = await db
    .insert(stripeWebhookEventSchema)
    .values({
      id: `swe_${crypto.randomUUID()}`,
      eventId: input.eventId,
      type: input.type,
      account: input.account,
      livemode: input.livemode,
      salonId: input.salonId,
      status: born ? born.status : 'processing',
      outcome: born ? born.outcome : null,
      attempts: born ? 0 : 1,
      processedAt: born ? new Date() : null,
      receivedAt: sql`now()`,
      sessionId: input.sessionId,
      metadataDepositId: input.depositId,
      paymentIntentId: input.projection?.paymentIntentId ?? null,
      paymentStatus: input.projection?.paymentStatus ?? null,
      amountTotal: input.projection?.amountTotal ?? null,
      currency: input.projection?.currency ?? null,
      metadataAppointmentId: input.projection?.metadataAppointmentId ?? null,
      metadataSalonId: input.projection?.metadataSalonId ?? null,
      clientReferenceId: input.projection?.clientReferenceId ?? null,
      projectionStatus: 'ok',
    })
    .onConflictDoNothing({ target: stripeWebhookEventSchema.eventId })
    .returning();

  const row = rows[0];
  if (!row) {
    const [existing] = await db
      .select({ id: stripeWebhookEventSchema.id })
      .from(stripeWebhookEventSchema)
      .where(eq(stripeWebhookEventSchema.eventId, input.eventId))
      .limit(1);
    return { claimed: false, id: existing?.id ?? null };
  }
  return { claimed: true, id: row.id, attempts: row.attempts };
}

/**
 * Claim the stable per-deposit poll lease, re-arming it when a prior buggy or
 * interrupted run left the same one-shot identity safely claimable.
 *
 * A plain `ON CONFLICT DO NOTHING` permanently consumes
 * `luster:poll_evidence:<deposit>` once a run finalizes it `processed`. The
 * discovery scan then sees no excluding row, tries to park again every five
 * minutes, loses the conflict forever, and repeatedly calls the provider. This
 * CAS admits only the same states as ordinary duplicate/reclaim handling plus a
 * `processed` poll lease. Manual money terminals and poison remain absorbing.
 */
export async function claimOrRearmPollEvidenceWorkRow(input: {
  eventId: string;
  account: string;
  livemode: boolean;
  salonId: string;
  sessionId: string;
  depositId: string;
  projection?: Partial<WebhookEventProjection>;
}): Promise<LusterWorkRowClaim> {
  const inserted = await claimLusterWorkRow({
    ...input,
    type: 'luster.poll_evidence',
  });
  if (inserted.claimed || !inserted.id) {
    return inserted;
  }

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - CLAIM_STALE_AFTER_MS);
  const projection = input.projection;
  const rows = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'processing',
      outcome: null,
      attempts: sql`${stripeWebhookEventSchema.attempts} + 1`,
      availableAt: null,
      lastError: null,
      processedAt: null,
      account: input.account,
      livemode: input.livemode,
      salonId: input.salonId,
      sessionId: input.sessionId,
      metadataDepositId: input.depositId,
      paymentIntentId: projection?.paymentIntentId ?? null,
      paymentStatus: projection?.paymentStatus ?? null,
      amountTotal: projection?.amountTotal ?? null,
      currency: projection?.currency ?? null,
      metadataAppointmentId: projection?.metadataAppointmentId ?? null,
      metadataSalonId: projection?.metadataSalonId ?? null,
      clientReferenceId: projection?.clientReferenceId ?? null,
      projectionStatus: 'ok',
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, inserted.id),
      eq(stripeWebhookEventSchema.eventId, input.eventId),
      eq(stripeWebhookEventSchema.type, 'luster.poll_evidence'),
      eq(stripeWebhookEventSchema.salonId, input.salonId),
      eq(stripeWebhookEventSchema.account, input.account),
      or(
        and(
          eq(stripeWebhookEventSchema.status, 'processed'),
          // The reviewed build finalized a poll lease as ignored_unpaid; the
          // same run's retention pass then stripped its deposit projection.
          // Recover that exact stable internal identity without weakening the
          // account/salon/type fences used for every other conflict.
          or(
            eq(stripeWebhookEventSchema.metadataDepositId, input.depositId),
            isNull(stripeWebhookEventSchema.metadataDepositId),
          ),
        ),
        and(
          eq(stripeWebhookEventSchema.status, 'failed_retryable'),
          eq(stripeWebhookEventSchema.metadataDepositId, input.depositId),
          lte(stripeWebhookEventSchema.availableAt, now),
        ),
        and(
          eq(stripeWebhookEventSchema.status, 'processing'),
          eq(stripeWebhookEventSchema.metadataDepositId, input.depositId),
          lt(stripeWebhookEventSchema.updatedAt, staleCutoff),
        ),
      ),
    ))
    .returning();

  const row = rows[0];
  return row
    ? { claimed: true, id: row.id, attempts: row.attempts }
    : { claimed: false, id: inserted.id };
}

/** Stable identity for the once-per-deposit stuck alert. */
export function stuckAlertEventId(depositId: string): string {
  return `luster:stuck_alert:${depositId}`;
}

/** Stable identity for the shared poll / sweep evidence lease on one deposit. */
export function pollEvidenceEventId(depositId: string): string {
  return `luster:poll_evidence:${depositId}`;
}

/**
 * The retention predicate, applied by the sweep.
 *
 * Rows that did NOT resolve a deposit keep only their identity columns; rows
 * that DID keep their projection, because that is the money record an operator
 * works the manual terminal from. The raw payload goes on both paths past the
 * purge horizon, in EVERY state including `poisoned` — a payload we could never
 * parse is not a reason to keep customer data forever.
 */
export function shouldStripProjection(outcome: string | null): boolean {
  if (!outcome) {
    return false;
  }
  return outcome.startsWith('ignored_') || outcome === 'session_expired';
}

/** Rows the discovery scans must skip, by event status. */
export async function depositIdsWithExcludingEventRows(
  candidates: Array<{ depositId: string; sessionId: string | null }>,
): Promise<Set<string>> {
  if (candidates.length === 0) {
    return new Set();
  }

  const depositIds = candidates.map(candidate => candidate.depositId);
  const sessionIds = candidates
    .map(candidate => candidate.sessionId)
    .filter((sessionId): sessionId is string => Boolean(sessionId));

  const rows = await db
    .select({
      sessionId: stripeWebhookEventSchema.sessionId,
      depositId: stripeWebhookEventSchema.metadataDepositId,
    })
    .from(stripeWebhookEventSchema)
    .where(and(
      or(
        inArray(stripeWebhookEventSchema.metadataDepositId, depositIds),
        sessionIds.length > 0
          ? inArray(stripeWebhookEventSchema.sessionId, sessionIds)
          : sql`false`,
      ),
      inArray(stripeWebhookEventSchema.status, [
        ...LIVE_EVENT_STATUSES,
        ...MANUAL_TERMINAL_STATUSES,
      ]),
    ));

  // Matched on the CANDIDATE's own session id, never positionally: an event row
  // referencing one deposit must not suppress the scan for a different one.
  const bySession = new Map(
    candidates
      .filter(candidate => candidate.sessionId)
      .map(candidate => [candidate.sessionId!, candidate.depositId]),
  );

  const excluded = new Set<string>();
  for (const row of rows) {
    if (row.depositId) {
      excluded.add(row.depositId);
    }
    const matched = row.sessionId ? bySession.get(row.sessionId) : undefined;
    if (matched) {
      excluded.add(matched);
    }
  }
  return excluded;
}

/** Rows older than the orphan horizon may reach the manual orphan terminal. */
export function isPastOrphanHorizon(receivedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - receivedAt.getTime() > ORPHAN_HORIZON_MS;
}

/** Deposits still `checkout_created` more than two hours past expiry are stuck. */
export function isStuckPastExpiry(holdExpiresAt: Date | null, now: Date = new Date()): boolean {
  return Boolean(holdExpiresAt && now.getTime() - holdExpiresAt.getTime() > 2 * 60 * 60_000);
}
