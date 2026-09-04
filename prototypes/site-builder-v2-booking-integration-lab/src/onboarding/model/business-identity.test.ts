import { describe, expect, it } from 'vitest';

import {
  deriveLegacyBusinessFields,
  inferOnboardingBusinessType,
  isPersonalBusinessType,
  locationForBusinessType,
  normalizeSiteSlug,
  normalizeSiteSlugInput,
  validateSiteSlug,
} from './business-identity';
import { createDefaultBusinessProfile } from './defaults';

describe('business identity', () => {
  it('maps the four owner-facing choices onto the existing structure and location fields', () => {
    expect(deriveLegacyBusinessFields('independent_salon')).toEqual({
      businessStructure: 'solo',
      locationType: 'salon_suite',
    });
    expect(deriveLegacyBusinessFields('home_based')).toEqual({
      addressVisibility: 'after_booking',
      businessStructure: 'solo',
      locationType: 'home_studio',
    });
    expect(deriveLegacyBusinessFields('mobile')).toEqual({
      addressVisibility: 'hidden',
      businessStructure: 'solo',
      locationType: 'mobile_service',
    });
    expect(deriveLegacyBusinessFields('salon_team')).toEqual({
      businessStructure: 'multi_tech',
      locationType: 'traditional_salon',
    });
  });

  it('adapts only fresh location defaults to the selected business type', () => {
    const location = createDefaultBusinessProfile().location;

    expect(locationForBusinessType(location, 'independent_salon').addressVisibility).toBe('public');
    expect(locationForBusinessType(location, 'salon_team').addressVisibility).toBe('public');

    const home = locationForBusinessType(location, 'home_based');

    expect(home.addressVisibility).toBe('after_booking');
    expect(locationForBusinessType(home, 'independent_salon').addressVisibility).toBe('public');
    expect(locationForBusinessType(location, 'mobile').addressVisibility).toBe('hidden');
  });

  it('does not change explicit or previously saved privacy choices when business type changes', () => {
    const location = createDefaultBusinessProfile().location;

    for (const addressVisibility of ['hidden', 'after_booking', 'public'] as const) {
      for (const businessType of ['independent_salon', 'home_based', 'salon_team', 'mobile'] as const) {
        for (const addressVisibilityDefaulted of [false, undefined]) {
          expect(locationForBusinessType({
            ...location,
            addressVisibility,
            addressVisibilityDefaulted,
          }, businessType).addressVisibility).toBe(addressVisibility);
        }
      }
    }

    expect(locationForBusinessType({
      ...location,
      addressVisibility: 'after_booking',
      exactAddress: '10 Test Avenue',
    }, 'independent_salon').addressVisibility).toBe('after_booking');
  });

  it('infers old drafts without asking a duplicate business question', () => {
    expect(inferOnboardingBusinessType({
      businessStructure: 'solo',
      locationType: 'home_studio',
    })).toBe('home_based');
    expect(inferOnboardingBusinessType({
      businessStructure: 'multi_tech',
      locationType: 'traditional_salon',
    })).toBe('salon_team');
  });

  it('requires a personal name only for personal business types', () => {
    expect(isPersonalBusinessType('independent_salon')).toBe(true);
    expect(isPersonalBusinessType('home_based')).toBe(true);
    expect(isPersonalBusinessType('mobile')).toBe(true);
    expect(isPersonalBusinessType('salon_team')).toBe(false);
  });

  it('generates safe slugs while preserving an in-progress custom hyphen', () => {
    expect(normalizeSiteSlug('  Îsla Nail Studio  ')).toBe('isla-nail-studio');
    expect(normalizeSiteSlugInput('Daniela-')).toBe('daniela-');
    expect(normalizeSiteSlugInput('Daniela-Nails')).toBe('daniela-nails');
    expect(validateSiteSlug('daniela-nails')).toBe('');
    expect(validateSiteSlug('daniela-')).toBe('Use lowercase letters, numbers and hyphens only.');
  });
});
