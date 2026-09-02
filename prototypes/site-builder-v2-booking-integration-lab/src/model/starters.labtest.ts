import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BOOKING_PRESENTATION_SETTINGS,
  withoutFeaturedServicesRail,
} from '../booking/presentation';
import {
  ADD_SECTION_CATALOGUE,
  SECTION_CATALOGUE,
  getAddSectionLibrary,
} from './catalogue';
import { createDeterministicIdFactory } from './ids';
import {
  addPage,
  addSection,
  moveSectionToPage,
  removePage,
  toggleNavigation,
} from './operations';
import {
  getSectionRegistryEntry,
  isLibrarySection,
} from './section-library/registry';
import { createEmptySiteContent } from './section-library/site-content';
import { getStarterDocumentOutline, initializeStarter } from './starters';
import { SITE_BUILDER_SCHEMA_VERSION, type OriginStarter } from './types';
import { validateSiteBuilderDocument } from './validation';

const starters: readonly OriginStarter[] = [
  'quick_book',
  'one_page',
  'multi_page',
];

const V1_BOOKING_PRESENTATION_SETTINGS = withoutFeaturedServicesRail(
  DEFAULT_BOOKING_PRESENTATION_SETTINGS,
);

describe('starter initialization', () => {
  it.each(starters)('%s starts with one catalogue and no duplicate featured rail', (starter) => {
    const document = initializeStarter(starter, {
      idFactory: createDeterministicIdFactory(`single-catalogue-${starter}`),
    });
    const bookingSections = document.pages
      .flatMap(page => page.sections)
      .filter(section => section.sectionType === 'booking');

    expect(bookingSections).toHaveLength(1);
    const booking = bookingSections[0];
    if (booking?.sectionType !== 'booking') throw new Error('Booking section is missing.');
    if (booking.settings.layout !== 'visual_grid') {
      throw new Error('V1 Booking must use the Visual Grid fixture.');
    }
    expect(booking.settings.layoutSettings.showFeatured).toBe(false);
  });

  it('creates the exact Quick Book defaults', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('quick'),
    });

    expect(SITE_BUILDER_SCHEMA_VERSION).toBe(2);
    expect(document.schemaVersion).toBe(2);
    expect(document.originStarter).toBe('quick_book');
    expect(document.navigation.enabled).toBe(false);
    expect(document.pages).toHaveLength(1);
    expect(document.siteContent).toEqual(createEmptySiteContent());
    expect(document.siteContent).toEqual({
      faq: [],
      offers: [],
      reviews: [],
      staff: [],
    });

    expect(document.pages[0]?.sections).toEqual([
      {
        id: 'section_quick_1',
        sectionType: 'hero',
        label: 'Salon intro',
        order: 0,
        visible: true,
        settings: {
          headline: { source: 'shared' },
          intro: { source: 'shared' },
          media: 'gradient',
          preset: 'booking_first',
          primaryCtaLabel: 'Book an appointment',
          showLocationEyebrow: false,
          showStatusLine: false,
          version: 1,
        },
      },
      {
        id: 'section_quick_2',
        sectionType: 'booking',
        label: 'Booking',
        order: 1,
        visible: true,
        settings: V1_BOOKING_PRESENTATION_SETTINGS,
      },
      {
        id: 'section_quick_3',
        sectionType: 'gallery',
        label: 'Gallery',
        order: 2,
        visible: true,
        galleryPresentationOwner: 'onboarding',
        settings: {
          preset: 'carousel',
          selection: { mode: 'all' },
          version: 1,
        },
      },
    ]);

    const booking = document.pages[0]?.sections[1];
    expect(booking?.sectionType).toBe('booking');
    if (booking?.sectionType !== 'booking') {
      throw new Error('Quick Book is missing Booking.');
    }
    expect(booking.settings).toEqual(V1_BOOKING_PRESENTATION_SETTINGS);
    if (booking.settings.layout !== 'visual_grid') {
      throw new Error('Quick Book must use the Visual Grid fixture.');
    }
    expect(booking.settings.layoutSettings.showFeatured).toBe(false);

    // Library sections carry per-type settings only: no numbered-placeholder
    // presentation slots and no retired starter role metadata.
    for (const section of document.pages[0]?.sections ?? []) {
      expect(section).not.toHaveProperty('placeholderSettings');
      expect(section).not.toHaveProperty('size');
      expect(section).not.toHaveProperty('starterSemanticRole');
    }
  });

  it('creates the exact One-page defaults', () => {
    const document = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('one'),
    });

    expect(document.navigation.enabled).toBe(true);
    expect(document.pages).toHaveLength(1);
    expect(document.siteContent).toEqual(createEmptySiteContent());
    expect(document.pages[0]?.sections).toHaveLength(7);
    expect(document.pages[0]?.sections.map((section) => section.sectionType)).toEqual([
      'hero',
      'gallery',
      'about',
      'booking',
      'reviews',
      'policies',
      'visit_us',
    ]);
    expect(document.pages[0]?.sections.map((section) => section.label)).toEqual([
      'Welcome',
      'Gallery',
      'About',
      'Booking',
      'Reviews',
      'Before You Book',
      'Visit & Contact',
    ]);
    expect(document.pages[0]?.sections.map((section) => section.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(
      document.pages[0]?.sections.every((section) => section.visible),
    ).toBe(true);

    // One-page overrides a label but never a preset: every library section is
    // created with its registry defaults.
    for (const section of document.pages[0]?.sections ?? []) {
      if (!isLibrarySection(section)) {
        continue;
      }
      expect(section.settings).toEqual(
        getSectionRegistryEntry(section.sectionType).defaultSettings(),
      );
    }
    expect(document.pages[0]?.sections[0]).toMatchObject({
      sectionType: 'hero',
      label: 'Welcome',
      settings: { preset: 'image_right' },
    });
  });

  it('creates the five Multi-page defaults', () => {
    const document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('multi'),
    });

    expect(document.navigation.enabled).toBe(true);
    expect(document.pages.map((page) => page.name)).toEqual([
      'Home',
      'Services & Booking',
      'Gallery',
      'About',
      'Contact',
    ]);
    expect(document.pages.map((page) => page.slug)).toEqual([
      '',
      'services-book',
      'gallery',
      'about',
      'contact',
    ]);
    expect(document.pages.flatMap((page) => page.sections)).toHaveLength(7);
    expect(
      document.pages.map((page) =>
        page.sections.map((section) => section.sectionType),
      ),
    ).toEqual([
      [
        'hero',
        'reviews',
      ],
      [
        'booking',
        'policies',
      ],
      ['gallery'],
      ['about'],
      ['visit_us'],
    ]);
    expect(
      document.pages[1]?.sections.map((section) => section.label),
    ).toEqual([
      'Booking',
      'Before You Book',
    ]);

    // The content pages contain only their release-owned responsibility.
    expect(document.pages[0]?.sections[0]).toMatchObject({
      sectionType: 'hero',
      label: 'Welcome',
      settings: { preset: 'image_right' },
    });
    expect(document.pages[2]?.sections[0]).toMatchObject({
      galleryPresentationOwner: 'onboarding',
      sectionType: 'gallery',
      label: 'Gallery',
      settings: { preset: 'grid', selection: { mode: 'all' }, version: 1 },
    });

    expect(document.navigation.items).toHaveLength(5);
    expect(document.navigation.items.map((item) => item.label)).toEqual([
      'Home',
      'Services & Booking',
      'Gallery',
      'About',
      'Contact',
    ]);
    expect(document.siteContent).toEqual(createEmptySiteContent());
  });

  it.each(starters)('%s has stable unique IDs and validates', (starter) => {
    const document = initializeStarter(starter, {
      idFactory: createDeterministicIdFactory(starter),
    });
    const ids = [
      document.siteId,
      ...document.pages.map((page) => page.id),
      ...document.pages.flatMap((page) =>
        page.sections.map((section) => section.id),
      ),
      ...document.navigation.items.map((item) => item.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    expect(validateSiteBuilderDocument(document)).toEqual({
      success: true,
      document,
    });
  });

  it.each(starters)('%s keeps legacy placeholder instances valid', (starter) => {
    const ids = createDeterministicIdFactory(`legacy-${starter}`);
    const document = initializeStarter(starter, { idFactory: ids });
    const home = document.pages.find((page) => page.isHome);
    if (!home) {
      throw new Error('Starter is missing Home.');
    }
    const withPlaceholder = addSection(
      document,
      { pageId: home.id, sectionType: 'section_11' },
      ids,
    );
    const placeholder = withPlaceholder.pages
      .flatMap((page) => page.sections)
      .find((section) => section.sectionType === 'section_11');

    expect(placeholder).toMatchObject({
      sectionType: 'section_11',
      label: 'Section 11',
      size: 'medium',
      placeholderSettings: { note: 'Content and settings will be designed later.' },
    });
    expect(placeholder).not.toHaveProperty('starterSemanticRole');
    expect(validateSiteBuilderDocument(withPlaceholder)).toEqual({
      success: true,
      document: withPlaceholder,
    });

    // A schema-v1-era instance that still carries the retired role metadata
    // stays valid: v2 stopped writing the field, it did not ban it.
    const tagged = structuredClone(withPlaceholder);
    const taggedPlaceholder = tagged.pages
      .flatMap((page) => page.sections)
      .find((section) => section.sectionType === 'section_11');
    if (taggedPlaceholder?.sectionType !== 'section_11') {
      throw new Error('Missing the owner-added placeholder.');
    }
    taggedPlaceholder.starterSemanticRole = 'about';

    expect(validateSiteBuilderDocument(tagged)).toEqual({
      success: true,
      document: tagged,
    });
  });
});

