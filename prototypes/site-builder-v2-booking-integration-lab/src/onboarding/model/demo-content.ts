/**
 * Deterministic Isla-flavored demonstration content for owner-facing section
 * previews (Section Gallery, recipes). This is presentation-sample data only:
 * it never enters a persisted document, and surfaces that show it must label
 * it as sample content. Booking/services stay canonical — only profile-shaped
 * and siteContent-shaped sample values live here.
 */

import { CANONICAL_SERVICES } from '../../booking/data';
import type { SiteContentCollections } from '../../model/section-library/site-content';
import { createDefaultOnboardingState } from './defaults';
import { ONBOARDING_EXAMPLE_GALLERY_IMAGES } from './gallery-examples';
import type { OnboardingLabState } from './types';

export const DEMO_SITE_CONTENT: SiteContentCollections = {
  faq: [
    {
      answer: 'Come with bare nails if you can. If you have product on, book a removal add-on and we’ll take care of it gently.',
      id: 'demo-faq-prep',
      question: 'How should I prepare for my appointment?',
    },
    {
      answer: 'Gel manicures typically last two to three weeks depending on your nail growth and daily wear.',
      id: 'demo-faq-lasting',
      question: 'How long does a gel manicure last?',
    },
    {
      answer: 'Yes — bring a reference photo and we’ll adapt it to your nail shape and length.',
      id: 'demo-faq-inspo',
      question: 'Can I bring nail inspiration photos?',
    },
    {
      answer: 'Life happens! Give us 24 hours’ notice and we’ll rebook you with no charge.',
      id: 'demo-faq-reschedule',
      question: 'What if I need to reschedule?',
    },
  ],
  offers: [
    {
      actionLabel: 'Book your first visit',
      detail: 'New clients enjoy 15% off any manicure service on their first visit.',
      expiresAt: null,
      id: 'demo-offer-new-client',
      terms: 'First visit only. Not combinable with other offers.',
      title: 'New client welcome',
    },
    {
      actionLabel: 'Book a duo',
      detail: 'Bring a friend on a weekday morning and you each get a free add-on.',
      expiresAt: null,
      id: 'demo-offer-duo',
      terms: 'Weekdays before noon.',
      title: 'Bestie mornings',
    },
  ],
  reviews: [
    {
      authorName: 'Maya R.',
      id: 'demo-review-maya',
      quote: 'The most meticulous Russian manicure I’ve ever had. Three weeks later my nails still look freshly done.',
      rating: 5,
      source: 'google',
      visible: true,
    },
    {
      authorName: 'Jess T.',
      id: 'demo-review-jess',
      quote: 'Isla listened to exactly what I wanted and somehow made it even better. The studio feels so calm.',
      rating: 5,
      source: 'client',
      visible: true,
    },
    {
      authorName: 'Priya S.',
      id: 'demo-review-priya',
      quote: 'Booked chrome French tips for a wedding — flawless, and they lasted through the honeymoon.',
      rating: 5,
      source: 'google',
      visible: true,
    },
  ],
  staff: [
    {
      acceptsBookings: true,
      id: 'demo-staff-isla',
      name: 'Isla Moreno',
      specialties: ['Russian manicure', 'Detailed nail art'],
      title: 'Founder & lead nail artist',
    },
    {
      acceptsBookings: true,
      id: 'demo-staff-vy',
      name: 'Vy Tran',
      specialties: ['BIAB', 'Chrome finishes'],
      title: 'Senior nail artist',
    },
    {
      acceptsBookings: false,
      id: 'demo-staff-noor',
      name: 'Noor Haddad',
      specialties: ['Classic manicures'],
      title: 'Apprentice artist',
    },
  ],
};

const DEMO_OPEN_DAY = { close: '18:00', closed: false, open: '10:00' };
const DEMO_CLOSED_DAY = { close: '', closed: true, open: '' };

/**
 * A fully configured owner state: every shared authority a section can bind
 * to has believable content, so every library section demonstrates its real
 * populated appearance.
 */
