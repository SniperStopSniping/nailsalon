import { describe, expect, it } from 'vitest';

import {
  createDefaultBookingPresentationSettings,
  switchBookingLayout,
} from '../booking/presentation';
import {
  applyHistoryCommand,
  canRedoHistory,
  canUndoHistory,
  createHistoryState,
  redoHistory,
  undoHistory,
} from './history';
import { createDeterministicIdFactory } from './ids';
import { updateLibrarySectionSettings, updateSiteContent } from './operations';
import { initializeStarter } from './starters';
import type { SiteBuilderDocument } from './types';
import {
  MAX_SITE_BUILDER_IMPORT_JSON_LENGTH,
  SITE_BUILDER_STORAGE_KEY,
  exportSiteBuilderDocument,
  parseSiteBuilderDocument,
  validateSiteBuilderDocument,
} from './validation';

describe('structural history', () => {
  it('undoes and redoes complete logical commands', () => {
    const ids = createDeterministicIdFactory('history');
    const initial = initializeStarter('quick_book', { idFactory: ids });
    const home = initial.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    let history = createHistoryState(initial);
    history = applyHistoryCommand(
      history,
      {
        type: 'add_section',
        input: { pageId: home.id, sectionType: 'section_11', position: 2 },
      },
      { idFactory: ids },
    );
    history = applyHistoryCommand(history, {
      type: 'add_page',
      input: { name: 'Gallery' },
    }, { idFactory: ids });
    const gallery = history.present.pages.find((page) => page.name === 'Gallery');
    const section11 = history.present.pages[0]?.sections.find(
      (section) => section.sectionType === 'section_11',
    );
    if (!gallery || !section11) {
      throw new Error('History setup failed.');
    }
    history = applyHistoryCommand(history, {
      type: 'move_section_to_page',
      sectionId: section11.id,
      pageId: gallery.id,
    });
    const moved = history.present;

    expect(canUndoHistory(history)).toBe(true);
    history = undoHistory(history);
    expect(history.present.pages[0]?.sections.some((section) => section.id === section11.id)).toBe(
      true,
    );
    expect(canRedoHistory(history)).toBe(true);
    history = redoHistory(history);
    expect(history.present).toEqual(moved);
  });

  it('covers destructive-looking remove and restore as single history entries', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('remove-history'),
    });
    const section = initial.pages[0]?.sections[1];
    if (!section) {
      throw new Error('Missing section.');
    }
    let history = createHistoryState(initial);
    history = applyHistoryCommand(history, {
      type: 'remove_section',
      sectionId: section.id,
    });
    expect(history.present.unusedSections[0]?.id).toBe(section.id);
    history = undoHistory(history);
    expect(history.present).toEqual(initial);
    history = redoHistory(history);
    expect(history.present.unusedSections[0]?.id).toBe(section.id);
  });

  it('does not create history for a no-op', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('no-op'),
    });
    const history = createHistoryState(initial);
    const unchanged = applyHistoryCommand(history, {
      type: 'toggle_navigation',
      enabled: false,
    });

    expect(unchanged).toBe(history);
    expect(canUndoHistory(unchanged)).toBe(false);
  });

  it('groups a page settings form submission into one undo entry', () => {
    const initial = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('page-settings-history'),
    });
    const page = initial.pages[2];
    if (!page) {
      throw new Error('Missing optional page.');
    }
    let history = createHistoryState(initial);
    history = applyHistoryCommand(history, {
      type: 'update_page_settings',
      pageId: page.id,
      name: 'Portfolio',
      slug: 'work',
      visible: false,
      visibleInNavigation: false,
    });

    expect(history.past).toHaveLength(1);
    expect(history.present.pages[2]).toMatchObject({
      name: 'Portfolio',
      slug: 'work',
      visible: false,
      visibleInNavigation: false,
    });
    history = undoHistory(history);
    expect(history.present).toEqual(initial);
  });

  it('records a committed section order as one logical history entry', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('section-order-history'),
    });
    const home = initial.pages[0];
    const booking = home?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!home || !booking) {
      throw new Error('Missing Booking.');
    }
    const requestedOrder = [
      booking.id,
      ...home.sections
        .filter((section) => section.id !== booking.id)
        .map((section) => section.id),
    ];
    let history = createHistoryState(initial);

    history = applyHistoryCommand(history, {
      type: 'commit_section_move',
      input: {
        sourcePageId: home.id,
        sectionId: booking.id,
        orderedSectionIds: requestedOrder,
      },
    });

    expect(history.past).toHaveLength(1);
    expect(history.present.pages[0]?.sections.map((section) => section.id)).toEqual(
      requestedOrder,
    );
    const committed = history.present;

    history = undoHistory(history);
    expect(history.present).toEqual(initial);
    expect(history.future).toEqual([committed]);

    history = redoHistory(history);
    expect(history.present).toEqual(committed);
    expect(history.past).toHaveLength(1);
  });

  it('undoes and redoes a combined cross-page transaction in one step', () => {
    const initial = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('cross-page-history'),
    });
    const source = initial.pages.find((page) => page.name === 'Services / Book');
    const destination = initial.pages.find((page) => page.name === 'Home');
    const booking = source?.sections.find((section) => section.sectionType === 'booking');
    if (!source || !destination || !booking) throw new Error('Missing multi-page structure.');
    const requestedOrder = [...source.sections].reverse().map((section) => section.id);
    let history = createHistoryState(initial);

    history = applyHistoryCommand(history, {
      type: 'commit_section_move',
      input: {
        sourcePageId: source.id,
        orderedSectionIds: requestedOrder,
        sectionId: booking.id,
        destination: { type: 'existing_page', pageId: destination.id, position: 1 },
      },
    });

    expect(history.past).toEqual([initial]);
    expect(history.present.pages.find((page) => page.id === destination.id)?.sections[0]?.id)
      .toBe(booking.id);
    const committed = history.present;
    history = undoHistory(history);
    expect(history.present).toEqual(initial);
    history = redoHistory(history);
    expect(history.present).toEqual(committed);
    expect(history.past).toEqual([initial]);
  });

  it('creates a destination page and moves its section as one undoable command', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('new-page-move-history'),
    });
    const source = initial.pages[0];
    const section = source?.sections[0];
    if (!source || !section) throw new Error('Missing Quick Book structure.');
    let history = createHistoryState(initial);

    history = applyHistoryCommand(history, {
      type: 'commit_section_move',
      input: {
        sourcePageId: source.id,
        orderedSectionIds: [...source.sections].reverse().map((candidate) => candidate.id),
        sectionId: section.id,
        destination: { type: 'new_page', name: 'Portfolio', position: 1 },
      },
    });

    expect(history.past).toEqual([initial]);
    expect(history.present.pages.find((page) => page.name === 'Portfolio')?.sections[0]?.id)
      .toBe(section.id);
    const committed = history.present;
    history = undoHistory(history);
    expect(history.present).toEqual(initial);
    history = redoHistory(history);
    expect(history.present).toEqual(committed);
  });

  it('records Booking presentation updates and reset while customer state stays external', () => {
    const initial = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('booking-history'),
    });
    const booking = initial.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (booking?.sectionType !== 'booking') {
      throw new Error('Missing Booking.');
    }
    const customerState = {
      serviceId: 'svc-manicure-russian',
      addOnIds: ['addon-french'],
      query: 'russian',
    };
    let history = createHistoryState(initial);
    const cleanList = switchBookingLayout(booking.settings, 'clean_list');
    history = applyHistoryCommand(history, {
      type: 'update_booking_presentation',
      sectionId: booking.id,
      settings: cleanList,
    });

    expect(history.past).toHaveLength(1);
    expect(history.present.pages[0]?.sections.find(
      (section) => section.id === booking.id,
    )).toMatchObject({ settings: cleanList });
    expect(customerState).toEqual({
      serviceId: 'svc-manicure-russian',
      addOnIds: ['addon-french'],
      query: 'russian',
    });

    history = applyHistoryCommand(history, {
      type: 'reset_booking_presentation',
      sectionId: booking.id,
    });
    expect(history.past).toHaveLength(2);
    expect(history.present.pages[0]?.sections.find(
      (section) => section.id === booking.id,
    )).toMatchObject({
      settings: createDefaultBookingPresentationSettings(),
    });

    history = undoHistory(history);
    expect(history.present.pages[0]?.sections.find(
      (section) => section.id === booking.id,
    )).toMatchObject({ settings: cleanList });
  });

  it('records library settings and shared content edits as single undo entries', () => {
    const initial = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('library-history'),
    });
    const hero = initial.pages[0]?.sections.find(
      (section) => section.sectionType === 'hero',
    );
    if (hero?.sectionType !== 'hero') {
      throw new Error('Missing Hero.');
    }
    const member = {
      id: 'staff_ana',
      name: 'Ana',
      title: 'Nail artist',
      specialties: ['Structured gel'],
      acceptsBookings: true,
    };
    let history = createHistoryState(initial);

    history = applyHistoryCommand(history, {
      type: 'update_library_section_settings',
      sectionId: hero.id,
      settings: { ...hero.settings, preset: 'full_bleed', showStatusLine: false },
    });
    expect(history.past).toHaveLength(1);
    expect(history.present.pages[0]?.sections.find(
      (section) => section.id === hero.id,
    )).toMatchObject({
      settings: {
        headline: { source: 'shared' },
        intro: { source: 'shared' },
        media: 'profile_photo',
        preset: 'full_bleed',
        primaryCtaLabel: 'Book an appointment',
        showLocationEyebrow: true,
        showStatusLine: false,
        version: 1,
      },
    });

    history = applyHistoryCommand(history, {
      type: 'update_site_content',
      input: { collection: 'staff', operation: 'upsert', record: member },
    });
    expect(history.past).toHaveLength(2);
    expect(history.present.siteContent.staff).toEqual([member]);

    history = undoHistory(history);
    expect(history.present.siteContent.staff).toEqual([]);
    expect(history.present.pages[0]?.sections.find(
      (section) => section.id === hero.id,
    )).toMatchObject({ settings: { preset: 'full_bleed' } });

    history = undoHistory(history);
    expect(history.present).toEqual(initial);
    expect(canUndoHistory(history)).toBe(false);
  });
});

