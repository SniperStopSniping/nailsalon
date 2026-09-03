import { describe, expect, it } from 'vitest';

import { createDefaultOnboardingState } from '../onboarding/model/defaults';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../onboarding/model/site-library-context';
import { createDeterministicIdFactory } from './ids';
import { isLibrarySectionType } from './section-library/registry';
import {
  createBookingSectionInstance,
  createLibrarySectionInstance,
  initializeStarter,
} from './starters';
import type {
  OriginStarter,
  PageDocument,
  SectionInstance,
  SectionType,
  SiteBuilderDocument,
} from './types';
import {
  reconcileV1StarterDocument,
  V1_STARTER_COMPILER_VERSION,
  V1_STARTER_RECIPE_VERSION,
} from './v1-starter-recipes';

const LEGACY_SHAPES: Record<OriginStarter, readonly {
  name: string;
  slug: string;
  types: readonly SectionType[];
}[]> = {
  quick_book: [{
    name: 'Home',
    slug: '',
    types: ['announcement_bar', 'hero', 'featured_services', 'booking', 'final_cta', 'footer'],
  }],
  one_page: [{
    name: 'Home',
    slug: '',
    types: [
      'announcement_bar',
      'hero',
      'quick_info',
      'section_navigation',
      'about',
      'featured_services',
      'gallery',
      'reviews',
      'deposits_cancellations',
      'policies',
      'visit_us',
      'booking',
      'final_cta',
      'footer',
    ],
  }],
  multi_page: [
    {
      name: 'Home',
      slug: '',
      types: [
        'announcement_bar',
        'hero',
        'quick_info',
        'featured_services',
        'gallery',
        'reviews',
        'final_cta',
        'footer',
      ],
    },
    {
      name: 'Services / Book',
      slug: 'services-book',
      types: ['booking', 'deposits_cancellations', 'policies', 'faq', 'footer'],
    },
    {
      name: 'Gallery',
      slug: 'gallery',
      types: ['gallery', 'final_cta', 'footer'],
    },
    {
      name: 'Team',
      slug: 'team',
      types: ['team', 'about', 'footer'],
    },
    {
      name: 'Contact',
      slug: 'contact',
      types: ['visit_us', 'hours', 'contact', 'footer'],
    },
  ],
};

const pageTypes = (document: SiteBuilderDocument): SectionType[][] =>
  [...document.pages]
    .sort((left, right) => left.order - right.order)
    .map(page => [...page.sections]
      .sort((left, right) => left.order - right.order)
      .map(section => section.sectionType));

const createLegacySection = (
  type: SectionType,
  order: number,
  idFactory: ReturnType<typeof createDeterministicIdFactory>,
): SectionInstance => {
  if (type === 'booking') {
    return createBookingSectionInstance(idFactory, { order });
  }
  if (!isLibrarySectionType(type)) {
    throw new Error(`Legacy recipe fixture cannot create ${type}.`);
  }
  return createLibrarySectionInstance(type, idFactory, { order });
};

const createLegacyDocument = (starter: OriginStarter): SiteBuilderDocument => {
  const idFactory = createDeterministicIdFactory(`legacy-${starter}`);
  const source = initializeStarter(starter, {
    idFactory,
    siteId: `site-${starter}`,
    siteName: 'Isla Nail Studio',
  });
  const pages = LEGACY_SHAPES[starter].map((shape, pageOrder): PageDocument => {
    const existing = source.pages[pageOrder];
    if (!existing) {
      throw new Error(`Missing ${starter} fixture page ${pageOrder}.`);
    }
    return {
      ...existing,
      isHome: pageOrder === 0,
      name: shape.name,
      order: pageOrder,
      sections: shape.types.map((type, order) =>
        createLegacySection(type, order, idFactory)),
      slug: shape.slug,
    };
  });
  return {
    ...source,
    navigation: {
      ...source.navigation,
      enabled: starter !== 'quick_book',
      items: pages.map((page, order) => ({
        id: `legacy-${starter}-navigation-${order}`,
        label: page.name,
        order,
        pageId: page.id,
      })),
    },
    pages,
  };
};

