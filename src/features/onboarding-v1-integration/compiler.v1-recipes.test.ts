import { describe, expect, it } from 'vitest';

import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import type {
  OriginStarter,
  SectionType,
  SiteBuilderDocument,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import {
  V1_STARTER_COMPILER_VERSION,
  V1_STARTER_RECIPE_VERSION,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/v1-starter-recipes';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { compileOnboardingToSiteDocument } from './compiler';
import { createPersistableOnboardingDraft } from './snapshot';

const ACCOUNT_SITE_ID = '11111111-1111-4111-8111-111111111111';

const addRealReview = (document: SiteBuilderDocument): SiteBuilderDocument => {
  const next = structuredClone(document);
  const reviewId = 'review-daniela-client';
  next.siteContent.reviews = [{
    authorName: 'Ana',
    id: reviewId,
    quote: 'Beautiful work and a thoughtful appointment.',
    rating: 5,
    source: 'client',
    visible: true,
  }];
  const reviews = next.pages
    .flatMap(page => page.sections)
    .find(section => section.sectionType === 'reviews');
  if (!reviews || reviews.sectionType !== 'reviews') {
    throw new Error('Compiler fixture needs a Reviews section.');
  }
  reviews.settings.reviewIds = [reviewId];
  return next;
};

const compileCompleteStarter = (starter: OriginStarter) => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.profile.about.shortBio = 'Detail-focused nail care in Toronto.';
  state.profile.bookingOnlyContact = true;
  state.profile.location.cityOrArea = 'Toronto';
  state.profile.location.locationType = 'salon_suite';
  state.profile.policies.other.custom = 'Please arrive with bare nails.';
  state.profile.policies.copy.other.visible = true;
  state.recipe.aboutEnabled = true;
  state.recipe.galleryEnabled = true;
  state.recipe.policiesEnabled = true;
  state.recipe.starter = starter;
  state.recipe.starterDocumentSiteId = `accepted-${starter}`;
  state.gallery.source = 'mock_luster';
  state.gallery.images = [{
    altText: 'Finished berry manicure',
    fileName: 'berry-manicure.webp',
    id: 'gallery-real-one',
    mimeType: 'image/webp',
    previewUrl: '/gallery/berry-manicure.webp',
    source: 'fixture',
  }];

  let source = initializeStarter(starter, {
    idFactory: createDeterministicIdFactory(`compiler-${starter}`),
    siteId: `accepted-${starter}`,
    siteName: state.profile.businessName,
  });
  if (starter !== 'quick_book') {
    source = addRealReview(source);
  }
  const { snapshot } = createPersistableOnboardingDraft(
    state,
    'luster_berry',
    null,
    source,
  );
  return {
    first: compileOnboardingToSiteDocument({
      revision: 1,
      siteId: ACCOUNT_SITE_ID,
      snapshot,
    }),
    second: compileOnboardingToSiteDocument({
      revision: 1,
      siteId: ACCOUNT_SITE_ID,
      snapshot,
    }),
  };
};

const pageTypes = (document: SiteBuilderDocument): SectionType[][] =>
  [...document.pages]
    .sort((left, right) => left.order - right.order)
    .map(page => [...page.sections]
      .sort((left, right) => left.order - right.order)
      .map(section => section.sectionType));

describe('compiled locked V1 starter recipes', () => {
  it.each([
    {
      expected: [['hero', 'gallery', 'booking', 'about', 'visit_us']],
      starter: 'quick_book',
    },
    {
      expected: [[
        'hero',
        'gallery',
        'about',
        'booking',
        'reviews',
        'policies',
        'visit_us',
      ]],
      starter: 'one_page',
    },
    {
      expected: [
        ['hero', 'reviews'],
        ['booking', 'policies'],
        ['gallery'],
        ['about'],
        ['visit_us'],
      ],
      starter: 'multi_page',
    },
  ] as const)(
    'persists only the locked $starter document and stamps its compiler contract',
    ({ expected, starter }) => {
      const { first, second } = compileCompleteStarter(starter);

      expect(first).toMatchObject({
        compilerVersion: V1_STARTER_COMPILER_VERSION,
        recipeMigrationResult: 'fresh_v1',
        recipeVersion: V1_STARTER_RECIPE_VERSION,
        starter,
      });
      expect(pageTypes(first.builderDocument)).toEqual(expected);
      expect(first.pages.map(page => page.sections.map(section => section.type)))
        .toEqual(expected);
      expect(second).toEqual(first);
    },
  );

  it('persists the exact five Multi-page destinations with no repeated content family', () => {
    const { first } = compileCompleteStarter('multi_page');

    expect(first.builderDocument.pages.map(page => [page.name, page.slug])).toEqual([
      ['Home', ''],
      ['Services & Booking', 'services-book'],
      ['Gallery', 'gallery'],
      ['About', 'about'],
      ['Contact', 'contact'],
    ]);

    const customerTypes = first.pages.flatMap(page =>
      page.sections.map(section => section.type));

    expect(new Set(customerTypes).size).toBe(customerTypes.length);
    expect(customerTypes.filter(type => type === 'booking')).toHaveLength(1);
    expect(customerTypes).not.toContain('featured_services');
    expect(customerTypes).not.toContain('deposits_cancellations');
    expect(customerTypes).not.toContain('footer');
    expect(customerTypes).not.toContain('final_cta');
    expect(customerTypes).not.toContain('section_navigation');
  });
});
