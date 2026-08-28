import { describe, expect, it } from 'vitest';

import { getEssentialsLeft } from '../progress/essentials';
import {
  applyLabReviewFixture,
  LAB_REVIEW_FIXTURES,
} from './index';

describe('onboarding Lab review fixtures', () => {
  it('exposes every named review state', () => {
    expect(LAB_REVIEW_FIXTURES.map((fixture) => fixture.label)).toEqual([
      'Blank new owner',
      'Daniela / Isla Nail Studio',
      'About Off',
      'Policies Off',
      'Canva intent',
      'Gallery selected',
      'All essentials complete',
      'One essential missing',
      'Lifetime offer available',
      'Offer expiring',
      'Offer expired',
      'No offer',
      'Reduced motion',
      'Long policy copy',
      'Small phone',
      'Multi-page starter',
    ]);
  });

  it('uses Daniela-style shared profile content', () => {
    const state = applyLabReviewFixture('daniela_isla');
    expect(state.profile).toMatchObject({
      businessName: 'Isla Nail Studio',
      instagram: '@islanail.studio',
      ownerName: 'Daniela',
    });
    expect(state.profile.location.cityOrArea).toBe('Scarborough, Ontario');
    expect(state.profile.about.specialties).toEqual([
      'Russian Manicure',
      'BIAB',
      'Gel-X',
      'Hard Gel',
    ]);
  });

  it('provides coherent complete and one-missing essential states', () => {
    expect(getEssentialsLeft(applyLabReviewFixture('all_essentials_complete'))).toBe(0);
    expect(getEssentialsLeft(applyLabReviewFixture('one_essential_missing'))).toBe(1);
  });

  it('uses fixed offer timestamps and returns isolated copies', () => {
    const first = applyLabReviewFixture('lifetime_offer_available');
    const second = applyLabReviewFixture('lifetime_offer_available');
    first.planOffer.expiresAt = null;

    expect(second.planOffer.seededAt).toBe('2026-08-27T12:00:00.000Z');
    expect(second.planOffer.expiresAt).toBe('2026-08-28T12:00:00.000Z');
  });
});
