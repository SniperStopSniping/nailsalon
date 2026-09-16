/**
 * billing_subscription projection — Gate C2 (contract §8.3, §8.4, §3.9, §6).
 *
 * The webhook route parses and claims; THIS module owns every financial
 * state transition, each one idempotent on object-derived identities:
 *
 *   - paid_through moves forward on unrefunded paid evidence, so a replayed or
 *     re-ordered invoice event is arithmetic identity, not corruption.
 *   - The staleness fence is STRICTLY `event.created < last_event_created`
 *     (§8.3): distinct events sharing a created second stay eligible, and an
 *     equal-second same-type conflict resolves by re-projecting from the
 *     AUTHORITATIVE current subscription the caller re-fetched — never by
 *     guessing event order (event ids are not time-sortable).
 *   - Founding effects are gated on PAID evidence (§3.9): claim redemption
 *     and rate_protected_through both key on the first successfully PAID
 *     activation, never on checkout completion alone —
 *     checkout.session.completed can arrive with payment_status 'unpaid'
 *     for delayed-notification methods.
 *   - The window engine remains the ONLY granter: nothing here writes a
 *     ledger row; handlers call evaluateSubscriptionWindows after state
 *     moves and applyUpgradeDiff on plan upgrades (window-cumulative, #118).
 */

import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { type ActorType, logAuditEventTx } from '@/libs/auditLog';
import { getBillingOffer } from '@/libs/billing/billingOffers';
import { completeAttempt, expireAttempt } from '@/libs/billing/checkoutAttempts';
import { applyUpgradeDiff, evaluateSubscriptionWindows } from '@/libs/billing/creditGrants';
import type { BillingDbTransaction } from '@/libs/billing/creditLedger';
import { getPlanDefinition } from '@/libs/billing/planDefinitions';
import { releasePromotionClaim } from '@/libs/billing/promotionClaims';
import { getPromotion } from '@/libs/billing/promotions';
import { resolveOfferForServicePeriod, resolveRateProtectedThrough } from '@/libs/billing/rateProtection';
import { resolveBillingOfferFromStripePriceId } from '@/libs/billing/stripePriceMap';
import {
  type BillingEvidenceReader,
  overlapsRefund,
  readSubscriptionRefunds,
  recordSubscriptionRefundResolution,
  REFUND_EVIDENCE_VERSION,
  type SubscriptionRefund,
} from '@/libs/billing/subscriptionRefunds';
import { db } from '@/libs/DB';
import {
  billingPromotionClaimSchema,
  billingSubscriptionSchema,
  type BillingSubscriptionStatus,
} from '@/models/Schema';

/** P3c: every lib-layer audit row in this domain defaults to the webhook actor. */
const WEBHOOK_ACTOR = { actorType: 'webhook' as const, actorId: 'stripe-billing' };

/**
 * R-5 status fence: a paid invoice only RESUMES a subscription that dunning
 * or an incomplete first payment had knocked out of service. It must never
 * resurrect `canceled` / `incomplete_expired`, un-pause `paused`, or convert
 * `trialing` — those states are owned by the subscription event stream, and a
 * late or replayed invoice event arriving after them would otherwise flap the
 * status back to active.
 */
const PAYMENT_RESUMABLE_STATUSES = new Set<BillingSubscriptionStatus>([
  'past_due',
  'unpaid',
  'incomplete',
]);

/**
 * R-5: statuses an invoice failure may mark `past_due`. A subscription that
 * is already canceled/expired/paused (or incomplete, which dunning never
 * touches) keeps the status its own event stream set.
 */
const PAYMENT_FAILURE_DUNNABLE_STATUSES = new Set<BillingSubscriptionStatus>([
  'active',
  'unpaid',
  'trialing',
]);

/** Optional override for {@link projectSubscriptionSnapshot}'s audit actor. */
export type BillingProjectionActor = { actorType: ActorType; actorId: string | null };

