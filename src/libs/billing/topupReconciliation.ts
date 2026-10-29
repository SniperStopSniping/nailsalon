/**
 * Held top-up reconciliation — Gate C2 (contract §8.5, §7.8; plan G06).
 *
 * `/api/billing/checkout/topup` persists a durable `billing_checkout_attempt`
 * BEFORE calling Stripe, and fulfillment happens exclusively on verified
 * payment evidence delivered through the stripe-billing webhook (§7.8). Two
 * things can leave an attempt "held" forever without this job:
 *
 *   - the webhook delivery for a genuinely paid/expired session is lost
 *     (Stripe retries eventually, but a reconciliation pass is the backstop
 *     the plan requires), or
 *   - a client crashed between `beginCheckoutAttempt` and Stripe's response,
 *     leaving a `creating`/`checkout_created` row with no session id at all.
 *
 * "Held" is deliberately a QUERY, not a persisted status (`checkoutAttempts.ts`
 * never writes one): a row is a candidate when the salon has MORE THAN ONE
 * such row (PR #195's own multi-attempt anomaly) OR its TTL has lapsed
 * (`expires_at < now`). Every transition applied here is one of the SAME
 * idempotent functions the webhook calls — `applyTopupSessionCompleted` /
 * `applyTopupSessionExpired` — never a bespoke write, so replaying this job
 * (or racing the webhook) is exactly as safe as replaying the webhook itself.
 *
 * A row with NO session id is only LISTED as `unbound`: PR #195 was explicit
 * that age alone must never clear an attempt whose Stripe outcome is
 * unknown — only a bound session's own status (paid/expired/open) is
 * evidence.
 */

import 'server-only';

import * as Sentry from '@sentry/nextjs';

import {
  applyTopupSessionCompleted,
  applyTopupSessionExpired,
  extractTopupVerifiedEvidenceFromSession,
  isTopupEvidenceMismatchReason,
  retrieveTopupCheckoutSession,
} from '@/libs/billing/topupFulfillment';
import {
  acquireTopupSweepLease,
  checkpointTopupSweep,
  finishTopupSweep,
  MAX_TOPUP_EXAMINATION_LIMIT,
  releaseTopupSweepLease,
  renewTopupSweepLease,
  selectTopupSweepCandidates,
  type TopupSweepCandidate,
  type TopupSweepLease,
  TopupSweepLeaseLostError,
  validateTopupExaminationLimit,
} from '@/libs/billing/topupReconciliationSweep';

const DEFAULT_EXAMINATION_LIMIT = MAX_TOPUP_EXAMINATION_LIMIT;

export type TopupReconciliationAnomaly = {
  attemptId: string;
  sessionId: string | null;
  reason: string;
};

export type TopupReconciliationSummary = {
  /** Another invocation owns the sweep; this run did not examine candidates. */
  leaseBusy?: true;
  examined: number;
  fulfilled: number;
  expired: number;
  left_open: number;
  unbound: Array<{ attemptId: string; salonId: string; createdAt: Date }>;
  anomalies: TopupReconciliationAnomaly[];
};

function reportAnomaly(
  summary: TopupReconciliationSummary,
  entry: TopupReconciliationAnomaly,
): void {
  summary.anomalies.push(entry);
  Sentry.captureMessage('billing.topup_reconciliation_anomaly', {
    level: 'warning',
    extra: entry,
  });
}

/**
 * Resolve the candidate set (§ above), examine at most `limit` of them, and
 * apply only the existing idempotent transitions. Never touches an attempt
 * whose session is still `open`, and never invents a state change for a
 * candidate whose evidence is missing or inconsistent — those are reported,
 * not repaired.
 */
export async function reconcileHeldTopups(
  input: { now?: Date; limit?: number } = {},
): Promise<TopupReconciliationSummary> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? DEFAULT_EXAMINATION_LIMIT;

  validateTopupExaminationLimit(limit);
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('Top-up reconciliation now must be a valid date');
  }

  const summary: TopupReconciliationSummary = {
    examined: 0,
    fulfilled: 0,
    expired: 0,
    left_open: 0,
    unbound: [],
    anomalies: [],
  };

  const lease = await acquireTopupSweepLease();
  if (!lease) {
    return { ...summary, leaseBusy: true };
  }

  try {
    const candidates = await selectTopupSweepCandidates(lease, now, limit);
    for (const candidate of candidates) {
      await renewTopupSweepLease(lease);
      await examineCandidate(candidate, summary, now, lease);
      // Includes unbound, open and anomaly results. Never pre-advance a page:
      // a crash or failed checkpoint leaves this item available for safe replay.
      await checkpointTopupSweep(lease, candidate.id);
    }
    await finishTopupSweep(lease, now);
  } finally {
    await releaseTopupSweepLease(lease);
  }
  return summary;
}

