import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  getPublicTopupOffers,
  getTopupOffer,
  resolveTopupAudienceForFamily,
  resolveTopupOffersForFamily,
  TOPUP_OFFERS,
} = await import('./topupOffers');

describe('topupOffers', () => {
  it('locks Free-plan top-up prices at $6.99 / $15.99 / $29.99 CAD', () => {
    expect(TOPUP_OFFERS.topup_100_free_2026_08.priceCents).toBe(699);
    expect(TOPUP_OFFERS.topup_250_free_2026_08.priceCents).toBe(1599);
    expect(TOPUP_OFFERS.topup_500_free_2026_08.priceCents).toBe(2999);
  });

  it('locks paid-plan top-up prices at $5.99 / $13.99 / $26.99 / $49.99 CAD', () => {
    expect(TOPUP_OFFERS.topup_100_paid_2026_08.priceCents).toBe(599);
    expect(TOPUP_OFFERS.topup_250_paid_2026_08.priceCents).toBe(1399);
    expect(TOPUP_OFFERS.topup_500_paid_2026_08.priceCents).toBe(2699);
    expect(TOPUP_OFFERS.topup_1000_paid_2026_08.priceCents).toBe(4999);
  });

  it('resolves the free family to free-plan offers and every paid family to paid-plan offers', () => {
    expect(resolveTopupAudienceForFamily('free')).toBe('free_plan');

    for (const family of ['starter', 'pro', 'elite'] as const) {
      expect(resolveTopupAudienceForFamily(family)).toBe('paid_plan');
    }
  });

  it('offers 100/250/500 to free salons and adds the 1000 pack only for paid salons', () => {
    const free = resolveTopupOffersForFamily('free');
    const paid = resolveTopupOffersForFamily('pro');

    expect(free.map(offer => offer.credits).sort((a, b) => a - b)).toEqual([100, 250, 500]);
    expect(paid.map(offer => offer.credits).sort((a, b) => a - b)).toEqual([100, 250, 500, 1000]);
    expect(free.every(offer => offer.audience === 'free_plan')).toBe(true);
    expect(paid.every(offer => offer.audience === 'paid_plan')).toBe(true);
  });

  it('keeps record keys and offer keys in lockstep and prices in integer CAD cents', () => {
    for (const [recordKey, offer] of Object.entries(TOPUP_OFFERS)) {
      expect(offer.key).toBe(recordKey);
      expect(offer.currency).toBe('cad');
      expect(Number.isInteger(offer.priceCents)).toBe(true);
    }
  });

  it('returns null for unknown keys and is deeply frozen', () => {
    expect(getTopupOffer('topup_50_free_2026_08')).toBeNull();
    expect(Object.isFrozen(TOPUP_OFFERS)).toBe(true);
    expect(() => {
      (TOPUP_OFFERS.topup_100_paid_2026_08 as { priceCents: number }).priceCents = 1;
    }).toThrow(TypeError);
  });

  it('exposes public projections with no Stripe identifiers', () => {
    const serialized = JSON.stringify([
      ...getPublicTopupOffers('free'),
      ...getPublicTopupOffers('elite'),
    ]);

    expect(serialized).not.toMatch(/price_|coupon|promo_|stripe/i);
  });
});
