import { describe, expect, it } from 'vitest';

import { CANONICAL_SERVICES } from '../booking/data';
import { switchBookingLayout } from '../booking/presentation';
import { createDeterministicIdFactory } from './ids';
import {
  BuilderOperationError,
  addPage,
  addSection,
  commitSectionMove,
  getSectionMoveDestinationAvailability,
  getSectionMoveAnnouncement,
  moveNavigationItem,
  movePage,
  moveSection,
  moveSectionDown,
  moveSectionToNewPage,
  moveSectionToPage,
  moveSectionUp,
  removePage,
  removeSection,
  renameNavigationItem,
  renamePage,
  reorderSections,
  restorePage,
  restoreSection,
  resetBookingSectionPresentation,
  setPageNavigationVisibility,
  setPageSlug,
  setPageVisible,
  setSectionVisible,
  toggleNavigation,
  updateBookingSectionPresentation,
  updateLibrarySectionSettings,
  updateSectionSettings,
  updateSiteContent,
} from './operations';
import { getSectionRegistryEntry } from './section-library/registry';
import { initializeStarter } from './starters';
import { validateSiteBuilderDocument } from './validation';

describe('section operations', () => {
  it('adds at an explicit position and normalizes order', () => {
    const ids = createDeterministicIdFactory('add');
    const original = initializeStarter('quick_book', { idFactory: ids });
    const home = original.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    const document = addSection(
      original,
      { pageId: home.id, sectionType: 'section_11', position: 2 },
      ids,
    );

    expect(document.pages[0]?.sections.map((section) => section.sectionType)).toEqual([
      'hero',
      'section_11',
      'gallery',
      'booking',
      'about',
      'visit_us',
    ]);
    expect(document.pages[0]?.sections.map((section) => section.order)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(original.pages[0]?.sections).toHaveLength(5);
  });

  it('removes and restores the same placeholder instance with settings intact', () => {
    const ids = createDeterministicIdFactory('restore');
    const original = initializeStarter('quick_book', { idFactory: ids });
    const home = original.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    // Numbered placeholders are the only sections `updateSectionSettings`
    // still edits; starter pages no longer contain any, so add one.
    const withPlaceholder = addSection(
      original,
      { pageId: home.id, sectionType: 'section_11', position: 2 },
      ids,
    );
    const section = withPlaceholder.pages[0]?.sections[1];
    if (section?.sectionType !== 'section_11') {
      throw new Error('Missing the owner-added placeholder.');
    }
    const edited = updateSectionSettings(withPlaceholder, section.id, {
      label: 'My future section',
      note: 'Keep this owner note.',
      size: 'large',
    });
    const removed = removeSection(edited, section.id);

    expect(removed.pages[0]?.sections).toHaveLength(5);
    expect(removed.unusedSections[0]).toMatchObject({
      id: section.id,
      sectionType: 'section_11',
      label: 'My future section',
      size: 'large',
      placeholderSettings: { note: 'Keep this owner note.' },
    });

    const restored = restoreSection(removed, section.id, home.id, 2);
    expect(restored.unusedSections).toHaveLength(0);
    expect(restored.pages[0]?.sections[1]).toMatchObject({
      id: section.id,
      sectionType: 'section_11',
      label: 'My future section',
      size: 'large',
      placeholderSettings: { note: 'Keep this owner note.' },
    });
  });

  it('removes and restores a library instance with its settings intact', () => {
    const original = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('restore-library'),
    });
    const home = original.pages[0];
    const hero = home?.sections.find((section) => section.sectionType === 'hero');
    if (!home || hero?.sectionType !== 'hero') {
      throw new Error('Missing Hero.');
    }
    const customized = updateLibrarySectionSettings(original, hero.id, {
      ...hero.settings,
      preset: 'editorial_split',
      primaryCtaLabel: 'Reserve your seat',
    });
    const removed = removeSection(customized, hero.id);

    expect(removed.pages[0]?.sections.map((section) => section.sectionType)).toEqual([
      'gallery',
      'booking',
      'about',
      'visit_us',
    ]);
    expect(removed.unusedSections[0]).toMatchObject({
      id: hero.id,
      sectionType: 'hero',
      label: 'Salon intro',
      settings: {
        headline: { source: 'shared' },
        intro: { source: 'shared' },
        media: 'gradient',
        preset: 'editorial_split',
        primaryCtaLabel: 'Reserve your seat',
        showLocationEyebrow: false,
        showStatusLine: false,
        version: 1,
      },
    });

    const restored = restoreSection(removed, hero.id, home.id, 2);
    expect(restored.unusedSections).toHaveLength(0);
    expect(restored.pages[0]?.sections[1]).toEqual(
      removed.unusedSections[0] && { ...removed.unusedSections[0], order: 1 },
    );
  });

  it('supports numbered, up/down, and cross-page movement', () => {
    const ids = createDeterministicIdFactory('moves');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    document = addSection(
      document,
      { pageId: home.id, sectionType: 'section_11' },
      ids,
    );
    const section11 = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'section_11',
    );
    if (!section11) {
      throw new Error('Missing Section 11.');
    }
    document = moveSection(document, section11.id, 2);
    expect(getSectionMoveAnnouncement(document, section11.id)).toBe(
      'Section 11 moved to position 2 of 6.',
    );
    document = moveSectionDown(document, section11.id);
    expect(document.pages[0]?.sections[2]?.id).toBe(section11.id);
    document = moveSectionUp(document, section11.id);
    expect(document.pages[0]?.sections[1]?.id).toBe(section11.id);

    document = addPage(document, { name: 'Gallery' }, ids);
    const gallery = document.pages.find((page) => page.name === 'Gallery');
    if (!gallery) {
      throw new Error('Missing Gallery.');
    }
    document = moveSectionToPage(document, section11.id, gallery.id);
    expect(document.pages[0]?.sections.some((section) => section.id === section11.id)).toBe(
      false,
    );
    expect(document.pages[1]?.sections[0]?.id).toBe(section11.id);
  });

  it('can create a page while moving a section as one operation', () => {
    const ids = createDeterministicIdFactory('new-page-move');
    const original = initializeStarter('quick_book', { idFactory: ids });
    const section = original.pages[0]?.sections[0];
    if (!section) {
      throw new Error('Missing section.');
    }
    const document = moveSectionToNewPage(
      original,
      { sectionId: section.id, name: 'Portfolio', slug: 'My Portfolio' },
      ids,
    );

    expect(document.pages[1]).toMatchObject({ name: 'Portfolio', slug: 'my-portfolio' });
    expect(document.pages[1]?.sections[0]?.id).toBe(section.id);
  });

  it('reorders a page from one complete, exact set of section IDs', () => {
    const original = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('ordered-section-ids'),
    });
    const home = original.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    const originalIds = home.sections.map((section) => section.id);
    const requestedIds = [...originalIds].reverse();

    const reordered = reorderSections(original, home.id, requestedIds);

    expect(reordered.pages[0]?.sections.map((section) => section.id)).toEqual(
      requestedIds,
    );
    expect(reordered.pages[0]?.sections.map((section) => section.order)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(original.pages[0]?.sections.map((section) => section.id)).toEqual(
      originalIds,
    );
    expect(reorderSections(reordered, home.id, requestedIds)).toBe(reordered);
  });

  it('rejects incomplete, duplicate, or unknown ordered section IDs without mutation', () => {
    const original = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('invalid-ordered-section-ids'),
    });
    const home = original.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    const ids = home.sections.map((section) => section.id);
    const [first, second, third] = ids;
    if (!first || !second || !third) {
      throw new Error('Missing starter sections.');
    }
    const before = structuredClone(original);

    for (const invalidOrder of [
      [first, second],
      [first, first, third],
      [first, second, 'unknown-section-id'],
    ]) {
      expect(() => reorderSections(original, home.id, invalidOrder)).toThrowError(
        'Section order must contain every section on the page exactly once.',
      );
      expect(original).toEqual(before);
    }
  });

  it('rejects an invalid or foreign active section before applying any order', () => {
    const original = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('invalid-active-section-id'),
    });
    const home = original.pages[0];
    const booking = original.pages
      .flatMap((page) => page.sections)
      .find((section) => section.sectionType === 'booking');
    if (!home || !booking) {
      throw new Error('Missing starter structure.');
    }
    const reversedHomeOrder = home.sections.map((section) => section.id).reverse();
    const before = structuredClone(original);

    for (const sectionId of ['missing-section-id', booking.id]) {
      expect(() =>
        commitSectionMove(original, {
          sourcePageId: home.id,
          sectionId,
          orderedSectionIds: reversedHomeOrder,
        }),
      ).toThrowError(`Section not found on source page: ${sectionId}`);
      expect(original).toEqual(before);
    }
  });

  it('keeps the source document intact when a cross-page destination is invalid', () => {
    const original = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('invalid-move-destination'),
    });
    const home = original.pages[0];
    const booking = home?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!home || !booking) {
      throw new Error('Missing Booking.');
    }
    const before = structuredClone(original);

    expect(() =>
      commitSectionMove(original, {
        sourcePageId: home.id,
        sectionId: booking.id,
        orderedSectionIds: home.sections.map((section) => section.id).reverse(),
        destination: {
          type: 'existing_page',
          pageId: 'missing-page-id',
        },
      }),
    ).toThrowError('Page not found: missing-page-id');
    expect(original).toEqual(before);
  });
});

