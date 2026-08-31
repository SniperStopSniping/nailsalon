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
import { compileOnboardingToSiteDocument } from './compiler';
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

/**
 * The compiler stamps the recipe's About/Gallery presentation choices into the
 * owning library sections' settings, so the persisted Builder document is the
 * accepted document plus exactly those preset writes. A gallery whose preset
 * was deliberately set away from the default (the multi_page Home
 * "Featured work" editorial strip) keeps its own preset.
 */
const withStampedRecipePresets = (
  document: SiteBuilderDocument,
  presets: { aboutPreset: 'photo_right'; galleryLayout: 'grid' },
): SiteBuilderDocument => {
  const stamped = structuredClone(document);
  for (const section of stamped.pages.flatMap(page => page.sections)) {
    if (section.sectionType === 'about') {
      section.settings.preset = presets.aboutPreset;
    }
    if (section.sectionType === 'gallery' && section.settings.preset === 'grid') {
      section.settings.preset = presets.galleryLayout;
    }
  }
  return stamped;
};

describe('account-backed onboarding document compiler', () => {
  it.each(['quick_book', 'one_page', 'multi_page'] as const)(
    'preserves the exact accepted %s universal document and stable IDs',
    (starter) => {
      const state = acceptedState(starter);
      const source = initializeStarter(starter, {
        idFactory: createDeterministicIdFactory(starter),
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

      // The accepted document survives verbatim apart from the recipe presets
      // the compiler stamps into the About and Gallery sections.
      expect(compiled.builderDocument).toEqual(withStampedRecipePresets(source, {
        aboutPreset: 'photo_right',
        galleryLayout: 'grid',
      }));
      expect(compiled.builderDocument.pages.map(page => page.id))
        .toEqual(source.pages.map(page => page.id));
      expect(compiled.builderDocument.pages.flatMap(page => page.sections.map(section => section.id)))
        .toEqual(source.pages.flatMap(page => page.sections.map(section => section.id)));

      if (starter === 'multi_page') {
        expect(compiled.builderDocument.pages.map(page => page.name)).toEqual([
          'Home',
          'Services / Book',
          'Gallery',
          'Team',
          'Contact',
        ]);
        // The starter's editorial "Featured work" gallery keeps its
        // deliberate preset; only default-preset galleries follow the
        // owner's chosen layout.
        const homeGallery = compiled.builderDocument.pages[0]!.sections.find(
          section => section.sectionType === 'gallery',
        );

        expect(homeGallery).toMatchObject({
          label: 'Featured work',
          settings: { preset: 'editorial' },
        });
        expect(source.pages[0]!.sections.find(
          section => section.sectionType === 'gallery',
        )).toMatchObject({ settings: { preset: 'editorial' } });
      }
    },
  );

  it.each([
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        contact: 1,
        deposits_cancellations: 1,
        featured_services: 1,
        final_cta: 1,
        footer: 1,
        gallery: 1,
        hero: 1,
        policies: 1,
      },
      starter: 'quick_book',
    },
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        deposits_cancellations: 1,
        featured_services: 1,
        final_cta: 1,
        footer: 1,
        gallery: 1,
        hero: 1,
        policies: 1,
        quick_info: 1,
        section_navigation: 1,
        visit_us: 1,
      },
      starter: 'one_page',
    },
    {
      expectedCounts: {
        about: 1,
        booking: 1,
        contact: 1,
        deposits_cancellations: 1,
        featured_services: 1,
        final_cta: 2,
        footer: 5,
        gallery: 2,
        hero: 1,
        policies: 1,
        quick_info: 1,
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
      expect(sections.map(item => item.presentation.label))
        .not.toContainEqual(expect.stringMatching(/^Section \d+$/u));
      expect(typeCounts).toEqual(expectedCounts);

      if (starter === 'multi_page') {
        const homeGallery = source.pages[0]!.sections.find(
          section => section.sectionType === 'gallery',
        )!;
        const galleryPageGallery = source.pages.find(page => page.slug === 'gallery')!.sections[0]!;
        const contactSource = source.pages
          .find(page => page.slug === 'contact')!
          .sections.find(section => section.sectionType === 'contact')!;

        expect(sections.filter(item => item.type === 'gallery').map(item => item.id))
          .toEqual([homeGallery.id, galleryPageGallery.id]);
        expect(sections.find(item => item.type === 'contact')?.id).toBe(contactSource.id);
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
    const teamPage = source.pages.find(page => page.slug === 'team')!;
    const aboutSection = teamPage.sections.find(section => section.sectionType === 'about')!;
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
      .find(page => page.slug === 'team')!
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
    // About is a soft per-site limit: the owner's copy is kept alongside the
    // starter's, and neither absorbs the other's identity.
    expect(compiledAbout.map(section => section.id))
      .toEqual([duplicate.id, originalAbout.id]);
    // Quick Info is absent because this fixture sets no location, hours, or
    // booking preference — none of its facts resolve to content, so it would
    // publish an empty strip. The next test shows it returning on its own.
    expect(compiled.pages[0]?.sections.map(section => section.type))
      .toEqual(['about', 'hero', 'final_cta', 'footer']);
  });

  it('publishes Quick Info as soon as one of its facts has content', () => {
    const state = acceptedState('one_page');
    const document = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('quick-info-facts'),
      siteId: 'site_one_page',
      siteName: state.profile.businessName,
    });
    const withoutFacts = createPersistableOnboardingDraft(
      state, 'luster_berry', null, document,
    ).snapshot;
    state.profile.bookingPreferences.visitMode = 'appointment_only';
    const withFact = createPersistableOnboardingDraft(
      state, 'luster_berry', null, document,
    ).snapshot;

    const typesOf = (snapshot: typeof withFact) => compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    }).pages.flatMap(page => page.sections.map(section => section.type));

    expect(typesOf(withoutFacts)).not.toContain('quick_info');
    expect(typesOf(withFact)).toContain('quick_info');
  });

  it('keeps injected optional IDs stable when the target page slug changes', () => {
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
    const injectedTypes = [
      'about',
      'contact',
      'deposits_cancellations',
      'gallery',
      'policies',
    ];
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
    const originalIds = compile(source).pages
      .flatMap(page => page.sections)
      .filter(section => injectedTypes.includes(section.type))
      .map(section => section.id);
    source.pages[0]!.slug = 'daniela-home';
    const renamedIds = compile(source).pages
      .flatMap(page => page.sections)
      .filter(section => injectedTypes.includes(section.type))
      .map(section => section.id);

    expect(renamedIds).toEqual(originalIds);
    expect(originalIds).toEqual([
      `${SITE_ID}:onboarding:about`,
      `${SITE_ID}:onboarding:gallery`,
      `${SITE_ID}:onboarding:deposits_cancellations`,
      `${SITE_ID}:onboarding:policies`,
      `${SITE_ID}:onboarding:contact`,
    ]);
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

  it('migrates an older v1 starter document without semantic metadata', () => {
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
    // A schema-v1 document as it was persisted before starterSemanticRole
    // existed: numbered placeholders resolved positionally by the upgrade.
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

    // The v1 placeholders become real library sections, keeping their ids and
    // the frozen v1 preview labels; "featured work" becomes an editorial
    // gallery and keeps that preset through recipe stamping.
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
      ['hero', 'gallery'],
      ['featured_services', 'booking'],
      ['gallery'],
      ['about'],
      ['visit_us', 'contact'],
    ]);
  });

  it.each([
    { expectedVisitUsCount: 0, starter: 'quick_book' },
    { expectedVisitUsCount: 1, starter: 'one_page' },
    { expectedVisitUsCount: 1, starter: 'multi_page' },
  ] as const)(
    'keeps exactly one truthful customer contact surface for public $starter profile data',
    ({ expectedVisitUsCount, starter }) => {
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

      if (starter === 'multi_page') {
        const sourceContact = source.pages
          .find(page => page.slug === 'contact')!
          .sections.find(section => section.sectionType === 'contact')!;

        expect(contacts.map(section => section.id)).toEqual([sourceContact.id]);
      } else if (starter === 'one_page') {
        // Visit Us already carries the location and contact summary, so the
        // ladder does not inject a second Contact surface behind it.
        expect(contacts).toEqual([]);
      } else {
        expect(contacts.map(section => section.id))
          .toEqual([`${SITE_ID}:onboarding:contact`]);
      }
    },
  );

  it('does not compile Booking-only as a duplicate empty Contact section', () => {
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
    expect(sections).not.toContainEqual(expect.objectContaining({ type: 'contact' }));
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

  it('retains every distinct Custom Design section by stable ID', () => {
    const state = acceptedState('quick_book');
    state.recipe.canvaEnabled = true;
    state.canva.status = 'ready';
    state.canva.customDesignSectionId = 'custom-one';
    const settings = createDefaultCustomDesignSettings();
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
        settings: { ...settings, displayMode: 'full_width' },
        visible: true,
      },
    );
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      'luster_berry',
      settings,
      source,
    );
    const customSections = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: SITE_ID,
      snapshot,
    }).pages.flatMap(page => page.sections).filter(
      section => section.type === 'custom_design',
    );

    expect(customSections.map(section => section.id)).toEqual(['custom-one', 'custom-two']);
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