/** The §6.5a status vocabulary as Stripe reports it. */
const KNOWN_STATUSES = new Set<BillingSubscriptionStatus>([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);

export type StripeSubscriptionSnapshot = {
  id: string;
  customerId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date;
  metadata: Record<string, string | undefined>;
  /** The subscription's first item's price id (§4/G02 cross-check). Absent when the caller could not read it. */
  priceId?: string | null;
};

export type ProjectionOutcome =
  | { applied: true; kind: 'created' | 'updated' | 'stale' | 'noop' }
  | { applied: false; anomaly: string };

/**
 * G02 price ↔ offer-metadata cross-check gate. Logged AT MOST ONCE per
 * process — over the all-placeholder Gate A tables `resolveBillingOfferFromStripePriceId`
 * always returns null (every table is unconfigured), so without this cap
 * every subscription event carrying a price id would log forever. The same
 * null return also covers a configured map that simply does not recognise an
 * unrelated price id; in both cases there is nothing positive to cross-check
 * against, so the cross-check is skipped rather than treated as a mismatch.
 */
let subscriptionPriceCrossCheckUnconfiguredLogged = false;

function logSubscriptionPriceCrossCheckSkippedOnce(): void {
  if (subscriptionPriceCrossCheckUnconfiguredLogged) {
    return;
  }
  subscriptionPriceCrossCheckUnconfiguredLogged = true;
  // eslint-disable-next-line no-console
  console.info('[billing] subscription price cross-check skipped: price map unconfigured for this environment (G02)');
}

/**
 * Upsert from an authoritative subscription snapshot (a subscription.* event
 * body, or a re-fetch when equal-second events conflict — the caller decides
 * which per §8.3; the projection is identical either way).
 */
export async function projectSubscriptionSnapshot(input: {
  snapshot: StripeSubscriptionSnapshot;
  eventCreated: Date;
  eventId: string;
  now?: Date;
  /**
   * P3c: defaults to the webhook actor. The window-evaluation cron (P4)
   * reuses this same projection for reconciliation repairs and will pass
   * its own actor once that caller exists.
   */
  actor?: BillingProjectionActor;
}): Promise<ProjectionOutcome> {
  const { snapshot } = input;
  const now = input.now ?? new Date();
  const actor = input.actor ?? WEBHOOK_ACTOR;

  const offerKey = snapshot.metadata.billingOfferKey ?? null;
  const salonId = snapshot.metadata.salonId ?? null;
  const offer = offerKey !== null ? getBillingOffer(offerKey) : null;
  if (salonId === null || offer === null) {
    return { applied: false, anomaly: 'UNKNOWN_OFFER_OR_SALON_METADATA' };
  }
  const plan = getPlanDefinition(offer.planDefinitionKey);
  if (plan === null) {
    return { applied: false, anomaly: 'UNKNOWN_PLAN_DEFINITION' };
  }
  if (!KNOWN_STATUSES.has(snapshot.status as BillingSubscriptionStatus)) {
    return { applied: false, anomaly: `UNKNOWN_STATUS:${snapshot.status}` };
  }
  const status = snapshot.status as BillingSubscriptionStatus;

  // G02: cross-check the Stripe Price actually on the subscription against
  // the offer key we trust from metadata — BEFORE any state write. Only
  // evaluated when the caller supplied a price id; a resolved-but-different
  // offer is a hard anomaly (never guess which one is right), while a null
  // resolution (unconfigured map, or a price id the current map does not
  // recognise) is inert-by-design until Stripe Price ids are provisioned.
  if (snapshot.priceId !== null && snapshot.priceId !== undefined) {
    const resolvedOfferKey = resolveBillingOfferFromStripePriceId(snapshot.priceId);
    if (resolvedOfferKey === null) {
      logSubscriptionPriceCrossCheckSkippedOnce();
    } else if (resolvedOfferKey !== offer.key) {
      return { applied: false, anomaly: 'PRICE_OFFER_MISMATCH' };
    }
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, snapshot.id))
      .for('update');

    if (existing === undefined) {
      const subscriptionId = `bsub_${crypto.randomUUID()}`;
      await tx.insert(billingSubscriptionSchema).values({
        id: subscriptionId,
        salonId,
        stripeSubscriptionId: snapshot.id,
        stripeCustomerId: snapshot.customerId,
        planDefinitionKey: plan.key,
        billingOfferKey: offer.key,
        promotionKey: snapshot.metadata.promotionKey ?? null,
        billingCadence: offer.cadence,
        status,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        // Entitlement starts at ZERO: paid_through only extends when an
        // invoice payment succeeds (§8.4). The anchor is the activation
        // instant and never moves again (§6.3).
        paidThrough: snapshot.currentPeriodStart,
        creditCycleAnchor: snapshot.currentPeriodStart,
        lastEventCreated: input.eventCreated,
        lastEventId: input.eventId,
      }).onConflictDoNothing({ target: billingSubscriptionSchema.stripeSubscriptionId });
      await logAuditEventTx(tx, {
        salonId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'billing_subscription_projected',
        entityType: 'billing_subscription',
        entityId: subscriptionId,
        metadata: { kind: 'created', billingOfferKey: offer.key },
      });
      return { applied: true, kind: 'created' as const };
    }

    // §8.3 fence: strictly-older events are stale; equal-second events remain
    // eligible (the caller re-fetched when types conflicted).
    if (
      existing.lastEventCreated !== null
      && input.eventCreated.getTime() < existing.lastEventCreated.getTime()
    ) {
      await logAuditEventTx(tx, {
        salonId: existing.salonId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'billing_subscription_projected',
        entityType: 'billing_subscription',
        entityId: existing.id,
        metadata: { kind: 'stale' },
      });
      return { applied: true, kind: 'stale' as const };
    }

    const fromPlanKey = existing.planDefinitionKey;
    const toAllowance = plan.monthlySmsCredits;
    const fromPlan = getPlanDefinition(fromPlanKey);
    const fromAllowance = fromPlan?.monthlySmsCredits ?? 0;

    const patch: Partial<typeof existing> = {
      status,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      stripeCustomerId: snapshot.customerId,
      lastEventCreated: input.eventCreated,
      lastEventId: input.eventId,
    };

    if (offer.key !== existing.billingOfferKey) {
      if (toAllowance > fromAllowance) {
        // Upgrade: authoritative immediately; the diff grant is
        // window-cumulative (#118) and the engine skips granted windows.
        patch.planDefinitionKey = plan.key;
        patch.billingOfferKey = offer.key;
        patch.pendingOfferKey = null;
      } else {
        // Downgrade: NEVER applied mid-window (§6.4) — parked as the pending
        // offer, applied when a renewal invoice arrives under the new price.
        patch.pendingOfferKey = offer.key;
      }
    }

    await tx
      .update(billingSubscriptionSchema)
      .set(patch)
      .where(eq(billingSubscriptionSchema.id, existing.id));

    if (offer.key !== existing.billingOfferKey && toAllowance > fromAllowance) {
      await applyUpgradeDiff(tx, {
        subscriptionId: existing.id,
        fromPlanKey,
        toPlanKey: plan.key,
        now,
      });
    }
    await logAuditEventTx(tx, {
      salonId: existing.salonId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'billing_subscription_projected',
      entityType: 'billing_subscription',
      entityId: existing.id,
      metadata: { kind: 'updated', billingOfferKey: offer.key },
    });
    return { applied: true, kind: 'updated' as const };
  });
}

