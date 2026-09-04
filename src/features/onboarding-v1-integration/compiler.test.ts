import { createDefaultBookingPresentationSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/booking/presentation';
import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import { createDeterministicIdFactory } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/ids';
import {
  addSection,
  moveSectionToPage,
  removeSection,
  setSectionVisible,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/operations';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import {
  compileOnboardingToSiteDocument,
  resolveProductionServiceSelection,
} from './compiler';
import { onboardingDraftClaimRequestSchema } from './contracts';
import { createPersistableOnboardingDraft } from './snapshot';

const SITE_ID = '11111111-1111-4111-8111-111111111111';

const acceptedState = (starter: 'quick_book' | 'one_page' | 'multi_page') => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.recipe.starter = starter;
  state.recipe.starterDocumentSiteId = `site_${starter}`;
  return state;
};

const addMeaningfulPolicy = (state: ReturnType<typeof acceptedState>) => {
  state.recipe.policiesEnabled = true;
  state.profile.policies.other.custom = 'Please arrive with bare nails.';
  state.profile.policies.copy.other.visible = true;
};

const addGalleryContent = (state: ReturnType<typeof acceptedState>) => {
  state.recipe.galleryEnabled = true;
  state.gallery.source = 'mock_luster';
  state.gallery.images = [{
    altText: 'Example manicure',
    fileName: 'example-manicure.webp',
    id: 'gallery-example-one',
    mimeType: 'image/webp',
    previewUrl: '/gallery/example-manicure.webp',
    source: 'fixture',
  }];
};

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

const pageSectionTypes = (document: SiteBuilderDocument) =>
  [...document.pages]
    .sort((left, right) => left.order - right.order)
    .map(page => [...page.sections]
      .sort((left, right) => left.order - right.order)
      .map(section => section.sectionType));

const AUTOMATIC_SHELL_TYPES = [
  'section_navigation',
  'final_cta',
  'footer',
] as const;

