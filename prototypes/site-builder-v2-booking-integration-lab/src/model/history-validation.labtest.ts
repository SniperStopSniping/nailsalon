import { describe, expect, it } from 'vitest';

import {
  applyHistoryCommand,
  canRedoHistory,
  canUndoHistory,
  createHistoryState,
  redoHistory,
  undoHistory,
} from './history';
import { createDeterministicIdFactory } from './ids';
import { initializeStarter } from './starters';
import type { SiteBuilderDocument } from './types';
import {
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
});

describe('validation, import, and export', () => {
  it('round-trips a valid serializable document', () => {
    const document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('roundtrip'),
    });
    const json = exportSiteBuilderDocument(document);
    const imported = parseSiteBuilderDocument(json);

    expect(SITE_BUILDER_STORAGE_KEY).toContain('schema-1');
    expect(imported).toEqual({ success: true, document });
    expect(JSON.parse(json)).toEqual(document);
  });

  it('fails safely for malformed JSON and unsupported schema versions', () => {
    expect(parseSiteBuilderDocument('{bad json')).toEqual({
      success: false,
      issues: ['The selected file is not valid JSON.'],
    });
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('bad-schema'),
    });
    const invalid = { ...document, schemaVersion: 2 };

    expect(validateSiteBuilderDocument(invalid)).toMatchObject({ success: false });
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
          (section) => section.sectionType !== 'booking_access',
        ),
      })),
    } satisfies SiteBuilderDocument;
    expect(validateSiteBuilderDocument(withoutBooking)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        'Document must have at least one visible Booking access section.',
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
});
