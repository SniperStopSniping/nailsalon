import { describe, expect, it } from 'vitest';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import { compileOnboardingToSiteDocument } from './compiler';
import { onboardingPersistedSnapshotSchema } from './contracts';
import { createSavedSitePreviewModel } from './saved-preview';
import { createPersistableOnboardingDraft } from './snapshot';

const createQuickBookDraft = () => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.profile.email = 'hello@islanails.example';
  state.profile.instagram = '@islanails';
  state.profile.bookingOnlyContact = false;
  state.profile.location.cityOrArea = 'Toronto';
  state.profile.location.addressVisibility = 'after_booking';
  state.profile.hours.setupState = 'configured';
  state.profile.hours.showOnSite = true;
  state.profile.hours.days.monday = {
    close: '19:00',
    closed: false,
    open: '10:00',
  };
  for (const day of [
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ] as const) {
    state.profile.hours.days[day] = {
      close: '',
      closed: true,
      open: '',
    };
  }
  state.profile.about.shortBio = 'Healthy nails and thoughtful appointments.';
  state.recipe.starter = 'quick_book';
  state.recipe.quickBookLayout = 'profile_story';
  state.recipe.quickBookProfile = {
    showBio: true,
    showBookingPolicy: false,
    showCancellationPolicy: true,
    // Stale compatibility switches deliberately disagree with the canonical
    // Screen 1/3/4 answers. Snapshot persistence must follow those answers.
    showEmail: false,
    showHours: false,
    showInstagram: false,
    showLocation: false,
    showPhone: false,
    showReviews: true,
    showTechName: false,
    showTechPhoto: false,
  };
  const document = initializeStarter('quick_book', {
    siteId: 'quick-book-profile-persistence',
    siteName: state.profile.businessName,
  });
  return { document, state };
};

describe('Quick Book profile presentation persistence', () => {
  it('persists canonical Screen 1/3/4 visibility without duplicating salon profile data', () => {
    const { document, state } = createQuickBookDraft();
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      null,
      document,
    );

    expect(snapshot.site.quickBookProfile).toEqual({
      ...state.recipe.quickBookProfile,
      showEmail: true,
      showHours: true,
      showInstagram: true,
      showLocation: true,
      showTechName: true,
      showTechPhoto: true,
    });
    expect(snapshot.site.quickBookLayout).toBe('profile_story');
    expect(snapshot.profile.email).toBe('hello@islanails.example');
    expect(snapshot.profile.about.shortBio).toBe(
      'Healthy nails and thoughtful appointments.',
    );
    expect(snapshot.site).not.toHaveProperty('email');
    expect(snapshot.site).not.toHaveProperty('bio');

    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: 'account-backed-quick-book',
      snapshot,
    });
    const saved = createSavedSitePreviewModel({ document: compiled, media: [], snapshot });

    expect(saved.state.recipe.quickBookProfile).toEqual(snapshot.site.quickBookProfile);
    expect(saved.state.recipe.quickBookLayout).toBe('profile_story');
    expect(saved.state.profile.email).toBe('hello@islanails.example');
    expect(saved.state.profile.about.shortBio).toBe(
      'Healthy nails and thoughtful appointments.',
    );
  });

  it('keeps saved values while public visibility follows privacy and contact choices', () => {
    const { document, state } = createQuickBookDraft();
    state.profile.bookingOnlyContact = true;
    state.profile.hours.showOnSite = false;
    state.profile.about.visibility.instagram = false;
    state.profile.about.visibility.owner_name = false;
    state.profile.about.visibility.profile_photo = false;

    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      null,
      document,
    );

    expect(snapshot.site.quickBookProfile).toMatchObject({
      showEmail: false,
      showHours: false,
      showInstagram: false,
      showLocation: true,
      showPhone: false,
      showTechName: false,
      showTechPhoto: false,
    });
    expect(snapshot.profile.email).toBe('hello@islanails.example');
    expect(snapshot.profile.instagram).toBe('@islanails');
    expect(snapshot.profile.hours.days.monday).toEqual({
      close: '19:00',
      closed: false,
      open: '10:00',
    });
  });

  it('defaults older account-backed snapshots to private Quick Book visibility', () => {
    const { document, state } = createQuickBookDraft();
    const persisted = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      null,
      document,
    ).snapshot;
    const legacy = structuredClone(persisted) as unknown as Record<string, unknown>;
    delete (legacy.site as Record<string, unknown>).quickBookProfile;
    delete (legacy.site as Record<string, unknown>).quickBookLayout;

    const parsed = onboardingPersistedSnapshotSchema.parse(legacy);

    expect(parsed.site.quickBookProfile).toEqual(DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY);
    expect(parsed.site.quickBookLayout).toBe('compact_dropdown');
    expect(parsed.profile.email).toBe('hello@islanails.example');
    expect(parsed.profile.about.shortBio).toBe(
      'Healthy nails and thoughtful appointments.',
    );
  });
});
