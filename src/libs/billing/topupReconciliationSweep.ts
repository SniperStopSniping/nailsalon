/**
 * Durable, bounded top-up sweep ordered by the existing immutable attempt ID
 * (checkout creation assigns it once; fulfillment only updates state/evidence).
 * SQL comparisons, max and ORDER BY use the ID column's existing DB collation,
 * so the primary-key range/order index remains usable. No JS key comparisons.
 * Committed rows/eligibility changes behind the cursor wait for the next sweep.
 * There is at most one sweep per invocation, so a persistent open/unbound row
 * cannot consume the budget again until every later eligible row has a turn.
 *
 * Capacity: limit <= 200 examinations per successful invocation; a finite sweep
 * of N stable eligible rows takes ceil(N / limit) successful full pages. IDs
 * above the finite captured high-water wait for the next sweep; new IDs inside
 * the remaining range may join this sweep. Backdated created_at is irrelevant.
 * Eventual service assumes recurring invocations, finite arrivals ahead of an item,
 * bounded provider/DB latency and some invocations live long enough to checkpoint.
 * Sustained arrival rate above processing capacity has no bounded latency.
 *
 * Ownership uses DB wall time (never caller `now`) and a fresh random token on
 * every claim, including same-process reclaim. Renew/checkpoint/release all fence
 * on token AND unexpired lease. No transaction or DB lock spans Stripe I/O.
 * A paused worker may overlap an already-started request after its 120s lease
 * expires; after returning it must recheck ownership before fulfillment. This
 * precheck cannot atomically fence financial work: a pause after it can still
 * start/finish a transition after expiry. Existing idempotent financial handlers
 * make that replay safe; the old worker cannot change a successor's cursor.
 * Missing migration/DB errors propagate before any provider request.
 */
import 'server-only';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db } from '@/libs/DB';

export const MAX_TOPUP_EXAMINATION_LIMIT = 200;

export type TopupSweepLease = {
  token: string;
  cursorAttemptId: string | null;
  highWaterAttemptId: string | null;
};

export type TopupSweepCandidate = {
  id: string;
  salonId: string;
  stripeCheckoutSessionId: string | null;
  createdAt: Date;
};

export class TopupSweepLeaseLostError extends Error {
  constructor() {
    super('TOPUP_RECONCILIATION_LEASE_LOST');
    this.name = 'TopupSweepLeaseLostError';
  }
}

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

export function validateTopupExaminationLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TOPUP_EXAMINATION_LIMIT) {
    throw new RangeError(`Top-up examination limit must be an integer from 1 to ${MAX_TOPUP_EXAMINATION_LIMIT}`);
  }
}

const activeOwner = (lease: TopupSweepLease) => sql`
  scope = 'global' AND lease_token = ${lease.token}
  AND lease_expires_at > clock_timestamp()
  AND high_water_attempt_id IS NOT DISTINCT FROM ${lease.highWaterAttemptId}::text
`;

// EXISTS tests global same-salon pending rows, including beyond this sweep's
// high-water. It preserves the old >1 predicate without loading/counting them.
const eligible = (now: Date) => sql`
  a.purpose = 'sms_topup' AND a.status IN ('creating', 'checkout_created')
  AND (a.expires_at < ${now} OR EXISTS (
    SELECT 1 FROM billing_checkout_attempt peer
    WHERE peer.salon_id = a.salon_id AND peer.purpose = 'sms_topup'
      AND peer.status IN ('creating', 'checkout_created')
      AND peer.id <> a.id
  ))
`;

export async function acquireTopupSweepLease(): Promise<TopupSweepLease | null> {
  const token = randomUUID();
  const claimed = rows<{ cursorAttemptId: string | null; highWaterAttemptId: string | null }>(await db.execute(sql`
    INSERT INTO billing_topup_reconciliation_sweep
      (scope, cursor_attempt_id, high_water_attempt_id, lease_token, lease_expires_at)
    VALUES ('global', NULL,
      (SELECT id FROM billing_checkout_attempt ORDER BY id DESC LIMIT 1),
      ${token}, clock_timestamp() + interval '120 seconds')
    ON CONFLICT (scope) DO UPDATE SET
      lease_token = EXCLUDED.lease_token,
      lease_expires_at = clock_timestamp() + interval '120 seconds',
      high_water_attempt_id = COALESCE(billing_topup_reconciliation_sweep.high_water_attempt_id, EXCLUDED.high_water_attempt_id)
    WHERE billing_topup_reconciliation_sweep.lease_token IS NULL
      OR billing_topup_reconciliation_sweep.lease_expires_at <= clock_timestamp()
    RETURNING cursor_attempt_id AS "cursorAttemptId", high_water_attempt_id AS "highWaterAttemptId"
  `))[0];
  return claimed ? { token, ...claimed } : null;
}

