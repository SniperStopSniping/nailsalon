import { describe, expect, it } from 'vitest';

import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { compileOnboardingToSiteDocument } from './compiler';
import { createPersistableOnboardingDraft } from './snapshot';

const SITE_ID = '11111111-1111-4111-8111-111111111111';

describe('account-backed Gallery presentation ownership', () => {
  it('round-trips one stable onboarding-owned Gallery without a duplicate presentation', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Isla Nail Studio';
    state.profile.businessStructure = 'solo';
    state.profile.ownerName = 'Daniela';
    state.recipe.starter = 'multi_page';
    state.recipe.starterDocumentSiteId = 'site_multi_page';
    state.gallery.layout = 'carousel';
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('gallery-provenance-compile'),
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    const galleries = source.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');
    const gallery = galleries[0];
    if (!gallery) {
      throw new Error('Missing starter Gallery.');
    }

    expect(galleries).toHaveLength(1);
    expect(gallery.galleryPresentationOwner).toBe('onboarding');

    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      source,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    });
    const compiledGalleries = compiled.builderDocument.pages
      .flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery');

    expect(compiledGalleries).toHaveLength(1);
    expect(compiledGalleries[0]).toMatchObject({
      galleryPresentationOwner: 'onboarding',
      id: gallery.id,
      label: 'Gallery',
      settings: { preset: 'carousel' },
    });
  });
});