describe('page and navigation operations', () => {
  it('adds, edits, reorders, hides, removes, and restores a page', () => {
    const ids = createDeterministicIdFactory('pages');
    let document = initializeStarter('quick_book', { idFactory: ids });
    document = addPage(document, { name: 'Gallery' }, ids);
    const gallery = document.pages[1];
    if (!gallery) {
      throw new Error('Missing Gallery.');
    }
    const section = document.pages[0]?.sections[0];
    if (!section) {
      throw new Error('Missing section.');
    }
    document = moveSectionToPage(document, section.id, gallery.id);
    document = renamePage(document, gallery.id, 'Our Work');
    document = setPageSlug(document, gallery.id, 'Nail Art');
    document = setPageNavigationVisibility(document, gallery.id, false);
    document = setPageVisible(document, gallery.id, false);
    document = setPageVisible(document, gallery.id, true);
    document = movePage(document, gallery.id, 1);
    document = toggleNavigation(document, true);
    document = renameNavigationItem(document, gallery.id, 'Gallery');
    document = moveNavigationItem(document, gallery.id, 1);

    expect(document.pages[0]).toMatchObject({
      id: gallery.id,
      name: 'Our Work',
      slug: 'nail-art',
      visible: true,
      visibleInNavigation: false,
    });
    expect(document.navigation.items[0]).toMatchObject({
      pageId: gallery.id,
      label: 'Gallery',
    });

    const removed = removePage(document, gallery.id);
    expect(removed.pages.some((page) => page.id === gallery.id)).toBe(false);
    expect(removed.unusedSections.some((candidate) => candidate.id === section.id)).toBe(
      true,
    );
    const restored = restorePage(removed, gallery.id);
    expect(restored.pages.find((page) => page.id === gallery.id)?.sections[0]?.id).toBe(
      section.id,
    );
    expect(restored.navigation.items.some((item) => item.pageId === gallery.id)).toBe(
      true,
    );
  });

  it('creates unique normalized slugs', () => {
    const ids = createDeterministicIdFactory('slugs');
    let document = initializeStarter('quick_book', { idFactory: ids });
    document = addPage(document, { name: 'Gallery' }, ids);
    document = addPage(document, { name: 'Gallery' }, ids);

    expect(document.pages.map((page) => page.slug)).toEqual([
      '',
      'gallery',
      'gallery-2',
    ]);
  });
});

