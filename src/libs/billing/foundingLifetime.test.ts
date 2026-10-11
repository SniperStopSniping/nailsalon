import { describe, expect, it } from 'vitest';

import { FOUNDING_LIFETIME_TERMS, isFoundingLifetimeOfferOpen } from './foundingLifetime';

describe('founding lifetime offer terms', () => {
  it('keeps free core access available through and after the former deadline', () => {
    expect(isFoundingLifetimeOfferOpen(new Date('2027-01-02T04:59:59.999Z'))).toBe(true);
    expect(isFoundingLifetimeOfferOpen(new Date('2027-01-02T05:00:00.000Z'))).toBe(true);
    expect(isFoundingLifetimeOfferOpen(new Date('2035-01-01T00:00:00Z'))).toBe(true);
    expect(isFoundingLifetimeOfferOpen(new Date('invalid'))).toBe(false);
  });

  it('includes software and emails with one-time free texts and non-expiring purchased texts', () => {
    expect(FOUNDING_LIFETIME_TERMS).toMatchObject({
      coreSoftwareMonthlyPriceCents: 0,
      coreSoftwareAccess: 'lifetime',
      emails: 'unlimited',
      starterTextCredits: 100,
      starterTextCreditsFrequency: 'once_per_verified_business',
      additionalTexts: 'paid_separately',
      purchasedTextCreditsExpire: false,
      claimDeadline: null,
    });
    expect(FOUNDING_LIFETIME_TERMS).not.toHaveProperty('aiReceptionist');
    expect(FOUNDING_LIFETIME_TERMS).not.toHaveProperty('phoneUsage');
  });
});
