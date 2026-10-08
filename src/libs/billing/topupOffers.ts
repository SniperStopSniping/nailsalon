import 'server-only';

import type { PlanFamily } from './planDefinitions';
import { TOPUP_OFFERS, type TopupAudience, type TopupOffer, type TopupOfferKey } from './topupCatalog';

export { TOPUP_OFFERS };
export type { TopupAudience, TopupOffer, TopupOfferKey };

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
    offer => offer.active && (offer.audience === 'all_plans' || offer.audience === audience),
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

/** Active offers for ONE audience — the Buy More list, server-resolved (§9.1). */
export function listActiveTopupOffersForAudience(audience: TopupAudience): TopupOffer[] {
  return Object.values(TOPUP_OFFERS)
    .filter(offer => offer.active && (offer.audience === 'all_plans' || offer.audience === audience))
    .sort((a, b) => a.credits - b.credits);
}
