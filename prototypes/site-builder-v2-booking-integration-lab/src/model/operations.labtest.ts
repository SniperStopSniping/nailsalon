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
  updateSectionSettings,
} from './operations';
import { initializeStarter } from './starters';

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
      'section_01',
      'section_11',
      'section_02',
      'booking',
    ]);
    expect(document.pages[0]?.sections.map((section) => section.order)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(original.pages[0]?.sections).toHaveLength(3);
  });

  it('removes and restores the same instance with settings intact', () => {
    const original = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('restore'),
    });
    const home = original.pages[0];
    const section = home?.sections[1];
    if (!home || !section) {
      throw new Error('Missing starter section.');
    }
    const edited = updateSectionSettings(original, section.id, {
      label: 'My future section',
      note: 'Keep this owner note.',
      size: 'large',
    });
    const removed = removeSection(edited, section.id);

    expect(removed.pages[0]?.sections).toHaveLength(2);
    expect(removed.unusedSections[0]).toMatchObject({
      id: section.id,
      label: 'My future section',
      size: 'large',
      placeholderSettings: { note: 'Keep this owner note.' },
    });

    const restored = restoreSection(removed, section.id, home.id, 2);
    expect(restored.unusedSections).toHaveLength(0);
    expect(restored.pages[0]?.sections[1]).toMatchObject({
      id: section.id,
      label: 'My future section',
      size: 'large',
      placeholderSettings: { note: 'Keep this owner note.' },
    });
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
      'Section 11 moved to position 2 of 4.',
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
      0, 1, 2,
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
    const requestedOrder = [
      home.sections[1]?.id,
      booking.id,
      home.sections[0]?.id,
    ].filter((id): id is string => Boolean(id));

    const committed = commitSectionMove(document, {
      sourcePageId: home.id,
      orderedSectionIds: requestedOrder,
      sectionId: booking.id,
      destination: { type: 'existing_page', pageId: gallery.id, position: 1 },
    });

    expect(document).toEqual(baseline);
    expect(committed.pages.find((page) => page.id === home.id)?.sections.map(
      (section) => section.label,
    )).toEqual(['Section 02', 'Section 01']);
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
