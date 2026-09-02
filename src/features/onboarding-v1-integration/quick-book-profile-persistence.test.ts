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
  state.profile.about.shortBio = 'Healthy nails and thoughtful appointments.';
  state.recipe.starter = 'quick_book';
  state.recipe.quickBookProfile = {
    showBio: true,
    showBookingPolicy: false,
    showCancellationPolicy: true,
    showEmail: true,
    showHours: false,
    showInstagram: true,
    showLocation: true,
    showPhone: false,
    showReviews: true,
    showTechName: true,
    showTechPhoto: false,
  };
  const document = initializeStarter('quick_book', {
    siteId: 'quick-book-profile-persistence',
    siteName: state.profile.businessName,
  });
  return { document, state };
};

describe('Quick Book profile presentation persistence', () => {
  it('round-trips all visibility choices without duplicating salon profile data', () => {
    const { document, state } = createQuickBookDraft();
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      null,
      document,
    );

    expect(snapshot.site.quickBookProfile).toEqual(state.recipe.quickBookProfile);
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

    expect(saved.state.recipe.quickBookProfile).toEqual(state.recipe.quickBookProfile);
    expect(saved.state.profile.email).toBe('hello@islanails.example');
    expect(saved.state.profile.about.shortBio).toBe(
      'Healthy nails and thoughtful appointments.',
    );
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

    const parsed = onboardingPersistedSnapshotSchema.parse(legacy);

    expect(parsed.site.quickBookProfile).toEqual(DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY);
    expect(parsed.profile.email).toBe('hello@islanails.example');
    expect(parsed.profile.about.shortBio).toBe(
      'Healthy nails and thoughtful appointments.',
    );
  });
});