type BillingSubscriptionRow = typeof billingSubscriptionSchema.$inferSelect;

/**
 * A parked downgrade applies at renewal (§6.4): the renewal invoice is
 * the boundary evidence. §3.9/G15: the pending key is mapped through the
 * rate-protection resolver before it is applied — a protected Founding
 * subscriber renewing into a pending change still keeps its protected
 * offer while `servicePeriodStart` (the pre-update paid_through
 * boundary — this invoice's coverage begins exactly where the prior
 * entitlement ended) is strictly before `rate_protected_through`.
 * Today the committed catalogue retires no offer, so this is a no-op —
 * pinned in billingSubscriptionProjection.test.ts.
 *
 * R-4 extracted this from `applyInvoicePaymentSucceeded` so the reconcile
 * cron can apply a parked offer ON ITS OWN ({@link applyPendingOfferAtRenewal})
 * without borrowing the payment transition's paid-through and status effects.
 *
 * `now` is accepted for symmetry with the other projection helpers; the
 * resolver deliberately keys on the subscription's own service-period
 * boundary, never on wall-clock time.
 */
function computePendingOfferPatch(
  subscription: BillingSubscriptionRow,
  _now: Date,
): { billingOfferKey: string; planDefinitionKey: string; pendingOfferKey: null } | null {
  if (subscription.pendingOfferKey === null) {
    return null;
  }
  const resolvedPendingOfferKey = resolveOfferForServicePeriod({
    currentOfferKey: subscription.pendingOfferKey,
    rateProtectedThrough: subscription.rateProtectedThrough,
    servicePeriodStart: subscription.paidThrough,
  }).offerKey;
  const pendingOffer = getBillingOffer(resolvedPendingOfferKey);
  const pendingPlan = pendingOffer !== null ? getPlanDefinition(pendingOffer.planDefinitionKey) : null;
  if (pendingOffer === null || pendingPlan === null) {
    return null;
  }
  return {
    billingOfferKey: pendingOffer.key,
    planDefinitionKey: pendingPlan.key,
    pendingOfferKey: null,
  };
}

/**
 * invoice.payment_succeeded (§8.4, §3.9): extend paid_through to the paid
 * period's end — monotonic max, so replay and reorder are identity — then
 * let the window engine evaluate. NEVER grants credits directly. The FIRST
 * paid activation of a founding subscription starts the 24-month rate
 * protection clock and redeems the reserved claim.
 */