async function examineCandidate(
  candidate: TopupSweepCandidate,
  summary: TopupReconciliationSummary,
  now: Date,
  lease: TopupSweepLease,
): Promise<void> {
  summary.examined += 1;

  if (candidate.stripeCheckoutSessionId === null) {
    // PR #195 invariant: age is never evidence of a Stripe-side outcome
    // for a row that never reached Stripe. List it for an operator.
    summary.unbound.push({
      attemptId: candidate.id,
      salonId: candidate.salonId,
      createdAt: candidate.createdAt,
    });
    return;
  }

  let session: Awaited<ReturnType<typeof retrieveTopupCheckoutSession>>;
  try {
    session = await retrieveTopupCheckoutSession(candidate.stripeCheckoutSessionId);
  } catch {
    reportAnomaly(summary, {
      attemptId: candidate.id,
      sessionId: candidate.stripeCheckoutSessionId,
      reason: 'SESSION_UNRETRIEVABLE',
    });
    return;
  }

  // Recheck after external I/O. A later process pause can still race expiry;
  // the financial handler's own idempotency remains the final safety boundary.
  await renewTopupSweepLease(lease);

  if (session.payment_status === 'paid') {
    try {
      const verifiedEvidence = extractTopupVerifiedEvidenceFromSession(session);
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
      const result = await applyTopupSessionCompleted({
        sessionId: candidate.stripeCheckoutSessionId,
        paymentStatus: 'paid',
        paymentIntentId,
        verifiedEvidence,
        now,
      });
      if (result.fulfilled) {
        summary.fulfilled += 1;
      } else if (isTopupEvidenceMismatchReason(result.reason)) {
        // Verified evidence disagreed with the locked purchase — held for a
        // human, exactly like the webhook's own held_anomaly path. No credits
        // are granted; payment-intent metadata may already have been backfilled.
        reportAnomaly(summary, {
          attemptId: candidate.id,
          sessionId: candidate.stripeCheckoutSessionId,
          reason: result.reason!,
        });
      } else {
        reportAnomaly(summary, {
          attemptId: candidate.id,
          sessionId: candidate.stripeCheckoutSessionId,
          reason: result.reason ?? 'TOPUP_FULFILLMENT_UNRESOLVED',
        });
      }
    } catch (error) {
      if (error instanceof TopupSweepLeaseLostError) {
        throw error;
      }
      // A completed failed examination must not pin every later row. Atomic,
      // idempotent fulfillment can be retried next sweep; report only a bounded
      // reason because arbitrary exception text can contain provider/DB secrets.
      reportAnomaly(summary, {
        attemptId: candidate.id,
        sessionId: candidate.stripeCheckoutSessionId,
        reason: 'TOPUP_EXAMINATION_FAILED',
      });
    }
    return;
  }

  if (session.status === 'expired') {
    try {
      const result = await applyTopupSessionExpired(candidate.stripeCheckoutSessionId);
      if (result.expired) {
        summary.expired += 1;
      }
    } catch {
      // The precreated purchase row genuinely does not exist yet (a
      // racing checkout TX2) — retryable next pass, not an operator page.
      reportAnomaly(summary, {
        attemptId: candidate.id,
        sessionId: candidate.stripeCheckoutSessionId,
        reason: 'TOPUP_PURCHASE_NOT_FOUND',
      });
    }
    return;
  }

  if (session.status === 'open') {
    // Still a live checkout — never resolved by age alone.
    summary.left_open += 1;
    return;
  }

  reportAnomaly(summary, {
    attemptId: candidate.id,
    sessionId: candidate.stripeCheckoutSessionId,
    reason: `UNEXPECTED_SESSION_STATE:${String(session.status)}:${String(session.payment_status)}`,
  });
}