describe('add section catalogue', () => {
  it('offers only Custom Design beside the named library', () => {
    expect(ADD_SECTION_CATALOGUE.map((item) => item.sectionType)).toEqual([
      'custom_design',
    ]);
    // The numbered slots stay exported so legacy instances resolve labels and
    // sizes; they are simply no longer offered.
    expect(SECTION_CATALOGUE).toHaveLength(20);
    expect(SECTION_CATALOGUE[10]?.sectionType).toBe('section_11');
  });

  it('lists every registry section type in the Add Section library', () => {
    const library = getAddSectionLibrary();

    expect(library.map((item) => item.sectionType)).toEqual([
      'about',
      'announcement_bar',
      'contact',
      'deposits_cancellations',
      'faq',
      'featured_services',
      'final_cta',
      'footer',
      'gallery',
      'hero',
      'hours',
      'offers',
      'policies',
      'quick_info',
      'reviews',
      'section_navigation',
      'team',
      'visit_us',
    ]);
    expect(library.every((item) => item.kind === 'library')).toBe(true);
    expect(
      library
        .filter((item) => item.limitKind === 'hard')
        .map((item) => [item.sectionType, item.maxPerPage]),
    ).toEqual([
      ['announcement_bar', 1],
      ['footer', 1],
      ['hero', 1],
      ['section_navigation', 1],
    ]);
    expect(library.find((item) => item.sectionType === 'hero')).toMatchObject({
      label: 'Hero',
      category: 'conversion',
      defaultPresetId: 'image_right',
      presetIds: ['image_right', 'full_bleed', 'editorial_split', 'booking_first'],
    });
  });
});

