import { describe, expect, it } from 'vitest';

import {
  applyLocationDisplayMode,
  applyPhoneDisplayMode,
  EMPTY_SALON_CONTENT,
  resolveSalonContent,
  type ResolveSalonContentInput,
} from './salonContent';

// Unmistakable synthetic PII — if any of these strings survive into a
// `city_only` result (or a snapshot of it), the leak is impossible to miss.
const PRIVATE_STREET_ADDRESS = '999 PRIVATE HOME ROAD';
const PRIVATE_UNIT = 'UNIT 77';
const PRIVATE_POSTAL_CODE = 'A1A 1A1';
const PRIVATE_FULL_ADDRESS = `${PRIVATE_STREET_ADDRESS}, ${PRIVATE_UNIT}`;
// Unmistakable synthetic phone (never a real number) — the home-based solo
// tech's personal mobile that `city_only` must also redact, not just the
// street address/postal code.
const PRIVATE_PHONE = '+14165550199';

const BASE_BOOKING_EXPERIENCE: ResolveSalonContentInput['bookingExperience'] = {
  policy: {
    enabled: false,
    title: null,
    text: null,
    showOnServicePage: true,
    showBeforeConfirmation: true,
    showAfterConfirmation: true,
    showInConfirmationEmail: true,
  },
  quickFacts: {
    appointmentOnly: { enabled: false, label: null },
    depositNotice: { enabled: false, label: null },
    cancellationNotice: { enabled: false, label: null },
  },
  socialLinks: {
    instagram: null,
    facebook: null,
    tiktok: null,
  },
};

const SERVICE_A = {
  id: 'svc-a',
  name: 'Gel Manicure',
  durationMinutes: 60,
  priceCents: 4500,
  category: 'manicure' as const,
  bookingCategory: 'manicure',
  sortOrder: 1,
};

const SERVICE_B = {
  id: 'svc-b',
  name: 'Luster Manicure',
  durationMinutes: 75,
  priceCents: 6500,
  category: 'manicure' as const,
  bookingCategory: 'manicure',
  templateKey: 'luster_manicure',
  sortOrder: 2,
};

