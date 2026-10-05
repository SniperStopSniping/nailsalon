/** Local-only fixtures. This module has no storage or production data access. */
import { createMenuFixture } from '../../booking/helpers';
import { createDanielaFixtureState } from '../fixtures';
import { createOnboardingBookingFixture } from '../model/booking-preview';
import { deriveDepositPolicySummary } from '../model/policies';
import { resolveQuickBookProfile } from '../model/quick-book-profile';
import { buildLabQuickBookPresentationProfile } from '../quick-book/lab-presentation';
import type { ApprovedQuickBookLayout } from './ApprovedQuickBookComposition';

export function createQuickBookFixture(layout: ApprovedQuickBookLayout, scenario: string) {
  const state = createDanielaFixtureState();
  state.recipe.starter = 'quick_book';
  state.recipe.quickBookLayout = layout;
  state.reviewOptions.previewTimestamp = '2026-10-03T15:00:00.000Z';
  const view = resolveQuickBookProfile({ profile: state.profile, visibility: { ...state.recipe.quickBookProfile, showBio: true, showBookingPolicy: true, showCancellationPolicy: true }, previewTimestamp: state.reviewOptions.previewTimestamp });
  const profile = buildLabQuickBookPresentationProfile({
    layout,
    profile: state.profile,
    view,
    logoUrl: null,
    profilePhotoUrl: '/assets/images/tech-daniela.jpeg',
    coverUrl: '/assets/images/services/manicure-russian-clean.webp',
    gallery: [],
    websiteCopy: null,
    bioVisible: true,
  });
  const match = scenario.match(/^facts-(\d+)$/u);
  if (match) {
    const count = Number(match[1]);
    if (count === 0) {
      profile.location = null;
    }
    if (count < 2) {
      profile.hours = null;
    }
    profile.presentation.newClients = count >= 3 ? 'Accepting new clients' : null;
    // This synthetic review aggregate exists ONLY to stress-test optional data.
    profile.reviews = count >= 4 ? { ratingText: '4.8', reviewCountText: '24 fixture reviews', href: null } : null;
    profile.presentation.bookingMethod = count >= 5 ? 'Appointment only' : null;
  }
  if (scenario.startsWith('logo-')) {
    profile.identity.logoUrl = '/quick-book-logo-fixture.png';
  }
  if (scenario === 'long-name' || scenario === 'logo-long-name') {
    profile.identity.salonName = 'Isla Nail Studio & Advanced Manicure Atelier Scarborough';
    profile.identity.technicianName = 'Daniela Alexandra Rodriguez';
  }
  if (scenario === 'long-facts') {
    profile.location = { name: null, addressLine: null, localityLine: 'Scarborough Town Centre, Greater Toronto Area, Ontario', directionsUrl: null, instructionLines: ['Exact address shared after booking.'] };
    profile.hours = { statusLabel: 'Closed for an extended studio break', todayLabel: 'Opens Monday at 10 AM; advance booking is required', weekly: view.hours?.weekly.map(row => ({ day: row.label, value: row.hours })) ?? [] };
  }
  if (scenario === 'missing-media' || scenario === 'expired-media') {
    profile.identity.logoUrl = null;
    profile.presentation.portrait = scenario === 'expired-media' ? { kind: 'custom', url: '/unavailable-portrait.jpg', alt: 'Unavailable fixture portrait', focal: null } : { kind: 'default' };
    profile.presentation.cover = scenario === 'expired-media' ? { kind: 'custom', url: '/unavailable-cover.jpg', focal: null } : { kind: 'default' };
  }
  if (scenario === 'hidden-media') {
    profile.identity.logoUrl = null;
    profile.presentation.portrait = { kind: 'none' };
    profile.presentation.cover = null;
  }
  const menu = createOnboardingBookingFixture(state.profile, createMenuFixture({ imageFixture: scenario === 'no-service-images' ? 'no_images' : 'image_rich' }));
  return { profile, menu, depositSummary: deriveDepositPolicySummary(state.profile.policies) };
}