export async function renewTopupSweepLease(lease: TopupSweepLease): Promise<void> {
  const renewed = rows(await db.execute(sql`
    UPDATE billing_topup_reconciliation_sweep
    SET lease_expires_at = clock_timestamp() + interval '120 seconds'
    WHERE ${activeOwner(lease)} RETURNING scope
  `));
  if (renewed.length !== 1) {
    throw new TopupSweepLeaseLostError();
  }
}

export async function selectTopupSweepCandidates(lease: TopupSweepLease, now: Date, limit: number): Promise<TopupSweepCandidate[]> {
  validateTopupExaminationLimit(limit);
  const selected = rows<Omit<TopupSweepCandidate, 'createdAt'> & { createdAt: Date | string }>(await db.execute(sql`
    SELECT a.id, a.salon_id AS "salonId", a.stripe_checkout_session_id AS "stripeCheckoutSessionId",
      a.created_at AS "createdAt"
    FROM billing_checkout_attempt a
    WHERE ${eligible(now)}
      AND (${lease.cursorAttemptId}::text IS NULL OR a.id > ${lease.cursorAttemptId}::text)
      AND a.id <= ${lease.highWaterAttemptId}::text
      AND EXISTS (SELECT 1 FROM billing_topup_reconciliation_sweep WHERE ${activeOwner(lease)})
    ORDER BY a.id LIMIT ${limit}
  `));
  return selected.map(row => ({ ...row, createdAt: new Date(row.createdAt) }));
}

/** Called only after the current candidate's examination has completed. */
export async function checkpointTopupSweep(lease: TopupSweepLease, attemptId: string): Promise<void> {
  const updated = rows(await db.execute(sql`
    UPDATE billing_topup_reconciliation_sweep
    SET cursor_attempt_id = ${attemptId}::text, lease_expires_at = clock_timestamp() + interval '120 seconds'
    WHERE ${activeOwner(lease)}
      AND cursor_attempt_id IS NOT DISTINCT FROM ${lease.cursorAttemptId}::text
      AND (cursor_attempt_id IS NULL OR ${attemptId}::text > cursor_attempt_id)
      AND ${attemptId}::text <= high_water_attempt_id
    RETURNING scope
  `));
  if (updated.length !== 1) {
    throw new TopupSweepLeaseLostError();
  }
  lease.cursorAttemptId = attemptId;
}

/** Clear only an exhausted sweep; never wrap and re-examine in this invocation. */
export async function finishTopupSweep(lease: TopupSweepLease, now: Date): Promise<void> {
  const finished = rows(await db.execute(sql`
    WITH sweep_end AS (
      SELECT NOT EXISTS (
        SELECT 1 FROM billing_checkout_attempt a
        WHERE ${eligible(now)}
          AND (${lease.cursorAttemptId}::text IS NULL OR a.id > ${lease.cursorAttemptId}::text)
          AND a.id <= ${lease.highWaterAttemptId}::text
        LIMIT 1
      ) AS complete
    )
    UPDATE billing_topup_reconciliation_sweep
    SET cursor_attempt_id = CASE WHEN sweep_end.complete THEN NULL ELSE cursor_attempt_id END,
      high_water_attempt_id = CASE WHEN sweep_end.complete THEN NULL ELSE high_water_attempt_id END,
      lease_expires_at = clock_timestamp() + interval '120 seconds'
    FROM sweep_end
    WHERE ${activeOwner(lease)}
      AND cursor_attempt_id IS NOT DISTINCT FROM ${lease.cursorAttemptId}::text
    RETURNING scope
  `));
  if (finished.length !== 1) {
    throw new TopupSweepLeaseLostError();
  }
}

export async function releaseTopupSweepLease(lease: TopupSweepLease): Promise<void> {
  // high-water may have been cleared by finish; ownership still requires the
  // fresh token and live expiry. An old owner can never release a new claim.
  await db.execute(sql`
    UPDATE billing_topup_reconciliation_sweep SET lease_token = NULL, lease_expires_at = NULL
    WHERE scope = 'global' AND lease_token = ${lease.token} AND lease_expires_at > clock_timestamp()
  `);
}
