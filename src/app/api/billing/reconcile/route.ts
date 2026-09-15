/**
 * Billing reconciliation — Gate C2/P4 (contract §8.6).
 *
 * A READ-mostly drift detector: local `billing_subscription` rows are
 * compared against the authoritative remote subscription (+ its latest
 * invoice), drift is REPORTED, and the only permitted repair is
 * re-projection through the same idempotent transitions every webhook uses
 * — `projectSubscriptionSnapshot` / `applyInvoicePaymentSucceeded` — never a
 * bespoke write. Two Stripe endpoints must not become two divergent billing
 * systems, and this job is the instrument that proves they haven't.
 *
 * Duplicate remote subscriptions for one customer are ALERTED, never
 * silently resolved (§8.5): choosing one would strand real money on the
 * other.
 *
 * Per-section gating (P4): the `billing_stripe_event` payload purge (G13)
 * runs FIRST and UNCONDITIONALLY, right after CRON_SECRET auth — payloads
 * accumulate from the moment the webhook secret is provisioned, long before
 * either dark switch is ever flipped. Subscription drift runs only when
 * BILLING_SUBSCRIPTIONS_ENABLED='true'; held top-up reconciliation (G06)
 * only when BILLING_TOPUPS_ENABLED='true'. When NEITHER is set the route
 * makes no Stripe call and touches the database only for the purge, and
 * responds `200 { skipped: 'BILLING_DISABLED', purged }`.
 *
 * REGISTERED in `vercel.json` (P4b, plan D3 ratified 2026-09-14, §20 runbook
 * step): Vercel invokes this on a `17 * * * *` schedule and authenticates
 * with `Authorization: Bearer <CRON_SECRET>` (accepted by
 * `isAuthorizedCronRequest`, `src/libs/billing/cronAuth.ts`). Registration
 * does not change the dark contract above: while both switches are unset,
 * every invocation still runs ONLY the unconditional G13 payload purge and
 * answers `200 { skipped: 'BILLING_DISABLED', purged }` — no Stripe call.
 * Registration's only inherent cost is the ~one pooled DB connection +
 * `SELECT 1` that `src/libs/DB.ts` performs on module load for any cold
 * start — a property of that module, not of this route.
 */