export async function applyInvoicePaymentSucceeded(input: {
  stripeSubscriptionId: string;
  paidPeriodEnd: Date;
  invoiceId?: string;
  paidPeriodStart?: Date;
  eventCreated: Date;
  eventId: string;
  now?: Date;
}): Promise<{ applied: boolean; anomaly?: string }> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(input.paidPeriodEnd.getTime())
    || (input.paidPeriodStart !== undefined && (!Number.isFinite(input.paidPeriodStart.getTime()) || input.paidPeriodStart >= input.paidPeriodEnd))) {
    return { applied: false, anomaly: 'INVALID_PAID_PERIOD' };
  }
  const outcome = await db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
      .for('update');
    if (subscription === undefined) {
      return { applied: false as const, anomaly: 'SUBSCRIPTION_NOT_PROJECTED', subscriptionRowId: undefined };
    }

    const refundEvidence = await readSubscriptionRefunds(tx, subscription);
    // Malformed or unreadable evidence excludes everything (fail closed).
    if (refundEvidence.incomplete) {
      return { applied: false as const, anomaly: 'SUBSCRIPTION_PERIOD_REFUNDED', subscriptionRowId: undefined };
    }
    // This very invoice's EFFECTIVE state is "refunded" — including a legacy
    // row whose bounds are unusable. A later `void` resolution removes the
    // invoice from this set, which is exactly how a reversed refund becomes
    // re-appliable (R-2).
    if (input.invoiceId !== undefined && refundEvidence.appliedInvoiceIds.has(input.invoiceId)) {
      return { applied: false as const, anomaly: 'SUBSCRIPTION_PERIOD_REFUNDED', subscriptionRowId: undefined };
    }
    // R-3: with refunds on record the coverage comparison is load-bearing, so
    // an unknown start can no longer be defaulted to the epoch minimum — that
    // silently made EVERY refund overlap and turned a legitimate renewal into
    // a permanent hold. Unknown start + existing refunds is its own anomaly.
    if (refundEvidence.refunds.length > 0 && input.paidPeriodStart === undefined) {
      return { applied: false as const, anomaly: 'PAID_PERIOD_START_UNKNOWN', subscriptionRowId: undefined };
    }
    if (refundEvidence.refunds.length > 0
      && overlapsRefund(refundEvidence, { start: input.paidPeriodStart!, end: input.paidPeriodEnd })) {
      return { applied: false as const, anomaly: 'SUBSCRIPTION_PERIOD_REFUNDED', subscriptionRowId: undefined };
    }

    // Deliberately NOT advancing last_event_created/last_event_id: that
    // fence belongs to the SUBSCRIPTION event stream. An invoice raising the
    // shared watermark would make a genuinely newer plan change created a
    // second earlier read as stale and be dropped (review finding 2).
    // The durable refund exclusions above take precedence over this monotonic advance.
    const patch: Record<string, unknown> = {};
    // R-5: resume service only from a dunning/incomplete state.
    if (PAYMENT_RESUMABLE_STATUSES.has(subscription.status)) {
      patch.status = 'active';
    }
    if (input.paidPeriodEnd.getTime() > subscription.paidThrough.getTime()) {
      patch.paidThrough = input.paidPeriodEnd;
    }

    const pendingPatch = computePendingOfferPatch(subscription, now);
    if (pendingPatch !== null) {
      Object.assign(patch, pendingPatch);
    }

    // §3.9: the protection clock begins at the FIRST successfully paid
    // founding activation, exactly once, and never resets.
    if (subscription.promotionKey !== null && subscription.rateProtectedThrough === null) {
      const promotion = getPromotion(subscription.promotionKey);
      if (promotion !== null) {
        // Protection requires THIS salon's own claim as evidence — redeemed
        // now (reserved → redeemed) or already redeemed by the checkout
        // handler. bare metadata promotionKey is never enough: it survives
        // on a subscription whose claim was refused (review finding 1).
        const redeemedNow = await tx
          .update(billingPromotionClaimSchema)
          .set({ status: 'redeemed', redeemedAt: now })
          .where(and(
            eq(billingPromotionClaimSchema.promotionKey, subscription.promotionKey),
            eq(billingPromotionClaimSchema.salonId, subscription.salonId),
            eq(billingPromotionClaimSchema.status, 'reserved'),
          ))
          .returning();
        let hasClaim = redeemedNow.length === 1;
        if (!hasClaim) {
          const [already] = await tx
            .select({ id: billingPromotionClaimSchema.id })
            .from(billingPromotionClaimSchema)
            .where(and(
              eq(billingPromotionClaimSchema.promotionKey, subscription.promotionKey),
              eq(billingPromotionClaimSchema.salonId, subscription.salonId),
              eq(billingPromotionClaimSchema.status, 'redeemed'),
            ))
            .limit(1);
          hasClaim = already !== undefined;
        }
        if (hasClaim) {
          patch.rateProtectedThrough = resolveRateProtectedThrough(now, promotion);
        }
      }
    }

    // The status fence (R-5) can leave NOTHING to write — a replayed invoice
    // for an already-active, already-covered subscription. Drizzle rejects an
    // empty SET, and a no-op UPDATE would be pointless row churn anyway.
    if (Object.keys(patch).length > 0) {
      await tx
        .update(billingSubscriptionSchema)
        .set(patch)
        .where(eq(billingSubscriptionSchema.id, subscription.id));
    }
    return { applied: true as const, subscriptionRowId: subscription.id };
  });

  if (outcome.applied && outcome.subscriptionRowId !== undefined) {
    // Outside the projection transaction: the engine takes its own locks and
    // is exactly-once on window idempotency keys regardless.
    await evaluateSubscriptionWindows({ subscriptionId: outcome.subscriptionRowId, now });
  }
  return { applied: outcome.applied, ...(outcome.applied ? {} : { anomaly: outcome.anomaly }) };
}

