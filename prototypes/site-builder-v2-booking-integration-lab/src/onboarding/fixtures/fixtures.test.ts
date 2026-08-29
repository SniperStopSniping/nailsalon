import { describe, expect, it } from 'vitest';

import { getWeeklyHoursPreviewStatus } from '../model/hours';
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
      'Preview time · Open',
      'Preview time · Closed',
      'Lifetime offer available',
      'Founding offer · Discounted annual',
      'Founding offer · Locked monthly',
      'Founding offer · Free beta',
      'Founding offer · Hidden',
      'Offer expiring',
      'Offer expired',
      'No offer',
      'Reduced motion',
      'Long policy copy',
      'Small phone',
      'Multi-page starter',
    ]);
  });

  it('provides fixed Lab-only open and closed preview timestamps', () => {
    const open = applyLabReviewFixture('preview_time_open');
    const closed = applyLabReviewFixture('preview_time_closed');
    expect(open.reviewOptions.previewTimestamp).toBe('2026-08-27T18:30:00.000Z');
    expect(closed.reviewOptions.previewTimestamp).toBe('2026-08-28T01:00:00.000Z');
    expect(getWeeklyHoursPreviewStatus(
      open.profile.hours,
      open.reviewOptions.previewTimestamp,
    )?.label).toBe('Open until 6:00 PM');
    expect(getWeeklyHoursPreviewStatus(
      closed.profile.hours,
      closed.reviewOptions.previewTimestamp,
    )?.label).toBe('Opens tomorrow at 10:00 AM');
  });

  it('uses Daniela-style shared profile content', () => {
    const state = applyLabReviewFixture('daniela_isla');
    expect(state.profile).toMatchObject({
      businessName: 'Isla Nail Studio',
      businessStructure: 'solo',
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
    expect(state.profile.hours).toMatchObject({
      setupState: 'configured',
      showOnSite: true,
    });
    expect(state.profile.hours.days.thursday).toEqual({
      close: '18:00',
      closed: false,
      open: '10:00',
    });
    expect(state.reviewOptions.previewTimestamp).toBe('2026-08-27T18:30:00.000Z');
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

  it('exposes every configurable founding mode as persisted Lab state', () => {
    expect(applyLabReviewFixture('lifetime_offer_available').planOffer.foundingMode)
      .toBe('lifetime');
    expect(applyLabReviewFixture('founding_discounted_annual').planOffer.foundingMode)
      .toBe('discounted_annual');
    expect(applyLabReviewFixture('founding_locked_monthly').planOffer.foundingMode)
      .toBe('locked_monthly');
    expect(applyLabReviewFixture('founding_free_beta').planOffer.foundingMode)
      .toBe('free_beta');
    expect(applyLabReviewFixture('founding_hidden').planOffer).toMatchObject({
      fixtureState: 'none',
      foundingMode: 'hidden',
    });
  });
});