describe('Booking section operations and outcome invariants', () => {
  it('blocks removing or hiding the protected Booking section', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('booking'),
    });
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!booking) {
      throw new Error('Missing Booking.');
    }

    for (const operation of [
      () => removeSection(document, booking.id),
      () => setSectionVisible(document, booking.id, false),
    ]) {
      expect(operation).toThrowError(BuilderOperationError);
      expect(operation).toThrowError(
        'Your site needs at least one visible way for clients to start booking.',
      );
    }
    expect(document.unusedSections).toHaveLength(0);
  });

  it('rejects a duplicate Booking section', () => {
    const ids = createDeterministicIdFactory('duplicate-booking');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    expect(() =>
      addSection(
        document,
        { pageId: home.id, sectionType: 'booking' },
        ids,
      ),
    ).toThrowError(
      'Booking is already on this site. Move the existing Booking section instead.',
    );
  });

  it('moves Booking across pages without changing its presentation settings', () => {
    const ids = createDeterministicIdFactory('move-booking');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    const booking = home?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!home || booking?.sectionType !== 'booking') {
      throw new Error('Missing Booking.');
    }
    const canonicalBefore = JSON.stringify(CANONICAL_SERVICES);
    const customized = switchBookingLayout(booking.settings, 'clean_list');
    document = updateBookingSectionPresentation(
      document,
      booking.id,
      customized,
    );
    document = addPage(document, { name: 'Services' }, ids);
    const services = document.pages.find((page) => page.name === 'Services');
    if (!services) {
      throw new Error('Missing Services page.');
    }

    document = moveSectionToPage(document, booking.id, services.id);
    const moved = document.pages
      .flatMap((page) => page.sections)
      .find((section) => section.id === booking.id);

    expect(moved).toMatchObject({
      id: booking.id,
      sectionType: 'booking',
      settings: customized,
    });
    expect(document.pages.find((page) => page.id === home.id)?.sections)
      .not.toContainEqual(expect.objectContaining({ id: booking.id }));
    expect(JSON.stringify(CANONICAL_SERVICES)).toBe(canonicalBefore);
  });

  it('commits a cross-page Booking move without changing presentation settings', () => {
    const ids = createDeterministicIdFactory('commit-booking-move');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    const booking = home?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!home || booking?.sectionType !== 'booking') {
      throw new Error('Missing Booking.');
    }
    const customized = switchBookingLayout(booking.settings, 'editorial_cards');
    document = updateBookingSectionPresentation(document, booking.id, customized);
    document = addPage(document, { name: 'Services' }, ids);
    const services = document.pages.find((page) => page.name === 'Services');
    const committedHome = document.pages.find((page) => page.id === home.id);
    if (!services || !committedHome) {
      throw new Error('Missing move destination.');
    }
    const requestedOrder = committedHome.sections
      .map((section) => section.id)
      .reverse();

    const moved = commitSectionMove(document, {
      sourcePageId: home.id,
      sectionId: booking.id,
      orderedSectionIds: requestedOrder,
      destination: { type: 'existing_page', pageId: services.id },
    });
    const movedBooking = moved.pages
      .flatMap((page) => page.sections)
      .find((section) => section.id === booking.id);

    expect(movedBooking).toMatchObject({
      id: booking.id,
      sectionType: 'booking',
      settings: customized,
    });
    expect(moved.pages.find((page) => page.id === services.id)?.sections[0]?.id)
      .toBe(booking.id);
    expect(moved.pages.find((page) => page.id === home.id)?.sections.map(
      (section) => section.id,
    )).toEqual(requestedOrder.filter((id) => id !== booking.id));
  });

  it('atomically combines source ordering with an explicit destination position', () => {
    const ids = createDeterministicIdFactory('combined-cross-page-move');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    const booking = home?.sections.find((section) => section.sectionType === 'booking');
    if (!home || !booking) throw new Error('Missing Quick Book structure.');

    document = addPage(document, { name: 'Gallery' }, ids);
    const gallery = document.pages.find((page) => page.name === 'Gallery');
    if (!gallery) throw new Error('Missing Gallery.');
    document = addSection(document, { pageId: gallery.id, sectionType: 'section_11' }, ids);
    document = addSection(document, { pageId: gallery.id, sectionType: 'section_12' }, ids);
    const baseline = structuredClone(document);
    const requestedOrder = [...home.sections]
      .reverse()
      .map((section) => section.id);

    const committed = commitSectionMove(document, {
      sourcePageId: home.id,
      orderedSectionIds: requestedOrder,
      sectionId: booking.id,
      destination: { type: 'existing_page', pageId: gallery.id, position: 1 },
    });

    expect(document).toEqual(baseline);
    expect(committed.pages.find((page) => page.id === home.id)?.sections.map(
      (section) => section.label,
    )).toEqual([
      'Visit & Contact',
      'About',
      'Gallery',
      'Salon intro',
    ]);
    expect(committed.pages.find((page) => page.id === gallery.id)?.sections.map(
      (section) => section.label,
    )).toEqual(['Booking', 'Section 11', 'Section 12']);
  });

  it('updates and resets Booking presentation without accepting placeholder edits', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('booking-settings'),
    });
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (booking?.sectionType !== 'booking') {
      throw new Error('Missing Booking.');
    }
    const customized = switchBookingLayout(booking.settings, 'editorial_cards');
    const updated = updateBookingSectionPresentation(
      document,
      booking.id,
      customized,
    );
    const updatedBooking = updated.pages[0]?.sections.find(
      (section) => section.id === booking.id,
    );
    expect(updatedBooking).toMatchObject({ settings: customized });
    expect(() =>
      updateSectionSettings(updated, booking.id, { size: 'compact' }),
    ).toThrow('Use Booking presentation settings');

    const reset = resetBookingSectionPresentation(updated, booking.id);
    const resetBooking = reset.pages[0]?.sections.find(
      (section) => section.id === booking.id,
    );
    expect(resetBooking).toMatchObject({
      settings: expect.objectContaining({ layout: 'visual_grid' }),
    });
  });

  it('blocks hiding or removing the page that contains Booking', () => {
    const document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('booking-page'),
    });
    const bookingPage = document.pages.find((page) =>
      page.sections.some((section) => section.sectionType === 'booking'),
    );
    if (!bookingPage) {
      throw new Error('Missing Booking page.');
    }

    expect(() => setPageVisible(document, bookingPage.id, false)).toThrow(
      'Your site needs at least one visible way for clients to start booking.',
    );
    expect(() => removePage(document, bookingPage.id)).toThrow(
      'Your site needs at least one visible way for clients to start booking.',
    );
  });

  it('blocks moving Booking onto a hidden page', () => {
    const ids = createDeterministicIdFactory('hidden-booking-page');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (booking?.sectionType !== 'booking') {
      throw new Error('Missing Booking.');
    }
    document = addPage(document, { name: 'Hidden', visible: false }, ids);
    const hiddenPage = document.pages.find((page) => page.name === 'Hidden');
    if (!hiddenPage) {
      throw new Error('Missing hidden page.');
    }

    expect(() =>
      moveSectionToPage(document, booking.id, hiddenPage.id),
    ).toThrow(
      'Your site needs at least one visible way for clients to start booking.',
    );
    expect(document.pages[0]?.sections).toContainEqual(
      expect.objectContaining({ id: booking.id }),
    );
    expect(getSectionMoveDestinationAvailability(document, booking.id, hiddenPage.id))
      .toEqual({
        available: false,
        code: 'booking_required',
        reason: 'Your site needs at least one visible way for clients to start booking.',
      });
  });

  it('does not confuse a page omitted from navigation with a page hidden from clients', () => {
    const ids = createDeterministicIdFactory('not-in-navigation-destination');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!booking) throw new Error('Missing Booking.');
    document = addPage(document, {
      name: 'Direct booking',
      visible: true,
      visibleInNavigation: false,
    }, ids);
    const destination = document.pages.find((page) => page.name === 'Direct booking');
    if (!destination) throw new Error('Missing direct destination.');

    expect(getSectionMoveDestinationAvailability(document, booking.id, destination.id))
      .toEqual({ available: true });
  });

  it('blocks hiding the final visible page and removing Home', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('visible'),
    });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }

    expect(() => setPageVisible(document, home.id, false)).toThrow(
      'Your site needs at least one visible way for clients to start booking.',
    );
    expect(() => removePage(document, home.id)).toThrow('Home cannot be removed.');
  });
});

