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

  it('offers the same 100/200/500 packages to every salon', () => {
    const free = resolveTopupOffersForFamily('free');
    const paid = resolveTopupOffersForFamily('pro');

    expect(free.map(offer => offer.credits).sort((a, b) => a - b)).toEqual([100, 200, 500]);
    expect(paid.map(offer => offer.credits).sort((a, b) => a - b)).toEqual([100, 200, 500]);
    expect(free.every(offer => offer.audience === 'all_salons')).toBe(true);
    expect(paid.every(offer => offer.audience === 'all_salons')).toBe(true);
  });

  it('retires historical packages without changing their prices and defines current CAD prices', () => {
    expect(TOPUP_OFFERS.topup_100_free_2026_08.active).toBe(false);
    expect(TOPUP_OFFERS.topup_100_paid_2026_08.active).toBe(false);
    expect(getPublicTopupOffers('free').map(offer => [offer.credits, offer.priceCents])).toEqual([[100, 2000], [200, 3000], [500, 5000]]);
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
