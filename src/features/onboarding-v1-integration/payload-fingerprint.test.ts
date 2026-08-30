import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { fingerprintOnboardingPayload } from './payload-fingerprint';
import { createPersistableOnboardingDraft } from './snapshot';

describe('fingerprintOnboardingPayload', () => {
  it('is deterministic and changes with persisted customer-site content', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Isla Nail Studio';
    state.profile.businessStructure = 'solo';
    state.profile.ownerName = 'Daniela';
    state.recipe.starter = 'one_page';
    const document = initializeStarter('one_page', {
      siteId: 'local-site',
      siteName: state.profile.businessName,
    });
    const first = createPersistableOnboardingDraft(state, 'luster_berry', null, document);
    const reordered = JSON.parse(JSON.stringify(first.snapshot)) as typeof first.snapshot;
    const changed = structuredClone(first.snapshot);
    changed.profile.businessName = 'Changed Studio';

    expect(fingerprintOnboardingPayload(first.snapshot))
      .toBe(fingerprintOnboardingPayload(reordered));
    expect(fingerprintOnboardingPayload(first.snapshot))
      .not.toBe(fingerprintOnboardingPayload(changed));
  });
});
