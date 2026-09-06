import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { compileOnboardingToSiteDocument } from './compiler';
import { onboardingPersistedSnapshotSchema } from './contracts';
import { createSavedSitePreviewModel } from './saved-preview';
import { createPersistableOnboardingDraft } from './snapshot';

describe('onboarding persisted owner name boundary', () => {
  const teamSalonState = () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'AUDIT Repro Team Salon';
    state.profile.businessType = 'salon_team';
    state.profile.businessStructure = 'multi_tech';
    state.profile.location.cityOrArea = 'Toronto';
    state.recipe.starter = 'quick_book';
    return state;
  };

  it('accepts a Salon/studio snapshot whose owner name was never asked for', () => {
    // OP-001: Basics hides the personal owner-name field for `salon_team`, so
    // requiring it here blocked the whole account gate.
    const state = teamSalonState();
    state.profile.ownerName = '';

    const { snapshot } = createPersistableOnboardingDraft(state, 'luster_berry');

    expect(snapshot.profile.ownerName).toBe('');
    expect(onboardingPersistedSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('still requires the owner name for the personal business types that ask for it', () => {
    for (const businessType of ['independent_salon', 'home_based', 'mobile'] as const) {
      const state = teamSalonState();
      state.profile.businessType = businessType;
      state.profile.businessStructure = 'solo';
      state.profile.ownerName = 'Maya';
      const { snapshot } = createPersistableOnboardingDraft(state, 'luster_berry');

      expect(onboardingPersistedSnapshotSchema.safeParse(snapshot).success).toBe(true);

      const withoutOwnerName = onboardingPersistedSnapshotSchema.safeParse({
        ...snapshot,
        profile: { ...snapshot.profile, ownerName: '' },
      });

      expect(withoutOwnerName.success).toBe(false);
      expect(withoutOwnerName.error?.issues.map(issue => issue.path.join('.')))
        .toContain('profile.ownerName');
    }
  });
});

describe('onboarding persisted location boundary', () => {
  it('keeps setup-default provenance local while saving canonical address and contact choices', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Maya Test Atelier';
    state.profile.ownerName = 'Maya';
    state.profile.businessType = 'independent_salon';
    state.profile.businessStructure = 'solo';
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.exactAddress = '100 Test Avenue';
    state.recipe.starter = 'quick_book';

    const { snapshot } = createPersistableOnboardingDraft(state, 'luster_berry');

    expect(snapshot.profile.location).not.toHaveProperty('addressVisibilityDefaulted');
    expect(snapshot.profile.location).toMatchObject({
      addressVisibility: 'public',
      cityOrArea: 'Toronto',
      exactAddress: '100 Test Avenue',
    });
    expect(snapshot.profile.bookingOnlyContact).toBe(false);
    expect(onboardingPersistedSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(state.profile.location.addressVisibilityDefaulted).toBe(true);
  });

  it('preserves mobile service areas through the strict snapshot contract', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Maya Mobile Nails';
    state.profile.ownerName = 'Maya';
    state.profile.businessType = 'mobile';
    state.profile.businessStructure = 'solo';
    state.profile.location.locationType = 'mobile_service';
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.serviceAreas = 'North York, Scarborough and nearby neighbourhoods';
    state.recipe.starter = 'quick_book';

    const builderDocument = initializeStarter('quick_book');
    const { snapshot } = createPersistableOnboardingDraft(state, 'luster_berry', null, builderDocument);
    const restored = onboardingPersistedSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
    const document = compileOnboardingToSiteDocument({ revision: 1, siteId: 'mobile-service-area-test', snapshot: restored });
    const saved = createSavedSitePreviewModel({ document, media: [], snapshot: restored });

    expect(restored.profile.location.serviceAreas).toBe(state.profile.location.serviceAreas);
    expect(saved.state.profile.location.serviceAreas).toBe(state.profile.location.serviceAreas);
    expect(restored.profile.location).not.toHaveProperty('addressVisibilityDefaulted');
    expect(onboardingPersistedSnapshotSchema.safeParse({
      ...snapshot,
      profile: { ...snapshot.profile, location: { ...snapshot.profile.location, serviceAreas: 'x'.repeat(2_001) } },
    }).success).toBe(false);
  });
});
