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

import type { ActorType } from '@/libs/auditLog';
import {
  applyInvoicePaymentSucceeded,
  applyPendingOfferAtRenewal,
  applySubscriptionFullRefund,
  applySubscriptionRefundVoid,
  projectSubscriptionSnapshot,
  type StripeSubscriptionSnapshot,
} from '@/libs/billing/billingSubscriptionProjection';
import { computeCreditWindow } from '@/libs/billing/creditWindows';
import { isAuthorizedCronRequest } from '@/libs/billing/cronAuth';
import { subscriptionLinePeriods } from '@/libs/billing/invoiceLinePeriods';
import { resolveBillingOfferFromStripePriceId } from '@/libs/billing/stripePriceMap';
import { readSubscriptionRefunds } from '@/libs/billing/subscriptionRefunds';
import { reconcileHeldTopups, type TopupReconciliationSummary } from '@/libs/billing/topupReconciliation';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';
import { type BillingSubscription, billingSubscriptionSchema } from '@/models/Schema';

const SUBSCRIPTION_BATCH_SIZE = 100;
const PURGE_BATCH_SIZE = 500;

/**
 * R-2 writer 3 acts as the system, not as a webhook delivery: its evidence
 * corrections are attributable to THIS job in `audit_log`, distinguishable
 * from both `stripe-billing` (webhook) and a super-admin's typed resolution.
 */
const RECONCILE_ACTOR = { actorType: 'system' as const, actorId: 'billing-reconcile' };

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
  /**
   * Informational observations that are NOT drift: a comparison this pass
   * deliberately declined to make (truncated invoice lines, a latest invoice
   * whose coverage is refunded) and the R-2 evidence corrections it made.
   * Never counted as drift, never alerted on by the drift budget.
   */
  notes: DriftEntry[];
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

/**
 * (b) the latest PAID invoice's coverage (§8.4/§6.4, R-6): its identity plus
 * the half-open span of its NON-PRORATION subscription lines.
 *
 * `null` when there is nothing comparable — no latest invoice, an
 * open/failed one, or one that bills no subscription line for this
 * subscription. `'uncomparable'` is the distinct truncated-lines case: the
 * remote coverage EXISTS but this pass cannot see all of it, so comparing
 * would report drift invented by pagination. That is reported as a note, not
 * silently swallowed.
 */
function latestPaidInvoiceCoverage(
  remote: ReconcileRemoteSubscription,
): { invoiceId: string | undefined; start: Date; end: Date } | null | 'uncomparable' {
  const invoice = typeof remote.latest_invoice === 'object' && remote.latest_invoice !== null
    ? remote.latest_invoice
    : null;
  if (invoice === null) {
    return null;
  }
  if (invoice.lines?.has_more) {
    return 'uncomparable';
  }
  const isPaid = invoice.status === 'paid' || invoice.paid === true;
  if (!isPaid) {
    return null;
  }
  const coverage = subscriptionLinePeriods(invoice.lines?.data, remote.id);
  if (coverage.kind !== 'ok') {
    return null;
  }
  return { invoiceId: invoice.id, start: coverage.start, end: coverage.end };
}

/**
 * R-2 writer 3 (safety net): the hourly pass re-checks the EFFECTIVE refund
 * evidence against Stripe, in BOTH directions.
 *
 *   - An invoice still marked refunded whose charge's cumulative
 *     `amount_refunded` has fallen below its `amount` is no longer fully
 *     refunded — Owner decision O2 voids the exclusion automatically and
 *     alerts, because a webhook that was never delivered (or was delivered
 *     while the endpoint was down) must not leave a paying salon's
 *     entitlement suppressed forever.
 *   - An invoice whose effective row is a MACHINE `void` but whose charge
 *     Stripe now reports as fully refunded is re-asserted. A void can be
 *     just as stale as an applied row: a handler that read the charge while
 *     it was partially refunded can commit its void AFTER a newer handler
 *     committed the applied row, and nothing else would ever correct it —
 *     the salon would keep granting credits on money that was returned.
 *
 * A `super_admin` void is a deliberate operator decision and is NEVER
 * re-asserted automatically; the operator owns it until they change it.
 *
 * Every failure is absorbed into a note: a Stripe hiccup on one invoice can
 * never abort the reconcile pass for the rest of the estate.
 */
async function reconcileRefundEvidence(
  row: BillingSubscription,
  now: Date,
  notes: DriftEntry[],
): Promise<void> {
  const evidence = await db.transaction(async tx => readSubscriptionRefunds(tx, row));
  await reconcileRetractedEvidence(row, now, notes, evidence.appliedInvoiceIds);
  await reconcileStaleVoids(row, now, notes, evidence.voidedInvoiceIds);
}

