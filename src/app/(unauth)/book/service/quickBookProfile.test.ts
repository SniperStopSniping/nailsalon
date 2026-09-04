import { describe, expect, it } from 'vitest';

import type { QuickBookProfileVisibility } from '@/libs/bookingPageConfig';
import type { BookingExperience } from '@/types/salonPolicy';

import { resolvePublicQuickBookProfile } from './quickBookProfile';

const HIDDEN: QuickBookProfileVisibility = {
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

const BOOKING_EXPERIENCE: BookingExperience = {
  primaryColor: null,
  bookingMessage: null,
  policy: {
    enabled: true,
    title: 'Before your visit',
    text: 'Please arrive five minutes early.',
    showOnServicePage: true,
    showBeforeConfirmation: true,
    showAfterConfirmation: true,
    showInConfirmationEmail: true,
  },
  quickFacts: {
    appointmentOnly: { enabled: true, label: 'Appointment only' },
    depositNotice: { enabled: true, label: '$15 deposit required' },
    cancellationNotice: { enabled: true, label: '24 hours notice' },
  },
  socialLinks: {
    instagram: 'https://www.instagram.com/isla.nails/',
    facebook: null,
    tiktok: null,
  },
  confirmationMessage: null,
};

function buildSource(
  visibility: QuickBookProfileVisibility = HIDDEN,
): Parameters<typeof resolvePublicQuickBookProfile>[0] {
  return {
    salon: {
      name: 'Isla Nail Studio',
      logoUrl: 'https://images.example/isla-logo.png',
      phone: '(647) 123-4567',
      email: 'hello@islanails.com',
      address: '880 Ellesmere Rd, Unit 2',
      city: 'Scarborough',
      state: 'ON',
      zipCode: 'M1P 2W8',
      businessHours: {
        monday: { open: '10:00', close: '21:30' },
        tuesday: { open: '10:00', close: '21:30' },
      },
    },
    technicians: [{
      name: 'Daniela',
      imageUrl: 'https://images.example/daniela.jpg' as string | null,
      rating: 5 as number | null,
      reviewCount: 128,
    }],
    locations: [],
    bookingExperience: BOOKING_EXPERIENCE,
    reviewUrl: 'https://g.page/r/isla/review',
    sharedProfile: {
      bookingOnlyContact: null,
      businessType: null,
      callEnabled: null,
      entranceInstructions: 'Inside TB Nails · Back of building',
      textEnabled: null,
      textNumber: null,
      transitInformation: 'Two minutes from the station',
    },
    parkingInstructions: 'Use the rear lot',
    visibility,
    bio: 'Healthy nails, flawless results. Specializing in BIAB, Gel-X and Russian Manicure.',
    locationDisplayMode: 'full_address' as const,
    timeZone: 'America/Toronto',
    now: new Date('2026-09-07T15:00:00.000Z'),
  };
}

describe('resolvePublicQuickBookProfile', () => {
  it('projects a full profile exclusively from enabled canonical values', () => {
    const profile = resolvePublicQuickBookProfile(buildSource({
      showTechName: true,
      showTechPhoto: true,
      showLocation: true,
      showHours: true,
      showPhone: true,
      showEmail: true,
      showBookingPolicy: true,
      showCancellationPolicy: true,
      showReviews: true,
      showInstagram: true,
      showBio: true,
    }));

    expect(profile.identity).toEqual({
      salonName: 'Isla Nail Studio',
      logoUrl: 'https://images.example/isla-logo.png',
      technicianName: 'Daniela',
      technicianPhotoUrl: 'https://images.example/daniela.jpg',
    });
    expect(profile.location).toMatchObject({
      addressLine: '880 Ellesmere Rd, Unit 2',
      localityLine: 'Scarborough, ON M1P 2W8',
      instructionLines: [
        'Inside TB Nails · Back of building',
        'Parking: Use the rear lot',
        'Transit: Two minutes from the station',
      ],
    });
    expect(profile.hours).toMatchObject({ statusLabel: 'Open now', todayLabel: 'Until 9:30 PM' });
    expect(profile.contact).toEqual({
      phone: { actionLabel: 'Call', display: '(647) 123-4567', href: 'tel:6471234567' },
      email: { display: 'hello@islanails.com', href: 'mailto:hello@islanails.com' },
    });
    expect(profile.policies).toEqual([
      { label: 'Booking', text: 'Appointment only' },
      {
        label: 'Before your visit',
        text: 'Please arrive five minutes early.',
      },
    ]);
    expect(profile.reviews).toMatchObject({
      ratingText: '5.0',
      reviewCountText: '128',
      href: 'https://g.page/r/isla/review',
    });
    expect(profile.instagram).toEqual({
      label: '@isla.nails',
      href: 'https://www.instagram.com/isla.nails/',
    });
    expect(profile.bio).toMatch(/^Healthy nails/);
  });

  it('keeps every optional stored value out of the minimal public payload', () => {
    const profile = resolvePublicQuickBookProfile(buildSource());

    expect(profile.identity).toEqual({
      salonName: 'Isla Nail Studio',
      logoUrl: 'https://images.example/isla-logo.png',
      technicianName: null,
      technicianPhotoUrl: null,
    });
    expect(profile).toMatchObject({
      location: null,
      hours: null,
      contact: null,
      policies: [],
      reviews: null,
      instagram: null,
      bio: null,
    });
    expect(JSON.stringify(profile)).not.toContain('(647) 123-4567');
    expect(JSON.stringify(profile)).not.toContain('hello@islanails.com');
    expect(JSON.stringify(profile)).not.toContain('880 Ellesmere');
  });

  it('derives open and closed status from the salon timezone at the injected time', () => {
    const source = buildSource({ ...HIDDEN, showHours: true });

    source.now = new Date('2026-09-07T13:00:00.000Z');

    expect(resolvePublicQuickBookProfile(source).hours).toMatchObject({
      statusLabel: 'Closed',
      todayLabel: 'Opens today at 10:00 AM',
    });

    source.now = new Date('2026-09-07T15:00:00.000Z');

    expect(resolvePublicQuickBookProfile(source).hours).toMatchObject({
      statusLabel: 'Open now',
      todayLabel: 'Until 9:30 PM',
    });

    source.now = new Date('2026-09-08T02:00:00.000Z');

    expect(resolvePublicQuickBookProfile(source).hours).toMatchObject({
      statusLabel: 'Closed',
      todayLabel: 'Opens tomorrow at 10:00 AM',
    });
  });

  it('finds the next configured opening after a closed day in the salon timezone', () => {
    const source = buildSource({ ...HIDDEN, showHours: true });
    source.now = new Date('2026-09-09T15:00:00.000Z');

    expect(resolvePublicQuickBookProfile(source).hours).toMatchObject({
      statusLabel: 'Closed',
      todayLabel: 'Opens Monday at 10:00 AM',
    });
  });

  it('honours independent contact toggles and existing city-only privacy', () => {
    const phoneOnlySource = buildSource({ ...HIDDEN, showPhone: true });

    expect(resolvePublicQuickBookProfile(phoneOnlySource).contact).toEqual({
      phone: { actionLabel: 'Call', display: '(647) 123-4567', href: 'tel:6471234567' },
      email: null,
    });

    const privateSource = {
      ...buildSource({ ...HIDDEN, showLocation: true, showPhone: true, showEmail: true }),
      locationDisplayMode: 'city_only' as const,
    };
    const privateProfile = resolvePublicQuickBookProfile(privateSource);

    expect(privateProfile.location).toMatchObject({ addressLine: null, localityLine: 'Scarborough, ON' });
    expect(privateProfile.contact).toEqual({
      phone: { actionLabel: 'Call', display: '(647) 123-4567', href: 'tel:6471234567' },
      email: { display: 'hello@islanails.com', href: 'mailto:hello@islanails.com' },
    });
    expect(JSON.stringify(privateProfile)).not.toContain('880 Ellesmere');
    expect(JSON.stringify(privateProfile)).not.toContain('M1P 2W8');
  });

  it('requires global public-contact eligibility in addition to Quick Book visibility', () => {
    const source = buildSource({ ...HIDDEN, showEmail: true, showPhone: true });
    source.sharedProfile.bookingOnlyContact = true;

    const privateProfile = resolvePublicQuickBookProfile(source);

    expect(privateProfile.contact).toBeNull();
    expect(JSON.stringify(privateProfile)).not.toContain('(647) 123-4567');
    expect(JSON.stringify(privateProfile)).not.toContain('hello@islanails.com');

    source.sharedProfile.bookingOnlyContact = false;

    expect(resolvePublicQuickBookProfile(source).contact).toEqual({
      email: { display: 'hello@islanails.com', href: 'mailto:hello@islanails.com' },
      phone: { actionLabel: 'Call', display: '(647) 123-4567', href: 'tel:6471234567' },
    });
  });

  it('uses canonical call and text preferences without duplicating public phone content', () => {
    const bothSource = buildSource({ ...HIDDEN, showPhone: true });
    bothSource.publicContactPreferences = {
      callEnabled: true,
      textEnabled: true,
      textNumber: '(647) 123-4567',
    };

    expect(resolvePublicQuickBookProfile(bothSource).contact?.phone).toEqual({
      actionLabel: 'Call or text',
      display: '(647) 123-4567',
      href: 'tel:6471234567',
    });

    const textOnlySource = buildSource({ ...HIDDEN, showPhone: true });
    textOnlySource.publicContactPreferences = {
      callEnabled: false,
      textEnabled: true,
      textNumber: '(416) 555-0199',
    };

    expect(resolvePublicQuickBookProfile(textOnlySource).contact?.phone).toEqual({
      actionLabel: 'Text',
      display: '(416) 555-0199',
      href: 'sms:4165550199',
    });

    const distinctSource = buildSource({ ...HIDDEN, showPhone: true });
    distinctSource.publicContactPreferences = {
      callEnabled: true,
      textEnabled: true,
      textNumber: '(416) 555-0199',
    };

    expect(resolvePublicQuickBookProfile(distinctSource).contact?.phone).toEqual({
      actionLabel: 'Call',
      display: '(647) 123-4567',
      href: 'tel:6471234567',
    });
    expect(JSON.stringify(resolvePublicQuickBookProfile(distinctSource).contact)).not.toContain('4165550199');
  });

  it('does not publish a phone action when canonical contact preferences disable it', () => {
    const source = buildSource({ ...HIDDEN, showPhone: true });
    source.publicContactPreferences = {
      callEnabled: false,
      textEnabled: false,
      textNumber: null,
    };

    expect(resolvePublicQuickBookProfile(source).contact).toBeNull();
  });

  it('does not restore legacy calling when one migrated contact preference is explicitly disabled', () => {
    const source = buildSource({ ...HIDDEN, showPhone: true });
    source.publicContactPreferences = {
      callEnabled: false,
      textEnabled: false,
      textNumber: null,
    };

    expect(resolvePublicQuickBookProfile(source).contact).toBeNull();
  });

  it('keeps booking and cancellation policy content behind independent toggles', () => {
    const bookingOnly = resolvePublicQuickBookProfile(buildSource({
      ...HIDDEN,
      showBookingPolicy: true,
    }));

    expect(bookingOnly.policies).toEqual([
      { label: 'Booking', text: 'Appointment only' },
      { label: 'Deposit', text: '$15 deposit required' },
    ]);
    expect(JSON.stringify(bookingOnly.policies)).not.toContain('Please arrive five minutes early.');

    const cancellationOnly = resolvePublicQuickBookProfile(buildSource({
      ...HIDDEN,
      showCancellationPolicy: true,
    }));

    expect(cancellationOnly.policies).toEqual([
      {
        label: 'Before your visit',
        text: 'Please arrive five minutes early.',
      },
    ]);
    expect(JSON.stringify(cancellationOnly.policies)).not.toContain('$15 deposit');
    expect(JSON.stringify(cancellationOnly.policies)).not.toContain('Appointment only');

    const both = resolvePublicQuickBookProfile(buildSource({
      ...HIDDEN,
      showBookingPolicy: true,
      showCancellationPolicy: true,
    }));

    expect(both.policies).toEqual([
      { label: 'Booking', text: 'Appointment only' },
      {
        label: 'Before your visit',
        text: 'Please arrive five minutes early.',
      },
    ]);
  });

  it('falls back to the existing cancellation quick fact when no full policy is enabled', () => {
    const source = buildSource({
      ...HIDDEN,
      showBookingPolicy: true,
      showCancellationPolicy: true,
    });
    source.bookingExperience = {
      ...source.bookingExperience,
      policy: { ...source.bookingExperience.policy, enabled: false, text: null },
    };

    expect(resolvePublicQuickBookProfile(source).policies).toEqual([
      { label: 'Booking', text: 'Appointment only' },
      { label: 'Deposit', text: '$15 deposit required' },
      { label: 'Cancellation', text: '24 hours notice' },
    ]);
  });

  it('publishes direction notes only for an explicitly public location', () => {
    const source = buildSource({ ...HIDDEN, showLocation: true });
    source.locationDisplayMode = 'city_only';

    expect(resolvePublicQuickBookProfile(source).location).toMatchObject({
      addressLine: null,
      localityLine: 'Scarborough, ON',
      instructionLines: [],
    });

    source.locationDisplayMode = 'full_address';

    expect(resolvePublicQuickBookProfile(source).location).toMatchObject({
      instructionLines: [
        'Inside TB Nails · Back of building',
        'Parking: Use the rear lot',
        'Transit: Two minutes from the station',
      ],
    });
  });

  it('never publishes the generic internal location name', () => {
    const source = buildSource({ ...HIDDEN, showLocation: true });
    source.locations = [{
      address: '880 Ellesmere Rd, Unit 2',
      businessHours: null,
      city: 'Scarborough',
      email: null,
      isPrimary: true,
      name: 'Primary location',
      phone: null,
      state: 'ON',
      zipCode: 'M1P 2W8',
    }];

    expect(resolvePublicQuickBookProfile(source).location?.name).toBeNull();
  });

  it('fails an unsafe canonical review URL closed without hiding a real rating', () => {
    const source = buildSource({ ...HIDDEN, showReviews: true });
    source.reviewUrl = 'javascript:alert(1)';

    expect(resolvePublicQuickBookProfile(source).reviews).toEqual({
      href: null,
      ratingText: '5.0',
      reviewCountText: '128',
    });
  });

  it('never fabricates reviews, a technician, or invalid links', () => {
    const source = buildSource({
      ...HIDDEN,
      showTechName: true,
      showTechPhoto: true,
      showReviews: true,
      showInstagram: true,
    });
    source.technicians = [
      { name: 'Daniela', imageUrl: null, rating: null, reviewCount: 0 },
      { name: 'Mia', imageUrl: null, rating: 5, reviewCount: 1 },
    ];
    source.bookingExperience = {
      ...BOOKING_EXPERIENCE,
      socialLinks: { ...BOOKING_EXPERIENCE.socialLinks, instagram: 'javascript:alert(1)' },
    };
    source.reviewUrl = 'javascript:alert(1)';

    const profile = resolvePublicQuickBookProfile(source);

    expect(profile.identity.technicianName).toBeNull();
    expect(profile.identity.technicianPhotoUrl).toBeNull();
    expect(profile.reviews).toBeNull();
    expect(profile.instagram).toBeNull();
    expect(profile.bio).toBeNull();
  });

  it('uses the active shared booking-page bio and suppresses a photo that cross-falls back to the logo', () => {
    const source = buildSource({
      ...HIDDEN,
      showTechPhoto: true,
      showBio: true,
    });
    source.technicians[0]!.imageUrl = source.salon.logoUrl;

    const profile = resolvePublicQuickBookProfile(source);

    expect(profile.bio).toBe('Healthy nails, flawless results. Specializing in BIAB, Gel-X and Russian Manicure.');
    expect(profile.identity.logoUrl).toBe('https://images.example/isla-logo.png');
    expect(profile.identity.technicianPhotoUrl).toBeNull();
  });
});