describe('resolveSalonContent', () => {
  it('resolves a fully populated salon into every content group', () => {
    const content = resolveSalonContent({
      salon: {
        name: 'Isla Nail Studio',
        logoUrl: '/logo.png',
        address: '123 Main St',
        city: 'Toronto',
        state: 'ON',
        zipCode: 'M5V 1A1',
        businessHours: { monday: { open: '09:00', close: '17:00' } },
      },
      technicians: [
        {
          id: 'tech-1',
          name: 'Mila',
          bio: 'Loves nail art',
          avatarUrl: '/mila.jpg',
          specialties: ['Gel-X'],
          languages: ['English', 'French'],
          rating: '4.9',
          reviewCount: 42,
          skillLevel: 'expert',
          acceptingNewClients: true,
        },
      ],
      services: [SERVICE_A, SERVICE_B],
      addOns: [
        {
          id: 'addon-1',
          name: 'Chrome Finish',
          category: 'nail_art',
          pricingType: 'fixed',
          durationMinutes: 10,
          priceCents: 1500,
        },
      ],
      locations: [
        {
          id: 'loc-1',
          name: 'Downtown',
          address: '1 Main St',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5V 1A1',
          isPrimary: true,
          businessHours: { tuesday: { open: '10:00', close: '18:00' } },
        },
      ],
      bookingExperience: {
        ...BASE_BOOKING_EXPERIENCE,
        policy: { ...BASE_BOOKING_EXPERIENCE.policy, enabled: true, text: 'Please arrive early.' },
        socialLinks: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
      },
      lusterFeaturingEnabled: true,
    });

    // identity — solo salon (1 technician) borrows its rating.
    expect(content.identity).toEqual({
      name: 'Isla Nail Studio',
      logoUrl: '/logo.png',
      specialtyLine: null,
      bio: null,
      heroImageUrl: null,
      salonRating: { rating: 4.9, reviewCount: 42 },
    });

    // people
    expect(content.people.technicians).toHaveLength(1);
    expect(content.people.technicians[0]).toMatchObject({
      id: 'tech-1',
      bio: 'Loves nail art',
      avatarUrl: '/mila.jpg',
      specialties: ['Gel-X'],
      languages: ['English', 'French'],
      rating: 4.9,
      reviewCount: 42,
      skillLevel: 'expert',
      acceptingNewClients: true,
    });

    // catalog — featured services reuse getFeaturedServices (Luster manicure leads).
    expect(content.catalog.services.map(service => service.id)).toEqual(['svc-a', 'svc-b']);
    expect(content.catalog.featuredServices.map(service => service.id)).toEqual(['svc-b']);
    expect(content.catalog.addOns).toHaveLength(1);

    // place — primary location wins over the salon-level fallback.
    expect(content.place.locations).toHaveLength(1);
    expect(content.place.address).toEqual({
      address: '1 Main St',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5V 1A1',
    });
    expect(content.place.hours).toEqual({ tuesday: { open: '10:00', close: '18:00' } });
    expect(content.place.entranceInstructions).toBeNull();

    // policies / social
    expect(content.policies.policy.enabled).toBe(true);
    expect(content.social.instagram).toBe('https://instagram.com/isla');

    // proof — always empty in this PR.
    expect(content.proof.portfolio).toEqual([]);
    expect(content.proof.reviews).toEqual([]);
  });

  it('borrows the sole technician rating for a solo salon, but never aggregates for a team', () => {
    const solo = resolveSalonContent({
      salon: { name: 'Solo Salon' },
      technicians: [{ id: 't1', name: 'Ava', rating: 4.5, reviewCount: 10 }],
      services: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(solo.identity.salonRating).toEqual({ rating: 4.5, reviewCount: 10 });

    const team = resolveSalonContent({
      salon: { name: 'Team Salon' },
      technicians: [
        { id: 't1', name: 'Ava', rating: 4.5, reviewCount: 10 },
        { id: 't2', name: 'Bea', rating: 4.8, reviewCount: 20 },
      ],
      services: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(team.identity.salonRating).toBeNull();

    const none = resolveSalonContent({
      salon: { name: 'No Techs Salon' },
      technicians: [],
      services: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(none.identity.salonRating).toBeNull();
  });

  it('excludes inactive technicians from the solo-rating decision', () => {
    const content = resolveSalonContent({
      salon: { name: 'Salon' },
      technicians: [
        { id: 't1', name: 'Ava', rating: 4.5, reviewCount: 10, isActive: true },
        { id: 't2', name: 'Retired Bea', rating: 4.8, reviewCount: 20, isActive: false },
      ],
      services: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(content.identity.salonRating).toEqual({ rating: 4.5, reviewCount: 10 });
  });

  it('falls back to the salon-level address/hours when there is no primary location', () => {
    const content = resolveSalonContent({
      salon: {
        name: 'Salon',
        address: '9 Salon Rd',
        city: 'Ottawa',
        state: 'ON',
        zipCode: 'K1A 0B1',
        businessHours: { monday: { open: '09:00', close: '17:00' } },
      },
      technicians: [],
      services: [],
      locations: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(content.place.address).toEqual({
      address: '9 Salon Rd',
      city: 'Ottawa',
      state: 'ON',
      zipCode: 'K1A 0B1',
    });
    expect(content.place.hours).toEqual({ monday: { open: '09:00', close: '17:00' } });
  });

  it('resolves a minimally populated salon to safe empty groups without crashing', () => {
    const content = resolveSalonContent({
      salon: { name: 'Minimal Salon' },
      technicians: [],
      services: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(content.identity.name).toBe('Minimal Salon');
    expect(content.identity.salonRating).toBeNull();
    expect(content.people.technicians).toEqual([]);
    expect(content.catalog.services).toEqual([]);
    expect(content.catalog.featuredServices).toEqual([]);
    expect(content.place.locations).toEqual([]);
    expect(content.place.address).toBeNull();
    expect(content.place.hours).toBeNull();
    expect(content.social).toEqual({ instagram: null, facebook: null, tiktok: null });
  });

  it('folds in bookingPageContent (heroImageUrl/specialtyLine/bio) when the caller supplies it, and stays null when it does not (PR 6)', () => {
    const withoutContent = resolveSalonContent({
      salon: { name: 'Isla Nail Studio' },
      technicians: [],
      services: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(withoutContent.identity.heroImageUrl).toBeNull();
    expect(withoutContent.identity.specialtyLine).toBeNull();
    expect(withoutContent.identity.bio).toBeNull();

    const withContent = resolveSalonContent({
      salon: { name: 'Isla Nail Studio' },
      technicians: [],
      services: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
      content: {
        heroImageUrl: 'https://example.com/hero.jpg',
        specialtyLine: 'Russian manicure & BIAB · Toronto',
        bio: 'A quiet, detail-first studio.',
      },
    });

    expect(withContent.identity.heroImageUrl).toBe('https://example.com/hero.jpg');
    expect(withContent.identity.specialtyLine).toBe('Russian manicure & BIAB · Toronto');
    expect(withContent.identity.bio).toBe('A quiet, detail-first studio.');
  });
});

describe('applyLocationDisplayMode', () => {
  it('is a no-op for full_address', () => {
    const value = { address: PRIVATE_FULL_ADDRESS, zipCode: PRIVATE_POSTAL_CODE, city: 'Homeburg' };

    expect(applyLocationDisplayMode(value, 'full_address')).toEqual(value);
    expect(applyLocationDisplayMode(value, 'full_address')).toBe(value);
  });

  // Post-launch privacy fix: this assertion previously read `phone:
  // '555-0100'` here — i.e. it asserted the salon phone SURVIVES
  // `city_only` redaction, which was the exact defect this fix closes (a
  // home-based solo tech's personal mobile staying published under a
  // control named "city only"). Corrected to assert the phone is redacted
  // too, alongside address/zipCode — every other field still passes
  // through untouched.
  it('strips address, zipCode, and phone for city_only when the value carries a phone field, preserving every other field', () => {
    const value = {
      id: 'loc-private',
      name: 'Home Studio',
      address: PRIVATE_FULL_ADDRESS,
      city: 'Homeburg',
      state: 'ON',
      zipCode: PRIVATE_POSTAL_CODE,
      phone: PRIVATE_PHONE,
      isPrimary: true,
    };

    const redacted = applyLocationDisplayMode(value, 'city_only');

    expect(redacted.address).toBeNull();
    expect(redacted.zipCode).toBeNull();
    expect(redacted.phone).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain(PRIVATE_PHONE);
    expect(redacted).toMatchObject({
      id: 'loc-private',
      name: 'Home Studio',
      city: 'Homeburg',
      state: 'ON',
      isPrimary: true,
    });
  });

  it('full_address (control) preserves the exact phone unredacted — proves the city_only assertion above is not vacuous', () => {
    const value = {
      id: 'loc-private',
      name: 'Home Studio',
      address: PRIVATE_FULL_ADDRESS,
      city: 'Homeburg',
      state: 'ON',
      zipCode: PRIVATE_POSTAL_CODE,
      phone: PRIVATE_PHONE,
      isPrimary: true,
    };

    const result = applyLocationDisplayMode(value, 'full_address');

    expect(result.phone).toBe(PRIVATE_PHONE);
    expect(result).toBe(value);
  });

  it('never adds a phone key to a value that never had one — city_only stays shape-preserving for phone-less values', () => {
    const value = { address: PRIVATE_FULL_ADDRESS, zipCode: PRIVATE_POSTAL_CODE, city: 'Homeburg' };

    const redacted = applyLocationDisplayMode(value, 'city_only');

    expect(redacted).toEqual({ address: null, zipCode: null, city: 'Homeburg' });
    expect(Object.prototype.hasOwnProperty.call(redacted, 'phone')).toBe(false);
  });
});

describe('applyPhoneDisplayMode', () => {
  it('is a no-op for full_address', () => {
    expect(applyPhoneDisplayMode(PRIVATE_PHONE, 'full_address')).toBe(PRIVATE_PHONE);
  });

  it('redacts the phone to null for city_only', () => {
    expect(applyPhoneDisplayMode(PRIVATE_PHONE, 'city_only')).toBeNull();
  });

  it('stays null in, null out regardless of mode', () => {
    expect(applyPhoneDisplayMode(null, 'full_address')).toBeNull();
    expect(applyPhoneDisplayMode(null, 'city_only')).toBeNull();
  });
});

describe('resolveSalonContent — location privacy (locationDisplayMode)', () => {
  const salonWithPrivateSalonLevelAddress: ResolveSalonContentInput['salon'] = {
    name: 'Private Home Studio',
    address: PRIVATE_FULL_ADDRESS,
    city: 'Homeburg',
    state: 'ON',
    zipCode: PRIVATE_POSTAL_CODE,
  };

  it('defaults to full_address (unchanged behaviour) when locationDisplayMode is not supplied', () => {
    const content = resolveSalonContent({
      salon: salonWithPrivateSalonLevelAddress,
      technicians: [],
      services: [],
      locations: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
    });

    expect(content.place.address).toEqual({
      address: PRIVATE_FULL_ADDRESS,
      city: 'Homeburg',
      state: 'ON',
      zipCode: PRIVATE_POSTAL_CODE,
    });
  });

  it('full_address preserves the exact street address, postal code, and phone (single location, explicit mode)', () => {
    const content = resolveSalonContent({
      salon: { name: 'Private Home Studio' },
      technicians: [],
      services: [],
      locations: [
        {
          id: 'loc-1',
          name: 'Home Studio',
          address: PRIVATE_FULL_ADDRESS,
          city: 'Homeburg',
          state: 'ON',
          zipCode: PRIVATE_POSTAL_CODE,
          phone: PRIVATE_PHONE,
          isPrimary: true,
        },
      ],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
      content: { locationDisplayMode: 'full_address' },
    });

    expect(content.place.address?.address).toBe(PRIVATE_FULL_ADDRESS);
    expect(content.place.address?.zipCode).toBe(PRIVATE_POSTAL_CODE);
    expect(content.place.locations[0]?.address).toBe(PRIVATE_FULL_ADDRESS);
    expect(content.place.locations[0]?.zipCode).toBe(PRIVATE_POSTAL_CODE);
    expect(content.place.locations[0]?.phone).toBe(PRIVATE_PHONE);
  });

  // Post-launch privacy fix: this test previously asserted `phone:
  // '555-0100'` SURVIVES `city_only` redaction — that was the exact defect
  // (THE DEFECT section of the hotfix task). Corrected to assert the phone
  // is redacted to `null` alongside address/zipCode, and the synthetic
  // phone string is added to the "none of these private strings survive"
  // serialized-payload proof below, same as the address strings already
  // were.
  it('city_only strips street address/unit, postal code, and phone from a single location, keeping city/state/name', () => {
    const content = resolveSalonContent({
      salon: { name: 'Private Home Studio' },
      technicians: [],
      services: [],
      locations: [
        {
          id: 'loc-1',
          name: 'Home Studio',
          address: PRIVATE_FULL_ADDRESS,
          city: 'Homeburg',
          state: 'ON',
          zipCode: PRIVATE_POSTAL_CODE,
          phone: PRIVATE_PHONE,
          isPrimary: true,
        },
      ],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
      content: { locationDisplayMode: 'city_only' },
    });

    // The unmistakable proof: none of the private strings survive anywhere
    // in the resolved content, serialized or not.
    const serialized = JSON.stringify(content);

    expect(serialized).not.toContain(PRIVATE_STREET_ADDRESS);
    expect(serialized).not.toContain(PRIVATE_UNIT);
    expect(serialized).not.toContain(PRIVATE_POSTAL_CODE);
    expect(serialized).not.toContain(PRIVATE_PHONE);

    expect(content.place.address).toEqual({
      address: null,
      city: 'Homeburg',
      state: 'ON',
      zipCode: null,
    });
    expect(content.place.locations[0]).toMatchObject({
      id: 'loc-1',
      name: 'Home Studio',
      address: null,
      city: 'Homeburg',
      state: 'ON',
      zipCode: null,
      phone: null,
    });
  });

  it('city_only redacts every location in a multi-location salon, not only the primary', () => {
    const content = resolveSalonContent({
      salon: { name: 'Multi-Location Salon' },
      technicians: [],
      services: [],
      locations: [
        {
          id: 'loc-primary',
          name: 'Main Studio',
          address: PRIVATE_FULL_ADDRESS,
          city: 'Homeburg',
          state: 'ON',
          zipCode: PRIVATE_POSTAL_CODE,
          phone: PRIVATE_PHONE,
          isPrimary: true,
        },
        {
          id: 'loc-secondary',
          name: 'Second Studio',
          address: '42 OTHER PRIVATE LANE',
          city: 'Homeburg',
          state: 'ON',
          zipCode: 'B2B 2B2',
          phone: '+14165550299',
          isPrimary: false,
        },
      ],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
      content: { locationDisplayMode: 'city_only' },
    });

    expect(content.place.locations).toHaveLength(2);

    for (const location of content.place.locations) {
      expect(location.address).toBeNull();
      expect(location.zipCode).toBeNull();
      expect(location.phone).toBeNull();
      expect(location.city).toBe('Homeburg');
    }
  });

  it('city_only also redacts the salon-level fallback address used when there is no location row', () => {
    const content = resolveSalonContent({
      salon: salonWithPrivateSalonLevelAddress,
      technicians: [],
      services: [],
      locations: [],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
      content: { locationDisplayMode: 'city_only' },
    });

    const serialized = JSON.stringify(content);

    expect(serialized).not.toContain(PRIVATE_STREET_ADDRESS);
    expect(serialized).not.toContain(PRIVATE_POSTAL_CODE);
    expect(content.place.address).toEqual({
      address: null,
      city: 'Homeburg',
      state: 'ON',
      zipCode: null,
    });
  });

  it('city_only never touches hours or entranceInstructions — only address fields are privacy-sensitive', () => {
    const content = resolveSalonContent({
      salon: { name: 'Private Home Studio' },
      technicians: [],
      services: [],
      locations: [
        {
          id: 'loc-1',
          name: 'Home Studio',
          address: PRIVATE_FULL_ADDRESS,
          city: 'Homeburg',
          zipCode: PRIVATE_POSTAL_CODE,
          isPrimary: true,
          businessHours: { monday: { open: '10:00', close: '18:00' } },
        },
      ],
      bookingExperience: BASE_BOOKING_EXPERIENCE,
      content: { locationDisplayMode: 'city_only' },
    });

    expect(content.place.hours).toEqual({ monday: { open: '10:00', close: '18:00' } });
  });
});

describe('EMPTY_SALON_CONTENT', () => {
  it('is always safe to render (every collection empty, every scalar null-ish)', () => {
    expect(EMPTY_SALON_CONTENT.identity.name).toBe('');
    expect(EMPTY_SALON_CONTENT.people.technicians).toEqual([]);
    expect(EMPTY_SALON_CONTENT.catalog.services).toEqual([]);
    expect(EMPTY_SALON_CONTENT.catalog.featuredServices).toEqual([]);
    expect(EMPTY_SALON_CONTENT.place.locations).toEqual([]);
    expect(EMPTY_SALON_CONTENT.proof.portfolio).toEqual([]);
    expect(EMPTY_SALON_CONTENT.proof.reviews).toEqual([]);
  });
});
