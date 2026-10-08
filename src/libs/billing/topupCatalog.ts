/** Versioned, public-safe package facts shared by checkout and readiness. */
export type TopupAudience = 'free_plan' | 'paid_plan' | 'all_plans';

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
  topup_100_2026_10: { key: 'topup_100_2026_10', credits: 100, priceCents: 2000, currency: 'cad', audience: 'all_plans', active: true },
  topup_200_2026_10: { key: 'topup_200_2026_10', credits: 200, priceCents: 3000, currency: 'cad', audience: 'all_plans', active: true },
  topup_500_2026_10: { key: 'topup_500_2026_10', credits: 500, priceCents: 5000, currency: 'cad', audience: 'all_plans', active: true },
  // Historical offers stay immutable and resolvable for existing purchases.
  // They cannot be selected for a new checkout.
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

Object.freeze(TOPUP_OFFERS);
Object.values(TOPUP_OFFERS).forEach(Object.freeze);