const addRealReview = (document: SiteBuilderDocument): SiteBuilderDocument => {
  const next = structuredClone(document);
  const reviewId = 'review-real-client';
  next.siteContent.reviews = [{
    authorName: 'Ana',
    id: reviewId,
    quote: 'The care and finish were excellent.',
    rating: 5,
    source: 'client',
    visible: true,
  }];
  const reviews = next.pages
    .flatMap(page => page.sections)
    .find(section => section.sectionType === 'reviews');
  if (!reviews || reviews.sectionType !== 'reviews') {
    throw new Error('Review fixture needs a Reviews section.');
  }
  reviews.settings.reviewIds = [reviewId];
  return next;
};

const recipeInput = (
  document: SiteBuilderDocument,
  options: {
    gallery?: boolean;
    policies?: boolean;
    structure?: 'multi_tech' | 'solo';
  } = {},
) => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = options.structure ?? 'solo';
  state.profile.ownerName = 'Daniela';
  state.profile.bookingOnlyContact = true;
  state.recipe.aboutEnabled = true;
  state.recipe.galleryEnabled = options.gallery ?? true;
  state.recipe.policiesEnabled = options.policies ?? false;
  if (state.recipe.galleryEnabled) {
    state.gallery.source = 'mock_luster';
    state.gallery.images = [{
      altText: 'Finished berry manicure',
      fileName: 'berry-manicure.webp',
      id: 'gallery-real-one',
      mimeType: 'image/webp',
      previewUrl: '/gallery/berry-manicure.webp',
      source: 'fixture',
    }];
  }
  if (state.recipe.policiesEnabled) {
    state.profile.policies.other.custom = 'Please arrive with bare nails.';
    state.profile.policies.copy.other.visible = true;
  }
  return {
    context: deriveSiteLibraryContext(state, document),
    toggles: deriveSitePlanToggles(state),
  };
};

describe('locked V1 starter recipes', () => {
  it('materializes compact Profile, Booking, optional work proof, and Visit for Quick Book', () => {
    expect(pageTypes(initializeStarter('quick_book'))).toEqual([[
      'hero',
      'booking',
      'gallery',
      'visit_us',
    ]]);
  });

  it('materializes the seven-slot One-page order without site-shell sections', () => {
    expect(pageTypes(initializeStarter('one_page'))).toEqual([[
      'hero',
      'gallery',
      'about',
      'booking',
      'reviews',
      'policies',
      'visit_us',
    ]]);
  });

  it('materializes exactly five Multi-page destinations without repeating a content family', () => {
    const document = initializeStarter('multi_page');

    expect(document.pages.map(page => [page.name, page.slug])).toEqual([
      ['Home', ''],
      ['Services & Booking', 'services-book'],
      ['Gallery', 'gallery'],
      ['About', 'about'],
      ['Contact', 'contact'],
    ]);
    expect(pageTypes(document)).toEqual([
      ['hero', 'reviews'],
      ['booking', 'policies'],
      ['gallery'],
      ['about'],
      ['visit_us'],
    ]);

    const allTypes = pageTypes(document).flat();

    expect(new Set(allTypes).size).toBe(allTypes.length);
  });

  it('removes the duplicate featured-service rail while migrating every legacy starter', () => {
    for (const starter of ['quick_book', 'one_page', 'multi_page'] as const) {
      const legacy = createLegacyDocument(starter);
      const reconciled = reconcileV1StarterDocument(legacy, recipeInput(legacy)).document;
      const booking = reconciled.pages
        .flatMap(page => page.sections)
        .find(section => section.sectionType === 'booking');
      if (booking?.sectionType !== 'booking') {
        throw new Error(`${starter} is missing Booking.`);
      }

      if (booking.settings.layout !== 'visual_grid') {
        throw new Error(`${starter} must use the Visual Grid fixture.`);
      }

      expect(booking.settings.layoutSettings.showFeatured).toBe(false);
    }
  });

  it('reconciles the One-page recipe to five, six, or seven real sections as optional content becomes publishable', () => {
    const fiveSource = initializeStarter('one_page', { siteId: 'site-one-five' });
    const five = reconcileV1StarterDocument(fiveSource, recipeInput(fiveSource, {
      gallery: true,
      policies: false,
    })).document;

    const sixSource = addRealReview(initializeStarter('one_page', { siteId: 'site-one-six' }));
    const six = reconcileV1StarterDocument(sixSource, recipeInput(sixSource, {
      gallery: true,
      policies: false,
    })).document;

    const sevenSource = addRealReview(initializeStarter('one_page', { siteId: 'site-one-seven' }));
    const seven = reconcileV1StarterDocument(sevenSource, recipeInput(sevenSource, {
      gallery: true,
      policies: true,
    })).document;

    expect(pageTypes(five)).toEqual([['hero', 'gallery', 'about', 'booking', 'visit_us']]);
    expect(pageTypes(six)).toEqual([['hero', 'gallery', 'about', 'booking', 'reviews', 'visit_us']]);
    expect(pageTypes(seven)).toEqual([[
      'hero',
      'gallery',
      'about',
      'booking',
      'reviews',
      'policies',
      'visit_us',
    ]]);
  });
});

