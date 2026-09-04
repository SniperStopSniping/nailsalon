import type { ReviewRecord } from '../../model/section-library/site-content';
import { createDefaultBusinessProfile } from './defaults';
import {
  QUICK_BOOK_SHORT_BIO_MAX_LENGTH,
  resolveQuickBookProfile,
} from './quick-book-profile';
import type {
  BusinessProfileDraft,
  QuickBookProfileVisibilityDraft,
} from './types';

const MONDAY_AT_NOON_IN_TORONTO = '2026-08-31T16:00:00.000Z';

const FULL_VISIBILITY: QuickBookProfileVisibilityDraft = {
  showBio: true,
  showBookingPolicy: true,
  showCancellationPolicy: true,
  showEmail: true,
  showHours: true,
  showInstagram: true,
  showLocation: true,
  showPhone: true,
  showReviews: true,
  showTechName: true,
  showTechPhoto: true,
};

const createFullProfile = (): BusinessProfileDraft => {
  const profile = createDefaultBusinessProfile();
  profile.businessName = 'Isla Nail Studio';
  profile.ownerName = 'Daniela';
  profile.logo = {
    fileName: 'isla-logo.png',
    id: 'logo-reference',
    mimeType: 'image/png',
    source: 'indexed_db',
    storageId: 'logo-storage-id',
  };
  profile.profilePhoto = {
    fileName: 'daniela.jpg',
    id: 'profile-reference',
    mimeType: 'image/jpeg',
    source: 'indexed_db',
    storageId: 'profile-storage-id',
  };
  profile.bookingOnlyContact = false;
  profile.clientContact = {
    callEnabled: true,
    differentTextNumber: '',
    primaryNumber: '(647) 123-4567',
    textEnabled: true,
    useDifferentTextNumber: false,
  };
  profile.email = 'Hello@IslaNails.com';
  profile.instagram = 'https://www.instagram.com/isla.nails/';
  profile.location = {
    addressVisibility: 'public',
    allowGeneralAreaDirections: true,
    cityOrArea: 'Scarborough, ON M1P 2W8',
    entranceInstructions: 'Inside TB Nails · Back entrance',
    exactAddress: '880 Ellesmere Rd, Unit 2',
    locationType: 'salon_suite',
    parking: 'Free parking behind the building',
    transitInformation: 'Near Ellesmere station',
  };
  profile.hours.setupState = 'configured';
  profile.hours.showOnSite = true;
  for (const weekday of Object.keys(profile.hours.days) as Array<keyof typeof profile.hours.days>) {
    profile.hours.days[weekday] = weekday === 'sunday'
      ? { close: '', closed: true, open: '' }
      : { close: '21:30', closed: false, open: '10:00' };
  }
  profile.about.shortBio = 'Healthy nails, flawless results. Specializing in BIAB, Gel-X and Russian Manicure.';
  profile.bookingPreferences.visitMode = 'appointment_only';
  profile.policies.deposits = {
    amountCents: 1500,
    mode: 'fixed',
    refundable: false,
    transferable: false,
    wordingOverride: '',
  };
  profile.policies.cancellations.notice = '24_hours';
  profile.policies.cancellations.consequence = 'deposit_lost';
  return profile;
};

const REVIEWS: ReviewRecord[] = [
  {
    authorName: 'Avery',
    id: 'review-visible-rated',
    quote: 'Beautiful work and a calm appointment.',
    rating: 5,
    source: 'client',
    visible: true,
  },
  {
    authorName: 'Mina',
    id: 'review-visible-unrated',
    quote: 'My nails lasted beautifully.',
    rating: null,
    source: 'client',
    visible: true,
  },
  {
    authorName: 'Hidden reviewer',
    id: 'review-hidden',
    quote: 'This review is not public.',
    rating: 1,
    source: 'other',
    visible: false,
  },
];

