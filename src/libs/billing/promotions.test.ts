import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  computeFoundingFirstTermCents,
  getPromotion,
  isOfferEligibleForPromotion,
  isPromotionWindowOpen,
  PROMOTIONS,
} = await import('./promotions');
const { BILLING_OFFERS } = await import('./billingOffers');

const founding = PROMOTIONS.founding_annual_2026;

describe('promotions — founding_annual_2026', () => {
  it('locks the founding first annual terms at $89.94 / $149.94 / $269.94 CAD', () => {
    expect(computeFoundingFirstTermCents(BILLING_OFFERS.starter_2026_08_annual)).toBe(8994);
    expect(computeFoundingFirstTermCents(BILLING_OFFERS.pro_2026_08_annual)).toBe(14994);
    expect(computeFoundingFirstTermCents(BILLING_OFFERS.elite_2026_08_annual)).toBe(26994);
  });

  it('never produces the 50%-off-annual mistake ($74.95 / $124.95 / $224.95)', () => {
    expect(computeFoundingFirstTermCents(BILLING_OFFERS.starter_2026_08_annual)).not.toBe(7495);
    expect(computeFoundingFirstTermCents(BILLING_OFFERS.pro_2026_08_annual)).not.toBe(12495);
    expect(computeFoundingFirstTermCents(BILLING_OFFERS.elite_2026_08_annual)).not.toBe(22495);
  });

  it('covers EVERY active annual offer — dropping one from eligibility is a defect', () => {
    const annualOfferKeys = Object.values(BILLING_OFFERS)
      .filter(offer => offer.cadence === 'annual')
      .map(offer => offer.key)
      .sort();

    expect([...founding.eligibleOfferKeys].sort()).toEqual(annualOfferKeys);
    expect(annualOfferKeys).toHaveLength(3);
  });

  it('is implemented as 40% off, once, with 24-month rate protection', () => {
    expect(founding.percentOffAgainstAnnualPrice).toBe(40);
    expect(founding.duration).toBe('once');
    expect(founding.rateProtectionMonths).toBe(24);
  });

  it('applies only to annual offers and rejects monthly cadence outright', () => {
    for (const key of founding.eligibleOfferKeys) {
      expect(BILLING_OFFERS[key].cadence).toBe('annual');
      expect(isOfferEligibleForPromotion(founding, key)).toBe(true);
    }

    expect(isOfferEligibleForPromotion(founding, 'starter_2026_08_monthly')).toBe(false);
    expect(() => computeFoundingFirstTermCents(BILLING_OFFERS.starter_2026_08_monthly)).toThrow();
  });

  it('ships with an UNCONFIGURED window (both bounds null) that is NOT open', () => {
    expect(founding.startsAt).toBeNull();
    expect(founding.endsAt).toBeNull();
    expect(founding.maximumRedemptions).toBeNull();
    expect(isPromotionWindowOpen(founding, new Date('2026-08-16T00:00:00Z'))).toBe(false);
  });

  it('opens and closes correctly once a window is configured', () => {
    const configured = {
      ...founding,
      eligibleOfferKeys: [...founding.eligibleOfferKeys],
      startsAt: '2026-09-01T00:00:00Z',
      endsAt: '2026-12-01T00:00:00Z',
    };

    expect(isPromotionWindowOpen(configured, new Date('2026-08-31T23:59:59Z'))).toBe(false);
    expect(isPromotionWindowOpen(configured, new Date('2026-09-01T00:00:00Z'))).toBe(true);
    expect(isPromotionWindowOpen(configured, new Date('2026-11-30T23:59:59Z'))).toBe(true);
    expect(isPromotionWindowOpen(configured, new Date('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('rejects fractional-cent math instead of rounding silently', () => {
    const fractional = { ...BILLING_OFFERS.starter_2026_08_annual, priceCents: 14991 };

    expect(() => computeFoundingFirstTermCents(fractional)).toThrow(/integer-exact/);
  });

  it('returns null for unknown promotion keys and is deeply frozen', () => {
    expect(getPromotion('black_friday_2026')).toBeNull();
    expect(Object.isFrozen(PROMOTIONS)).toBe(true);
    expect(Object.isFrozen(founding.eligibleOfferKeys)).toBe(true);
    expect(() => {
      (founding.eligibleOfferKeys as string[]).push('starter_2026_08_monthly');
    }).toThrow(TypeError);
  });
});
