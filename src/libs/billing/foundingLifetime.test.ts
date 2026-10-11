import { describe, expect, it } from 'vitest';

import { FOUNDING_LIFETIME_TERMS, isFoundingLifetimeOfferOpen } from './foundingLifetime';

describe('founding lifetime offer terms', () => {
  it('includes all of January1 in Toronto and rejects the exact end instant', () => {
    expect(isFoundingLifetimeOfferOpen(new Date('2027-01-02T04:59:59.999Z'))).toBe(true);
    expect(isFoundingLifetimeOfferOpen(new Date('2027-01-02T05:00:00.000Z'))).toBe(false);
    expect(isFoundingLifetimeOfferOpen(new Date('invalid'))).toBe(false);
  });

  it('includes software and emails without implying recurring free texts or AI usage', () => {
    expect(FOUNDING_LIFETIME_TERMS).toMatchObject({
      coreSoftwareMonthlyPriceCents: 0,
      coreSoftwareAccess: 'lifetime',
      emails: 'unlimited',
      starterTextCredits: 100,
      starterTextCreditsFrequency: 'once_per_verified_business',
      additionalTexts: 'paid_separately',
      aiReceptionist: 'paid_separately',
      phoneUsage: 'paid_separately',
      otherUsageServices: 'paid_separately',
    });
  });
});