describe('legacy starter recipe migration', () => {
  it.each([
    { legacyCount: 6, starter: 'quick_book' },
    { legacyCount: 14, starter: 'one_page' },
    { legacyCount: 23, starter: 'multi_page' },
  ] as const)('migrates the untouched $legacyCount-section $starter recipe', ({ legacyCount, starter }) => {
    let legacy = createLegacyDocument(starter);
    if (starter !== 'quick_book') {
      legacy = addRealReview(legacy);
    }

    expect(legacy.pages.flatMap(page => page.sections)).toHaveLength(legacyCount);

    const result = reconcileV1StarterDocument(legacy, recipeInput(legacy, {
      gallery: true,
      policies: true,
    }));

    expect(result).toMatchObject({
      compilerVersion: V1_STARTER_COMPILER_VERSION,
      migrationResult: 'migrated_legacy_recipe',
      recipeVersion: V1_STARTER_RECIPE_VERSION,
    });
    expect(pageTypes(result.document)).toEqual(starter === 'quick_book'
      ? [['hero', 'booking', 'gallery', 'visit_us']]
      : starter === 'one_page'
        ? [[
            'hero',
            'gallery',
            'about',
            'booking',
            'reviews',
            'policies',
            'visit_us',
          ]]
        : [
            ['hero', 'reviews'],
            ['booking', 'policies'],
            ['gallery'],
            ['about'],
            ['visit_us'],
          ]);
  });

  it('preserves retained page and section identities and is document-idempotent', () => {
    const legacy = addRealReview(createLegacyDocument('multi_page'));
    const originalGalleryPage = legacy.pages.find(page => page.slug === 'gallery');
    const originalTeamPage = legacy.pages.find(page => page.slug === 'team');
    const originalGallery = originalGalleryPage?.sections.find(
      section => section.sectionType === 'gallery',
    );
    const originalAbout = originalTeamPage?.sections.find(
      section => section.sectionType === 'about',
    );
    if (!originalGalleryPage || !originalTeamPage || !originalGallery || !originalAbout) {
      throw new Error('Legacy multi-page fixture is incomplete.');
    }
    const input = recipeInput(legacy, { gallery: true, policies: true });

    const first = reconcileV1StarterDocument(legacy, input);
    const second = reconcileV1StarterDocument(first.document, input);
    const galleryPage = first.document.pages.find(page => page.slug === 'gallery');
    const aboutPage = first.document.pages.find(page => page.slug === 'about');

    expect(galleryPage?.id).toBe(originalGalleryPage.id);
    expect(galleryPage?.sections[0]?.id).toBe(originalGallery.id);
    expect(aboutPage?.id).toBe(originalTeamPage.id);
    expect(aboutPage?.sections[0]?.id).toBe(originalAbout.id);
    expect(second.document).toEqual(first.document);
    expect(second.migrationResult).toBe('fresh_v1');
  });

  it('migrates the untouched five-slot Quick Book recipe without losing retained section IDs', () => {
    const source = initializeStarter('quick_book', { siteId: 'site-quick-book-v1' });
    const home = source.pages[0];
    if (!home) {
      throw new Error('Quick Book fixture has no Home page.');
    }
    const hero = home.sections.find(section => section.sectionType === 'hero');
    const gallery = home.sections.find(section => section.sectionType === 'gallery');
    const booking = home.sections.find(section => section.sectionType === 'booking');
    if (!hero || !gallery || !booking) {
      throw new Error('Quick Book v2 fixture is incomplete.');
    }
    const ids = createDeterministicIdFactory('quick-book-v1-slots');
    const about = createLibrarySectionInstance('about', ids, { order: 3 });
    const visit = createLibrarySectionInstance('visit_us', ids, {
      label: 'Visit & Contact',
      order: 4,
      presetId: 'compact_info',
    });
    source.pages[0]!.sections = [
      { ...hero, label: 'Salon intro', order: 0 },
      { ...gallery, order: 1 },
      { ...booking, order: 2 },
      about,
      visit,
    ];

    const result = reconcileV1StarterDocument(source, recipeInput(source, {
      gallery: true,
    }));

    expect(result.migrationResult).toBe('migrated_legacy_recipe');
    expect(pageTypes(result.document)).toEqual([[
      'hero',
      'booking',
      'gallery',
      'visit_us',
    ]]);
    expect(result.document.pages[0]?.sections.map(section => section.id)).toEqual([
      hero.id,
      booking.id,
      gallery.id,
      visit.id,
    ]);
    expect(result.document.pages[0]?.sections[0]?.label).toBe('Salon intro');
  });

  it('adds the stable Visit & Contact slot to an untouched v2 Quick Book document', () => {
    const source = initializeStarter('quick_book', { siteId: 'site-quick-book-v2' });
    source.pages[0]!.sections = source.pages[0]!.sections
      .filter(section => section.sectionType !== 'visit_us')
      .map((section, order) => ({ ...section, order }));
    const retainedIds = source.pages[0]!.sections.map(section => section.id);

    const result = reconcileV1StarterDocument(source, recipeInput(source, {
      gallery: true,
    }));

    expect(result.migrationResult).toBe('migrated_legacy_recipe');
    expect(pageTypes(result.document)).toEqual([[
      'hero',
      'booking',
      'gallery',
      'visit_us',
    ]]);
    expect(result.document.pages[0]?.sections.slice(0, 3).map(section => section.id))
      .toEqual(retainedIds);
    expect(result.document.pages[0]?.sections[3]?.id)
      .toBe('site-quick-book-v2:recipe-v3:home:visit_us');
  });

  it('does not migrate an old shape after a deliberate Builder edit', () => {
    const edited = createLegacyDocument('quick_book');
    const hero = edited.pages[0]?.sections.find(section => section.sectionType === 'hero');
    if (!hero) {
      throw new Error('Legacy Quick Book fixture has no Hero.');
    }
    hero.label = 'My deliberately edited introduction';

    const result = reconcileV1StarterDocument(edited, recipeInput(edited));

    expect(result.migrationResult).toBe('preserved_manual_edits');
    expect(result.document).toEqual(edited);
  });

  it('does not restore a V1 core section the owner deliberately removed', () => {
    const edited = initializeStarter('one_page', { siteId: 'site-manual-remove' });
    const gallery = edited.pages[0]?.sections.find(section => section.sectionType === 'gallery');
    if (!gallery) {
      throw new Error('One-page fixture has no Gallery.');
    }
    edited.pages[0]!.sections = edited.pages[0]!.sections
      .filter(section => section.id !== gallery.id)
      .map((section, order) => ({ ...section, order }));
    edited.unusedSections = [{ ...gallery, order: 0 }];

    const result = reconcileV1StarterDocument(edited, recipeInput(edited, { gallery: true }));

    expect(result.migrationResult).toBe('preserved_manual_edits');
    expect(result.document).toEqual(edited);
  });

  it('does not overwrite a deliberate section rename in an existing V1 document', () => {
    const edited = initializeStarter('one_page', { siteId: 'site-manual-label' });
    const hero = edited.pages[0]?.sections.find(section => section.sectionType === 'hero');
    if (!hero) {
      throw new Error('One-page fixture has no Hero.');
    }
    hero.label = 'Daniela’s welcome';

    const result = reconcileV1StarterDocument(edited, recipeInput(edited));

    expect(result.migrationResult).toBe('preserved_manual_edits');
    expect(result.document).toEqual(edited);
  });

  it('does not reorder a V1 document after an owner moves core sections', () => {
    const edited = initializeStarter('quick_book', { siteId: 'site-manual-order' });
    const sections = [...edited.pages[0]!.sections];
    const gallery = sections.find(section => section.sectionType === 'gallery');
    const booking = sections.find(section => section.sectionType === 'booking');
    if (!gallery || !booking) {
      throw new Error('Quick Book fixture is incomplete.');
    }
    const moved = sections.filter(section => section.id !== gallery.id);
    const bookingIndex = moved.findIndex(section => section.id === booking.id);
    moved.splice(bookingIndex, 0, gallery);
    edited.pages[0]!.sections = moved.map((section, order) => ({ ...section, order }));

    const result = reconcileV1StarterDocument(edited, recipeInput(edited));

    expect(result.migrationResult).toBe('preserved_manual_edits');
    expect(result.document).toEqual(edited);
  });
});
