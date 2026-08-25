import { describe, expect, it } from 'vitest';

import { SECTION_CATALOGUE } from './catalogue';
import { createDeterministicIdFactory } from './ids';
import {
  addPage,
  addSection,
  moveSectionToPage,
  removePage,
  toggleNavigation,
} from './operations';
import { initializeStarter } from './starters';
import type { OriginStarter } from './types';
import { validateSiteBuilderDocument } from './validation';

const starters: readonly OriginStarter[] = [
  'quick_book',
  'one_page',
  'multi_page',
];

describe('starter initialization', () => {
  it('creates the exact Quick Book defaults', () => {
    const document = initializeStarter('quick_book', {
      idFactory: createDeterministicIdFactory('quick'),
    });

    expect(document.schemaVersion).toBe(1);
    expect(document.originStarter).toBe('quick_book');
    expect(document.navigation.enabled).toBe(false);
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]?.sections.map((section) => section.sectionType)).toEqual(
      ['section_01', 'section_02', 'booking_access'],
    );
    expect(document.pages[0]?.sections.map((section) => section.size)).toEqual([
      'compact',
      'medium',
      'compact',
    ]);
  });

  it('creates the exact One-page defaults', () => {
    const document = initializeStarter('one_page', {
      idFactory: createDeterministicIdFactory('one'),
    });

    expect(document.navigation.enabled).toBe(true);
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]?.sections.map((section) => section.sectionType)).toEqual([
      'section_01',
      'section_02',
      'section_03',
      'section_04',
      'section_05',
      'booking_access',
    ]);
    expect(document.pages[0]?.sections.map((section) => section.size)).toEqual([
      'large',
      'medium',
      'medium',
      'large',
      'compact',
      'compact',
    ]);
  });

  it('creates the five Multi-page defaults', () => {
    const document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('multi'),
    });

    expect(document.navigation.enabled).toBe(true);
    expect(document.pages.map((page) => page.name)).toEqual([
      'Home',
      'Services / Book',
      'Gallery',
      'About',
      'Contact',
    ]);
    expect(document.pages[1]?.sections.map((section) => section.sectionType)).toEqual([
      'section_03',
      'booking_access',
    ]);
    expect(document.navigation.items).toHaveLength(5);
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
    expect(document.navigation.enabled).toBe(true);
  });

  it('lets Quick Book grow well beyond ten sections and add five pages', () => {
    const ids = createDeterministicIdFactory('large-quick');
    let document = initializeStarter('quick_book', { idFactory: ids });
    const home = document.pages[0];
    if (!home) {
      throw new Error('Quick Book is missing Home.');
    }

    for (const item of SECTION_CATALOGUE.slice(2, 15)) {
      document = addSection(
        document,
        { pageId: home.id, sectionType: item.sectionType },
        ids,
      );
    }
    for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
      document = addPage(document, { name: `Added page ${pageNumber}` }, ids);
    }

    expect(document.pages[0]?.sections).toHaveLength(16);
    expect(document.pages).toHaveLength(6);
  });

  it('lets Multi-page become a valid one-page site', () => {
    let document = initializeStarter('multi_page', {
      idFactory: createDeterministicIdFactory('simple-multi'),
    });
    const home = document.pages.find((page) => page.isHome);
    const booking = document.pages
      .flatMap((page) => page.sections)
      .find((section) => section.sectionType === 'booking_access');
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