import * as Sentry from '@sentry/nextjs';
import { asc, gt, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import {
  applyInvoicePaymentSucceeded,
  projectSubscriptionSnapshot,
  type StripeSubscriptionSnapshot,
} from '@/libs/billing/billingSubscriptionProjection';
import { computeCreditWindow } from '@/libs/billing/creditWindows';
import { isAuthorizedCronRequest } from '@/libs/billing/cronAuth';
import { resolveBillingOfferFromStripePriceId } from '@/libs/billing/stripePriceMap';
import { reconcileHeldTopups, type TopupReconciliationSummary } from '@/libs/billing/topupReconciliation';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';
import { type BillingSubscription, billingSubscriptionSchema } from '@/models/Schema';

const SUBSCRIPTION_BATCH_SIZE = 100;
const PURGE_BATCH_SIZE = 500;

type DriftEntry = {
  stripeSubscriptionId: string;
  field: string;
  local: string;
  remote: string;
  repaired: boolean;
};

type SubscriptionDriftSummary = {
  checked: number;
  drift: DriftEntry[];
  duplicateRemoteCustomers: number;
};

/** A Stripe subscription retrieved with `expand: ['latest_invoice']`. */
type ReconcileRemoteSubscription = Stripe.Subscription & {
  latest_invoice?: Stripe.Invoice | string | null;
};

/**
 * Unconditional G13 purge: `payload_purge_after` was set at claim time
 * (`billingStripeEvents.ts`) but nothing purged it. Batched so one pass
 * never holds a giant row set; loops until drained.
 */
async function purgeExpiredStripeEventPayloads(now: Date): Promise<number> {
  let purged = 0;
  for (;;) {
    const result = await db.execute<{ id: string }>(sql`
      UPDATE billing_stripe_event
      SET raw_payload = NULL
      WHERE id IN (
        SELECT id FROM billing_stripe_event
        WHERE payload_purge_after < ${now} AND raw_payload IS NOT NULL
        LIMIT ${PURGE_BATCH_SIZE}
      )
      RETURNING id
    `);
    const count = result.rows.length;
    purged += count;
    if (count < PURGE_BATCH_SIZE) {
      break;
    }
  }
  return purged;
}

/** (b) paid_through vs the latest PAID invoice's LATEST line-item period end (§8.4/§6.4). Null when there is no paid invoice to compare against — never guessed from an open/failed one. */
function latestPaidInvoicePeriodEnd(remote: ReconcileRemoteSubscription): Date | null {
  const invoice = typeof remote.latest_invoice === 'object' && remote.latest_invoice !== null
    ? remote.latest_invoice
    : null;
  if (invoice === null || invoice.lines?.has_more) {
    return null;
  }
  const isPaid = invoice.status === 'paid' || invoice.paid === true;
  if (!isPaid) {
    return null;
  }
  const periodEnds = (invoice.lines?.data ?? [])
    .map(line => line.period?.end ?? 0)
    .filter(end => end > 0);
  if (periodEnds.length === 0) {
    return null;
  }
  return new Date(Math.max(...periodEnds) * 1000);
}

async function reconcileOneSubscription(
  row: BillingSubscription,
  now: Date,
  drift: DriftEntry[],
  duplicateAlerts: string[],
  customersSeen: Map<string, string>,
): Promise<void> {
  let remote: ReconcileRemoteSubscription;
  try {
    remote = await stripe.subscriptions.retrieve(row.stripeSubscriptionId, {
      expand: ['latest_invoice'],
    }) as ReconcileRemoteSubscription;
  } catch {
    drift.push({
      stripeSubscriptionId: row.stripeSubscriptionId,
      field: 'existence',
      local: row.status,
      remote: 'UNRETRIEVABLE',
      repaired: false,
    });
    return;
  }

  // Duplicate remote detection: one customer, two live local rows would be
  // impossible (partial unique); one customer with a second REMOTE live
  // subscription we never projected is the §8.5 alert case.
  const customerId = typeof remote.customer === 'string' ? remote.customer : remote.customer.id;
  const previousRemoteId = customersSeen.get(customerId);
  if (previousRemoteId !== undefined && previousRemoteId !== remote.id) {
    duplicateAlerts.push(customerId);
  }
  customersSeen.set(customerId, remote.id);

  // (a) status / cancelAtPeriodEnd.
  const basicFields: Array<[string, string, string]> = [
    ['status', row.status, remote.status],
    ['cancelAtPeriodEnd', String(row.cancelAtPeriodEnd), String(remote.cancel_at_period_end)],
  ];
  const conflictingBasic = basicFields.filter(([, local, remoteValue]) => local !== remoteValue);

  // (c) plan/offer keys vs the subscription item's ACTUAL price — never
  // metadata alone (metadata can itself be stale). Skipped silently when
  // the reverse map is unconfigured (every table null pre-activation) or
  // does not recognise this price id.
  const remotePriceId = remote.items?.data?.[0]?.price?.id ?? null;
  const resolvedOfferKey = remotePriceId !== null
    ? resolveBillingOfferFromStripePriceId(remotePriceId)
    : null;

  // (d) a parked downgrade (§6.4 pending_offer_key) whose price Stripe is
  // now ALREADY billing — the renewal boundary was reached remotely. This
  // is evaluated BEFORE (c): a price that matches the PENDING offer is
  // expected evidence of a parked transition, not a data-integrity mismatch
  // — it must never also be reported/repaired as one.
  const pendingApplied = resolvedOfferKey !== null
    && row.pendingOfferKey !== null
    && resolvedOfferKey === row.pendingOfferKey;
  const offerMismatch = resolvedOfferKey !== null
    && resolvedOfferKey !== row.billingOfferKey
    && !pendingApplied;

  if (conflictingBasic.length > 0 || offerMismatch) {
    // Repair = the SAME idempotent projection the webhook runs, from the
    // authoritative snapshot we just fetched. A genuine PRICE_OFFER_MISMATCH
    // anomaly (metadata and price disagree) aborts the WHOLE projection
    // before any write — reconcile reports it and moves on, it never loops.
    const snapshot: StripeSubscriptionSnapshot = {
      id: remote.id,
      customerId,
      status: remote.status,
      cancelAtPeriodEnd: remote.cancel_at_period_end,
      currentPeriodStart: new Date(remote.current_period_start * 1000),
      metadata: (remote.metadata ?? {}) as Record<string, string | undefined>,
      priceId: remotePriceId,
    };
    const outcome = await projectSubscriptionSnapshot({
      snapshot,
      // The CURRENT watermark, not now(): a reconcile pass must never
      // out-fence authentic Stripe events still mid-retry — equal-second
      // stays eligible, so the repair applies without advancing anything.
      eventCreated: row.lastEventCreated ?? new Date(0),
      eventId: `reconcile_${crypto.randomUUID()}`,
    });
    for (const [field, local, remoteValue] of conflictingBasic) {
      drift.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field,
        local,
        remote: remoteValue,
        repaired: outcome.applied,
      });
    }
    if (offerMismatch) {
      drift.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'offer_mismatch',
        local: row.billingOfferKey,
        remote: resolvedOfferKey!,
        repaired: outcome.applied,
      });
    }
  }

  const remotePaidThroughFromInvoice = latestPaidInvoicePeriodEnd(remote);
  const paidThroughBehind = remotePaidThroughFromInvoice !== null
    && remotePaidThroughFromInvoice.getTime() > row.paidThrough.getTime();
  const paidThroughAhead = remotePaidThroughFromInvoice !== null
    && remotePaidThroughFromInvoice.getTime() < row.paidThrough.getTime();

  if (paidThroughAhead) {
    // Report ONLY — never lowered by reconcile. remotePaidThroughFromInvoice
    // is non-null in this branch.
    drift.push({
      stripeSubscriptionId: row.stripeSubscriptionId,
      field: 'paid_through_ahead',
      local: row.paidThrough.toISOString(),
      remote: remotePaidThroughFromInvoice!.toISOString(),
      repaired: false,
    });
  }

  if (paidThroughBehind || pendingApplied) {
    // The SAME idempotent transition invoice.payment_succeeded uses:
    // monotonic max on paid_through (never lowers it), and — in the SAME
    // transaction — applies a parked pending_offer_key when one is set.
    // When only the pending-offer evidence fired (no fresh paid period),
    // paidPeriodEnd is the CURRENT value: a deliberate no-advance call that
    // still clears the parked offer, because what we just confirmed is
    // §6.4's renewal boundary evidence (the price Stripe is now actually
    // billing), not a fresh invoice amount.
    const invoice = typeof remote.latest_invoice === 'object' ? remote.latest_invoice : null;
    const starts = (invoice?.lines?.data ?? []).map(line => line.period?.start ?? 0).filter(start => start > 0);
    const outcome = await applyInvoicePaymentSucceeded({
      invoiceId: invoice?.id,
      paidPeriodStart: starts.length ? new Date(Math.min(...starts) * 1000) : undefined,
      stripeSubscriptionId: remote.id,
      paidPeriodEnd: remotePaidThroughFromInvoice ?? row.paidThrough,
      eventCreated: row.lastEventCreated ?? new Date(0),
      eventId: `reconcile_${crypto.randomUUID()}`,
      now,
    });
    if (paidThroughBehind) {
      drift.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'paid_through_behind',
        local: row.paidThrough.toISOString(),
        remote: remotePaidThroughFromInvoice!.toISOString(),
        repaired: outcome.applied,
      });
    }
    if (pendingApplied) {
      drift.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'pending_offer_applied_remotely',
        local: row.pendingOfferKey!,
        remote: resolvedOfferKey!,
        repaired: outcome.applied,
      });
    }
  }

  // (e) next_credit_grant_at consistency — report only; the window engine
  // (dispatch/reconcile cron) remains the ONLY granter (§6.4).
  const expectedNextGrantAt = computeCreditWindow(row.creditCycleAnchor, row.creditCycleIndex).end;
  if (row.nextCreditGrantAt === null || row.nextCreditGrantAt.getTime() !== expectedNextGrantAt.getTime()) {
    drift.push({
      stripeSubscriptionId: row.stripeSubscriptionId,
      field: 'next_grant_drift',
      local: row.nextCreditGrantAt === null ? 'null' : row.nextCreditGrantAt.toISOString(),
      remote: expectedNextGrantAt.toISOString(),
      repaired: false,
    });
  }
}

