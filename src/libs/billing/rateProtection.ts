/**
 * Founding rate-protection resolver — Gate C2 (contract §3.9, P6/G15).
 *
 * Two DISTINCT financial facts must never be conflated (§3.9): the
 * first-annual-term PROMOTION (promotions.ts) and the founding BASE-RATE
 * PROTECTION modeled here. `rate_protected_through` is written exactly once,
 * at the first successfully paid founding activation (see the writer in
 * billingSubscriptionProjection.ts), and is consulted here every time an
 * offer key is about to be APPLIED for a future service period — today that
 * is only the pending-offer-at-renewal path in billingSubscriptionProjection.ts.
 *
 * Rule (§3.9, binding): any subscription service period whose START instant
 * is STRICTLY BEFORE `rate_protected_through` uses the CURRENT (protected)
 * Founding offer — even if that exact offer has since been retired for new
 * subscriptions. Once protection has lapsed (`rate_protected_through` is
 * null) or the service period starts at/after the boundary, the current
 * offer's plan is walked forward through its `successorKey` chain
 * (planDefinitions.ts) to the active plan, and the offer of the SAME
 * cadence for that plan is returned; an offer with no successor resolves to
 * itself.
 */

import 'server-only';

import { getBillingOffer, getOfferForPlanAndCadence } from './billingOffers';
import { addMonthsClamped } from './creditWindows';
import { getPlanDefinition } from './planDefinitions';

export type RateProtectionResolution = {
  offerKey: string;
  protected: boolean;
};

/**
 * The instant the founding base-rate protection window closes: the
 * activation instant plus the promotion's `rateProtectionMonths`, using the
 * SAME clamped-month arithmetic as the credit-window engine (§6.3) so a
 * month-end activation never drifts.
 */
export function resolveRateProtectedThrough(
  activationInstant: Date,
  promotion: { rateProtectionMonths: number },
): Date {
  return addMonthsClamped(activationInstant, promotion.rateProtectionMonths);
}

/**
 * Walk `offerKey`'s plan `successorKey` chain (planDefinitions.ts) to the
 * active plan and return the offer of the SAME cadence for it. An unknown
 * offer, an offer whose plan has no successor, or a chain whose target plan
 * has no matching-cadence offer all resolve to the ORIGINAL key — this
 * never throws and never drops the caller onto an unrelated offer.
 */
function resolveSuccessorOfferKey(offerKey: string): string {
  const offer = getBillingOffer(offerKey);
  if (offer === null) {
    return offerKey;
  }
  let plan = getPlanDefinition(offer.planDefinitionKey);
  const visited = new Set<string>();
  while (plan !== null && !plan.active && plan.successorKey !== null && !visited.has(plan.key)) {
    visited.add(plan.key);
    plan = getPlanDefinition(plan.successorKey);
  }
  if (plan === null) {
    return offerKey;
  }
  const successorOffer = getOfferForPlanAndCadence(plan.key, offer.cadence);
  return successorOffer?.key ?? offerKey;
}

/**
 * Resolve which offer key governs a given subscription service period
 * (§3.9). This is the ONLY place `rate_protected_through` is read to SELECT
 * pricing — the writer (the first-paid-activation clock) lives in
 * billingSubscriptionProjection.ts and never reads this module.
 */
export function resolveOfferForServicePeriod(input: {
  currentOfferKey: string;
  rateProtectedThrough: Date | null;
  servicePeriodStart: Date;
}): RateProtectionResolution {
  const { currentOfferKey, rateProtectedThrough, servicePeriodStart } = input;
  if (
    rateProtectedThrough !== null
    && servicePeriodStart.getTime() < rateProtectedThrough.getTime()
  ) {
    // Strictly before the boundary: the protected Founding offer applies
    // even if it has since been retired for new subscriptions.
    return { offerKey: currentOfferKey, protected: true };
  }
  return { offerKey: resolveSuccessorOfferKey(currentOfferKey), protected: false };
}