describe('library section operations', () => {
  const captureError = (operation: () => unknown): unknown => {
    try {
      operation();
    } catch (error) {
      return error;
    }
    throw new Error('Expected the operation to fail.');
  };

  it('adds a library section with registry defaults and with a preset', () => {
    const original = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('library'),
    });
    const home = original.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }

    const plain = addSection(
      original,
      { pageId: home.id, sectionType: 'offers' },
      createDeterministicIdFactory('plain'),
    );
    const added = plain.pages[0]?.sections.at(-1);
    if (added?.sectionType !== 'offers') {
      throw new Error('Missing the added Offers section.');
    }
    expect(added).toEqual({
      id: 'section_plain_1',
      sectionType: 'offers',
      label: 'Offers',
      order: 5,
      visible: true,
      settings: { offerIds: [], preset: 'cards', version: 1 },
    });
    expect(added.settings).toEqual(
      getSectionRegistryEntry('offers').defaultSettings(),
    );

    const withPreset = addSection(
      original,
      {
        pageId: home.id,
        sectionType: 'offers',
        position: 1,
        presetId: 'single_banner',
      },
      createDeterministicIdFactory('preset'),
    );
    expect(withPreset.pages[0]?.sections[0]).toEqual({
      id: 'section_preset_1',
      sectionType: 'offers',
      label: 'Offers',
      order: 0,
      visible: true,
      settings: { offerIds: [], preset: 'single_banner', version: 1 },
    });

    // A preset the registry does not publish is ignored, not persisted.
    const unknownPreset = addSection(
      original,
      { pageId: home.id, sectionType: 'offers', presetId: 'mega_banner' },
      createDeterministicIdFactory('unknown-preset'),
    );
    expect(unknownPreset.pages[0]?.sections.at(-1)).toMatchObject({
      sectionType: 'offers',
      settings: { preset: 'cards' },
    });
  });

  it('hard-stops a second instance of a per-page exclusive type', () => {
    const ids = createDeterministicIdFactory('hard-limit');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }

    const error = captureError(() =>
      addSection(document, { pageId: home.id, sectionType: 'hero' }, ids),
    );
    expect(error).toBeInstanceOf(BuilderOperationError);
    expect((error as BuilderOperationError).code).toBe('section_limit');
    expect((error as BuilderOperationError).message).toBe(
      'Hero is already on this page (maximum 1 per page). Edit the existing one instead.',
    );
    expect(
      document.pages[0]?.sections.filter((section) => section.sectionType === 'hero'),
    ).toHaveLength(1);

    // The hard limit is per page, so a second page may still carry a Hero.
    document = addPage(document, { name: 'Studio' }, ids);
    const studio = document.pages.find((page) => page.name === 'Studio');
    if (!studio) {
      throw new Error('Missing Studio page.');
    }
    document = addSection(document, { pageId: studio.id, sectionType: 'hero' }, ids);
    expect(
      document.pages.find((page) => page.id === studio.id)?.sections.map(
        (section) => section.sectionType,
      ),
    ).toEqual(['hero']);

    // Soft-limited types warn elsewhere; the operation itself still applies.
    document = addSection(
      document,
      { pageId: home.id, sectionType: 'featured_services' },
      ids,
    );
    document = addSection(
      document,
      { pageId: home.id, sectionType: 'featured_services' },
      ids,
    );
    expect(
      document.pages[0]?.sections.filter(
        (section) => section.sectionType === 'featured_services',
      ),
    ).toHaveLength(2);
  });

  it('enforces the hard per-page limit on cross-page moves and restores', () => {
    const ids = createDeterministicIdFactory('hard-limit-invariant');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }

    // Cross-page move: a hero legally added to a second page may not land on
    // a page that already has one.
    document = addPage(document, { name: 'Studio' }, ids);
    const studio = document.pages.find(page => page.name === 'Studio');
    if (!studio) {
      throw new Error('Missing Studio page.');
    }
    document = addSection(document, { pageId: studio.id, sectionType: 'hero' }, ids);
    const movedHeroId = document.pages
      .find(page => page.id === studio.id)?.sections[0]?.id;
    if (!movedHeroId) {
      throw new Error('Missing Studio hero.');
    }
    const moveError = captureError(() =>
      moveSectionToPage(document, movedHeroId, home.id),
    );
    expect(moveError).toBeInstanceOf(BuilderOperationError);
    expect((moveError as BuilderOperationError).code).toBe('section_limit');
    expect((moveError as BuilderOperationError).message).toBe(
      'Hero is already on this page (maximum 1 per page). Edit the existing one instead.',
    );

    // Footer is an advanced shell section, so add it explicitly before
    // exercising the generic hard-limit restore invariant.
    document = addSection(document, { pageId: home.id, sectionType: 'footer' }, ids);
    const footerId = document.pages
      .find(page => page.id === home.id)?.sections
      .find(section => section.sectionType === 'footer')?.id;
    if (!footerId) {
      throw new Error('Missing Quick Book footer.');
    }
    document = removeSection(document, footerId);
    document = addSection(document, { pageId: home.id, sectionType: 'footer' }, ids);
    const restoreError = captureError(() =>
      restoreSection(document, footerId, home.id),
    );
    expect(restoreError).toBeInstanceOf(BuilderOperationError);
    expect((restoreError as BuilderOperationError).code).toBe('section_limit');
    expect((restoreError as BuilderOperationError).message).toBe(
      'Footer is already on this page (maximum 1 per page). Edit the existing one instead.',
    );
    // The failed operations changed nothing: the document still validates.
    expect(validateSiteBuilderDocument(document).success).toBe(true);
  });

  it('refuses placeholder edits on library, Booking, and Custom Design sections', () => {
    const ids = createDeterministicIdFactory('placeholder-edits');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const homeId = document.pages[0]?.id;
    if (!homeId) throw new Error('Missing Quick Book Home.');
    document = addSection(document, { pageId: homeId, sectionType: 'footer' }, ids);
    document = addSection(
      document,
      { pageId: homeId, sectionType: 'custom_design' },
      ids,
    );
    const byType = (sectionType: string) =>
      document.pages[0]?.sections.find(
        (section) => section.sectionType === sectionType,
      );
    const hero = byType('hero');
    const footer = byType('footer');
    const booking = byType('booking');
    const customDesign = byType('custom_design');
    if (!hero || !footer || !booking || !customDesign) {
      throw new Error('Missing Quick Book structure.');
    }

    for (const section of [hero, footer]) {
      expect(() =>
        updateSectionSettings(document, section.id, { label: 'Renamed' }),
      ).toThrow('Use the section’s own settings to edit this section.');
      expect(() =>
        updateSectionSettings(document, section.id, { size: 'large' }),
      ).toThrow('Use the section’s own settings to edit this section.');
    }
    expect(() =>
      updateSectionSettings(document, booking.id, { note: 'nope' }),
    ).toThrow('Use Booking presentation settings to edit this section.');
    expect(() =>
      updateSectionSettings(document, customDesign.id, { note: 'nope' }),
    ).toThrow('Use Custom Design settings to edit this section.');
  });

  it('normalizes library settings through the owning registry entry', () => {
    const ids = createDeterministicIdFactory('normalize');
    let document = initializeStarter('one_page', { idFactory: ids });
    const homeId = document.pages[0]?.id;
    if (!homeId) throw new Error('Missing One-page Home.');
    document = addSection(
      document,
      { pageId: homeId, sectionType: 'announcement_bar' },
      ids,
    );
    document = addSection(
      document,
      { pageId: homeId, sectionType: 'quick_info' },
      ids,
    );
    const announcement = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'announcement_bar',
    );
    const quickInfo = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'quick_info',
    );
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!announcement || !quickInfo || !booking) {
      throw new Error('Missing One-page structure.');
    }

    const announced = updateLibrarySectionSettings(document, announcement.id, {
      action: { kind: 'url', label: 'See the offer', url: 'https://example.com/offer' },
      dismissible: 'nope',
      extra: 'dropped',
      message: 'x'.repeat(140),
      reassurance: 'y'.repeat(100),
      tone: 'loud',
      version: 9,
    });
    expect(
      announced.pages[0]?.sections.find((section) => section.id === announcement.id),
    ).toMatchObject({
      settings: {
        action: { kind: 'url', label: 'See the offer', url: 'https://example.com/offer' },
        dismissible: true,
        message: 'x'.repeat(120),
        reassurance: 'y'.repeat(90),
        tone: 'tint',
        version: 1,
      },
    });

    const facts = updateLibrarySectionSettings(announced, quickInfo.id, {
      facts: [
        'minimum_notice',
        'not_a_fact',
        'open_status',
        'location',
        'visit_mode',
        'new_clients',
      ],
      version: 1,
    });
    expect(
      facts.pages[0]?.sections.find((section) => section.id === quickInfo.id),
    ).toMatchObject({
      settings: {
        facts: ['minimum_notice', 'open_status', 'location', 'visit_mode'],
        version: 1,
      },
    });

    // Wholly unusable input falls back to the registry defaults rather than
    // persisting anything the type does not recognize.
    const reset = updateLibrarySectionSettings(facts, quickInfo.id, 'garbage');
    expect(
      reset.pages[0]?.sections.find((section) => section.id === quickInfo.id),
    ).toMatchObject({
      settings: getSectionRegistryEntry('quick_info').defaultSettings(),
    });

    expect(() => updateLibrarySectionSettings(document, booking.id, {})).toThrow(
      'This section does not use library settings.',
    );
  });

  it('upserts, reorders, and removes shared site content records', () => {
    const document = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('site-content'),
    });
    expect(document.siteContent).toEqual({
      faq: [],
      offers: [],
      reviews: [],
      staff: [],
    });
    const ana = {
      id: 'review_ana',
      quote: 'The best shape I have ever had.',
      authorName: 'Ana',
      rating: 5,
      source: 'client' as const,
      visible: true,
    };
    const mia = {
      id: 'review_mia',
      quote: 'Worth the trip across town.',
      authorName: 'Mia',
      rating: null,
      source: 'google' as const,
      visible: true,
    };

    let next = updateSiteContent(document, {
      collection: 'reviews',
      operation: 'upsert',
      record: ana,
    });
    next = updateSiteContent(next, {
      collection: 'reviews',
      operation: 'upsert',
      record: mia,
    });
    expect(next.siteContent.reviews.map((review) => review.id)).toEqual([
      'review_ana',
      'review_mia',
    ]);

    // Upserting an existing id edits in place instead of appending.
    next = updateSiteContent(next, {
      collection: 'reviews',
      operation: 'upsert',
      record: { ...ana, quote: 'Edited in place.' },
    });
    expect(next.siteContent.reviews.map((review) => review.id)).toEqual([
      'review_ana',
      'review_mia',
    ]);
    expect(next.siteContent.reviews[0]?.quote).toBe('Edited in place.');

    next = updateSiteContent(next, {
      collection: 'reviews',
      operation: 'reorder',
      orderedIds: ['review_mia', 'review_ana'],
    });
    expect(next.siteContent.reviews.map((review) => review.id)).toEqual([
      'review_mia',
      'review_ana',
    ]);

    expect(() =>
      updateSiteContent(next, {
        collection: 'reviews',
        operation: 'reorder',
        orderedIds: ['review_mia'],
      }),
    ).toThrow('Reordering must include every existing record exactly once.');
    expect(() =>
      updateSiteContent(next, {
        collection: 'reviews',
        operation: 'remove',
        recordId: 'review_missing',
      }),
    ).toThrow('Content record not found: review_missing');

    const removed = updateSiteContent(next, {
      collection: 'reviews',
      operation: 'remove',
      recordId: 'review_mia',
    });
    expect(removed.siteContent).toEqual({
      faq: [],
      offers: [],
      reviews: [{ ...ana, quote: 'Edited in place.' }],
      staff: [],
    });
    // Other collections are untouched by a reviews edit.
    expect(removed.pages).toEqual(document.pages);
  });

  it('leaves a bound section reference dangling when its record is removed', () => {
    const document = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('dangling'),
    });
    const reviewsSection = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'reviews',
    );
    if (!reviewsSection) {
      throw new Error('Missing Reviews section.');
    }
    const record = {
      id: 'review_ana',
      quote: 'The best shape I have ever had.',
      authorName: 'Ana',
      rating: 5,
      source: 'client' as const,
      visible: true,
    };

    const withReview = updateSiteContent(document, {
      collection: 'reviews',
      operation: 'upsert',
      record,
    });
    const bound = updateLibrarySectionSettings(withReview, reviewsSection.id, {
      preset: 'editorial_quote',
      reviewIds: ['review_ana'],
      showRatings: false,
      version: 1,
    });
    const removed = updateSiteContent(bound, {
      collection: 'reviews',
      operation: 'remove',
      recordId: 'review_ana',
    });

    expect(removed.siteContent.reviews).toEqual([]);
    expect(
      removed.pages[0]?.sections.find((section) => section.id === reviewsSection.id),
    ).toMatchObject({
      settings: {
        preset: 'editorial_quote',
        reviewIds: ['review_ana'],
        showRatings: false,
        version: 1,
      },
    });
  });
});