/** Direction 1: evidence says "refunded", Stripe says otherwise ⇒ void. */
async function reconcileRetractedEvidence(
  row: BillingSubscription,
  now: Date,
  notes: DriftEntry[],
  appliedInvoiceIds: Set<string>,
): Promise<void> {
  for (const invoiceId of appliedInvoiceIds) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['charge'] });
      const charge = typeof invoice.charge === 'object' && invoice.charge !== null ? invoice.charge : null;
      if (charge === null || charge.amount_refunded >= charge.amount) {
        continue;
      }
      const outcome = await applySubscriptionRefundVoid({
        stripeSubscriptionId: row.stripeSubscriptionId,
        invoiceId,
        reason: 'refund_reversed:reconcile',
        observedAmountRefunded: charge.amount_refunded,
        observedAmount: charge.amount,
        actor: RECONCILE_ACTOR,
        now,
      });
      if (!outcome.voided) {
        continue;
      }
      Sentry.captureMessage('billing.subscription_refund_voided', {
        level: 'warning',
        extra: {
          source: 'reconcile',
          stripeSubscriptionId: row.stripeSubscriptionId,
          invoiceId,
          observedAmountRefunded: charge.amount_refunded,
          observedAmount: charge.amount,
          reapplied: outcome.reapplied,
        },
      });
      notes.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'refund_evidence_voided',
        local: invoiceId,
        remote: `${charge.amount_refunded}/${charge.amount}`,
        repaired: outcome.reapplied,
      });
    } catch {
      notes.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'refund_evidence_unverifiable',
        local: invoiceId,
        remote: 'UNRETRIEVABLE',
        repaired: false,
      });
    }
  }
}

/**
 * Direction 2: a MACHINE void says "not refunded", Stripe says fully
 * refunded ⇒ re-assert the exclusion. This is the half that closes the
 * commit-order race — a void committed from a stale read would otherwise be
 * the last word forever, because the first loop only ever looks at invoices
 * that are still marked refunded.
 */
async function reconcileStaleVoids(
  row: BillingSubscription,
  now: Date,
  notes: DriftEntry[],
  voidedInvoiceIds: Map<string, ActorType>,
): Promise<void> {
  for (const [invoiceId, actorType] of voidedInvoiceIds) {
    // An operator's void stands: a human weighed this and the machine does
    // not get to overrule them on a schedule.
    if (actorType === 'super_admin') {
      continue;
    }
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['charge'] });
      const charge = typeof invoice.charge === 'object' && invoice.charge !== null ? invoice.charge : null;
      if (charge === null || charge.amount_refunded < charge.amount) {
        continue; // The void is correct — nothing to do.
      }
      if (invoice.lines?.has_more) {
        // Re-asserting needs the FULL coverage; a truncated page would
        // record a narrower exclusion than the refund actually covers.
        notes.push({
          stripeSubscriptionId: row.stripeSubscriptionId,
          field: 'refund_evidence_uncomparable',
          local: invoiceId,
          remote: 'LINES_TRUNCATED',
          repaired: false,
        });
        continue;
      }
      const coverage = subscriptionLinePeriods(invoice.lines?.data, row.stripeSubscriptionId);
      if (coverage.kind !== 'ok') {
        notes.push({
          stripeSubscriptionId: row.stripeSubscriptionId,
          field: 'refund_evidence_unverifiable',
          local: invoiceId,
          remote: 'NO_SUBSCRIPTION_LINES',
          repaired: false,
        });
        continue;
      }
      // The ordinary refund writer: a fresh applied row at a HIGHER seq
      // supersedes the void, and its own `lowered` rule pulls `paid_through`
      // back out of the refunded window.
      const result = await applySubscriptionFullRefund({
        stripeSubscriptionId: row.stripeSubscriptionId,
        invoiceId,
        refundIds: [],
        refundedPeriodStart: coverage.start,
        refundedPeriodEnd: coverage.end,
        eventCreated: row.lastEventCreated ?? new Date(0),
        eventId: `reconcile_${crypto.randomUUID()}`,
        observedAmountRefunded: charge.amount_refunded,
        observedAmount: charge.amount,
        actor: RECONCILE_ACTOR,
        now,
      });
      if (!result.applied) {
        continue;
      }
      Sentry.captureMessage('billing.subscription_refunded', {
        level: 'warning',
        extra: {
          source: 'reconcile',
          stripeSubscriptionId: row.stripeSubscriptionId,
          invoiceId,
          observedAmountRefunded: charge.amount_refunded,
          observedAmount: charge.amount,
          lowered: result.lowered,
        },
      });
      notes.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'refund_evidence_reasserted',
        local: invoiceId,
        remote: `${charge.amount_refunded}/${charge.amount}`,
        repaired: result.applied,
      });
    } catch {
      notes.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'refund_evidence_unverifiable',
        local: invoiceId,
        remote: 'UNRETRIEVABLE',
        repaired: false,
      });
    }
  }
}