export const createDemoOnboardingState = (): OnboardingLabState => {
  const state = createDefaultOnboardingState();

  return {
    ...state,
    gallery: {
      ...state.gallery,
      images: [...ONBOARDING_EXAMPLE_GALLERY_IMAGES],
      source: 'mock_luster',
    },
    profile: {
      ...state.profile,
      about: {
        ...state.profile.about,
        // No demo portrait exists, and a monogram at portrait scale reads as
        // a missing image; the About section shows its copy instead.
        visibility: { ...state.profile.about.visibility, profile_photo: false },
        shortBio: 'Precision nail care in a calm Leslieville studio — thoughtful shaping, long-wearing gel, and art that suits you.',
        specialties: ['Russian manicure', 'BIAB', 'Detailed nail art'],
        yearsOfExperience: '8 years',
      },
      bookingPreferences: {
        ...state.profile.bookingPreferences,
        minimumNoticeMinutes: 720,
        newClientStatus: 'yes',
        visitMode: 'appointment_only',
      },
      businessName: 'Isla Nail Studio',
      businessStructure: 'multi_tech',
      clientContact: {
        ...state.profile.clientContact,
        primaryNumber: '(437) 555-0155',
        textEnabled: true,
      },
      hours: {
        days: {
          friday: { ...DEMO_OPEN_DAY },
          monday: { ...DEMO_CLOSED_DAY },
          saturday: { close: '16:00', closed: false, open: '10:00' },
          sunday: { ...DEMO_CLOSED_DAY },
          thursday: { close: '20:00', closed: false, open: '10:00' },
          tuesday: { ...DEMO_OPEN_DAY },
          wednesday: { ...DEMO_OPEN_DAY },
        },
        setupState: 'configured',
        showOnSite: true,
      },
      instagram: 'islanailstudio',
      location: {
        ...state.profile.location,
        addressVisibility: 'public',
        cityOrArea: 'Leslieville, Toronto',
        entranceInstructions: 'Street-level entrance beside the plant shop.',
        exactAddress: '1189 Queen St E, Toronto',
        locationType: 'salon_suite',
        parking: 'Free street parking on Curzon St.',
        transitInformation: 'Two minutes from the 501 Queen streetcar.',
      },
      ownerName: 'Isla Moreno',
      policies: {
        ...state.profile.policies,
        cancellations: {
          ...state.profile.policies.cancellations,
          consequence: 'deposit_lost',
          notice: '24_hours',
        },
        lateArrivals: {
          gracePeriodMinutes: '15',
          rescheduleAfterLimit: true,
          shortenService: true,
        },
        noShows: {
          ...state.profile.policies.noShows,
          loseDeposit: true,
        },
        repairs: {
          ...state.profile.policies.repairs,
          conditions: 'Chips or lifting within the window, with the original service receipt.',
          freeRepairWindowDays: '5',
        },
        copy: {
          ...state.profile.policies.copy,
          cancellations: {
            ...state.profile.policies.copy.cancellations,
            useSuggestedWording: false,
            visible: true,
            wordingOverride: 'Plans change — reschedule or cancel up to 24 hours before your appointment and your deposit moves with you.',
          },
          deposits: {
            ...state.profile.policies.copy.deposits,
            useSuggestedWording: false,
            visible: true,
            wordingOverride: 'A $30 deposit books your seat and comes off your service total.',
          },
          late_arrivals: {
            ...state.profile.policies.copy.late_arrivals,
            useSuggestedWording: false,
            visible: true,
            wordingOverride: 'Running late? We hold your appointment for 15 minutes; after that we may need to shorten or rebook your service.',
          },
          no_shows: {
            ...state.profile.policies.copy.no_shows,
            useSuggestedWording: false,
            visible: true,
            wordingOverride: 'Missed appointments without notice forfeit the deposit.',
          },
          repairs: {
            ...state.profile.policies.copy.repairs,
            useSuggestedWording: false,
            visible: true,
            wordingOverride: 'Chips or lifting within 5 days? Come back and we’ll repair it free.',
          },
        },
        deposits: {
          ...state.profile.policies.deposits,
          amountCents: 3000,
          mode: 'fixed',
          refundable: false,
          transferable: true,
        },
      },
      preferredContact: 'instagram',
      serviceMenu: {
        ...state.profile.serviceMenu,
        reviewed: true,
        selectedServiceIds: CANONICAL_SERVICES.map(service => service.id),
      },
    },
  };
};

export const DEMO_FEATURED_SERVICE_IDS: readonly string[] = CANONICAL_SERVICES
  .filter(service => service.featured)
  .map(service => service.id);