describe('validation, import, and export', () => {
  it('round-trips a valid serializable document', () => {
    const document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('roundtrip'),
    });
    const json = exportSiteBuilderDocument(document);
    const imported = parseSiteBuilderDocument(json);

    expect(SITE_BUILDER_STORAGE_KEY).toBe(
      'luster:site-builder-v2-booking-integration-lab:document:v1',
    );
    expect(imported).toEqual({ success: true, document });
    expect(JSON.parse(json)).toEqual(document);
    expect(json).not.toContain('Russian Manicure');
    // Sections bind to the canonical menu by id; the exported document must
    // still carry no customer selection state. `serviceIds` below is the
    // Featured Services binding, so the guard targets the exact customer keys.
    expect(json).not.toContain('"serviceId"');
    expect(json).not.toContain('addOnIds');
    expect(json).not.toContain('detailServiceId');
    expect(json).not.toContain('query');
    const featuredServices = document.pages
      .flatMap((page) => page.sections)
      .find((section) => section.sectionType === 'featured_services');
    expect(featuredServices).toMatchObject({
      settings: { preset: 'grid', serviceIds: [], source: 'featured', version: 1 },
    });
    expect(json).toContain('"serviceIds": []');
    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: 2,
      siteContent: { faq: [], offers: [], reviews: [], staff: [] },
    });
  });

  it('round-trips shared content and customized library settings', () => {
    const initial = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('content-roundtrip'),
    });
    const reviewsSection = initial.pages[0]?.sections.find(
      (section) => section.sectionType === 'reviews',
    );
    if (!reviewsSection) {
      throw new Error('Missing Reviews section.');
    }
    const withContent = updateSiteContent(initial, {
      collection: 'reviews',
      operation: 'upsert',
      record: {
        id: 'review_ana',
        quote: 'The best shape I have ever had.',
        authorName: 'Ana',
        rating: 5,
        source: 'client',
        visible: true,
      },
    });
    const document = updateLibrarySectionSettings(withContent, reviewsSection.id, {
      preset: 'editorial_quote',
      reviewIds: ['review_ana'],
      showRatings: false,
      version: 1,
    });

    const json = exportSiteBuilderDocument(document);
    expect(parseSiteBuilderDocument(json)).toEqual({ success: true, document });
    expect(JSON.parse(json)).toMatchObject({
      siteContent: {
        reviews: [
          {
            id: 'review_ana',
            quote: 'The best shape I have ever had.',
            authorName: 'Ana',
            rating: 5,
            source: 'client',
            visible: true,
          },
        ],
      },
    });
  });

  it('fails safely for malformed JSON and unsupported schema versions', () => {
    expect(parseSiteBuilderDocument('{bad json')).toEqual({
      success: false,
      issues: ['The selected file is not valid JSON.'],
    });
    expect(
      parseSiteBuilderDocument('x'.repeat(MAX_SITE_BUILDER_IMPORT_JSON_LENGTH + 1)),
    ).toEqual({
      success: false,
      issues: ['The selected site document is too large.'],
    });
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('bad-schema'),
    });

    // v2 is the only version `validateSiteBuilderDocument` itself accepts.
    for (const schemaVersion of [0, 1, 3, '2', null]) {
      expect(
        validateSiteBuilderDocument({ ...document, schemaVersion }),
      ).toMatchObject({
        success: false,
        issues: expect.arrayContaining(['schemaVersion must be 2.']),
      });
    }
    expect(validateSiteBuilderDocument(document)).toMatchObject({ success: true });

    // Import is the one path that upgrades: a v1 document is re-versioned
    // before validation instead of being rejected.
    expect(
      parseSiteBuilderDocument(JSON.stringify({ ...document, schemaVersion: 1 })),
    ).toEqual({ success: true, document });
    expect(
      parseSiteBuilderDocument(JSON.stringify({ ...document, schemaVersion: 3 })),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining(['schemaVersion must be 2.']),
    });
  });

  it('rejects library sections and shared content the Builder could not create', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('library-invariants'),
    });
    const home = document.pages[0];
    const hero = home?.sections[1];
    if (!home || hero?.sectionType !== 'hero') {
      throw new Error('Missing Hero.');
    }

    const badSettings = structuredClone(document) as unknown as {
      pages: Array<{ sections: Array<{ settings: Record<string, unknown> }> }>;
    };
    const badHero = badSettings.pages[0]?.sections[1];
    if (!badHero) {
      throw new Error('Missing Hero.');
    }
    badHero.settings.preset = 'not_a_preset';
    expect(validateSiteBuilderDocument(badSettings)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        'pages[0].sections[1].settings is not a valid Hero configuration.',
      ]),
    });

    const twoHeroes = structuredClone(document);
    twoHeroes.pages[0]?.sections.push({
      ...structuredClone(hero),
      id: 'section_second_hero',
      order: twoHeroes.pages[0].sections.length,
    });
    expect(validateSiteBuilderDocument(twoHeroes)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        `Page ${home.id} exceeds the Hero limit of 1 per page.`,
      ]),
    });

    const duplicateContent = structuredClone(document);
    duplicateContent.siteContent.faq = [
      { id: 'faq_1', question: 'Do you take walk-ins?', answer: 'By appointment only.' },
      { id: 'faq_1', question: 'Do you repair a break?', answer: 'Within seven days.' },
    ];
    expect(validateSiteBuilderDocument(duplicateContent)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        'siteContent.faq[1].id is duplicated within siteContent.faq.',
      ]),
    });

    expect(
      validateSiteBuilderDocument({ ...document, siteContent: undefined }),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining(['siteContent must be an object.']),
    });
  });

  it('rejects corrupted invariants and non-normalized ordering', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('corrupt'),
    });
    const withoutBooking = {
      ...document,
      pages: document.pages.map((page) => ({
        ...page,
        sections: page.sections.filter(
          (section) => section.sectionType !== 'booking',
        ),
      })),
    } satisfies SiteBuilderDocument;
    expect(validateSiteBuilderDocument(withoutBooking)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        'Document must contain exactly one Booking section.',
      ]),
    });

    const badOrder: SiteBuilderDocument = {
      ...document,
      pages: document.pages.map((page) => ({ ...page, order: 7 })),
    };
    expect(validateSiteBuilderDocument(badOrder)).toMatchObject({
      success: false,
      issues: expect.arrayContaining(['Page ordering must be normalized.']),
    });
  });

  it('strictly rejects incompatible Booking controls and injected business or customer data', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('invalid-booking-settings'),
    });
    const incompatible = structuredClone(document) as unknown as {
      pages: Array<{
        sections: Array<Record<string, unknown>>;
      }>;
    };
    const booking = incompatible.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!booking) {
      throw new Error('Missing Booking.');
    }
    const settings = booking.settings as Record<string, unknown>;
    settings.layout = 'clean_list';
    settings.layoutSettings = {
      density: 'comfortable',
      imageMode: 'show',
      showFeatured: true,
      categoryNavigation: 'pills',
      showDescriptions: true,
    };
    settings.services = [{ name: 'Injected service', price: 1 }];
    booking.selection = { serviceId: 'svc-injected', addOnIds: [] };

    const result = validateSiteBuilderDocument(incompatible);
    expect(result).toMatchObject({ success: false });
    if (result.success) {
      throw new Error('Invalid Booking settings unexpectedly validated.');
    }
    expect(result.issues.join(' ')).toContain('imageMode');
    expect(result.issues.join(' ')).toContain('services');
    expect(result.issues.join(' ')).toContain('selection');
  });

  it('rejects duplicate Booking, duplicate IDs, malformed page references, and hidden capability', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('invalid-document'),
    });
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (booking?.sectionType !== 'booking') {
      throw new Error('Missing Booking.');
    }

    const duplicateBooking = structuredClone(document);
    duplicateBooking.pages[0]?.sections.push({
      ...structuredClone(booking),
      id: 'section_duplicate_booking',
      order: duplicateBooking.pages[0].sections.length,
    });
    expect(validateSiteBuilderDocument(duplicateBooking)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        'Document must contain exactly one Booking section.',
      ]),
    });

    const duplicateId = structuredClone(document);
    if (duplicateId.pages[0]?.sections[0]) {
      duplicateId.pages[0].sections[0].id = booking.id;
    }
    expect(validateSiteBuilderDocument(duplicateId)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.stringContaining('Entity IDs must be unique'),
      ]),
    });

    const badReference = structuredClone(document);
    if (badReference.navigation.items[0]) {
      badReference.navigation.items[0].pageId = 'page_missing';
    }
    expect(validateSiteBuilderDocument(badReference)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        'Navigation must have exactly one item for each active page.',
      ]),
    });

    const hiddenBooking = structuredClone(document);
    const hidden = hiddenBooking.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (hidden?.sectionType === 'booking') {
      hidden.visible = false;
    }
    expect(validateSiteBuilderDocument(hiddenBooking)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        'Booking must be visible on a visible page.',
      ]),
    });
  });
});