describe('account-backed onboarding document compiler', () => {
  it('persists non-default presentation choices in the accepted document before compiling', () => {
    const state = acceptedState('multi_page');
    state.recipe.aboutPreset = 'about_before_you_book';
    addGalleryContent(state);
    state.gallery.layout = 'carousel';
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('non-default-presentation'),
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });

    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'black_champagne',
      null,
      source,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    });

    expect(compiled.recipeMigrationResult).toBe('fresh_v1');
    expect(pageSectionTypes(compiled.builderDocument)).toEqual([
      ['hero'],
      ['booking'],
      ['gallery'],
      ['about'],
      ['visit_us'],
    ]);
    expect(compiled.builderDocument.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'about')
      .map(section => section.settings.preset))
      .toEqual(['about_before_you_book']);
    expect(compiled.builderDocument.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery')
      .map(section => section.settings.preset))
      .toEqual(['carousel']);

    const customerGalleryOwner = compiled.builderDocument.pages
      .find(page => page.slug === 'gallery')!
      .sections.find(section => section.sectionType === 'gallery')!;

    expect(compiled.pages.flatMap(page => page.sections)
      .filter(section => section.type === 'gallery')
      .map(section => ({
        id: section.id,
        layout: section.presentation.layout,
      })))
      .toEqual([{
        id: customerGalleryOwner.id,
        layout: customerGalleryOwner.settings.preset,
      }]);
    expect(source.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'about')
      .map(section => section.settings.preset))
      .toEqual(['photo_right']);
    expect(source.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'gallery')
      .map(section => section.settings.preset))
      .toEqual(['grid']);
  });

  it('keeps snapshot presentation choices for synthetic onboarding fallbacks', () => {
    const state = acceptedState('quick_book');
    addGalleryContent(state);
    state.gallery.layout = 'carousel';
    state.recipe.canvaEnabled = true;
    state.canva.customDesignSectionId = 'synthetic-custom-design';
    state.canva.displayMode = 'contained';
    state.canva.status = 'ready';
    const customDesignSettings: CustomDesignSettings = {
      ...createDefaultCustomDesignSettings(),
      displayMode: 'full_width',
      images: [{
        accessibleSummary: 'A customer-ready synthetic design panel.',
        altText: 'Synthetic custom design panel',
        aspectRatio: 1,
        assetId: 'synthetic-custom-artwork',
        decorative: false,
        fileName: 'synthetic-custom-artwork.png',
        fileSize: 1_024,
        height: 800,
        id: 'synthetic-custom-artwork',
        interactiveAreas: [],
        mimeType: 'image/png',
        width: 800,
      }],
    };
    const source = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('synthetic-presentation'),
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      customDesignSettings,
      source,
    );
    const sections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    }).pages.flatMap(page => page.sections);

    expect(sections.find(section => section.type === 'gallery')?.presentation.layout)
      .toBe('carousel');
    expect(sections.find(section => section.type === 'custom_design')?.presentation.displayMode)
      .toBe('contained');
  });

  it.each(['quick_book', 'one_page', 'multi_page'] as const)(
    'persists the exact locked %s recipe and stable source IDs',
    (starter) => {
      const state = acceptedState(starter);
      state.recipe.aboutEnabled = true;
      state.profile.bookingOnlyContact = true;
      state.profile.location.cityOrArea = 'Toronto';
      state.profile.location.locationType = 'salon_suite';
      addGalleryContent(state);
      addMeaningfulPolicy(state);
      let source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(starter),
        siteId: `site_${starter}`,
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
      const compiled = compileOnboardingToSiteDocument({
        revision: 1,
        siteId: SITE_ID,
        snapshot,
      });

      const expected = starter === 'quick_book'
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
            ];

      expect(pageSectionTypes(compiled.builderDocument)).toEqual(expected);
      expect(compiled.pages.map(page => page.sections.map(section => section.type)))
        .toEqual(expected);
      expect(compiled.builderDocument.pages.map(page => page.id))
        .toEqual(source.pages.map(page => page.id));
      expect(compiled.builderDocument.pages.flatMap(page => page.sections.map(section => section.id)))
        .toEqual(source.pages.flatMap(page => page.sections.map(section => section.id)));

      if (starter === 'multi_page') {
        expect(compiled.builderDocument.pages.map(page => page.name)).toEqual([
          'Home',
          'Services & Booking',
          'Gallery',
          'About',
          'Contact',
        ]);
      }

      for (const shellType of AUTOMATIC_SHELL_TYPES) {
        expect(compiled.builderDocument.pages.flatMap(page => page.sections)
          .some(section => section.sectionType === shellType)).toBe(false);
      }
    },
  );

  it('keeps the optional recipe floor at Quick 3, One-page 5, and Multi-page five pages', () => {
    const compile = (
      starter: 'quick_book' | 'one_page' | 'multi_page',
      includeGallery: boolean,
    ) => {
      const state = acceptedState(starter);
      state.recipe.aboutEnabled = true;
      state.recipe.galleryEnabled = includeGallery;
      state.recipe.policiesEnabled = false;
      state.profile.bookingOnlyContact = true;
      if (includeGallery) {
        addGalleryContent(state);
      }
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`recipe-floor-${starter}`),
        siteId: `site_${starter}`,
        siteName: state.profile.businessName,
      });
      const { snapshot } = createPersistableOnboardingDraft(
        state,
        'luster_berry',
        null,
        source,
      );
      return compileOnboardingToSiteDocument({
        revision: 1,
        siteId: SITE_ID,
        snapshot,
      });
    };

    const quick = compile('quick_book', false);
    const onePage = compile('one_page', true);
    const multiPage = compile('multi_page', true);

    expect(pageSectionTypes(quick.builderDocument)).toEqual([
      ['hero', 'booking', 'visit_us'],
    ]);
    expect(pageSectionTypes(onePage.builderDocument)).toEqual([[
      'hero',
      'gallery',
      'about',
      'booking',
      'visit_us',
    ]]);
    expect(multiPage.builderDocument.pages).toHaveLength(5);
    expect(multiPage.builderDocument.pages.map(page => page.slug)).toEqual([
      '',
      'services-book',
      'gallery',
      'about',
      'contact',
    ]);
    expect(pageSectionTypes(multiPage.builderDocument)).toEqual([
      ['hero'],
      ['booking'],
      ['gallery'],
      ['about'],
      ['visit_us'],
    ]);
  });

  it.each([
    {
      expectedCounts: {
        booking: 1,
        gallery: 1,
        hero: 1,
        visit_us: 1,
      },
      starter: 'quick_book',
    },
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        gallery: 1,
        hero: 1,
        policies: 1,
        visit_us: 1,
      },
      starter: 'one_page',
    },
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        gallery: 1,
        hero: 1,
        policies: 1,
        visit_us: 1,
      },
      starter: 'multi_page',
    },
  ] as const)(
    'projects the untouched $starter starter into named library sections without generic placeholders',
    ({ expectedCounts, starter }) => {
      const state = acceptedState(starter);
      state.recipe.aboutEnabled = true;
      state.profile.location.cityOrArea = 'Toronto';
      state.profile.location.locationType = 'salon_suite';
      addGalleryContent(state);
      addMeaningfulPolicy(state);
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`semantic-${starter}`),
        siteId: `site_${starter}`,
        siteName: state.profile.businessName,
      });
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
      const sections = compiled.pages.flatMap(page => page.sections);
      const typeCounts = sections.reduce<Record<string, number>>((counts, item) => ({
        ...counts,
        [item.type]: (counts[item.type] ?? 0) + 1,
      }), {});

      // Legacy compiled enum values belong to old persisted records only.
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'content' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'services' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'visit' }));
      // Library sections whose shared authority is still empty are omitted from
      // the customer tree even though the starter document contains them.
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'announcement_bar' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'reviews' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'team' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'faq' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'offers' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'quick_info' }));
      expect(sections).not.toContainEqual(expect.objectContaining({ type: 'featured_services' }));
      expect(sections).not.toContainEqual(
        expect.objectContaining({ type: 'deposits_cancellations' }),
      );

      for (const shellType of AUTOMATIC_SHELL_TYPES) {
        expect(sections).not.toContainEqual(expect.objectContaining({ type: shellType }));
      }

      expect(sections.map(item => item.presentation.label))
        .not.toContainEqual(expect.stringMatching(/^Section \d+$/u));
      expect(typeCounts).toEqual(expectedCounts);

      if (starter === 'multi_page') {
        const galleryPageGallery = source.pages.find(page => page.slug === 'gallery')!.sections[0]!;

        expect(sections.filter(item => item.type === 'gallery').map(item => item.id))
          .toEqual([galleryPageGallery.id]);
        expect(sections.find(item => item.type === 'contact')).toBeUndefined();
        expect(compiled.builderDocument.pages.map(page => page.slug)).toEqual([
          '',
          'services-book',
          'gallery',
          'about',
          'contact',
        ]);
        expect(new Set(sections.map(item => item.type)).size).toBe(sections.length);
      }
    },
  );

  it('keeps a moved starter section stable, typed, and owner-labelled', () => {
    const state = acceptedState('multi_page');
    state.recipe.aboutEnabled = true;
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('moved-about'),
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    const home = source.pages.find(page => page.isHome)!;
    const aboutPage = source.pages.find(page => page.slug === 'about')!;
    const aboutSection = aboutPage.sections.find(section => section.sectionType === 'about')!;
    const moved = moveSectionToPage(source, aboutSection.id, home.id);
    const movedAbout = moved.pages
      .flatMap(page => page.sections)
      .find(section => section.id === aboutSection.id)!;
    movedAbout.label = 'Daniela’s story';
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      moved,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    });
    const compiledAbout = compiled.pages
      .flatMap(page => page.sections)
      .filter(section => section.type === 'about');

    expect(compiled.recipeMigrationResult).toBe('preserved_manual_edits');
    expect(compiled.builderDocument.pages.find(page => page.id === home.id)?.sections)
      .toContainEqual(expect.objectContaining({
        id: aboutSection.id,
        label: 'Daniela’s story',
      }));
    expect(compiledAbout).toHaveLength(1);
    expect(compiledAbout[0]).toMatchObject({
      id: aboutSection.id,
      presentation: { label: 'Daniela’s story', originalSectionType: 'about' },
      source: 'business_profile',
      type: 'about',
    });
    expect(compiled.pages.find(page => page.id === home.id)?.sections.map(section => section.id))
      .toContain(aboutSection.id);
  });

  it('does not re-inject hidden or removed starter modules into the saved customer tree', () => {
    const state = acceptedState('one_page');
    state.recipe.aboutEnabled = true;
    addGalleryContent(state);
    const source = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('hidden-optional'),
      siteId: 'site_one_page',
      siteName: state.profile.businessName,
    });
    const about = source.pages[0]!.sections.find(
      section => section.sectionType === 'about',
    )!;
    const gallery = source.pages[0]!.sections.find(
      section => section.sectionType === 'gallery',
    )!;
    const withHiddenAbout = setSectionVisible(source, about.id, false);
    const document = removeSection(withHiddenAbout, gallery.id);
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    );
    const types = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    }).pages.flatMap(page => page.sections.map(section => section.type));

    expect(types).not.toContain('about');
    expect(types).not.toContain('gallery');
  });

  it('keeps an owner-added duplicate About distinct from the starter About', () => {
    const state = acceptedState('multi_page');
    state.recipe.aboutEnabled = true;
    const ids = createDeterministicIdFactory('duplicate-about');
    const original = initializeStarter('multi_page', {
      idFactory: ids,
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    const home = original.pages.find(page => page.isHome)!;
    const originalAbout = original.pages
      .find(page => page.slug === 'about')!
      .sections.find(section => section.sectionType === 'about')!;
    // Positions are 1-based, so this lands the owner's About first on Home.
    const withDuplicate = addSection(original, {
      pageId: home.id,
      position: 1,
      sectionType: 'about',
    }, ids);
    const originalIds = new Set(
      original.pages.flatMap(page => page.sections.map(section => section.id)),
    );
    const duplicate = withDuplicate.pages
      .flatMap(page => page.sections)
      .find(section => !originalIds.has(section.id))!;
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      withDuplicate,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    });
    const compiledAbout = compiled.pages
      .flatMap(page => page.sections)
      .filter(section => section.type === 'about');

    // Library sections never carry the removed v1 starter-role metadata, and
    // the Add Section library gives the new section the registry label.
    expect(duplicate).not.toHaveProperty('starterSemanticRole');
    expect(duplicate).toMatchObject({ label: 'About', sectionType: 'about' });
    // A deliberate advanced Builder duplicate is outside the compiler-owned
    // starter recipe. The compiler preserves both identities instead of
    // silently overwriting the owner's document.
    expect(compiled.recipeMigrationResult).toBe('preserved_manual_edits');
    expect(compiled.builderDocument.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'about')
      .map(section => section.id))
      .toEqual([duplicate.id, originalAbout.id]);
    expect(compiledAbout.map(section => section.id))
      .toEqual([duplicate.id, originalAbout.id]);
    expect(compiled.pages.flatMap(page => page.sections.map(section => section.type)))
      .not.toContain('featured_services');
  });

  it('keeps Quick Info out of V1 even when its former facts have content', () => {
    const state = acceptedState('one_page');
    state.profile.bookingOnlyContact = true;
    const document = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('quick-info-facts'),
      siteId: 'site_one_page',
      siteName: state.profile.businessName,
    });
    const withoutFacts = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    ).snapshot;
    state.profile.bookingPreferences.visitMode = 'appointment_only';
    const withFact = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    ).snapshot;

    const typesOf = (snapshot: typeof withFact) => compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    }).pages.flatMap(page => page.sections.map(section => section.type));

    expect(typesOf(withoutFacts)).not.toContain('quick_info');
    expect(typesOf(withFact)).not.toContain('quick_info');
    expect(typesOf(withFact).filter(type => type === 'visit_us')).toHaveLength(1);
  });

  it('keeps core section IDs stable and avoids legacy injections after a page rename', () => {
    const state = acceptedState('quick_book');
    state.recipe.aboutEnabled = true;
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.locationType = 'salon_suite';
    addGalleryContent(state);
    addMeaningfulPolicy(state);
    const source = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('stable-optional'),
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const compile = (document: SiteBuilderDocument) => {
      const { snapshot } = createPersistableOnboardingDraft(
        state,
        'luster_berry',
        null,
        document,
      );
      return compileOnboardingToSiteDocument({
        revision: 1,
        siteId: SITE_ID,
        snapshot,
      });
    };
    const original = compile(source);
    const originalIds = original.builderDocument.pages
      .flatMap(page => page.sections)
      .map(section => section.id);
    source.pages[0]!.slug = 'daniela-home';
    const renamed = compile(source);
    const renamedIds = renamed.builderDocument.pages
      .flatMap(page => page.sections)
      .map(section => section.id);

    expect(renamedIds).toEqual(originalIds);
    expect(renamed.recipeMigrationResult).toBe('preserved_manual_edits');
    expect(renamed.builderDocument.pages[0]?.slug).toBe('daniela-home');
    expect(renamed.builderDocument.pages[0]?.sections.map(section => section.sectionType))
      .toEqual(['hero', 'booking', 'gallery', 'visit_us']);
    expect(renamedIds.some(id => id.includes(':onboarding:'))).toBe(false);

    const renamedCustomerTypes = renamed.pages.flatMap(
      page => page.sections.map(section => section.type),
    );
    for (const removedType of [
      'quick_info',
      'deposits_cancellations',
      'contact',
      'final_cta',
      'footer',
    ] as const) {
      expect(renamedCustomerTypes).not.toContain(removedType);
    }
  });

  it('never promotes an owner label to a native Policies section', () => {
    const state = acceptedState('quick_book');
    state.recipe.policiesEnabled = false;
    const ids = createDeterministicIdFactory('owner-policies-label');
    const source = initializeStarter('quick_book', {
      idFactory: ids,
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const home = source.pages[0]!;
    const withLabel = addSection(source, {
      label: 'Policies',
      pageId: home.id,
      sectionType: 'section_08',
    }, ids);
    const ownerSectionId = withLabel.pages[0]!.sections.find(
      section => section.label === 'Policies',
    )!.id;
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      withLabel,
    );
    const sections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    }).pages.flatMap(page => page.sections);

    expect(sections).not.toContainEqual(expect.objectContaining({ id: ownerSectionId }));
    expect(sections).not.toContainEqual(expect.objectContaining({ type: 'policies' }));
    expect(sections).not.toContainEqual(
      expect.objectContaining({ type: 'deposits_cancellations' }),
    );
  });

  it('preserves an unrecognized manually composed schema-v1 document', () => {
    const state = acceptedState('multi_page');
    state.recipe.aboutEnabled = true;
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.locationType = 'salon_suite';
    addGalleryContent(state);
    const legacyPlaceholder = (
      id: string,
      sectionType: string,
      label: string,
      order: number,
    ) => ({
      id,
      label,
      order,
      placeholderSettings: { note: 'Content and settings will be designed later.' },
      sectionType,
      size: 'medium',
      visible: true,
    });
    // This eight-section schema-v1 shape is not one of the exact compiler-owned
    // 6/14/23 legacy recipes. It must therefore be normalized without being
    // destructively rewritten as a locked V1 starter.
    const legacyDocument = {
      navigation: {
        enabled: true,
        items: [
          { id: 'nav_1', label: 'Home', order: 0, pageId: 'page_1' },
          { id: 'nav_2', label: 'Services / Book', order: 1, pageId: 'page_2' },
          { id: 'nav_3', label: 'Gallery', order: 2, pageId: 'page_3' },
          { id: 'nav_4', label: 'About', order: 3, pageId: 'page_4' },
          { id: 'nav_5', label: 'Contact', order: 4, pageId: 'page_5' },
        ],
        style: 'simple',
      },
      originStarter: 'multi_page',
      pages: [
        {
          id: 'page_1',
          isHome: true,
          name: 'Home',
          order: 0,
          sections: [
            legacyPlaceholder('sec_1', 'section_01', 'Section 01', 0),
            legacyPlaceholder('sec_2', 'section_02', 'Section 02', 1),
          ],
          slug: '',
          visible: true,
          visibleInNavigation: true,
        },
        {
          id: 'page_2',
          isHome: false,
          name: 'Services / Book',
          order: 1,
          sections: [
            legacyPlaceholder('sec_3', 'section_03', 'Section 03', 0),
            {
              id: 'sec_booking',
              label: 'Booking',
              order: 1,
              sectionType: 'booking',
              settings: createDefaultBookingPresentationSettings(),
              visible: true,
            },
          ],
          slug: 'services-book',
          visible: true,
          visibleInNavigation: true,
        },
        {
          id: 'page_3',
          isHome: false,
          name: 'Gallery',
          order: 2,
          sections: [legacyPlaceholder('sec_4', 'section_04', 'Section 04', 0)],
          slug: 'gallery',
          visible: true,
          visibleInNavigation: true,
        },
        {
          id: 'page_4',
          isHome: false,
          name: 'About',
          order: 3,
          sections: [legacyPlaceholder('sec_5', 'section_05', 'Section 05', 0)],
          slug: 'about',
          visible: true,
          visibleInNavigation: true,
        },
        {
          id: 'page_5',
          isHome: false,
          name: 'Contact',
          order: 4,
          sections: [
            legacyPlaceholder('sec_6', 'section_06', 'Section 06', 0),
            legacyPlaceholder('sec_7', 'section_07', 'Section 07', 1),
          ],
          slug: 'contact',
          visible: true,
          visibleInNavigation: true,
        },
      ],
      removedPages: [],
      schemaVersion: 1,
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
      unusedSections: [],
    };
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      legacyDocument as unknown as SiteBuilderDocument,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    });

    expect(compiled.recipeMigrationResult).toBe('preserved_manual_edits');
    // The compatibility upgrader keeps stable ids for this unknown manual
    // document. Generic/duplicated legacy responsibilities stay out of the
    // resolved customer tree.
    expect(compiled.builderDocument.schemaVersion).toBe(2);
    expect(compiled.builderDocument.pages.map(page => page.sections.map(
      section => [section.sectionType, section.label, section.id],
    ))).toEqual([
      [
        ['hero', 'Welcome', 'sec_1'],
        ['gallery', 'Featured work', 'sec_2'],
      ],
      [
        ['featured_services', 'Services', 'sec_3'],
        ['booking', 'Booking', 'sec_booking'],
      ],
      [['gallery', 'Gallery', 'sec_4']],
      [['about', 'About', 'sec_5']],
      [
        ['visit_us', 'Visit us', 'sec_6'],
        ['contact', 'Contact', 'sec_7'],
      ],
    ]);
    expect(compiled.pages.map(page => page.sections.map(section => section.type))).toEqual([
      ['hero'],
      ['booking'],
      ['gallery'],
      ['about'],
      ['visit_us'],
    ]);

    const customerTypes = compiled.pages.flatMap(
      page => page.sections.map(section => section.type),
    );
    for (const removedType of [
      'featured_services',
      'contact',
      'footer',
      'final_cta',
      'quick_info',
    ] as const) {
      expect(customerTypes).not.toContain(removedType);
    }
  });

  it.each([
    { expectedBuilderVisitUsCount: 1, expectedVisitUsCount: 1, starter: 'quick_book' },
    { expectedBuilderVisitUsCount: 1, expectedVisitUsCount: 1, starter: 'one_page' },
    { expectedBuilderVisitUsCount: 1, expectedVisitUsCount: 1, starter: 'multi_page' },
  ] as const)(
    'keeps exactly one truthful customer contact surface for public $starter profile data',
    ({ expectedBuilderVisitUsCount, expectedVisitUsCount, starter }) => {
      const state = acceptedState(starter);
      state.profile.location.cityOrArea = 'Toronto';
      state.profile.location.locationType = 'salon_suite';
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`public-contact-${starter}`),
        siteId: `site_${starter}`,
        siteName: state.profile.businessName,
      });
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
      const sections = compiled.pages.flatMap(page => page.sections);
      const contacts = sections.filter(section => section.type === 'contact');
      const visitUs = sections.filter(section => section.type === 'visit_us');

      expect(visitUs).toHaveLength(expectedVisitUsCount);

      expect(contacts).toEqual([]);
      expect(compiled.builderDocument.pages.flatMap(page => page.sections)
        .filter(section => section.sectionType === 'visit_us'))
        .toHaveLength(expectedBuilderVisitUsCount);
    },
  );

  it('keeps Booking-only contact in the shared Visit & Contact section instead of injecting Contact', () => {
    const state = acceptedState('quick_book');
    state.profile.bookingOnlyContact = true;
    const source = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('booking-only-contact'),
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      source,
    );
    const sections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    }).pages.flatMap(page => page.sections);

    expect(sections.filter(section => section.type === 'booking')).toHaveLength(1);
    expect(sections.filter(section => section.type === 'hero')).toHaveLength(1);
    expect(sections).not.toContainEqual(expect.objectContaining({ type: 'contact' }));

    const visitUs = sections.filter(section => section.type === 'visit_us');

    expect(visitUs).toHaveLength(1);
    expect(visitUs[0]?.source).toBe('business_profile');
    expect(visitUs[0]?.presentation).toMatchObject({
      addressVisibility: snapshot.profile.location.addressVisibility,
      label: 'Visit & Contact',
      originalSectionType: 'visit_us',
    });
  });

  it.each(['quick_book', 'one_page', 'multi_page'] as const)(
    'omits Contact and empty contact navigation for private %s profile data',
    (starter) => {
      const state = acceptedState(starter);
      state.profile.bookingOnlyContact = false;
      state.profile.preferredContact = null;
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`private-contact-${starter}`),
        siteId: `site_${starter}`,
        siteName: state.profile.businessName,
      });
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

      expect(compiled.pages.flatMap(page => page.sections))
        .not.toContainEqual(expect.objectContaining({ type: 'contact' }));
      expect(compiled.pages.flatMap(page => page.sections))
        .not.toContainEqual(expect.objectContaining({ type: 'visit_us' }));
      expect(compiled.navigation.map(item => item.label)).not.toContain('Contact');
      expect(compiled.pages.map(page => page.slug)).not.toContain('contact');
    },
  );

  it.each(['one_page', 'multi_page'] as const)(
    'omits Gallery and its empty navigation when %s has no gallery content',
    (starter) => {
      const state = acceptedState(starter);
      state.recipe.galleryEnabled = true;
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(`empty-gallery-${starter}`),
        siteId: `site_${starter}`,
        siteName: state.profile.businessName,
      });
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

      expect(compiled.pages.flatMap(page => page.sections))
        .not.toContainEqual(expect.objectContaining({ type: 'gallery' }));
      expect(compiled.navigation.map(item => item.label)).not.toContain('Gallery');
      expect(compiled.pages.map(page => page.slug)).not.toContain('gallery');
    },
  );

  it('retains every Custom Design section while publishing one per page', () => {
    const state = acceptedState('quick_book');
    state.recipe.canvaEnabled = true;
    state.canva.status = 'ready';
    state.canva.customDesignSectionId = 'custom-one';
    const settings: CustomDesignSettings = {
      ...createDefaultCustomDesignSettings(),
      images: [{
        accessibleSummary: 'A customer-ready design panel.',
        altText: 'Custom nail design panel',
        aspectRatio: 1,
        assetId: 'custom-artwork',
        decorative: false,
        fileName: 'custom-artwork.png',
        fileSize: 1_024,
        height: 800,
        id: 'custom-artwork',
        interactiveAreas: [],
        mimeType: 'image/png',
        width: 800,
      }],
    };
    const source = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('multiple-custom'),
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    source.pages[0]!.sections.push(
      {
        id: 'custom-one',
        label: 'Custom Design',
        order: source.pages[0]!.sections.length,
        sectionType: 'custom_design',
        settings,
        visible: true,
      },
      {
        id: 'custom-two',
        label: 'Custom Design',
        order: source.pages[0]!.sections.length + 1,
        sectionType: 'custom_design',
        settings: {
          ...settings,
          displayMode: 'full_width',
          images: [{
            ...settings.images[0]!,
            assetId: 'custom-artwork-two',
            fileName: 'custom-artwork-two.png',
            id: 'custom-artwork-two',
          }],
        },
        visible: true,
      },
    );
    source.unusedSections.push({
      id: 'custom-restorable',
      label: 'Custom Design',
      order: source.unusedSections.length,
      sectionType: 'custom_design',
      settings: {
        ...settings,
        displayMode: 'contained',
        images: [{
          ...settings.images[0]!,
          assetId: 'custom-artwork-restorable',
          fileName: 'custom-artwork-restorable.png',
          id: 'custom-artwork-restorable',
        }],
      },
      visible: true,
    });
    const accountCustomMediaByLogicalId = new Map([
      ['custom-artwork', '11111111-1111-4111-8111-111111111111'],
      ['custom-artwork-two', '22222222-2222-4222-8222-222222222222'],
      ['custom-artwork-restorable', '33333333-3333-4333-8333-333333333333'],
    ]);
    const { media, snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      settings,
      source,
      accountCustomMediaByLogicalId,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    });
    const customSections = compiled.pages.flatMap(page => page.sections).filter(
      section => section.type === 'custom_design',
    );

    expect(customSections.map(section => section.id)).toEqual(['custom-one']);
    expect(customSections.map(section => section.presentation.displayMode))
      .toEqual(['poster']);
    expect(compiled.builderDocument.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'custom_design')
      .map(section => section.id))
      .toEqual(['custom-one', 'custom-two']);
    expect(media.filter(item => item.role === 'custom_design').map(item => item.localItemId))
      .toEqual([
        'custom-artwork',
        'custom-artwork-two',
        'custom-artwork-restorable',
      ]);
    expect(media.filter(item => item.role === 'custom_design').map(item => item.existingMediaId))
      .toEqual([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ]);
    expect(onboardingDraftClaimRequestSchema.parse({
      anonymousDraftToken: 'multi-custom-draft-token-000000000000',
      idempotencyKey: 'multi-custom-claim-key-0000000000000',
      media,
      snapshot,
    }).media.filter(item => item.role === 'custom_design').map(item => item.localItemId))
      .toEqual([
        'custom-artwork',
        'custom-artwork-two',
        'custom-artwork-restorable',
      ]);
  });

  it('round-trips full Custom Design metadata and internal destinations using logical IDs only', () => {
    const state = acceptedState('multi_page');
    state.recipe.canvaEnabled = true;
    state.canva.status = 'ready';
    state.canva.customDesignSectionId = 'section_custom_design';
    const document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('custom'),
      siteId: 'site_multi_page',
      siteName: state.profile.businessName,
    });
    const targetPage = document.pages[2]!;
    const targetSection = targetPage.sections[0]!;
    const settings: CustomDesignSettings = {
      ...createDefaultCustomDesignSettings(),
      background: { color: '#F4E4DE', mode: 'custom' },
      cta: {
        action: {
          destination: { pageId: targetPage.id, sectionId: targetSection.id },
          type: 'internal',
        },
        label: 'See my work',
        placement: { imageItemId: 'image_item_one', type: 'after_image' },
        type: 'custom',
      },
      displayMode: 'contained',
      gap: 'comfortable',
      images: [{
        accessibleSummary: 'A detailed design page with a booking call to action.',
        altText: 'Isla Nail Studio service guide',
        aspectRatio: 0.8,
        assetId: 'indexed_db_storage_key_must_not_persist',
        decorative: false,
        fileName: 'isla-guide.webp',
        fileSize: 4_000,
        height: 1_000,
        id: 'image_item_one',
        interactiveAreas: [{
          accessibleLabel: 'Open the Gallery',
          action: {
            destination: { pageId: targetPage.id, sectionId: targetSection.id },
            type: 'internal',
          },
          geometry: { height: 0.1, width: 0.3, x: 0.1, y: 0.7 },
          id: 'hotspot_gallery',
          labelConfirmed: true,
          reviewStatus: 'approved',
          semanticOrder: 0,
          validationStatus: 'valid',
        }],
        mimeType: 'image/webp',
        width: 800,
      }],
    };
    document.pages[0]!.sections.push({
      id: 'section_custom_design',
      label: 'Custom Design',
      order: document.pages[0]!.sections.length,
      sectionType: 'custom_design',
      settings,
      visible: true,
    });

    const draft = createPersistableOnboardingDraft(
      state,
      'black_champagne',
      settings,
      document,
    );
    const request = onboardingDraftClaimRequestSchema.parse({
      anonymousDraftToken: 'draft_token_123456789012345678901234567890',
      idempotencyKey: 'claim_key_123456789012345678901234567890',
      ...draft,
    });
    const compiled = compileOnboardingToSiteDocument({
      revision: 3,
      siteId: SITE_ID,
      snapshot: request.snapshot,
    });
    const savedCustom = compiled.builderDocument.pages
      .flatMap(page => page.sections)
      .find(section => section.sectionType === 'custom_design');

    expect(request.media).toEqual([expect.objectContaining({
      imageItemId: 'image_item_one',
      localItemId: 'image_item_one',
      role: 'custom_design',
    })]);
    expect(JSON.stringify(request)).not.toContain('indexed_db_storage_key_must_not_persist');
    expect(savedCustom).toMatchObject({
      settings: {
        cta: { action: { destination: { pageId: targetPage.id, sectionId: targetSection.id } } },
        images: [{
          assetId: 'image_item_one',
          id: 'image_item_one',
          interactiveAreas: [{
            action: { destination: { pageId: targetPage.id, sectionId: targetSection.id } },
          }],
        }],
      },
    });
  });

  it('keeps built-in Gallery fixtures out of the upload manifest', () => {
    const state = acceptedState('one_page');
    state.recipe.galleryEnabled = true;
    state.gallery.source = 'mock_luster';
    state.gallery.images = [{
      altText: 'Example manicure',
      fileName: 'example.webp',
      id: 'gallery-example-one',
      mimeType: 'image/webp',
      previewUrl: '/gallery/example.webp',
      source: 'fixture',
    }];
    const document: SiteBuilderDocument = initializeStarter('one_page', {
      siteId: 'site_one_page',
      siteName: state.profile.businessName,
    });
    const draft = createPersistableOnboardingDraft(state, 'luster_berry', null, document);

    expect(draft.snapshot.gallery).toMatchObject({
      imageItemIds: ['gallery-example-one'],
      source: 'mock_luster',
    });
    expect(draft.media).toEqual([]);
  });

  it('rejects unknown or duplicate service IDs before persistence', () => {
    const state = acceptedState('quick_book');
    state.profile.serviceMenu.selectedServiceIds = ['svc-manicure-gel', 'svc-manicure-gel', 'not-canonical'];
    const document = initializeStarter('quick_book', {
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });

    expect(() => createPersistableOnboardingDraft(state, 'luster_berry', null, document))
      .toThrow(/Selected service/);
  });

  it('resolves all four starter add-ons through exact Production template mappings', () => {
    const state = acceptedState('quick_book');
    const document = initializeStarter('quick_book', {
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });
    const draft = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    );

    expect(resolveProductionServiceSelection(draft.snapshot).addOnTemplateKeys)
      .toEqual([
        'french_tips',
        'chrome',
        'simple_nail_art',
        'detailed_nail_art',
      ]);
  });

  it('accepts overrides only for selected canonical menu items and bounds the map', () => {
    const state = acceptedState('quick_book');
    state.profile.serviceMenu.selectedServiceIds = ['svc-manicure-gel'];
    state.profile.serviceMenu.ownerOverridesByServiceId = {
      'svc-manicure-gel': { durationMinutes: 75, priceCents: 5_500 },
    };
    const document = initializeStarter('quick_book', {
      siteId: 'site_quick_book',
      siteName: state.profile.businessName,
    });

    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    )).not.toThrow();

    state.profile.serviceMenu.ownerOverridesByServiceId = {
      'svc-manicure-gel': { priceCents: 5_500 },
      'svc-pedicure-gel': { priceCents: 6_500 },
    };

    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    )).toThrow(/selected canonical service or add-on/);

    state.profile.serviceMenu.ownerOverridesByServiceId = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [
        `unselected-${index}`,
        { priceCents: 1_000 },
      ]),
    );

    expect(() => createPersistableOnboardingDraft(
      state,
      'luster_berry',
      null,
      document,
    )).toThrow(/at most 200/);
  });
});
