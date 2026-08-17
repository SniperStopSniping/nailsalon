import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  BILLING_OFFERS,
  getActiveOffersForFamily,
  getBillingOffer,
  getPublicBillingOffers,
  listActiveBillingOffers,
} = await import('./billingOffers');
const { getPlanDefinition } = await import('./planDefinitions');

describe('billingOffers', () => {
  it('locks monthly prices at $14.99 / $24.99 / $44.99 CAD', () => {
    expect(BILLING_OFFERS.starter_2026_08_monthly.priceCents).toBe(1499);
    expect(BILLING_OFFERS.pro_2026_08_monthly.priceCents).toBe(2499);
    expect(BILLING_OFFERS.elite_2026_08_monthly.priceCents).toBe(4499);
  });

  it('locks annual prices at $149.90 / $249.90 / $449.90 CAD', () => {
    expect(BILLING_OFFERS.starter_2026_08_annual.priceCents).toBe(14990);
    expect(BILLING_OFFERS.pro_2026_08_annual.priceCents).toBe(24990);
    expect(BILLING_OFFERS.elite_2026_08_annual.priceCents).toBe(44990);
  });

  it('derives every annual price structurally as exactly ten monthly payments', () => {
    for (const family of ['starter', 'pro', 'elite'] as const) {
      const offers = getActiveOffersForFamily(family);
      const monthly = offers.find(offer => offer.cadence === 'monthly');
      const annual = offers.find(offer => offer.cadence === 'annual');

      expect(monthly).toBeDefined();
      expect(annual).toBeDefined();
      expect(annual!.priceCents).toBe(monthly!.priceCents * 10);
    }
  });

  it('offers nothing to purchase on the Free plan', () => {
    expect(getActiveOffersForFamily('free')).toEqual([]);
  });

  it('references only existing, active plan definitions and prices everything in CAD', () => {
    for (const offer of Object.values(BILLING_OFFERS)) {
      const plan = getPlanDefinition(offer.planDefinitionKey);

      expect(plan).not.toBeNull();
      expect(plan!.active).toBe(true);
      expect(offer.currency).toBe('cad');
      expect(Number.isInteger(offer.priceCents)).toBe(true);
      expect(offer.priceCents).toBeGreaterThan(0);
    }
  });

  it('keeps record keys and offer keys in lockstep', () => {
    for (const [recordKey, offer] of Object.entries(BILLING_OFFERS)) {
      expect(offer.key).toBe(recordKey);
    }
  });

  it('returns null for unknown offer keys', () => {
    expect(getBillingOffer('starter_2026_08_weekly')).toBeNull();
    expect(getBillingOffer('')).toBeNull();
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(BILLING_OFFERS)).toBe(true);
    expect(() => {
      (BILLING_OFFERS.starter_2026_08_monthly as { priceCents: number }).priceCents = 1;
    }).toThrow(TypeError);
  });

  it('exposes all six active offers publicly with no Stripe identifiers', () => {
    expect(listActiveBillingOffers()).toHaveLength(6);

    const serialized = JSON.stringify(getPublicBillingOffers());

    expect(serialized).not.toMatch(/price_|coupon|promo_|stripe/i);
  });
});