/**
 * R-4: apply a parked downgrade at renewal WITHOUT the payment transition.
 *
 * The reconcile cron used to force this through a deliberately no-advancing
 * `applyInvoicePaymentSucceeded` call, which made the repair depend on the
 * latest invoice's status and period (Y7) and dragged in refund evidence,
 * status changes and window evaluation it had no business touching. This
 * applies exactly one patch — the pending offer — under the row lock.
 */
export async function applyPendingOfferAtRenewal(input: {
  stripeSubscriptionId: string;
  now?: Date;
  actor?: BillingProjectionActor;
}): Promise<{ applied: boolean; cleared: boolean }> {
  const now = input.now ?? new Date();
  const actor = input.actor ?? WEBHOOK_ACTOR;
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
      .for('update');
    if (subscription === undefined) {
      return { applied: false, cleared: false };
    }
    const patch = computePendingOfferPatch(subscription, now);
    if (patch === null) {
      return { applied: true, cleared: false };
    }
    await tx
      .update(billingSubscriptionSchema)
      .set(patch)
      .where(eq(billingSubscriptionSchema.id, subscription.id));
    await logAuditEventTx(tx, {
      salonId: subscription.salonId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'billing_subscription_projected',
      entityType: 'billing_subscription',
      entityId: subscription.id,
      metadata: { kind: 'pending_offer_applied', billingOfferKey: patch.billingOfferKey },
    });
    return { applied: true, cleared: true };
  });
}

/**
 * invoice.payment_failed: past_due projection; entitlement math untouched.
 *
 * R-5: the failure is fenced by STATUS, not by the event watermark. Dunning
 * only moves a subscription that is still in service (`active`/`trialing`) or
 * already exhausted (`unpaid`); a `canceled`, `incomplete_expired`, `paused`
 * or `incomplete` row keeps what its own event stream set. And it must NEVER
 * write `last_event_created`/`last_event_id`: that watermark belongs to the
 * SUBSCRIPTION stream, and an invoice raising it would fence out a genuinely
 * newer `customer.subscription.updated` created in the same second.
 */
export async function applyInvoicePaymentFailed(input: {
  stripeSubscriptionId: string;
  eventCreated: Date;
  eventId: string;
}): Promise<{ applied: boolean; changed: boolean }> {
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
      .for('update');
    if (subscription === undefined) {
      // The route reads this as a foreign (legacy-flow) invoice.
      return { applied: false, changed: false };
    }
    if (!PAYMENT_FAILURE_DUNNABLE_STATUSES.has(subscription.status)) {
      return { applied: true, changed: false };
    }
    await tx
      .update(billingSubscriptionSchema)
      .set({ status: 'past_due' })
      .where(eq(billingSubscriptionSchema.id, subscription.id));
    return { applied: true, changed: true };
  });
}

/**
 * §6.7: persist the refunded invoice interval under the subscription lock.
 * paidThrough alone cannot represent holes in prepaid coverage. Both payment
 * projection and the grant engine consume these durable exclusions. A later
 * disjoint paid renewal remains valid; replay never erases it.
 */