/**
 * Cursor pagination by `id` ascending, batches of 100, until drained — no
 * more silent `limit(100)` truncating the reconciled set.
 */
async function reconcileSubscriptionDrift(now: Date): Promise<SubscriptionDriftSummary> {
  const drift: DriftEntry[] = [];
  const duplicateAlerts: string[] = [];
  const customersSeen = new Map<string, string>();
  let checked = 0;
  let cursor: string | null = null;

  for (;;) {
    const rows: BillingSubscription[] = await db
      .select()
      .from(billingSubscriptionSchema)
      .where(cursor !== null ? gt(billingSubscriptionSchema.id, cursor) : undefined)
      .orderBy(asc(billingSubscriptionSchema.id))
      .limit(SUBSCRIPTION_BATCH_SIZE);
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      checked += 1;

      await reconcileOneSubscription(row, now, drift, duplicateAlerts, customersSeen);
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < SUBSCRIPTION_BATCH_SIZE) {
      break;
    }
  }

  if (duplicateAlerts.length > 0) {
    Sentry.captureMessage('billing.duplicate_remote_subscriptions', {
      level: 'error',
      extra: { customers: duplicateAlerts },
    });
  }

  return { checked, drift, duplicateRemoteCustomers: duplicateAlerts.length };
}

async function run(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  // G13: unconditional, before any switch gate.
  const purged = await purgeExpiredStripeEventPayloads(now);

  const subscriptionsEnabled = Env.BILLING_SUBSCRIPTIONS_ENABLED === 'true';
  const topupsEnabled = Env.BILLING_TOPUPS_ENABLED === 'true';

  if (!subscriptionsEnabled && !topupsEnabled) {
    // Dark contract: no Stripe call, no other DB read beyond the purge.
    return Response.json({ skipped: 'BILLING_DISABLED', purged });
  }

  const summary = subscriptionsEnabled ? await reconcileSubscriptionDrift(now) : null;
  const topups: TopupReconciliationSummary | null = topupsEnabled
    ? await reconcileHeldTopups({ now })
    : null;

  return Response.json({
    purged,
    ...(summary !== null ? { summary } : {}),
    ...(topups !== null ? { topups } : {}),
  });
}

export const GET = run;
export const POST = run;
export const dynamic = 'force-dynamic';
