import type {
  GalleryPresentationOwner,
  NavigationItem,
  OriginStarter,
  PageDocument,
  SectionInstance,
  SectionType,
  SiteBuilderDocument,
} from './types';

type LegacyStarterGalleryBinding = {
  owner: GalleryPresentationOwner;
  pageSlug: string;
  sectionOrder: number;
};

type LegacyStarterPageShape = {
  sectionTypes: readonly SectionType[];
  slug: string;
};

/**
 * Frozen schema-v2 starter shapes from before Gallery ownership was
 * persisted. Requiring the complete structural match prevents an authored
 * recipe or owner-added Gallery from being mistaken for onboarding's module.
 */
const LEGACY_STARTER_GALLERY_MIGRATIONS: Partial<Record<OriginStarter, {
  bindings: readonly LegacyStarterGalleryBinding[];
  pages: readonly LegacyStarterPageShape[];
}>> = {
  one_page: {
    bindings: [{ owner: 'onboarding', pageSlug: '', sectionOrder: 6 }],
    pages: [{
      sectionTypes: [
        'announcement_bar',
        'hero',
        'quick_info',
        'section_navigation',
        'about',
        'featured_services',
        'gallery',
        'reviews',
        'deposits_cancellations',
        'policies',
        'visit_us',
        'booking',
        'final_cta',
        'footer',
      ],
      slug: '',
    }],
  },
  multi_page: {
    bindings: [
      { owner: 'recipe', pageSlug: '', sectionOrder: 3 },
      { owner: 'onboarding', pageSlug: 'gallery', sectionOrder: 0 },
    ],
    pages: [
      {
        sectionTypes: [
          'announcement_bar',
          'hero',
          'quick_info',
          'gallery',
          'reviews',
          'final_cta',
          'footer',
        ],
        slug: '',
      },
      {
        sectionTypes: [
          'featured_services',
          'booking',
          'deposits_cancellations',
          'policies',
          'faq',
          'footer',
        ],
        slug: 'services-book',
      },
      {
        sectionTypes: ['gallery', 'final_cta', 'footer'],
        slug: 'gallery',
      },
      {
        sectionTypes: ['team', 'about', 'footer'],
        slug: 'team',
      },
      {
        sectionTypes: ['visit_us', 'hours', 'contact', 'footer'],
        slug: 'contact',
      },
    ],
  },
};

const matchesLegacyStarterShape = (
  document: SiteBuilderDocument,
  pages: readonly LegacyStarterPageShape[],
): boolean => {
  const actualPages = [...document.pages].sort((left, right) => left.order - right.order);
  if (actualPages.length !== pages.length) {
    return false;
  }
  return pages.every((expected, pageIndex) => {
    const actual = actualPages[pageIndex];
    if (!actual || actual.slug !== expected.slug) {
      return false;
    }
    const sectionTypes = [...actual.sections]
      .sort((left, right) => left.order - right.order)
      .map(section => section.sectionType);
    return sectionTypes.length === expected.sectionTypes.length
      && sectionTypes.every((type, index) => type === expected.sectionTypes[index]);
  });
};

/** Adds stable Gallery ownership when the active legacy starter shape is intact. */
export const normalizeGalleryPresentationOwnership = (
  document: SiteBuilderDocument,
): SiteBuilderDocument => {
  const migration = LEGACY_STARTER_GALLERY_MIGRATIONS[document.originStarter];
  if (!migration || !matchesLegacyStarterShape(document, migration.pages)) {
    return document;
  }
  let changed = false;
  const pages = document.pages.map((page) => {
    const sections = page.sections.map((section) => {
      if (
        section.sectionType !== 'gallery'
        || section.galleryPresentationOwner !== undefined
      ) {
        return section;
      }
      const binding = migration.bindings.find(candidate =>
        candidate.pageSlug === page.slug
        && candidate.sectionOrder === section.order);
      if (!binding) {
        return section;
      }
      changed = true;
      return { ...section, galleryPresentationOwner: binding.owner };
    });
    return sections.some((section, index) => section !== page.sections[index])
      ? { ...page, sections }
      : page;
  });
  return changed ? { ...document, pages } : document;
};

export const normalizeSections = <Section extends SectionInstance>(
  sections: readonly Section[],
): Section[] =>
  sections.map(
    (section, order) => ({ ...section, order }) as Section,
  );

export const normalizePages = (pages: readonly PageDocument[]): PageDocument[] =>
  pages.map((page, order) => ({
    ...page,
    order,
    sections: normalizeSections(page.sections),
  }));

export const normalizeNavigationItems = (
  items: readonly NavigationItem[],
): NavigationItem[] =>
  items.map((item, order) => ({ ...item, order }));

export const normalizeDocument = (
  document: SiteBuilderDocument,
): SiteBuilderDocument => normalizeGalleryPresentationOwnership({
  ...document,
  navigation: {
    ...document.navigation,
    items: normalizeNavigationItems(document.navigation.items),
  },
  pages: normalizePages(document.pages),
  unusedSections: normalizeSections(document.unusedSections),
  removedPages: document.removedPages.map(record => ({
    ...record,
    page: { ...record.page },
    sectionIds: [...record.sectionIds],
    navigationItem: { ...record.navigationItem },
  })),
});

export const hasNormalizedOrdering = (
  items: readonly { order: number }[],
): boolean => items.every((item, index) => item.order === index);
