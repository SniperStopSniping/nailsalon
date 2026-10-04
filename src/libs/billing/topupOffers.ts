/**
 * Canonical SMS top-up offers — Founding Plans v1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §3.5.
 *
 * Top-ups are versioned, never discounted by the annual promotion, roll
 * over, are spent after expiring allowances and starter value, and are
 * granted only from verified Stripe payment evidence (Gate B/C work). This
 * module is pure data + lookups.
 */

import 'server-only';

import type { PlanFamily } from './planDefinitions';

export type TopupAudience = 'free_plan' | 'paid_plan' | 'all_salons';

export type TopupOfferKey =
  | 'topup_100_free_2026_08'
  | 'topup_250_free_2026_08'
  | 'topup_500_free_2026_08'
  | 'topup_100_paid_2026_08'
  | 'topup_250_paid_2026_08'
  | 'topup_500_paid_2026_08'
  | 'topup_1000_paid_2026_08'
  | 'topup_100_2026_10'
  | 'topup_200_2026_10'
  | 'topup_500_2026_10';

export type TopupOffer = {
  key: TopupOfferKey;
  credits: 100 | 200 | 250 | 500 | 1000;
  priceCents: number;
  currency: 'cad';
  audience: TopupAudience;
  active: boolean;
};

export const TOPUP_OFFERS: Record<TopupOfferKey, TopupOffer> = {
  topup_100_2026_10: { key: 'topup_100_2026_10', credits: 100, priceCents: 2000, currency: 'cad', audience: 'all_salons', active: true },
  topup_200_2026_10: { key: 'topup_200_2026_10', credits: 200, priceCents: 3000, currency: 'cad', audience: 'all_salons', active: true },
  topup_500_2026_10: { key: 'topup_500_2026_10', credits: 500, priceCents: 5000, currency: 'cad', audience: 'all_salons', active: true },
  topup_100_free_2026_08: {
    key: 'topup_100_free_2026_08',
    credits: 100,
    priceCents: 699,
    currency: 'cad',
    audience: 'free_plan',
    active: false,
  },
  topup_250_free_2026_08: {
    key: 'topup_250_free_2026_08',
    credits: 250,
    priceCents: 1599,
    currency: 'cad',
    audience: 'free_plan',
    active: false,
  },
  topup_500_free_2026_08: {
    key: 'topup_500_free_2026_08',
    credits: 500,
    priceCents: 2999,
    currency: 'cad',
    audience: 'free_plan',
    active: false,
  },
  topup_100_paid_2026_08: {
    key: 'topup_100_paid_2026_08',
    credits: 100,
    priceCents: 599,
    currency: 'cad',
    audience: 'paid_plan',
    active: false,
  },
  topup_250_paid_2026_08: {
    key: 'topup_250_paid_2026_08',
    credits: 250,
    priceCents: 1399,
    currency: 'cad',
    audience: 'paid_plan',
    active: false,
  },
  topup_500_paid_2026_08: {
    key: 'topup_500_paid_2026_08',
    credits: 500,
    priceCents: 2699,
    currency: 'cad',
    audience: 'paid_plan',
    active: false,
  },
  topup_1000_paid_2026_08: {
    key: 'topup_1000_paid_2026_08',
    credits: 1000,
    priceCents: 4999,
    currency: 'cad',
    audience: 'paid_plan',
    active: false,
  },
};

export function getTopupOffer(key: string): TopupOffer | null {
  return Object.prototype.hasOwnProperty.call(TOPUP_OFFERS, key)
    ? TOPUP_OFFERS[key as TopupOfferKey]
    : null;
}

export function resolveTopupAudienceForFamily(family: PlanFamily): TopupAudience {
  return family === 'free' ? 'free_plan' : 'paid_plan';
}

export function resolveTopupOffersForFamily(family: PlanFamily): TopupOffer[] {
  const audience = resolveTopupAudienceForFamily(family);
  return Object.values(TOPUP_OFFERS).filter(
    offer => offer.active && (offer.audience === 'all_salons' || offer.audience === audience),
  );
}

/** Public-safe projection; TopupOffer carries no Stripe identifiers. */
export type PublicTopupOfferProjection = {
  key: TopupOfferKey;
  credits: number;
  priceCents: number;
  currency: 'cad';
  audience: TopupAudience;
};

export function getPublicTopupOffers(family: PlanFamily): PublicTopupOfferProjection[] {
  return resolveTopupOffersForFamily(family).map(offer => ({
    key: offer.key,
    credits: offer.credits,
    priceCents: offer.priceCents,
    currency: offer.currency,
    audience: offer.audience,
  }));
}

Object.freeze(TOPUP_OFFERS);
Object.values(TOPUP_OFFERS).forEach(Object.freeze);

/** Active offers for ONE audience — the Buy More list, server-resolved (§9.1). */
export function listActiveTopupOffersForAudience(audience: TopupAudience): TopupOffer[] {
  return Object.values(TOPUP_OFFERS)
    .filter(offer => offer.active && (offer.audience === 'all_salons' || offer.audience === audience))
    .sort((a, b) => a.credits - b.credits);
}
