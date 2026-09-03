import { describe, expect, it } from 'vitest';

import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { createPersistableOnboardingDraft } from './snapshot';

describe('canonical onboarding booking settings', () => {
  it('includes routing, timezone, and minimum notice in the account-backed snapshot', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Daniela Private Studio';
    state.profile.businessStructure = 'solo';
    state.profile.businessType = 'home_based';
    state.profile.ownerName = 'Daniela';
    state.profile.siteSlug = 'daniela-private-studio';
    state.profile.siteSlugCustomized = true;
    state.profile.timeZone = 'America/Vancouver';
    state.profile.bookingPreferences.minimumNoticeMinutes = 480;
    state.recipe.starter = 'quick_book';

    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
    );

    expect(snapshot.profile).toMatchObject({
      bookingPreferences: { minimumNoticeMinutes: 480 },
      businessType: 'home_based',
      siteSlug: 'daniela-private-studio',
      siteSlugCustomized: true,
      timeZone: 'America/Vancouver',
    });
  });
});
