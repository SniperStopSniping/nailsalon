/**
 * Credit grants — starter, monthly windows, upgrade diff, top-ups,
 * administrative, expiry sweep.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §6-§7.
 *
 * The credit-window engine is callable and tested in B1 but wired to no
 * webhook or cron: Stripe events (Gate C) maintain paid_through/status;
 * THIS engine is the only granter. Grant iff the FULL half-open window is
 * covered (paid_through >= window_end); late payment grants only the
 * still-active current window; fully missed windows are recorded
 * skipped_missed and never backfilled; `trialing` is anomalous and grants
 * nothing.
 */

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { getPlanDefinition } from '@/libs/billing/planDefinitions';
import { db } from '@/libs/DB';
import {
  billingCreditWindowSchema,
  billingStarterGrantSchema,
  billingSubscriptionSchema,
  smsCreditLedgerSchema,
  smsTopupPurchaseSchema,
} from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';
import { appendLotGrant, appendNegativeEntry, lockCreditAccount, lotRemaining, recomputeCachedBalance } from './creditLedger';
import { computeCreditWindow, evaluateCreditWindow } from './creditWindows';

export const STARTER_CREDITS = 100;

/**
 * One-time business-level starter grant. The durable evidence row (unique
 * per business identity, purge-surviving) is claimed FIRST; only the claim
 * winner appends the ledger lot. Replays, plan changes, cancel/resubscribe
 * and salon recreation under the same identity all lose the claim.
 */
export async function grantStarterCredits(
  tx: BillingDbTransaction,
  input: { businessIdentityId: string; salonId: string; now?: Date },
): Promise<{ granted: boolean }> {
  const now = input.now ?? new Date();
  const claimed = await tx
    .insert(billingStarterGrantSchema)
    .values({
      id: `bsg_${crypto.randomUUID()}`,
      businessIdentityId: input.businessIdentityId,
      salonId: input.salonId,
      credits: STARTER_CREDITS,
      grantedAt: now,
    })
    .onConflictDoNothing({ target: billingStarterGrantSchema.businessIdentityId })
    .returning();
  if (claimed.length === 0) {
    return { granted: false };
  }

  await lockCreditAccount(tx, input.salonId);
  const { lotId } = await appendLotGrant(tx, {
    salonId: input.salonId,
    bucket: 'starter',
    amount: STARTER_CREDITS,
    expiresAt: null,
    idempotencyKey: `starter-grant:${input.businessIdentityId}`,
    reason: 'starter_grant',
  });
  await tx
    .update(billingStarterGrantSchema)
    .set({ ledgerId: lotId })
    .where(eq(billingStarterGrantSchema.id, claimed[0]!.id));
  await recomputeCachedBalance(tx, input.salonId, now);
  return { granted: true };
}

export type WindowEvaluationSummary = {
  granted: number;
  skippedUnpaid: number;
  skippedMissed: number;
  anomalies: string[];
};

const GRANT_ELIGIBLE_STATUSES = new Set(['active', 'past_due', 'canceled']);

/**
 * Evaluate every unevaluated window up to `now` for one subscription.
 * §6.5a status table: active grants; past_due/canceled grant ONLY windows
 * fully covered by verified paid_through (prepaid remainder); unpaid/
 * incomplete/incomplete_expired/paused grant nothing new; trialing records
 * an anomaly and grants nothing.
 */
