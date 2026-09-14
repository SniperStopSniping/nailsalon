/**
 * billing_subscription projection — Gate C2 (contract §8.3, §8.4, §3.9, §6).
 *
 * The webhook route parses and claims; THIS module owns every financial
 * state transition, each one idempotent on object-derived identities:
 *
 *   - paid_through only ever moves FORWARD (monotonic max), so a replayed or
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

import { getBillingOffer } from '@/libs/billing/billingOffers';
import { completeAttempt } from '@/libs/billing/checkoutAttempts';
import { applyUpgradeDiff, evaluateSubscriptionWindows } from '@/libs/billing/creditGrants';
import type { BillingDbTransaction } from '@/libs/billing/creditLedger';
import { addMonthsClamped } from '@/libs/billing/creditWindows';
import { getPlanDefinition } from '@/libs/billing/planDefinitions';
import { getPromotion } from '@/libs/billing/promotions';
import { resolveBillingOfferFromStripePriceId } from '@/libs/billing/stripePriceMap';
import { db } from '@/libs/DB';
import {
  billingCheckoutAttemptSchema,
  billingPromotionClaimSchema,
  billingSubscriptionSchema,
  type BillingSubscriptionStatus,
} from '@/models/Schema';

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
}): Promise<ProjectionOutcome> {
  const { snapshot } = input;
  const now = input.now ?? new Date();

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
      await tx.insert(billingSubscriptionSchema).values({
        id: `bsub_${crypto.randomUUID()}`,
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
      return { applied: true, kind: 'created' as const };
    }

    // §8.3 fence: strictly-older events are stale; equal-second events remain
    // eligible (the caller re-fetched when types conflicted).
    if (
      existing.lastEventCreated !== null
      && input.eventCreated.getTime() < existing.lastEventCreated.getTime()
    ) {
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
    return { applied: true, kind: 'updated' as const };
  });
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
  eventCreated: Date;
  eventId: string;
  now?: Date;
}): Promise<{ applied: boolean; anomaly?: string }> {
  const now = input.now ?? new Date();
  const outcome = await db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
      .for('update');
    if (subscription === undefined) {
      return { applied: false as const, anomaly: 'SUBSCRIPTION_NOT_PROJECTED', subscriptionRowId: undefined };
    }

    // Deliberately NOT advancing last_event_created/last_event_id: that
    // fence belongs to the SUBSCRIPTION event stream. An invoice raising the
    // shared watermark would make a genuinely newer plan change created a
    // second earlier read as stale and be dropped (review finding 2).
    // paid_through is monotonic and needs no fence.
    const patch: Record<string, unknown> = {
      status: 'active',
    };
    if (input.paidPeriodEnd.getTime() > subscription.paidThrough.getTime()) {
      patch.paidThrough = input.paidPeriodEnd;
    }

    // A parked downgrade applies at renewal (§6.4): the renewal invoice is
    // the boundary evidence.
    if (subscription.pendingOfferKey !== null) {
      const pendingOffer = getBillingOffer(subscription.pendingOfferKey);
      const pendingPlan = pendingOffer !== null ? getPlanDefinition(pendingOffer.planDefinitionKey) : null;
      if (pendingOffer !== null && pendingPlan !== null) {
        patch.billingOfferKey = pendingOffer.key;
        patch.planDefinitionKey = pendingPlan.key;
        patch.pendingOfferKey = null;
      }
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
          patch.rateProtectedThrough = addMonthsClamped(now, promotion.rateProtectionMonths);
        }
      }
    }

    await tx
      .update(billingSubscriptionSchema)
      .set(patch)
      .where(eq(billingSubscriptionSchema.id, subscription.id));
    return { applied: true as const, subscriptionRowId: subscription.id };
  });

  if (outcome.applied && outcome.subscriptionRowId !== undefined) {
    // Outside the projection transaction: the engine takes its own locks and
    // is exactly-once on window idempotency keys regardless.
    await evaluateSubscriptionWindows({ subscriptionId: outcome.subscriptionRowId, now });
  }
  return { applied: outcome.applied, ...(outcome.applied ? {} : { anomaly: outcome.anomaly }) };
}

/** invoice.payment_failed: past_due projection; entitlement math untouched. */
export async function applyInvoicePaymentFailed(input: {
  stripeSubscriptionId: string;
  eventCreated: Date;
  eventId: string;
}): Promise<{ applied: boolean }> {
  const updated = await db
    .update(billingSubscriptionSchema)
    .set({
      status: 'past_due',
      lastEventCreated: input.eventCreated,
      lastEventId: input.eventId,
    })
    .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
    .returning();
  return { applied: updated.length === 1 };
}

/**
 * §6.7/G10 full subscription refund: future grants stop. Sets
 * `paid_through = min(paid_through, refundedPeriodStart)` — NEVER raises it —
 * so the window engine (the only granter, §6.4) stops minting windows the
 * refund left uncovered. Nothing else is recorded: this is deliberately NOT
 * part of the subscription event stream's `last_event_created` fence (a
 * refund is money evidence, not a newer subscription state), and consumed
 * credits already sent are never clawed back (§6.7) — only FUTURE windows are
 * affected.
 *
 * Idempotent by construction: replaying the SAME (or an older) refund's
 * `refundedPeriodStart` against an already-lowered `paid_through` is a pure
 * MIN no-op (`lowered: false`) — no extra column or refund-id ledger is
 * needed to detect replay. This is also why `charge.refunded` and
 * `refund.updated` for the SAME underlying refund converge to AT MOST ONE
 * Sentry alert regardless of delivery order: whichever event arrives first
 * lowers the value and reports `lowered: true`; the other finds the target
 * already reached and reports `lowered: false`.
 */
export async function applySubscriptionFullRefund(input: {
  stripeSubscriptionId: string;
  /** The refund's id — carried for caller-side logging/audit; not persisted here. */
  refundId: string;
  refundedPeriodStart: Date;
  eventCreated: Date;
  eventId: string;
  now?: Date;
}): Promise<{ applied: boolean; lowered: boolean }> {
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.stripeSubscriptionId, input.stripeSubscriptionId))
      .for('update');
    if (subscription === undefined) {
      return { applied: false, lowered: false };
    }
    if (input.refundedPeriodStart.getTime() >= subscription.paidThrough.getTime()) {
      // Already at or below the refunded floor — no-op, matches "never raises".
      return { applied: true, lowered: false };
    }
    await tx
      .update(billingSubscriptionSchema)
      .set({ paidThrough: input.refundedPeriodStart })
      .where(eq(billingSubscriptionSchema.id, subscription.id));
    return { applied: true, lowered: true };
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
    const expired = await tx
      .update(billingCheckoutAttemptSchema)
      .set({ status: 'expired' })
      .where(and(
        eq(billingCheckoutAttemptSchema.stripeCheckoutSessionId, input.sessionId),
        eq(billingCheckoutAttemptSchema.purpose, 'plan_subscription'),
        inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
      ))
      .returning();
    const released = await tx
      .update(billingPromotionClaimSchema)
      .set({ status: 'released', releasedAt: now })
      .where(and(
        eq(billingPromotionClaimSchema.stripeCheckoutSessionId, input.sessionId),
        eq(billingPromotionClaimSchema.status, 'reserved'),
      ))
      .returning();
    return { attemptExpired: expired.length === 1, claimReleased: released.length === 1 };
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
