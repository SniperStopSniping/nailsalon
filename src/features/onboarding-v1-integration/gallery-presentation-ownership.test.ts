import { describe, expect, it } from 'vitest';

import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { compileOnboardingToSiteDocument } from './compiler';
import { createPersistableOnboardingDraft } from './snapshot';

const SITE_ID = '11111111-1111-4111-8111-111111111111';

describe('account-backed Gallery presentation ownership', () => {
  it('round-trips stable provenance after customer-facing labels are exchanged', () => {
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
    const supporting = galleries.find(
      section => section.galleryPresentationOwner === 'recipe',
    );
    const primary = galleries.find(
      section => section.galleryPresentationOwner === 'onboarding',
    );
    if (!supporting || !primary) {
      throw new Error('Missing starter Galleries.');
    }
    supporting.label = 'Portfolio';
    primary.label = 'Featured work';

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

    expect(compiledGalleries.find(section => section.id === supporting.id))
      .toMatchObject({
        galleryPresentationOwner: 'recipe',
        label: 'Portfolio',
        settings: { preset: 'editorial' },
      });
    expect(compiledGalleries.find(section => section.id === primary.id))
      .toMatchObject({
        galleryPresentationOwner: 'onboarding',
        label: 'Featured work',
        settings: { preset: 'carousel' },
      });
  });
});