export async function evaluateSubscriptionWindows(
  input: { subscriptionId: string; now?: Date },
): Promise<WindowEvaluationSummary> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.id, input.subscriptionId))
      .for('update');
    const subscription = rows[0];
    const summary: WindowEvaluationSummary = { granted: 0, skippedUnpaid: 0, skippedMissed: 0, anomalies: [] };
    if (subscription === undefined) {
      return summary;
    }
    if (subscription.status === 'trialing') {
      summary.anomalies.push('TRIALING_SUBSCRIPTION_ANOMALY');
      return summary;
    }
    if (!GRANT_ELIGIBLE_STATUSES.has(subscription.status)) {
      return summary;
    }
    const plan = getPlanDefinition(subscription.planDefinitionKey);
    if (plan === null) {
      summary.anomalies.push('UNKNOWN_PLAN_DEFINITION');
      return summary;
    }

    await lockCreditAccount(tx, subscription.salonId);

    let index = subscription.creditCycleIndex;
    for (;;) {
      const window = computeCreditWindow(subscription.creditCycleAnchor, index);
      const evaluation = evaluateCreditWindow(window, subscription.paidThrough, now);
      if (evaluation === null) {
        break; // future window — stop.
      }

      const idempotencyKey = `monthly-grant:${subscription.stripeSubscriptionId}:${index}:${subscription.planDefinitionKey}`;
      const existing = await tx
        .select({ id: billingCreditWindowSchema.id, status: billingCreditWindowSchema.status })
        .from(billingCreditWindowSchema)
        .where(and(
          eq(billingCreditWindowSchema.billingSubscriptionId, subscription.id),
          eq(billingCreditWindowSchema.creditCycleIndex, index),
        ))
        .limit(1);

      if (evaluation.action === 'grant') {
        if (existing.length === 0 || existing[0]!.status === 'skipped_unpaid') {
          // Late payment during the still-active window upgrades a
          // skipped_unpaid record to granted — current window only. A
          // zero-allowance plan records the window without a ledger lot.
          let lotId: string | null = null;
          if (plan.monthlySmsCredits > 0) {
            const grant = await appendLotGrant(tx, {
              salonId: subscription.salonId,
              bucket: 'monthly',
              amount: plan.monthlySmsCredits,
              expiresAt: window.end,
              idempotencyKey,
              reason: 'monthly_window_grant',
            });
            lotId = grant.lotId;
          }
          if (existing.length === 0) {
            await tx.insert(billingCreditWindowSchema).values({
              id: `bcw_${crypto.randomUUID()}`,
              billingSubscriptionId: subscription.id,
              salonId: subscription.salonId,
              creditCycleIndex: index,
              planDefinitionKey: subscription.planDefinitionKey,
              windowStart: window.start,
              windowEnd: window.end,
              status: 'granted',
              grantLedgerId: lotId,
              idempotencyKey,
              resolvedAt: now,
            });
          } else {
            await tx
              .update(billingCreditWindowSchema)
              .set({ status: 'granted', grantLedgerId: lotId, resolvedAt: now })
              .where(and(
                eq(billingCreditWindowSchema.id, existing[0]!.id),
                eq(billingCreditWindowSchema.status, 'skipped_unpaid'),
              ));
          }
          summary.granted += 1;
        }
      } else if (existing.length === 0) {
        const status = evaluation.action === 'skip_unpaid' ? 'skipped_unpaid' : 'skipped_missed';
        await tx.insert(billingCreditWindowSchema).values({
          id: `bcw_${crypto.randomUUID()}`,
          billingSubscriptionId: subscription.id,
          salonId: subscription.salonId,
          creditCycleIndex: index,
          planDefinitionKey: subscription.planDefinitionKey,
          windowStart: window.start,
          windowEnd: window.end,
          status,
          idempotencyKey: `${idempotencyKey}:${status}`,
          resolvedAt: evaluation.action === 'skip_missed' ? now : null,
        });
        if (evaluation.action === 'skip_unpaid') {
          summary.skippedUnpaid += 1;
        } else {
          summary.skippedMissed += 1;
        }
      } else if (existing[0]!.status === 'skipped_unpaid' && evaluation.action === 'skip_missed') {
        await tx
          .update(billingCreditWindowSchema)
          .set({ status: 'skipped_missed', resolvedAt: now })
          .where(eq(billingCreditWindowSchema.id, existing[0]!.id));
        summary.skippedMissed += 1;
      }

      // A window that has fully elapsed advances the cursor; the ACTIVE
      // window keeps the cursor (late payment may still upgrade it).
      if (now.getTime() >= window.end.getTime()) {
        index += 1;
        continue;
      }
      // Active window: record cursor + next boundary and stop.
      await tx
        .update(billingSubscriptionSchema)
        .set({
          creditCycleIndex: index,
          currentCreditWindowStart: window.start,
          currentCreditWindowEnd: window.end,
          nextCreditGrantAt: window.end,
        })
        .where(eq(billingSubscriptionSchema.id, subscription.id));
      break;
    }

    await recomputeCachedBalance(tx, subscription.salonId, now);
    return summary;
  });
}

/**
 * Upgrade mid-window: grant only max(0, newAllowance − alreadyGrantedThisWindow).
 *
 * `alreadyGrantedThisWindow` is computed from GRANTED EVIDENCE — the sum of
 * monthly grant lots expiring at this window's end — never from the from/to
 * plan pair. A pair diff is farmable: Starter→Elite (+600), downgrade, then
 * Starter→Pro carries a fresh pair key and would mint +200 more, landing a
 * salon at 1000 monthly credits inside an Elite-capped-800 window. Against
 * cumulative evidence the second upgrade sees 800 already granted and mints
 * nothing (contract §6.4).
 *
 * Only an already-GRANTED window is topped up. If the current window has no
 * granted row yet, the window engine is the sole granter and will mint the
 * NEW plan's full allowance when the window qualifies (the webhook updates
 * plan_definition_key before evaluating) — an upgrade-diff issued here too
 * would double-grant the difference the engine is about to include.
 */