async function reconcileOneSubscription(
  row: BillingSubscription,
  now: Date,
  drift: DriftEntry[],
  notes: DriftEntry[],
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

  if (pendingApplied) {
    // R-4 (Y7): §6.4's renewal boundary was reached remotely — the price
    // Stripe is now actually billing IS the evidence. Applying it no longer
    // borrows the payment transition (which dragged in the latest invoice's
    // status and periods, refund evidence, status changes and window
    // evaluation it had no business touching); this clears exactly the
    // parked offer, under the row lock, and nothing else.
    //
    // Deliberately BEFORE the paid-through repair: that repair runs
    // `applyInvoicePaymentSucceeded`, which clears a parked offer as part of
    // its own transition. Running it first left this call with nothing to do
    // and made a genuine repair report `repaired: false`.
    const outcome = await applyPendingOfferAtRenewal({ stripeSubscriptionId: remote.id, now });
    drift.push({
      stripeSubscriptionId: row.stripeSubscriptionId,
      field: 'pending_offer_applied_remotely',
      local: row.pendingOfferKey!,
      remote: resolvedOfferKey!,
      repaired: outcome.cleared,
    });
  }

  const coverage = latestPaidInvoiceCoverage(remote);
  if (coverage === 'uncomparable') {
    notes.push({
      stripeSubscriptionId: row.stripeSubscriptionId,
      field: 'paid_through_uncomparable',
      local: row.paidThrough.toISOString(),
      remote: 'LINES_TRUNCATED',
      repaired: false,
    });
  }
  const comparable = coverage !== null && coverage !== 'uncomparable' ? coverage : null;
  const paidThroughBehind = comparable !== null && comparable.end.getTime() > row.paidThrough.getTime();
  const paidThroughAhead = comparable !== null && comparable.end.getTime() < row.paidThrough.getTime();

  if (paidThroughAhead) {
    // Report ONLY — never lowered by reconcile.
    drift.push({
      stripeSubscriptionId: row.stripeSubscriptionId,
      field: 'paid_through_ahead',
      local: row.paidThrough.toISOString(),
      remote: comparable!.end.toISOString(),
      repaired: false,
    });
  }

  if (paidThroughBehind) {
    // The SAME idempotent transition invoice.payment_succeeded uses:
    // monotonic max on paid_through (never lowers it), with this invoice's
    // own identity and coverage so the §6.7 refund exclusions apply exactly
    // as they would for a live event.
    const outcome = await applyInvoicePaymentSucceeded({
      invoiceId: comparable!.invoiceId,
      paidPeriodStart: comparable!.start,
      stripeSubscriptionId: remote.id,
      paidPeriodEnd: comparable!.end,
      eventCreated: row.lastEventCreated ?? new Date(0),
      eventId: `reconcile_${crypto.randomUUID()}`,
      now,
    });
    if (outcome.anomaly === 'SUBSCRIPTION_PERIOD_REFUNDED') {
      // Not drift: the local row is BEHIND the remote invoice precisely
      // because that invoice was refunded. Reporting (and endlessly
      // re-attempting) `paid_through_behind` here would turn the correct
      // §6.7 outcome into a permanent false alarm.
      notes.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'paid_through_refunded_invoice',
        local: row.paidThrough.toISOString(),
        remote: comparable!.end.toISOString(),
        repaired: false,
      });
    } else {
      drift.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'paid_through_behind',
        local: row.paidThrough.toISOString(),
        remote: comparable!.end.toISOString(),
        repaired: outcome.applied,
      });
    }
  }

  // R-2 writer 3, after the paid-through logic so a void's re-applied
  // coverage is the LAST word on paid_through for this pass.
  await reconcileRefundEvidence(row, now, notes);

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
  const notes: DriftEntry[] = [];
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

      await reconcileOneSubscription(row, now, drift, notes, duplicateAlerts, customersSeen);
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

  return { checked, drift, notes, duplicateRemoteCustomers: duplicateAlerts.length };
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