export async function applySubscriptionFullRefund(input: {
  stripeSubscriptionId: string;
  /** The refund identities are retained with the invoice and coverage in the audit fact (informational). */
  refundId?: string;
  refundIds?: string[];
  invoiceId: string;
  refundedPeriodStart: Date;
  refundedPeriodEnd: Date;
  eventCreated: Date;
  eventId: string;
  observedAmountRefunded?: number;
  observedAmount?: number;
  /**
   * Defaults to the webhook. The hourly reconcile passes its own actor when
   * it RE-ASSERTS evidence a stale machine void had retracted, so the audit
   * trail says which writer made each correction.
   */
  actor?: BillingProjectionActor;
  now?: Date;
}): Promise<{ applied: boolean; lowered: boolean; anomaly?: string }> {
  const actor = input.actor ?? WEBHOOK_ACTOR;
  // R-1: unusable coverage is rejected BEFORE any write. The route must never
  // reach this with bounds it could not derive (it holds the event instead);
  // this is defence in depth, because the null-bound row the old code wrote
  // permanently poisoned the evidence — every later read went `incomplete`
  // and every future window failed closed with no way back short of an
  // operator resolution.
  if (!Number.isFinite(input.refundedPeriodStart.getTime())
    || !Number.isFinite(input.refundedPeriodEnd.getTime())
    || input.refundedPeriodStart >= input.refundedPeriodEnd) {
    return { applied: false, lowered: false, anomaly: 'REFUND_COVERAGE_INVALID' };
  }
  const refundIds = [
    ...new Set([
      ...(input.refundIds ?? []),
      ...(input.refundId !== undefined && input.refundId !== '' ? [input.refundId] : []),
    ]),
  ];
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
      .for('update');
    if (subscription === undefined) {
      return { applied: false, lowered: false };
    }
    if (!input.invoiceId) {
      throw new Error('INVALID_SUBSCRIPTION_REFUND_IDENTITY');
    }
    const evidence = await readSubscriptionRefunds(tx, subscription);
    // Dedupe on the EFFECTIVE state, not on the raw applied rows: an invoice
    // whose latest resolution is `void` is NOT refunded, so a genuinely new
    // full refund writes a fresh applied row that supersedes the void (R-2).
    if (evidence.appliedInvoiceIds.has(input.invoiceId)) {
      return { applied: true, lowered: false };
    }
    const lowered = subscription.paidThrough > input.refundedPeriodStart
      && subscription.paidThrough <= input.refundedPeriodEnd;
    if (lowered) {
      await tx.update(billingSubscriptionSchema)
        .set({ paidThrough: input.refundedPeriodStart })
        .where(eq(billingSubscriptionSchema.id, subscription.id));
    }
    await logAuditEventTx(tx, {
      salonId: subscription.salonId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'billing_subscription_refund_applied',
      entityType: 'billing_subscription',
      entityId: subscription.id,
      metadata: {
        evidenceVersion: REFUND_EVIDENCE_VERSION,
        seq: evidence.nextSeq,
        invoiceId: input.invoiceId,
        refundIds,
        eventId: input.eventId,
        refundedPeriodStart: input.refundedPeriodStart.toISOString(),
        refundedPeriodEnd: input.refundedPeriodEnd.toISOString(),
        ...(Number.isFinite(input.observedAmountRefunded)
          ? { observedAmountRefunded: input.observedAmountRefunded }
          : {}),
        ...(Number.isFinite(input.observedAmount) ? { observedAmount: input.observedAmount } : {}),
      },
    });
    return { applied: true, lowered };
  });
}

/**
 * R-2 writer (webhook + reconcile): a charge whose CUMULATIVE
 * `amount_refunded` has dropped below its `amount` is no longer fully
 * refunded, so the §6.7 exclusion recorded for its invoice must stop
 * applying. Owner decision O2: void automatically and alert, rather than
 * leaving a salon's entitlement suppressed by evidence Stripe has retracted.
 *
 * The void is recorded as an append-only resolution row; nothing is deleted.
 * The coverage captured before the void is then replayed through the ordinary
 * payment transition, which re-establishes `paid_through` and re-evaluates
 * windows using exactly the same idempotent path a live payment takes.
 */
export async function applySubscriptionRefundVoid(input: {
  stripeSubscriptionId: string;
  invoiceId: string;
  reason: string;
  eventId?: string;
  /**
   * The charge amounts that justified the void, recorded on the resolution
   * row. Optional only for the super-admin path, where the operator's typed
   * reason IS the justification and there is no observed charge.
   */
  observedAmountRefunded?: number;
  observedAmount?: number;
  actor?: BillingProjectionActor;
  now?: Date;
}): Promise<{ applied: boolean; voided: boolean; reapplied: boolean }> {
  const now = input.now ?? new Date();
  const actor = input.actor ?? WEBHOOK_ACTOR;
  const outcome = await db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
      .for('update');
    if (subscription === undefined) {
      return { found: false as const };
    }
    const evidence = await readSubscriptionRefunds(tx, subscription);
    if (!evidence.appliedInvoiceIds.has(input.invoiceId)) {
      // No LIVE evidence for this invoice (never recorded, or already
      // voided). Never an error: the reconcile safety net re-checks every
      // hour and the webhook may deliver the same reversal twice.
      return { found: true as const, voided: false as const };
    }
    // Undefined when the effective row is malformed (legacy null bounds):
    // the void still lands, but there is no coverage to re-apply and an
    // operator `set` resolution is the way back.
    const coverage = evidence.refunds.find(refund => refund.invoiceId === input.invoiceId);
    await recordSubscriptionRefundResolution(tx, {
      subscription,
      invoiceId: input.invoiceId,
      resolution: 'void',
      reason: input.reason,
      actor,
      eventId: input.eventId,
      observedAmountRefunded: input.observedAmountRefunded,
      observedAmount: input.observedAmount,
      seq: evidence.nextSeq,
    });
    return {
      found: true as const,
      voided: true as const,
      coverage,
      seq: evidence.nextSeq,
      lastEventCreated: subscription.lastEventCreated,
    };
  });

  if (!outcome.found) {
    return { applied: false, voided: false, reapplied: false };
  }
  if (!outcome.voided) {
    return { applied: true, voided: false, reapplied: false };
  }
  if (outcome.coverage === undefined) {
    return { applied: true, voided: true, reapplied: false };
  }
  // Post-commit: the void must be durable before the coverage is replayed,
  // otherwise the payment transition would still read the invoice as refunded.
  const reapply = await applyInvoicePaymentSucceeded({
    stripeSubscriptionId: input.stripeSubscriptionId,
    invoiceId: input.invoiceId,
    paidPeriodStart: outcome.coverage.start,
    paidPeriodEnd: outcome.coverage.end,
    eventCreated: outcome.lastEventCreated ?? new Date(0),
    eventId: `refund-void:${input.eventId ?? outcome.seq}`,
    now,
  });
  return { applied: true, voided: true, reapplied: reapply.applied };
}

