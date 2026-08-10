import { describe, expect, it } from 'vitest';

import {
  EMPTY_SALON_CONTENT,
  resolveSalonContent,
  type ResolveSalonContentInput,
} from './salonContent';

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
