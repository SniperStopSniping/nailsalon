import type {
  NavigationItem,
  PageDocument,
  SectionInstance,
  SiteBuilderDocument,
} from './types';

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
): SiteBuilderDocument => ({
  ...document,
  navigation: {
    ...document.navigation,
    items: normalizeNavigationItems(document.navigation.items),
  },
  pages: normalizePages(document.pages),
  unusedSections: normalizeSections(document.unusedSections),
  removedPages: document.removedPages.map((record) => ({
    ...record,
    page: { ...record.page },
    sectionIds: [...record.sectionIds],
    navigationItem: { ...record.navigationItem },
  })),
});

export const hasNormalizedOrdering = (
  items: readonly { order: number }[],
): boolean => items.every((item, index) => item.order === index);