describe('starter freedom', () => {
  it.each(starters)('%s uses the same catalogue and page capabilities', (starter) => {
    const ids = createDeterministicIdFactory(`freedom-${starter}`);
    let document = initializeStarter(starter, { idFactory: ids });
    const homeId = document.pages.find((page) => page.isHome)?.id;
    expect(homeId).toBeDefined();
    if (!homeId) {
      throw new Error('Starter is missing Home.');
    }

    document = addSection(
      document,
      { pageId: homeId, sectionType: SECTION_CATALOGUE[10]?.sectionType ?? 'section_11' },
      ids,
    );
    document = addPage(document, { name: 'New page' }, ids);
    document = toggleNavigation(document, true);

    expect(document.pages).toHaveLength(starter === 'multi_page' ? 6 : 2);
    expect(
      document.pages
        .find((page) => page.id === homeId)
        ?.sections.some((section) => section.sectionType === 'section_11'),
    ).toBe(true);
    const ownerAdded = document.pages
      .find(page => page.id === homeId)
      ?.sections.find(section => section.sectionType === 'section_11');
    expect(ownerAdded).not.toHaveProperty('starterSemanticRole');
    expect(document.navigation.enabled).toBe(true);
  });

  it('preserves library identity and truthful outline labels when a starter section moves', () => {
    const source = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('semantic-move'),
    });
    const home = source.pages.find(page => page.isHome)!;
    const aboutPage = source.pages.find(page => page.slug === 'about')!;
    const about = aboutPage.sections.find(section => section.sectionType === 'about')!;
    const moved = moveSectionToPage(source, about.id, home.id);
    const movedAbout = moved.pages
      .flatMap(page => page.sections)
      .find(section => section.id === about.id)!;
    movedAbout.label = 'Daniela’s story';
    const outlinedAbout = getStarterDocumentOutline(moved)
      .flatMap(page => page.sections)
      .find(section => section.id === about.id);

    expect(moved.pages.find(page => page.id === home.id)?.sections.map(
      section => section.sectionType,
    )).toEqual([
      'hero',
      'reviews',
      'about',
    ]);
    expect(moved.pages.find(page => page.id === aboutPage.id)?.sections.map(
      section => section.sectionType,
    )).toEqual([]);
    expect(movedAbout).toMatchObject({
      id: about.id,
      sectionType: 'about',
      settings: { intro: { source: 'shared' }, preset: 'photo_right', version: 1 },
    });
    expect(outlinedAbout?.label).toBe('Daniela’s story');
    expect(outlinedAbout?.sectionType).toBe('about');
    // The retired semantic-role projection is only ever populated for residual
    // v1 placeholders, never for a library section.
    expect(outlinedAbout).not.toHaveProperty('semanticRole');
  });

  it('lets Quick Book add fifteen sections and five pages', () => {
    const ids = createDeterministicIdFactory('large-quick');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Quick Book is missing Home.');
    }
    expect(home.sections).toHaveLength(3);

    for (const item of SECTION_CATALOGUE.slice(2, 17)) {
      document = addSection(
        document,
        { pageId: home.id, sectionType: item.sectionType },
        ids,
      );
    }
    for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
      document = addPage(document, { name: `Added page ${pageNumber}` }, ids);
    }

    expect(document.pages[0]?.sections).toHaveLength(18);
    expect(document.pages).toHaveLength(6);
  });

  it('lets Multi-page become a valid one-page site', () => {
    let document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('simple-multi'),
    });
    const home = document.pages.find((page) => page.isHome);
    const booking = document.pages
      .flatMap((page) => page.sections)
      .find((section) => section.sectionType === 'booking');
    if (!home || !booking) {
      throw new Error('Multi-page defaults are incomplete.');
    }
    document = moveSectionToPage(document, booking.id, home.id);
    for (const page of [...document.pages].filter((candidate) => !candidate.isHome)) {
      document = removePage(document, page.id);
    }

    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]?.isHome).toBe(true);
    expect(validateSiteBuilderDocument(document).success).toBe(true);
  });
});
