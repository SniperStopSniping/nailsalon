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
import { and, eq, inArray } from 'drizzle-orm';

import {
  applyTopupSessionCompleted,
  applyTopupSessionExpired,
  extractTopupVerifiedEvidenceFromSession,
  isTopupEvidenceMismatchReason,
  retrieveTopupCheckoutSession,
} from '@/libs/billing/topupFulfillment';
import { db } from '@/libs/DB';
import { billingCheckoutAttemptSchema } from '@/models/Schema';

const DEFAULT_EXAMINATION_LIMIT = 200;

export type TopupReconciliationAnomaly = {
  attemptId: string;
  sessionId: string | null;
  reason: string;
};

export type TopupReconciliationSummary = {
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

  const heldRows = await db
    .select({
      id: billingCheckoutAttemptSchema.id,
      salonId: billingCheckoutAttemptSchema.salonId,
      stripeCheckoutSessionId: billingCheckoutAttemptSchema.stripeCheckoutSessionId,
      expiresAt: billingCheckoutAttemptSchema.expiresAt,
      createdAt: billingCheckoutAttemptSchema.createdAt,
    })
    .from(billingCheckoutAttemptSchema)
    .where(and(
      eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
      inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
    ))
    .orderBy(billingCheckoutAttemptSchema.id);

  const countBySalon = new Map<string, number>();
  for (const row of heldRows) {
    countBySalon.set(row.salonId, (countBySalon.get(row.salonId) ?? 0) + 1);
  }

  const candidates = heldRows
    .filter(row => (countBySalon.get(row.salonId) ?? 0) > 1 || row.expiresAt.getTime() < now.getTime())
    .slice(0, limit);

  const summary: TopupReconciliationSummary = {
    examined: 0,
    fulfilled: 0,
    expired: 0,
    left_open: 0,
    unbound: [],
    anomalies: [],
  };

  for (const candidate of candidates) {
    summary.examined += 1;

    if (candidate.stripeCheckoutSessionId === null) {
      // PR #195 invariant: age is never evidence of a Stripe-side outcome
      // for a row that never reached Stripe. List it for an operator.
      summary.unbound.push({
        attemptId: candidate.id,
        salonId: candidate.salonId,
        createdAt: candidate.createdAt,
      });
      continue;
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
      continue;
    }

    if (session.payment_status === 'paid') {
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
        // human, exactly like the webhook's own held_anomaly path. Nothing
        // was written.
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
      continue;
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
      continue;
    }

    if (session.status === 'open') {
      // Still a live checkout — never resolved by age alone.
      summary.left_open += 1;
      continue;
    }

    reportAnomaly(summary, {
      attemptId: candidate.id,
      sessionId: candidate.stripeCheckoutSessionId,
      reason: `UNEXPECTED_SESSION_STATE:${String(session.status)}:${String(session.payment_status)}`,
    });
  }

  return summary;
}
