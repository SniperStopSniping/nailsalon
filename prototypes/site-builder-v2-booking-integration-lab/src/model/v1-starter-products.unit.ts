import { describe, expect, it } from 'vitest';

import { createDeterministicIdFactory } from './ids';
import { createEmptySiteContent } from './section-library/site-content';
import { createLibrarySectionInstance } from './starters';
import {
  type OriginStarter,
  type PageDocument,
  type SectionInstance,
  SITE_BUILDER_SCHEMA_VERSION,
  type SiteBuilderDocument,
} from './types';
import {
  getNormalV1AddSectionTypes,
  getV1StarterPageRole,
} from './v1-starter-products';

const createPage = (
  name: string,
  slug: string,
  order: number,
  sections: SectionInstance[] = [],
): PageDocument => ({
  id: `page-${slug || 'home'}`,
  isHome: order === 0,
  name,
  order,
  sections,
  slug,
  visible: true,
  visibleInNavigation: true,
});

const createDocument = (
  originStarter: OriginStarter,
  pages: PageDocument[],
): SiteBuilderDocument => ({
  navigation: {
    enabled: originStarter !== 'quick_book',
    items: pages.map((page, order) => ({
      id: `navigation-${page.id}`,
      label: page.name,
      order,
      pageId: page.id,
    })),
    style: 'simple',
  },
  originStarter,
  pages,
  removedPages: [],
  schemaVersion: SITE_BUILDER_SCHEMA_VERSION,
  siteContent: createEmptySiteContent(),
  siteId: 'site-v1-products',
  siteName: 'Luster Studio',
  unusedSections: [],
});

const createSection = (type: Parameters<typeof createLibrarySectionInstance>[0]) =>
  createLibrarySectionInstance(type, createDeterministicIdFactory(type));

describe('normal V1 Add Section products', () => {
  it('offers only missing Quick Book core families on Home', () => {
    const home = createPage('Home', '', 0, [createSection('hero')]);
    const document = createDocument('quick_book', [home]);

    expect(getNormalV1AddSectionTypes({
      businessStructure: 'solo',
      document,
      page: home,
    })).toEqual(['gallery', 'booking', 'about', 'visit_us']);
  });

  it('chooses Team for a multi-tech one-page business and excludes advanced sections', () => {
    const home = createPage('Home', '', 0);
    const document = createDocument('one_page', [home]);

    expect(getNormalV1AddSectionTypes({
      businessStructure: 'multi_tech',
      document,
      page: home,
    })).toEqual([
      'hero',
      'gallery',
      'team',
      'booking',
      'reviews',
      'policies',
      'visit_us',
    ]);
  });

  it('does not offer a core family that is already active on another page', () => {
    const home = createPage('Home', '', 0);
    const extra = createPage('Work', 'work', 1, [createSection('gallery')]);
    const document = createDocument('one_page', [home, extra]);

    expect(getNormalV1AddSectionTypes({
      businessStructure: 'solo',
      document,
      page: home,
    })).not.toContain('gallery');
    expect(getNormalV1AddSectionTypes({
      businessStructure: 'solo',
      document,
      page: extra,
    })).toEqual([]);
  });

  it('keeps a removed core section eligible for restoration', () => {
    const home = createPage('Home', '', 0);
    const document = createDocument('quick_book', [home]);
    const removedGallery = createSection('gallery');
    if (removedGallery.sectionType !== 'gallery') {
      throw new Error('Gallery factory returned the wrong section type.');
    }
    document.unusedSections = [removedGallery];

    expect(getNormalV1AddSectionTypes({
      businessStructure: 'solo',
      document,
      page: home,
    })).toContain('gallery');
  });

  it('maps each multi-page recipe slot to only its authoritative missing families', () => {
    const pages = [
      createPage('Home', '', 0),
      createPage('Services & Booking', 'services-book', 1),
      createPage('Gallery', 'gallery', 2),
      createPage('About', 'about', 3),
      createPage('Contact', 'contact', 4),
    ];
    const document = createDocument('multi_page', pages);

    expect(pages.map(page => getNormalV1AddSectionTypes({
      businessStructure: 'solo',
      document,
      page,
    }))).toEqual([
      ['hero', 'reviews'],
      ['booking', 'policies'],
      ['gallery'],
      ['about'],
      ['visit_us'],
    ]);
  });

  it('keeps the multi-page role stable when a visible page name changes', () => {
    const services = createPage('Appointments', 'services-book', 1);
    const document = createDocument('multi_page', [
      createPage('Home', '', 0),
      services,
    ]);

    expect(getV1StarterPageRole(document, services)).toBe('services');
  });

  it('does not treat an owner-created multi-page page as a recipe slot by order', () => {
    const notes = createPage('Press', 'press', 1);
    const document = createDocument('multi_page', [
      createPage('Home', '', 0),
      notes,
    ]);

    expect(getV1StarterPageRole(document, notes)).toBeNull();
    expect(getNormalV1AddSectionTypes({
      businessStructure: 'solo',
      document,
      page: notes,
    })).toEqual([]);
  });
});