describe('resolveQuickBookProfile', () => {
  it('uses canonical public settings even when deprecated duplicated Quick Book gates are off', () => {
    const view = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile: createFullProfile(),
      verifiedReviews: REVIEWS,
      visibility: {
        showBio: false,
        showBookingPolicy: false,
        showCancellationPolicy: false,
        showEmail: false,
        showHours: false,
        showInstagram: false,
        showLocation: false,
        showPhone: false,
        showReviews: false,
        showTechName: false,
        showTechPhoto: false,
      },
    });

    expect(view).toMatchObject({
      bio: null,
      policies: [],
      reviews: null,
      techName: 'Daniela',
      techPhotoVisible: true,
    });
    expect(view.contacts).toHaveLength(3);
    expect(view.hours?.label).toBe('Open now');
    expect(view.instagram?.label).toBe('@isla.nails');
    expect(view.location?.primary).toBe('880 Ellesmere Rd, Unit 2');
  });

  it('removes canonically hidden identity and hours without deleting their saved values', () => {
    const profile = createFullProfile();
    profile.about.visibility.instagram = false;
    profile.about.visibility.owner_name = false;
    profile.about.visibility.profile_photo = false;
    profile.hours.showOnSite = false;
    const savedPhoto = profile.profilePhoto;
    const savedHours = structuredClone(profile.hours.days);

    const view = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile,
      visibility: FULL_VISIBILITY,
    });

    expect(view.hours).toBeNull();
    expect(view.instagram).toBeNull();
    expect(view.techName).toBeNull();
    expect(view.techPhotoVisible).toBe(false);
    expect(profile.profilePhoto).toEqual(savedPhoto);
    expect(profile.hours.days).toEqual(savedHours);
  });

  it('builds the full compact profile only from enabled canonical data and real visible reviews', () => {
    const view = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile: createFullProfile(),
      verifiedReviews: REVIEWS,
      visibility: FULL_VISIBILITY,
    });

    expect(view.techName).toBe('Daniela');
    expect(view.techPhotoVisible).toBe(true);
    expect(view.location).toMatchObject({
      detail: 'Scarborough, ON M1P 2W8',
      notes: [
        'Inside TB Nails · Back entrance',
        'Free parking behind the building',
        'Near Ellesmere station',
      ],
      primary: '880 Ellesmere Rd, Unit 2',
    });
    expect(view.location?.directions).toMatchObject({
      accessibleLabel: 'Directions to 880 Ellesmere Rd, Unit 2',
      target: '_blank',
    });
    expect(view.hours).toMatchObject({
      detail: 'Until 9:30 PM',
      label: 'Open now',
    });
    expect(view.hours?.weekly).toHaveLength(7);
    expect(view.contacts).toEqual([
      {
        detail: 'Text · Preferred',
        href: 'sms:6471234567',
        label: '(647) 123-4567',
        type: 'text',
      },
      {
        detail: 'Call',
        href: 'tel:6471234567',
        label: '(647) 123-4567',
        type: 'call',
      },
      {
        detail: 'Email',
        href: 'mailto:Hello@islanails.com',
        label: 'Hello@IslaNails.com',
        type: 'email',
      },
    ]);
    expect(view.instagram).toMatchObject({
      href: 'https://www.instagram.com/isla.nails/',
      label: '@isla.nails',
      rel: 'noopener noreferrer',
      target: '_blank',
    });
    expect(view.bio).toBe(
      'Healthy nails, flawless results. Specializing in BIAB, Gel-X and Russian Manicure.',
    );
    expect(view.policies).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'appointments', wording: 'Appointment only' }),
      expect.objectContaining({
        id: 'deposits-cancellations',
        wording: expect.stringContaining('A $15 deposit is required'),
      }),
    ]));
    expect(view.reviews).toEqual({
      averageRating: 5,
      count: 2,
      items: [
        {
          authorName: 'Avery',
          id: 'review-visible-rated',
          quote: 'Beautiful work and a calm appointment.',
          rating: 5,
        },
        {
          authorName: 'Mina',
          id: 'review-visible-unrated',
          quote: 'My nails lasted beautifully.',
          rating: null,
        },
      ],
      ratedCount: 1,
    });
    expect(JSON.stringify(view)).not.toContain('Hidden reviewer');
  });

  it('puts the preferred contact first and preserves a distinct text number', () => {
    const profile = createFullProfile();
    profile.preferredContact = 'text';
    profile.clientContact.useDifferentTextNumber = true;
    profile.clientContact.differentTextNumber = '(416) 555-0199';

    const view = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile,
      visibility: FULL_VISIBILITY,
    });

    expect(view.contacts.slice(0, 2)).toEqual([
      {
        detail: 'Text · Preferred',
        href: 'sms:4165550199',
        label: '(416) 555-0199',
        type: 'text',
      },
      {
        detail: 'Call',
        href: 'tel:6471234567',
        label: '(647) 123-4567',
        type: 'call',
      },
    ]);
  });

  it('does not publish a deposit policy that the owner has hidden', () => {
    const profile = createFullProfile();
    profile.policies.copy.deposits.visible = false;

    const view = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile,
      verifiedReviews: [],
      visibility: FULL_VISIBILITY,
    });

    expect(view.policies.some(policy => policy.id === 'deposit')).toBe(false);
  });

  it('omits invalid or absent public values instead of creating empty profile modules', () => {
    const profile = createDefaultBusinessProfile();
    profile.bookingOnlyContact = false;
    profile.clientContact.callEnabled = true;
    profile.clientContact.primaryNumber = '123';
    profile.email = 'not-an-email';
    profile.instagram = 'instagram.com/isla.nails/extra-path';
    profile.location.addressVisibility = 'hidden';
    profile.location.cityOrArea = '';
    profile.ownerName = '   ';
    profile.about.shortBio = '   ';

    const view = resolveQuickBookProfile({
      previewTimestamp: 'not-a-date',
      profile,
      verifiedReviews: [{
        authorName: 'Private',
        id: 'private-review',
        quote: 'Not public',
        rating: 5,
        source: 'client',
        visible: false,
      }],
      visibility: FULL_VISIBILITY,
    });

    expect(view.contacts).toEqual([]);
    expect(view.hours).toBeNull();
    expect(view.instagram).toBeNull();
    expect(view.location).toBeNull();
    expect(view.reviews).toBeNull();
    expect(view.techName).toBeNull();
    expect(view.techPhotoVisible).toBe(false);
    expect(view.bio).toBeNull();
  });

  it('never treats the logo asset as the nail-tech portrait', () => {
    const profile = createFullProfile();
    profile.profilePhoto = {
      ...profile.profilePhoto!,
      id: 'different-local-reference',
      storageId: profile.logo?.storageId,
    };

    const sharedAsset = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile,
      verifiedReviews: [],
      visibility: FULL_VISIBILITY,
    });

    expect(sharedAsset.techPhotoVisible).toBe(false);

    profile.profilePhoto = {
      ...profile.profilePhoto,
      storageId: 'distinct-profile-storage-id',
    };
    const distinctAsset = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile,
      verifiedReviews: [],
      visibility: FULL_VISIBILITY,
    });

    expect(distinctAsset.techPhotoVisible).toBe(true);
  });

  it('limits the shared short bio without persisting or exposing an overlong value', () => {
    const profile = createFullProfile();
    profile.about.shortBio = `  ${'A'.repeat(QUICK_BOOK_SHORT_BIO_MAX_LENGTH + 40)}  `;

    const view = resolveQuickBookProfile({
      previewTimestamp: MONDAY_AT_NOON_IN_TORONTO,
      profile,
      verifiedReviews: [],
      visibility: FULL_VISIBILITY,
    });

    expect(view.bio).toHaveLength(QUICK_BOOK_SHORT_BIO_MAX_LENGTH);
    expect(view.bio?.endsWith('…')).toBe(true);
    expect(profile.about.shortBio).toHaveLength(QUICK_BOOK_SHORT_BIO_MAX_LENGTH + 44);
  });
});