/**
 * R-2 operator read (INV-A8/A10 exit): the EFFECTIVE evidence a super-admin
 * must see before choosing a resolution. Read-only — never writes.
 */
export async function planSubscriptionRefundEvidence(
  database: BillingEvidenceReader,
  input: { salonId: string; stripeSubscriptionId: string },
): Promise<{
  subscriptionRowId: string;
  paidThrough: Date;
  evidence: {
    refunds: SubscriptionRefund[];
    incomplete: boolean;
    appliedInvoiceIds: string[];
    /** Invoices whose effective state is an explicit `void` (operator context). */
    voidedInvoiceIds: string[];
    rows: number;
    nextSeq: number;
  };
} | null> {
  const [subscription] = await database
    .select()
    .from(billingSubscriptionSchema)
    .where(and(
      eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId),
      // Tenant check: a super-admin acts on ONE salon at a time and may never
      // read another salon's subscription by guessing a Stripe id.
      eq(billingSubscriptionSchema.salonId, input.salonId),
    ))
    .limit(1);
  if (subscription === undefined) {
    return null;
  }
  const evidence = await readSubscriptionRefunds(database, subscription);
  return {
    subscriptionRowId: subscription.id,
    paidThrough: subscription.paidThrough,
    evidence: {
      refunds: evidence.refunds,
      incomplete: evidence.incomplete,
      appliedInvoiceIds: [...evidence.appliedInvoiceIds],
      voidedInvoiceIds: [...evidence.voidedInvoiceIds.keys()],
      rows: evidence.rows,
      nextSeq: evidence.nextSeq,
    },
  };
}

/**
 * R-2 operator write: resolve ONE invoice's refund evidence.
 *
 * `void` is the reversal path (identical semantics to
 * {@link applySubscriptionRefundVoid}, with the super-admin as actor).
 * `set` is the repair path for malformed legacy evidence: it records an
 * authoritative coverage window and applies the same `lowered` rule a refund
 * application would. No window evaluation is needed — the cron re-evaluates
 * and will now read the coverage as refunded.
 */
export async function applySubscriptionRefundEvidenceResolution(input: {
  salonId: string;
  stripeSubscriptionId: string;
  invoiceId: string;
  resolution: 'void' | 'set';
  periodStart?: Date;
  periodEnd?: Date;
  reason: string;
  actor: BillingProjectionActor;
  now?: Date;
}): Promise<{ applied: boolean; seq?: number; lowered?: boolean; reapplied?: boolean; anomaly?: string }> {
  const now = input.now ?? new Date();
  const [scoped] = await db
    .select({ id: billingSubscriptionSchema.id })
    .from(billingSubscriptionSchema)
    .where(and(
      eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId),
      eq(billingSubscriptionSchema.salonId, input.salonId),
    ))
    .limit(1);
  if (scoped === undefined) {
    return { applied: false, anomaly: 'SUBSCRIPTION_NOT_FOUND' };
  }

  if (input.resolution === 'void') {
    const outcome = await applySubscriptionRefundVoid({
      stripeSubscriptionId: input.stripeSubscriptionId,
      invoiceId: input.invoiceId,
      reason: input.reason,
      actor: input.actor,
      now,
    });
    return { applied: outcome.voided, reapplied: outcome.reapplied };
  }

  if (input.periodStart === undefined || input.periodEnd === undefined
    || !Number.isFinite(input.periodStart.getTime()) || !Number.isFinite(input.periodEnd.getTime())
    || input.periodStart >= input.periodEnd) {
    return { applied: false, anomaly: 'INVALID_RESOLUTION_BOUNDS' };
  }
  const periodStart = input.periodStart;
  const periodEnd = input.periodEnd;

  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(and(
        eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId),
        eq(billingSubscriptionSchema.salonId, input.salonId),
      ))
      .for('update');
    if (subscription === undefined) {
      return { applied: false, anomaly: 'SUBSCRIPTION_NOT_FOUND' };
    }
    const evidence = await readSubscriptionRefunds(tx, subscription);
    await recordSubscriptionRefundResolution(tx, {
      subscription,
      invoiceId: input.invoiceId,
      resolution: 'set',
      periodStart,
      periodEnd,
      reason: input.reason,
      actor: input.actor,
      seq: evidence.nextSeq,
    });
    const lowered = subscription.paidThrough > periodStart && subscription.paidThrough <= periodEnd;
    if (lowered) {
      await tx.update(billingSubscriptionSchema)
        .set({ paidThrough: periodStart })
        .where(eq(billingSubscriptionSchema.id, subscription.id));
    }
    return { applied: true, seq: evidence.nextSeq, lowered };
  });
}

