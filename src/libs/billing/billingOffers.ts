/**
 * Canonical billing offers — Founding Plans v1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §3, §4.
 *
 * A BillingOffer binds a PlanDefinition to a billing cadence and a price.
 * The Free plan deliberately has no offers (there is nothing to purchase).
 * Standard annual pricing equals exactly ten monthly payments ("pay
 * annually and get two months free") — this 10x relationship is asserted by
 * tests, not merely documented.
 *
 * Pure data + lookups; no I/O, no Stripe identifiers (see stripePriceMap.ts).
 */

import 'server-only';

import type { PlanDefinitionKey, PlanFamily } from './planDefinitions';
import { getPlanDefinition } from './planDefinitions';

export const BILLING_CADENCES = ['monthly', 'annual'] as const;
export type BillingCadence = (typeof BILLING_CADENCES)[number];

export type BillingOfferKey =
  | 'starter_2026_08_monthly'
  | 'starter_2026_08_annual'
  | 'pro_2026_08_monthly'
  | 'pro_2026_08_annual'
  | 'elite_2026_08_monthly'
  | 'elite_2026_08_annual';

export type BillingOffer = {
  key: BillingOfferKey;
  planDefinitionKey: PlanDefinitionKey;
  cadence: BillingCadence;
  priceCents: number;
  currency: 'cad';
  activeForNewSubscriptions: boolean;
};

export const BILLING_OFFERS: Record<BillingOfferKey, BillingOffer> = {
  starter_2026_08_monthly: {
    key: 'starter_2026_08_monthly',
    planDefinitionKey: 'starter_2026_08',
    cadence: 'monthly',
    priceCents: 1499,
    currency: 'cad',
    activeForNewSubscriptions: true,
  },
  starter_2026_08_annual: {
    key: 'starter_2026_08_annual',
    planDefinitionKey: 'starter_2026_08',
    cadence: 'annual',
    priceCents: 14990,
    currency: 'cad',
    activeForNewSubscriptions: true,
  },
  pro_2026_08_monthly: {
    key: 'pro_2026_08_monthly',
    planDefinitionKey: 'pro_2026_08',
    cadence: 'monthly',
    priceCents: 2499,
    currency: 'cad',
    activeForNewSubscriptions: true,
  },
  pro_2026_08_annual: {
    key: 'pro_2026_08_annual',
    planDefinitionKey: 'pro_2026_08',
    cadence: 'annual',
    priceCents: 24990,
    currency: 'cad',
    activeForNewSubscriptions: true,
  },
  elite_2026_08_monthly: {
    key: 'elite_2026_08_monthly',
    planDefinitionKey: 'elite_2026_08',
    cadence: 'monthly',
    priceCents: 4499,
    currency: 'cad',
    activeForNewSubscriptions: true,
  },
  elite_2026_08_annual: {
    key: 'elite_2026_08_annual',
    planDefinitionKey: 'elite_2026_08',
    cadence: 'annual',
    priceCents: 44990,
    currency: 'cad',
    activeForNewSubscriptions: true,
  },
};

export function getBillingOffer(key: string): BillingOffer | null {
  return Object.prototype.hasOwnProperty.call(BILLING_OFFERS, key)
    ? BILLING_OFFERS[key as BillingOfferKey]
    : null;
}

export function listActiveBillingOffers(): BillingOffer[] {
  return Object.values(BILLING_OFFERS).filter(offer => offer.activeForNewSubscriptions);
}

export function getActiveOffersForFamily(family: PlanFamily): BillingOffer[] {
  return listActiveBillingOffers().filter((offer) => {
    const plan = getPlanDefinition(offer.planDefinitionKey);
    return plan !== null && plan.family === family && plan.active;
  });
}

/**
 * Public-safe projection for pricing surfaces. No Stripe identifiers exist
 * on BillingOffer at all, so this projection cannot leak them.
 */
export type PublicBillingOfferProjection = {
  key: BillingOfferKey;
  planDefinitionKey: PlanDefinitionKey;
  cadence: BillingCadence;
  priceCents: number;
  currency: 'cad';
};

export function getPublicBillingOffers(): PublicBillingOfferProjection[] {
  return listActiveBillingOffers().map(offer => ({
    key: offer.key,
    planDefinitionKey: offer.planDefinitionKey,
    cadence: offer.cadence,
    priceCents: offer.priceCents,
    currency: offer.currency,
  }));
}

Object.freeze(BILLING_OFFERS);
Object.values(BILLING_OFFERS).forEach(Object.freeze);
