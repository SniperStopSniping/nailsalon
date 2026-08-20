import 'server-only';

import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { expireApprovalRequest } from '@/libs/expireApprovalRequest';
import { appointmentSchema } from '@/models/Schema';

/**
 * Luster L1 PR5 — bounded sweep for lapsed request-approval bookings.
 *
 * Mirrors `depositHoldReaper.ts`'s shape (bounded batch, ordered by the
 * deadline column, per-row try/catch, one salon's failure never stops the
 * batch for every other salon) but is materially simpler: unlike the
 * deposit reaper, nothing here calls an external provider, so there is no
 * multi-round-trip-per-row budget to derive a batch size from. Each row is
 * exactly one DB transaction (`expireApprovalRequest`'s row lock + CAS +
 * audit row + intent enqueue) — cheap and bounded on its own.
 *
 * Invoked from the EXISTING `/api/reminders/process` cron
 * (`vercel.json` stays zero-diff — see the route for why a new cron entry
 * is not needed and would not be allowed).
 *
 * `APPROVAL_REQUEST_SWEEP_BATCH` is deliberately generous relative to
 * `DEPOSIT_REAP_BATCH` (16): with no provider round trips in the loop, the
 * limiting factor is simply "don't scan an unbounded table in one pass."
 * Anything left over after one run is picked up by the next 15-minute
 * cron tick — this sweep is a LATENCY optimization on top of
 * `appointmentBlocking.ts`'s already-correct real-time predicate (a lapsed
 * request stops blocking the slot immediately regardless of whether this
 * sweep has run yet), never a correctness dependency.
 */
export const APPROVAL_REQUEST_SWEEP_BATCH = 200;

export type ApprovalRequestSweepSummary = {
  scanned: number;
  expired: number;
  alreadyExpired: number;
  skipped: number;
};

export async function sweepExpiredApprovalRequests(options?: {
  now?: Date;
}): Promise<ApprovalRequestSweepSummary> {
  const now = options?.now ?? new Date();
  const candidates = await loadExpiredApprovalRequestCandidates(now);

  const summary: ApprovalRequestSweepSummary = {
    scanned: candidates.length,
    expired: 0,
    alreadyExpired: 0,
    skipped: 0,
  };

  for (const candidate of candidates) {
    // Per-row try/catch, mirroring depositHoldReaper.ts: one bad row (a
    // transient lock timeout, an unexpected constraint violation) must not
    // stop the sweep for every other salon's lapsed request.
    try {
      const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
        appointmentId: candidate.id,
        transactionNow: now,
      }));
      if (outcome.outcome === 'transitioned') {
        summary.expired += 1;
      } else if (outcome.outcome === 'already_expired') {
        summary.alreadyExpired += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.skipped += 1;
      console.error('[approval-requests] sweep failed for a request; leaving it standing', {
        appointmentId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

async function loadExpiredApprovalRequestCandidates(now: Date): Promise<Array<{ id: string }>> {
  return db
    .select({ id: appointmentSchema.id })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.status, 'pending'),
      isNotNull(appointmentSchema.requestExpiresAt),
      lte(appointmentSchema.requestExpiresAt, now),
    ))
    .orderBy(asc(appointmentSchema.requestExpiresAt))
    .limit(APPROVAL_REQUEST_SWEEP_BATCH);
}
