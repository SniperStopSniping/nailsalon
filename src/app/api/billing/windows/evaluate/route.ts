/**
 * Credit-window scheduler — Gate C2/P4 (§6.4, §7.3 rule 7, §8.6 of the
 * contract).
 *
 * The B1 window engine is the ONLY monthly-allowance granter; Stripe events
 * merely maintain paid_through/status/plan. This route drives the engine
 * over every subscription with an unevaluated or due window, sweeps stale
 * promotion claims (the ONLY caller of `expireStaleClaims`, §7.3 rule 7),
 * and (P4/G09) sweeps lapsed credit lots per salon (`expireLapsedLots` —
 * bookkeeping only; correctness never depends on it).
 *
 * Dark contract: CRON_SECRET-gated exactly like /api/reminders/process, and
 * responds `200 { skipped: 'BILLING_DISABLED' }` while
 * BILLING_SUBSCRIPTIONS_ENABLED is unset — no DB read beyond the auth check.
 *
 * REGISTERED in `vercel.json` (P4b, plan D3 ratified 2026-09-14, §20 runbook
 * step): Vercel invokes this every 15 minutes and authenticates
 * with `Authorization: Bearer <CRON_SECRET>` (accepted by
 * `isAuthorizedCronRequest`, `src/libs/billing/cronAuth.ts`). Registration
 * does not change the dark contract above: while the switch is unset every
 * invocation is still a pure `200 skipped` with no DB read beyond the auth
 * check and no Stripe call. Registration's only inherent cost is the ~one
 * pooled DB connection + `SELECT 1` that `src/libs/DB.ts` performs on module
 * load for any cold start — a property of that module, not of this route.
 * Evaluating windows stays grant-correct whenever it runs regardless of
 * schedule drift (idempotent keys; missed evaluations skip, never backfill).
 */
import { and, asc, gt, inArray, isNull, lte, or } from 'drizzle-orm';

import { evaluateSubscriptionWindows, expireLapsedLots } from '@/libs/billing/creditGrants';
import { isAuthorizedCronRequest } from '@/libs/billing/cronAuth';
import { expireStaleClaims } from '@/libs/billing/promotionClaims';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { billingSubscriptionSchema } from '@/models/Schema';

const SUBSCRIPTION_BATCH_SIZE = 200;

async function run(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (Env.BILLING_SUBSCRIPTIONS_ENABLED !== 'true') {
    return Response.json({ skipped: 'BILLING_DISABLED' });
  }
  const now = new Date();
  // A crash between claim reservation and session creation leaves a
  // reserved claim with no session to expire it — sweeping here frees the
  // once-per-business slot after its TTL (review LOW finding).
  const staleClaims = await db.transaction(async tx => expireStaleClaims(tx, now));

  const summary = {
    evaluated: 0,
    granted: 0,
    skippedUnpaid: 0,
    skippedMissed: 0,
    anomalies: [] as string[],
    lapsedLotsExpired: 0,
  };

  // Cursor pagination by `id` ascending, batches of 200, until drained.
  let cursor: string | null = null;
  for (;;) {
    const due = await db
      .select({ id: billingSubscriptionSchema.id, salonId: billingSubscriptionSchema.salonId })
      .from(billingSubscriptionSchema)
      .where(and(
        inArray(billingSubscriptionSchema.status, ['active', 'past_due', 'canceled']),
        or(
          isNull(billingSubscriptionSchema.nextCreditGrantAt),
          lte(billingSubscriptionSchema.nextCreditGrantAt, now),
        ),
        cursor !== null ? gt(billingSubscriptionSchema.id, cursor) : undefined,
      ))
      .orderBy(asc(billingSubscriptionSchema.id))
      .limit(SUBSCRIPTION_BATCH_SIZE);
    if (due.length === 0) {
      break;
    }

    for (const subscription of due) {
      const result = await evaluateSubscriptionWindows({ subscriptionId: subscription.id, now });
      summary.evaluated += 1;
      summary.granted += result.granted;
      summary.skippedUnpaid += result.skippedUnpaid;
      summary.skippedMissed += result.skippedMissed;
      summary.anomalies.push(...result.anomalies);

      // G09: expireLapsedLots is a per-salon bookkeeping sweep (never called
      // anywhere in the dark contract before P4) — exported but orphaned.
      const { expired } = await db.transaction(async tx => expireLapsedLots(tx, {
        salonId: subscription.salonId,
        now,
      }));
      summary.lapsedLotsExpired += expired;
    }

    cursor = due[due.length - 1]!.id;
    if (due.length < SUBSCRIPTION_BATCH_SIZE) {
      break;
    }
  }

  return Response.json({ summary, staleClaimsExpired: staleClaims.expired });
}

export const GET = run;
export const POST = run;
export const dynamic = 'force-dynamic';
