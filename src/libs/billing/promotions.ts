/**
 * Canonical promotion definitions — Founding Plans v1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §3.3,
 * §3.4, §3.9, §7.3.
 *
 * BINDING PROMOTION MATH (contract §3.4): the standard annual Price equals
 * ten monthly payments, and the founding first annual term equals six
 * monthly payments. The Stripe implementation is therefore **40% off, once,
 * against the standard annual Price** (6/10 = 60% of annual). Marketing may
 * truthfully say "50% off your first year compared with paying monthly",
 * but the discount percentage applied to the annual Price is 40 — a 50%-off
 * annual coupon would produce $74.95 / $124.95 / $224.95, which the
 * contract explicitly rejects.
 *
 * The founding first-term promotion is DISTINCT from founding base-rate
 * protection (`rate_protected_through`, contract §3.9); this module models
 * only the promotion. Redemption enforcement (claim-before-checkout,
 * once-per-business, redemption caps) is Gate B `billing_promotion_claim`
 * work — this module is pure data + math.
 */

import 'server-only';

import type { BillingOffer, BillingOfferKey } from './billingOffers';

export type PromotionKey = 'founding_annual_2026';

export type PromotionDefinition = {
  key: PromotionKey;
  /** Annual offers only — the promotion never applies to monthly cadence. */
  eligibleOfferKeys: BillingOfferKey[];
  percentOffAgainstAnnualPrice: 40;
  duration: 'once';
  /** ISO instant; null = not yet scheduled (configured before launch). */
  startsAt: string | null;
  endsAt: string | null;
  maximumRedemptions: number | null;
  rateProtectionMonths: 24;
};

export const PROMOTIONS: Record<PromotionKey, PromotionDefinition> = {
  founding_annual_2026: {
    key: 'founding_annual_2026',
    eligibleOfferKeys: [
      'starter_2026_08_annual',
      'pro_2026_08_annual',
      'elite_2026_08_annual',
    ],
    percentOffAgainstAnnualPrice: 40,
    duration: 'once',
    startsAt: null,
    endsAt: null,
    maximumRedemptions: null,
    rateProtectionMonths: 24,
  },
};

export function getPromotion(key: string): PromotionDefinition | null {
  return Object.prototype.hasOwnProperty.call(PROMOTIONS, key)
    ? PROMOTIONS[key as PromotionKey]
    : null;
}

export function isOfferEligibleForPromotion(
  promotion: PromotionDefinition,
  offerKey: BillingOfferKey,
): boolean {
  return promotion.eligibleOfferKeys.includes(offerKey);
}

/**
 * Whether the promotion's configured redemption window is open at `now`.
 * A null boundary means that side is unbounded once launch configuration
 * sets the other. Both null (the committed state) means the promotion is
 * NOT yet open — the window must be explicitly configured before launch.
 */
export function isPromotionWindowOpen(promotion: PromotionDefinition, now: Date): boolean {
  if (promotion.startsAt === null && promotion.endsAt === null) {
    return false;
  }
  const nowMs = now.getTime();
  if (promotion.startsAt !== null && nowMs < Date.parse(promotion.startsAt)) {
    return false;
  }
  if (promotion.endsAt !== null && nowMs >= Date.parse(promotion.endsAt)) {
    return false;
  }
  return true;
}

/**
 * The founding first-term price in cents for an eligible annual offer:
 * exactly 60% of the standard annual price (40% off once). Integer-exact
 * for every catalogue value; guarded against accidental fractional cents.
 */
export function computeFoundingFirstTermCents(offer: BillingOffer): number {
  if (offer.cadence !== 'annual') {
    throw new Error(`Founding promotion applies only to annual offers, got: ${offer.key}`);
  }
  const scaled = offer.priceCents * 60;
  if (scaled % 100 !== 0) {
    throw new Error(`Founding promotion math is not integer-exact for ${offer.key}`);
  }
  return scaled / 100;
}

Object.freeze(PROMOTIONS);
Object.values(PROMOTIONS).forEach((promotion) => {
  Object.freeze(promotion.eligibleOfferKeys);
  Object.freeze(promotion);
});
