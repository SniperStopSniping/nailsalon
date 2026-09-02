import { describe, expect, it } from 'vitest';

import type { QuickBookProfileVisibility } from './bookingPageConfig';
import {
  isQuickBookProfileOwnedLegacySection,
  resolveQuickBookPublicSectionOrder,
  usesCompactQuickBookProfile,
} from './quickBookProfilePresentation';

const LEGACY_ORDER = [
  'salonProfile',
  'technicianProfile',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'reviews',
  'socialLinks',
  'bookingCta',
] as const;

const NEW_PRIVATE_PROFILE: QuickBookProfileVisibility = {
  version: 1,
  showTechName: false,
  showTechPhoto: false,
  showLocation: false,
  showHours: false,
  showPhone: false,
  showEmail: false,
  showBookingPolicy: false,
  showCancellationPolicy: false,
  showReviews: false,
  showInstagram: false,
  showBio: false,
};

describe('Quick Book profile presentation compatibility', () => {
  it('preserves every legacy public section when the profile marker is absent', () => {
    const legacyProfile: QuickBookProfileVisibility = {
      ...NEW_PRIVATE_PROFILE,
      version: 0,
    };

    expect(usesCompactQuickBookProfile(legacyProfile)).toBe(false);
    expect(resolveQuickBookPublicSectionOrder(
      'quick_book',
      LEGACY_ORDER,
      legacyProfile,
    )).toEqual(LEGACY_ORDER);
    expect(isQuickBookProfileOwnedLegacySection(
      'quick_book',
      'policies',
      legacyProfile,
    )).toBe(false);
  });

  it('uses the compact profile for a new all-private versioned config', () => {
    expect(usesCompactQuickBookProfile(NEW_PRIVATE_PROFILE)).toBe(true);
    expect(resolveQuickBookPublicSectionOrder(
      'quick_book',
      LEGACY_ORDER,
      NEW_PRIVATE_PROFILE,
    )).toEqual([
      'salonProfile',
      'serviceMenu',
      'bookingCta',
    ]);
    expect(isQuickBookProfileOwnedLegacySection(
      'quick_book',
      'policies',
      NEW_PRIVATE_PROFILE,
    )).toBe(true);
  });

  it('never filters another booking presentation', () => {
    expect(resolveQuickBookPublicSectionOrder(
      'editorial',
      LEGACY_ORDER,
      NEW_PRIVATE_PROFILE,
    )).toEqual(LEGACY_ORDER);
  });
});
