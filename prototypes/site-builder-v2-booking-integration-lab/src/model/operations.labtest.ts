import { describe, expect, it } from 'vitest';

import { createDeterministicIdFactory } from './ids';
import {
  BuilderOperationError,
  addPage,
  addSection,
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
  restorePage,
  restoreSection,
  setPageNavigationVisibility,
  setPageSlug,
  setPageVisible,
  setSectionVisible,
  toggleNavigation,
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
      'booking_access',
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

describe('outcome invariants', () => {
  it('blocks removing or hiding the final Booking access path', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('booking'),
    });
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking_access',
    );
    if (!booking) {
      throw new Error('Missing Booking access.');
    }

    for (const operation of [
      () => removeSection(document, booking.id),
      () => setSectionVisible(document, booking.id, false),
    ]) {
      expect(operation).toThrowError(BuilderOperationError);
      expect(operation).toThrowError(
        'Your site needs at least one way for clients to book.',
      );
    }
  });

  it('allows one booking path to move when another visible path remains', () => {
    const ids = createDeterministicIdFactory('two-booking');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Missing Home.');
    }
    document = addSection(
      document,
      { pageId: home.id, sectionType: 'booking_access' },
      ids,
    );
    const bookingIds = document.pages[0]?.sections
      .filter((section) => section.sectionType === 'booking_access')
      .map((section) => section.id);
    expect(bookingIds).toHaveLength(2);
    if (!bookingIds?.[0]) {
      throw new Error('Missing booking ID.');
    }
    document = removeSection(document, bookingIds[0]);
    expect(document.unusedSections.some((section) => section.id === bookingIds[0])).toBe(
      true,
    );
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
      'Your site needs at least one visible page.',
    );
    expect(() => removePage(document, home.id)).toThrow('Home cannot be removed.');
  });
});
