import { describe, expect, it } from 'vitest';

import {
  EMPTY_SHARED_SALON_PROFILE,
  resolvePublicLocationInstructions,
  resolvePublicSalonPhone,
  resolveSharedSalonProfile,
} from './sharedSalonProfile';

describe('sharedSalonProfile', () => {
  it('resolves the salon-owned directions fields independently', () => {
    expect(resolveSharedSalonProfile({
      sharedProfile: {
        bookingOnlyContact: true,
        businessType: 'home_based',
        callEnabled: true,
        entranceInstructions: '  Inside TB Nails · back entrance  ',
        textEnabled: true,
        textNumber: ' +14165550199 ',
        transitInformation: 'Two minutes from the station.',
      },
    })).toEqual({
      bookingOnlyContact: true,
      businessType: 'home_based',
      callEnabled: true,
      entranceInstructions: 'Inside TB Nails · back entrance',
      textEnabled: true,
      textNumber: '+14165550199',
      transitInformation: 'Two minutes from the station.',
    });
  });

  it('fails malformed legacy values closed without hiding valid siblings', () => {
    expect(resolveSharedSalonProfile({
      sharedProfile: {
        entranceInstructions: 12 as unknown as string,
        transitInformation: 'Near the station.',
      },
    })).toEqual({
      ...EMPTY_SHARED_SALON_PROFILE,
      transitInformation: 'Near the station.',
    });
  });

  it('publishes instructions only for an explicitly public location', () => {
    const profile = {
      bookingOnlyContact: null,
      businessType: null,
      callEnabled: null,
      entranceInstructions: 'Use the back entrance.',
      textEnabled: null,
      textNumber: null,
      transitInformation: null,
    };

    expect(resolvePublicLocationInstructions(profile, {
      addressIsPublic: true,
      parkingInstructions: 'Park behind the building.',
    })).toEqual([
      'Use the back entrance.',
      'Parking: Park behind the building.',
    ]);
    expect(resolvePublicLocationInstructions(profile, {
      addressIsPublic: false,
      parkingInstructions: 'Park behind the building.',
    })).toEqual([]);
  });

  it('keeps canonical phone private when contact is booking-only', () => {
    expect(resolvePublicSalonPhone({
      ...EMPTY_SHARED_SALON_PROFILE,
      bookingOnlyContact: true,
    }, '+14165550199', 'full_address')).toBeNull();

    expect(resolvePublicSalonPhone({
      ...EMPTY_SHARED_SALON_PROFILE,
      bookingOnlyContact: false,
    }, '+14165550199', 'full_address')).toBe('+14165550199');
  });
});
