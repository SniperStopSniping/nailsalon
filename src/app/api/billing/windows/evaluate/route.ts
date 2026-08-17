/**
 * Credit-window scheduler — Gate C2 (§6.4, §8.8 of the completion
 * authorization).
 *
 * The B1 window engine is the ONLY monthly-allowance granter; Stripe events
 * merely maintain paid_through/status/plan. This route drives the engine
 * over every subscription with an unevaluated or due window.
 *
 * CRON_SECRET-gated exactly like /api/reminders/process. DELIBERATELY NOT
 * REGISTERED in vercel.json: the deposits-ladder guard freezes cron entries
 * additively (an append rewrites the closing brace of the previous entry),
 * and a dark gate has nothing to schedule — registration is a §20 runbook
 * step with its own authorization. Until then this route only runs when
 * called explicitly, and evaluating windows is grant-correct whenever it
 * runs (idempotent keys; missed evaluations skip, never backfill).
 */
import { and, inArray, isNull, lte, or } from 'drizzle-orm';

import { evaluateSubscriptionWindows } from '@/libs/billing/creditGrants';
import { expireStaleClaims } from '@/libs/billing/promotionClaims';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { billingSubscriptionSchema } from '@/models/Schema';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const header = request.headers.get('x-cron-secret');
  const bearer = request.headers.get('authorization');
  return header === secret || bearer === `Bearer ${secret}`;
}

async function run(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (Env.BILLING_SUBSCRIPTIONS_ENABLED !== 'true') {
    return Response.json(
      { error: { code: 'BILLING_DISABLED', message: 'Nothing to evaluate while billing is dark.' } },
      { status: 503 },
    );
  }
  const now = new Date();
  // A crash between claim reservation and session creation leaves a
  // reserved claim with no session to expire it — sweeping here frees the
  // once-per-business slot after its TTL (review LOW finding).
  const staleClaims = await db.transaction(async tx => expireStaleClaims(tx, now));
  const due = await db
    .select({ id: billingSubscriptionSchema.id })
    .from(billingSubscriptionSchema)
    .where(and(
      inArray(billingSubscriptionSchema.status, ['active', 'past_due', 'canceled']),
      or(
        isNull(billingSubscriptionSchema.nextCreditGrantAt),
        lte(billingSubscriptionSchema.nextCreditGrantAt, now),
      ),
    ))
    .limit(200);

  const summary = { evaluated: 0, granted: 0, skippedUnpaid: 0, skippedMissed: 0, anomalies: [] as string[] };
  for (const subscription of due) {
    const result = await evaluateSubscriptionWindows({ subscriptionId: subscription.id, now });
    summary.evaluated += 1;
    summary.granted += result.granted;
    summary.skippedUnpaid += result.skippedUnpaid;
    summary.skippedMissed += result.skippedMissed;
    summary.anomalies.push(...result.anomalies);
  }
  return Response.json({ summary, staleClaimsExpired: staleClaims.expired });
}

export const GET = run;
export const POST = run;
export const dynamic = 'force-dynamic';