/**
 * checkout.session.completed for a plan subscription. Completing the durable
 * attempt is unconditional; FOUNDING effects wait for paid evidence — an
 * 'unpaid' async session leaves the claim reserved for the invoice handler.
 */
export async function applyCheckoutSessionCompleted(input: {
  sessionId: string;
  paymentStatus: string;
  now?: Date;
}): Promise<{ attemptCompleted: boolean }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const { completed } = await completeAttempt(tx, { stripeCheckoutSessionId: input.sessionId });
    if (input.paymentStatus === 'paid') {
      await tx
        .update(billingPromotionClaimSchema)
        .set({ status: 'redeemed', redeemedAt: now })
        .where(and(
          eq(billingPromotionClaimSchema.stripeCheckoutSessionId, input.sessionId),
          eq(billingPromotionClaimSchema.status, 'reserved'),
        ));
    }
    return { attemptCompleted: completed };
  });
}

/** checkout.session.expired: free the attempt slot and the claim (§7.3.6). */
export async function applyCheckoutSessionExpired(input: {
  sessionId: string;
  now?: Date;
}): Promise<{ attemptExpired: boolean; claimReleased: boolean }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // Reuses the SAME audited transitions as the checkout route
    // (checkoutAttempts.ts / promotionClaims.ts) instead of inline
    // duplicate updates.
    const { expired } = await expireAttempt(tx, {
      stripeCheckoutSessionId: input.sessionId,
      purpose: 'plan_subscription',
    });
    const [claim] = await tx
      .select({ id: billingPromotionClaimSchema.id })
      .from(billingPromotionClaimSchema)
      .where(and(
        eq(billingPromotionClaimSchema.stripeCheckoutSessionId, input.sessionId),
        eq(billingPromotionClaimSchema.status, 'reserved'),
      ))
      .limit(1);
    const released = claim === undefined
      ? false
      : (await releasePromotionClaim(tx, { claimId: claim.id, now })).released;
    return { attemptExpired: expired, claimReleased: released };
  });
}

/**
 * §2.3 duplicate-subscription policy for the checkout route — typed results
 * for every live-or-prepaid shape, never an overlapping second subscription.
 */
export async function classifySubscriptionEligibility(
  tx: BillingDbTransaction,
  salonId: string,
  now = new Date(),
): Promise<
  | { eligible: true }
  | { eligible: false; reason: 'ACTIVE_SUBSCRIPTION_EXISTS' | 'CANCELLATION_SCHEDULED' }
  | { eligible: false; reason: 'PREPAID_ENTITLEMENT_REMAINS'; paidThrough: Date }
  > {
  const [live] = await tx
    .select({
      status: billingSubscriptionSchema.status,
      cancelAtPeriodEnd: billingSubscriptionSchema.cancelAtPeriodEnd,
      paidThrough: billingSubscriptionSchema.paidThrough,
    })
    .from(billingSubscriptionSchema)
    .where(and(
      eq(billingSubscriptionSchema.salonId, salonId),
      inArray(billingSubscriptionSchema.status, [
        'active',
        'past_due',
        'trialing',
        'paused',
        'unpaid',
        'incomplete',
        'canceled',
      ]),
    ))
    .orderBy(billingSubscriptionSchema.createdAt)
    .limit(1);
  if (live === undefined) {
    return { eligible: true };
  }
  if (live.status === 'canceled') {
    if (live.paidThrough.getTime() > now.getTime()) {
      return { eligible: false, reason: 'PREPAID_ENTITLEMENT_REMAINS', paidThrough: live.paidThrough };
    }
    return { eligible: true };
  }
  if (live.cancelAtPeriodEnd) {
    return { eligible: false, reason: 'CANCELLATION_SCHEDULED' };
  }
  return { eligible: false, reason: 'ACTIVE_SUBSCRIPTION_EXISTS' };
}