export async function applyUpgradeDiff(
  tx: BillingDbTransaction,
  input: {
    subscriptionId: string;
    fromPlanKey: string;
    toPlanKey: string;
    now?: Date;
  },
): Promise<{ granted: number }> {
  const now = input.now ?? new Date();
  const rows = await tx
    .select()
    .from(billingSubscriptionSchema)
    .where(eq(billingSubscriptionSchema.id, input.subscriptionId))
    .for('update');
  const subscription = rows[0];
  if (subscription === undefined) {
    return { granted: 0 };
  }
  const fromPlan = getPlanDefinition(input.fromPlanKey);
  const toPlan = getPlanDefinition(input.toPlanKey);
  if (fromPlan === null || toPlan === null) {
    return { granted: 0 };
  }
  const window = computeCreditWindow(subscription.creditCycleAnchor, subscription.creditCycleIndex);
  if (now.getTime() < window.start.getTime() || now.getTime() >= window.end.getTime()) {
    return { granted: 0 };
  }

  const windowRows = await tx
    .select({ status: billingCreditWindowSchema.status })
    .from(billingCreditWindowSchema)
    .where(and(
      eq(billingCreditWindowSchema.billingSubscriptionId, subscription.id),
      eq(billingCreditWindowSchema.creditCycleIndex, subscription.creditCycleIndex),
    ))
    .limit(1);
  if (windowRows.length === 0 || windowRows[0]!.status !== 'granted') {
    return { granted: 0 };
  }

  // Serialize against every other ledger mutation for this salon BEFORE
  // reading the cumulative sum, or two concurrent plan changes could both
  // read the pre-upgrade total.
  await lockCreditAccount(tx, subscription.salonId);

  // Every monthly grant for this window — the window grant plus any prior
  // upgrade diffs — expires exactly at window.end, and no other window of
  // this salon shares that instant (one live subscription per salon), so the
  // expiry IS the window discriminator.
  const grantedRows = await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::int AS granted
    FROM sms_credit_ledger
    WHERE salon_id = ${subscription.salonId}
      AND bucket = 'monthly'
      AND entry_type = 'grant'
      AND expires_at = ${window.end}
  `);
  const alreadyGranted = Number((grantedRows.rows[0] as Record<string, unknown>).granted);
  const diff = Math.max(0, toPlan.monthlySmsCredits - alreadyGranted);
  if (diff === 0) {
    return { granted: 0 };
  }
  const { created } = await appendLotGrant(tx, {
    salonId: subscription.salonId,
    bucket: 'monthly',
    amount: diff,
    expiresAt: window.end,
    idempotencyKey: `upgrade-diff:${subscription.stripeSubscriptionId}:${subscription.creditCycleIndex}:${input.fromPlanKey}:${input.toPlanKey}`,
    reason: 'upgrade_allowance_diff',
  });
  await recomputeCachedBalance(tx, subscription.salonId, now);
  return { granted: created ? diff : 0 };
}

/** Fulfill a PAID top-up exactly once (purchased lot, never expires). */
export async function fulfillTopupPurchase(
  tx: BillingDbTransaction,
  input: { topupPurchaseId: string; now?: Date },
): Promise<{ fulfilled: boolean }> {
  const now = input.now ?? new Date();
  const rows = await tx
    .select()
    .from(smsTopupPurchaseSchema)
    .where(eq(smsTopupPurchaseSchema.id, input.topupPurchaseId))
    .for('update');
  const purchase = rows[0];
  if (purchase === undefined || purchase.salonId === null) {
    return { fulfilled: false };
  }
  if (purchase.status === 'fulfilled') {
    return { fulfilled: true };
  }
  if (purchase.status !== 'paid') {
    return { fulfilled: false };
  }
  if (purchase.stripeCheckoutSessionId === null) {
    return { fulfilled: false };
  }
  await lockCreditAccount(tx, purchase.salonId);
  const { lotId } = await appendLotGrant(tx, {
    salonId: purchase.salonId,
    bucket: 'purchased',
    amount: purchase.credits,
    expiresAt: null,
    idempotencyKey: `topup-grant:${purchase.stripeCheckoutSessionId}`,
    reason: 'topup_fulfillment',
    stripeRef: purchase.stripePaymentIntentId,
  });
  await tx
    .update(smsTopupPurchaseSchema)
    .set({ status: 'fulfilled', grantLedgerId: lotId })
    .where(and(
      eq(smsTopupPurchaseSchema.id, purchase.id),
      eq(smsTopupPurchaseSchema.status, 'paid'),
    ));
  await recomputeCachedBalance(tx, purchase.salonId, now);
  return { fulfilled: true };
}

/**
 * Top-up refund/dispute reversal — deterministic under CUMULATIVE provider
 * evidence (contract §7.8).
 *
 * Definitions, per purchase:
 *   G = credits granted            A = amount_cents paid
 *   R = cumulative refunded cents  — Stripe's `charge.amount_refunded`,
 *       cumulative by definition, re-fetchable forever; clamped to [0, A]
 *   C = credits already reversed   — derived from the append-only ledger's
 *       `purchase_reversal` rows against this lot (never from event payloads,
 *       which are purge-scheduled and double-count charge.refunded +
 *       refund.updated for one refund)
 *   U = unused value remaining on the lot
 *
 *   refund:  T(R) = floor(G * R / A)            — target cumulative reversal
 *            d    = min(max(0, T − C), max(U, 0))
 *   dispute: d    = max(0, G − C)               — full residual, NO unused
 *            cap; availability MAY go negative (blocks sends, never
 *            authorizes below zero)
 *
 * floor is deliberate: the salon is never docked more credits than the
 * refunded money proportionally covers (Luster absorbs the fraction), and it
 * is exact at full refund (T(A) = G). Cumulative targeting makes replays and
 * reordered events no-ops (older R ⇒ T ≤ C ⇒ d = 0) and makes multiple
 * partials converge without drift — summing independent per-refund floors
 * does not. G ≤ 1000 and A ≤ 4999 keep G·R ≤ 4,999,000: exact integer math.
 *
 * A refund whose T − C exceeds the unused cap reverses only U; the shortfall
 * is value the salon already consumed as sent messages, which is never
 * fabricated back (§7.8 "partial usage = audited adjustment") — it is
 * recorded on the reversal row's note. A cumulative figure that moved
 * BACKWARD (a failed refund) writes nothing: the ledger is append-only, so
 * correction is a manual audited adjustment, never an automatic re-grant.
 */
export async function reverseTopup(
  tx: BillingDbTransaction,
  input: {
    topupPurchaseId: string;
    kind: 'refund' | 'dispute';
    /** Refund id or dispute id — the per-event identity for the ledger key. */
    stripeRef: string;
    /**
     * REQUIRED for refunds: the charge's cumulative `amount_refunded` at the
     * time of this event. Never a per-event delta. Ignored for disputes.
     */
    cumulativeRefundedCents?: number;
    now?: Date;
  },
): Promise<{ reversed: number; shortfall: number; anomaly: string | null }> {
  const now = input.now ?? new Date();
  const none = (anomaly: string | null) => ({ reversed: 0, shortfall: 0, anomaly });
  const rows = await tx
    .select()
    .from(smsTopupPurchaseSchema)
    .where(eq(smsTopupPurchaseSchema.id, input.topupPurchaseId))
    .for('update');
  const purchase = rows[0];
  if (purchase === undefined || purchase.salonId === null || purchase.grantLedgerId === null) {
    return none(null);
  }
  await lockCreditAccount(tx, purchase.salonId);
  const info = await lotRemaining(tx, purchase.grantLedgerId);
  if (info === null) {
    return none(null);
  }

  // C — cumulative credits already reversed, from durable ledger evidence.
  const reversedRows = await tx.execute(sql`
    SELECT COALESCE(-SUM(amount), 0)::int AS reversed
    FROM sms_credit_ledger
    WHERE consumed_from_ledger_id = ${purchase.grantLedgerId}
      AND entry_type = 'purchase_reversal'
  `);
  const alreadyReversed = Number((reversedRows.rows[0] as Record<string, unknown>).reversed);

  let amount: number;
  let shortfall = 0;
  let note: string | null = null;
  if (input.kind === 'dispute') {
    amount = Math.max(0, purchase.credits - alreadyReversed);
  } else {
    if (
      input.cumulativeRefundedCents === undefined
      || !Number.isInteger(input.cumulativeRefundedCents)
      || input.cumulativeRefundedCents < 0
    ) {
      // Never guess a refund magnitude — fail closed for a manual look.
      return none('REFUND_EVIDENCE_MISSING');
    }
    const cumulativeCents = Math.min(input.cumulativeRefundedCents, purchase.amountCents);
    const target = Math.floor((purchase.credits * cumulativeCents) / purchase.amountCents);
    if (target < alreadyReversed) {
      // amount_refunded moved backward — a failed refund. Append-only ledger:
      // no automatic claw-forward; manual audited adjustment only.
      return none('REFUND_TOTAL_REGRESSED');
    }
    const delta = target - alreadyReversed;
    amount = Math.min(delta, Math.max(info.remaining, 0));
    shortfall = delta - amount;
    note = `cum_refunded_cents=${cumulativeCents}${
      shortfall > 0 ? `;consumed_shortfall=${shortfall}` : ''}`;
  }
  if (amount <= 0) {
    return { reversed: 0, shortfall, anomaly: null };
  }
  const key = input.kind === 'dispute'
    ? `dispute-reversal:${input.stripeRef}:${purchase.grantLedgerId}`
    : `topup-reversal:${input.stripeRef}:${purchase.grantLedgerId}`;
  const { created } = await appendNegativeEntry(tx, {
    salonId: purchase.salonId,
    entryType: 'purchase_reversal',
    bucket: 'purchased',
    amount,
    consumedFromLedgerId: purchase.grantLedgerId,
    idempotencyKey: key,
    reason: input.kind === 'dispute' ? 'topup_dispute_reversal' : 'topup_refund_reversal',
    stripeRef: input.stripeRef,
    note,
  });
  const nextStatus = input.kind === 'dispute'
    ? 'disputed'
    : (input.cumulativeRefundedCents ?? 0) >= purchase.amountCents ? 'refunded' : 'partially_reversed';
  await tx
    .update(smsTopupPurchaseSchema)
    .set({
      status: nextStatus,
      refundedAt: now,
      ...(input.kind === 'dispute' ? { stripeDisputeId: input.stripeRef } : { stripeRefundId: input.stripeRef }),
    })
    .where(eq(smsTopupPurchaseSchema.id, purchase.id));
  await recomputeCachedBalance(tx, purchase.salonId, now);
  return { reversed: created ? amount : 0, shortfall, anomaly: null };
}

/** Bookkeeping sweep: expired lots get explicit expiry entries. Correctness never depends on it. */
export async function expireLapsedLots(
  tx: BillingDbTransaction,
  input: { salonId: string; now?: Date },
): Promise<{ expired: number }> {
  const now = input.now ?? new Date();
  await lockCreditAccount(tx, input.salonId);
  const lapsed = await tx
    .select({ id: smsCreditLedgerSchema.id, bucket: smsCreditLedgerSchema.bucket })
    .from(smsCreditLedgerSchema)
    .where(and(
      eq(smsCreditLedgerSchema.salonId, input.salonId),
      sql`${smsCreditLedgerSchema.amount} > 0`,
      sql`${smsCreditLedgerSchema.expiresAt} IS NOT NULL AND ${smsCreditLedgerSchema.expiresAt} <= ${now}`,
    ));
  let expired = 0;
  for (const lot of lapsed) {
    const info = await lotRemaining(tx, lot.id);
    if (info === null || info.remaining <= 0) {
      continue;
    }
    // Segments under an ACTIVE hold are not expirable: the hold will either
    // settle (its own debit) or release. Expiring them here would double-
    // charge the salon when the in-flight send settles moments later.
    const heldRows = await tx.execute(sql`
      SELECT COALESCE(SUM(rl.segments), 0)::int AS held
      FROM sms_credit_reservation_lot rl
      JOIN sms_credit_reservation r ON r.id = rl.reservation_id
      WHERE rl.lot_ledger_id = ${lot.id} AND r.status = 'held'
    `);
    const held = Number((heldRows.rows[0] as { held: number }).held);
    const expirable = info.remaining - held;
    if (expirable <= 0) {
      continue;
    }
    const { created } = await appendNegativeEntry(tx, {
      salonId: input.salonId,
      entryType: 'expiry',
      bucket: lot.bucket,
      amount: expirable,
      consumedFromLedgerId: lot.id,
      idempotencyKey: `expiry:${lot.id}`,
      reason: 'lot_expiry_sweep',
    });
    if (created) {
      expired += 1;
    }
  }
  await recomputeCachedBalance(tx, input.salonId, now);
  return { expired };
}
