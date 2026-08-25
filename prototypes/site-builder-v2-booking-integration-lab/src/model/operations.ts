import {
  createDefaultBookingPresentationSettings,
  validateBookingPresentationSettings,
} from '../booking/presentation';
import { createIdFactory } from './ids';
import { normalizeDocument } from './normalize';
import { createSectionInstance } from './starters';
import type {
  AddPageInput,
  AddSectionInput,
  BookingSectionPresentationSettings,
  BuilderCommand,
  IdFactory,
  MoveSectionToNewPageInput,
  NavigationItem,
  PageDocument,
  PlaceholderSectionInstance,
  SectionInstance,
  SectionSize,
  SiteBuilderDocument,
} from './types';

export type BuilderOperationErrorCode =
  | 'booking_required'
  | 'home_page_required'
  | 'last_visible_page'
  | 'not_found'
  | 'invalid_input'
  | 'duplicate_id'
  | 'duplicate_booking';

export class BuilderOperationError extends Error {
  readonly code: BuilderOperationErrorCode;

  constructor(code: BuilderOperationErrorCode, message: string) {
    super(message);
    this.name = 'BuilderOperationError';
    this.code = code;
  }
}

const BOOKING_REQUIRED_MESSAGE =
  'Your site needs at least one visible way for clients to start booking.';

type LocatedSection = {
  page: PageDocument;
  pageIndex: number;
  section: SectionInstance;
  sectionIndex: number;
};

const fail = (
  code: BuilderOperationErrorCode,
  message: string,
): never => {
  throw new BuilderOperationError(code, message);
};

const getPageIndex = (
  document: SiteBuilderDocument,
  pageId: string,
): number => {
  const index = document.pages.findIndex((page) => page.id === pageId);
  if (index < 0) {
    return fail('not_found', `Page not found: ${pageId}`);
  }
  return index;
};

const locateSection = (
  document: SiteBuilderDocument,
  sectionId: string,
): LocatedSection => {
  for (const [pageIndex, page] of document.pages.entries()) {
    const sectionIndex = page.sections.findIndex(
      (section) => section.id === sectionId,
    );
    if (sectionIndex >= 0) {
      const section = page.sections[sectionIndex];
      if (!section) {
        break;
      }
      return { page, pageIndex, section, sectionIndex };
    }
  }

  return fail('not_found', `Section not found on a page: ${sectionId}`);
};

const assertPosition = (position: number, maximum: number): void => {
  if (!Number.isInteger(position) || position < 1 || position > maximum) {
    fail('invalid_input', `Position must be between 1 and ${maximum}.`);
  }
};

const insertAtPosition = <T>(
  items: readonly T[],
  item: T,
  position: number | undefined,
): T[] => {
  const target = position ?? items.length + 1;
  assertPosition(target, items.length + 1);
  const next = [...items];
  next.splice(target - 1, 0, item);
  return next;
};

const moveToPosition = <T>(
  items: readonly T[],
  fromIndex: number,
  position: number,
): T[] => {
  assertPosition(position, items.length);
  if (fromIndex === position - 1) {
    return [...items];
  }

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) {
    return fail('not_found', 'The item to move no longer exists.');
  }
  next.splice(position - 1, 0, item);
  return next;
};

const replacePage = (
  document: SiteBuilderDocument,
  pageIndex: number,
  page: PageDocument,
): SiteBuilderDocument => ({
  ...document,
  pages: document.pages.map((candidate, index) =>
    index === pageIndex ? page : candidate,
  ),
});

export const hasUsableBooking = (
  document: SiteBuilderDocument,
): boolean =>
  document.pages.some(
    (page) =>
      page.visible &&
      page.sections.some(
        (section) =>
          section.visible && section.sectionType === 'booking',
      ),
  );

const assertUsableBooking = (document: SiteBuilderDocument): void => {
  if (!hasUsableBooking(document)) {
    fail('booking_required', BOOKING_REQUIRED_MESSAGE);
  }
};

const assertHasVisiblePage = (document: SiteBuilderDocument): void => {
  if (!document.pages.some((page) => page.visible)) {
    fail('last_visible_page', 'Your site needs at least one visible page.');
  }
};

export const normalizeSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const uniqueSlug = (
  document: SiteBuilderDocument,
  requestedSlug: string,
  excludedPageId?: string,
): string => {
  const base = normalizeSlug(requestedSlug) || 'page';
  const used = new Set(
    document.pages
      .filter((page) => page.id !== excludedPageId)
      .map((page) => page.slug),
  );
  if (!used.has(base)) {
    return base;
  }

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
};

const assertNewId = (document: SiteBuilderDocument, id: string): void => {
  const ids = new Set<string>([document.siteId]);
  for (const page of document.pages) {
    ids.add(page.id);
    page.sections.forEach((section) => ids.add(section.id));
  }
  document.unusedSections.forEach((section) => ids.add(section.id));
  document.navigation.items.forEach((item) => ids.add(item.id));
  document.removedPages.forEach((record) => {
    ids.add(record.page.id);
    ids.add(record.navigationItem.id);
  });

  if (ids.has(id)) {
    fail('duplicate_id', `ID factory returned a duplicate ID: ${id}`);
  }
};

export const addSection = (
  document: SiteBuilderDocument,
  input: AddSectionInput,
  idFactory: IdFactory = createIdFactory(),
): SiteBuilderDocument => {
  const pageIndex = getPageIndex(document, input.pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${input.pageId}`);
  }
  if (
    input.sectionType === 'booking' &&
    document.pages.some((candidate) =>
      candidate.sections.some((section) => section.sectionType === 'booking'),
    )
  ) {
    return fail(
      'duplicate_booking',
      'Booking is already on this site. Move the existing Booking section instead.',
    );
  }
  const section = input.sectionType === 'booking'
    ? createSectionInstance('booking', idFactory)
    : createSectionInstance(input.sectionType, idFactory, {
        label: input.label,
        note: input.note,
        size: input.size,
      });
  assertNewId(document, section.id);

  return normalizeDocument(
    replacePage(document, pageIndex, {
      ...page,
      sections: insertAtPosition(page.sections, section, input.position),
    }),
  );
};

export const removeSection = (
  document: SiteBuilderDocument,
  sectionId: string,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  if (located.section.sectionType === 'booking') {
    return fail('booking_required', BOOKING_REQUIRED_MESSAGE);
  }
  const next = normalizeDocument({
    ...replacePage(document, located.pageIndex, {
      ...located.page,
      sections: located.page.sections.filter(
        (section) => section.id !== sectionId,
      ),
    }),
    unusedSections: [
      ...document.unusedSections,
      { ...located.section, order: document.unusedSections.length },
    ],
  });
  assertUsableBooking(next);
  return next;
};

export const restoreSection = (
  document: SiteBuilderDocument,
  sectionId: string,
  pageId: string,
  position?: number,
): SiteBuilderDocument => {
  const unusedIndex = document.unusedSections.findIndex(
    (section) => section.id === sectionId,
  );
  if (unusedIndex < 0) {
    return fail('not_found', `Unused section not found: ${sectionId}`);
  }
  const section = document.unusedSections[unusedIndex];
  if (!section) {
    return fail('not_found', `Unused section not found: ${sectionId}`);
  }
  const pageIndex = getPageIndex(document, pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${pageId}`);
  }

  const next = normalizeDocument({
    ...replacePage(document, pageIndex, {
      ...page,
      sections: insertAtPosition(page.sections, section, position),
    }),
    unusedSections: document.unusedSections.filter(
      (candidate) => candidate.id !== sectionId,
    ),
  });
  assertUsableBooking(next);
  return next;
};

export const setSectionVisible = (
  document: SiteBuilderDocument,
  sectionId: string,
  visible: boolean,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  if (located.section.visible === visible) {
    return document;
  }
  if (located.section.sectionType === 'booking' && !visible) {
    return fail('booking_required', BOOKING_REQUIRED_MESSAGE);
  }
  const sections = located.page.sections.map((section) =>
    section.id === sectionId ? { ...section, visible } : section,
  );
  const next = normalizeDocument(
    replacePage(document, located.pageIndex, { ...located.page, sections }),
  );
  assertUsableBooking(next);
  return next;
};

export const updateSectionSettings = (
  document: SiteBuilderDocument,
  sectionId: string,
  changes: { note?: string; size?: SectionSize; label?: string },
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  if (located.section.sectionType === 'booking') {
    return fail(
      'invalid_input',
      'Use Booking presentation settings to edit this section.',
    );
  }
  const placeholder = located.section;
  if (changes.label !== undefined && changes.label.trim().length === 0) {
    return fail('invalid_input', 'Section label cannot be empty.');
  }
  const sections = located.page.sections.map((section) =>
    section.id === sectionId
      ? {
          ...placeholder,
          label: changes.label?.trim() ?? placeholder.label,
          size: changes.size ?? placeholder.size,
          placeholderSettings: {
            ...placeholder.placeholderSettings,
            ...(changes.note === undefined ? {} : { note: changes.note }),
          },
        }
      : section,
  );
  return normalizeDocument(
    replacePage(document, located.pageIndex, { ...located.page, sections }),
  );
};

export const updateBookingSectionPresentation = (
  document: SiteBuilderDocument,
  sectionId: string,
  settings: BookingSectionPresentationSettings,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  if (located.section.sectionType !== 'booking') {
    return fail(
      'invalid_input',
      'Booking presentation settings can only be applied to Booking.',
    );
  }

  const validated = validateBookingPresentationSettings(settings);
  if (!validated.success) {
    return fail(
      'invalid_input',
      `Booking presentation settings are invalid: ${validated.issues.join(' ')}`,
    );
  }
  if (
    JSON.stringify(located.section.settings) ===
    JSON.stringify(validated.settings)
  ) {
    return document;
  }

  const sections = located.page.sections.map((section) =>
    section.id === sectionId
      ? { ...located.section, settings: validated.settings }
      : section,
  );
  return normalizeDocument(
    replacePage(document, located.pageIndex, { ...located.page, sections }),
  );
};

export const resetBookingSectionPresentation = (
  document: SiteBuilderDocument,
  sectionId: string,
): SiteBuilderDocument =>
  updateBookingSectionPresentation(
    document,
    sectionId,
    createDefaultBookingPresentationSettings(),
  );

export const moveSection = (
  document: SiteBuilderDocument,
  sectionId: string,
  position: number,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  if (located.sectionIndex === position - 1) {
    return document;
  }
  const sections = moveToPosition(
    located.page.sections,
    located.sectionIndex,
    position,
  );
  return normalizeDocument(
    replacePage(document, located.pageIndex, { ...located.page, sections }),
  );
};

export const moveSectionUp = (
  document: SiteBuilderDocument,
  sectionId: string,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  return located.sectionIndex === 0
    ? document
    : moveSection(document, sectionId, located.sectionIndex);
};

export const moveSectionDown = (
  document: SiteBuilderDocument,
  sectionId: string,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  return located.sectionIndex === located.page.sections.length - 1
    ? document
    : moveSection(document, sectionId, located.sectionIndex + 2);
};

export const moveSectionToPage = (
  document: SiteBuilderDocument,
  sectionId: string,
  destinationPageId: string,
  position?: number,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  const destinationIndex = getPageIndex(document, destinationPageId);
  if (located.page.id === destinationPageId) {
    return moveSection(
      document,
      sectionId,
      position ?? located.page.sections.length,
    );
  }
  const destination = document.pages[destinationIndex];
  if (!destination) {
    return fail('not_found', `Page not found: ${destinationPageId}`);
  }

  const pages = document.pages.map((page) => {
    if (page.id === located.page.id) {
      return {
        ...page,
        sections: page.sections.filter((section) => section.id !== sectionId),
      };
    }
    if (page.id === destinationPageId) {
      return {
        ...page,
        sections: insertAtPosition(page.sections, located.section, position),
      };
    }
    return page;
  });
  const next = normalizeDocument({ ...document, pages });
  assertUsableBooking(next);
  return next;
};

const createPageAndNavigationItem = (
  document: SiteBuilderDocument,
  input: AddPageInput,
  idFactory: IdFactory,
): { page: PageDocument; navigationItem: NavigationItem } => {
  const name = input.name.trim();
  if (name.length === 0) {
    return fail('invalid_input', 'Page name cannot be empty.');
  }
  const pageId = idFactory('page');
  assertNewId(document, pageId);
  const navigationItemId = idFactory('navigation_item');
  assertNewId(document, navigationItemId);
  if (navigationItemId === pageId) {
    return fail(
      'duplicate_id',
      `ID factory returned a duplicate ID: ${navigationItemId}`,
    );
  }
  const page: PageDocument = {
    id: pageId,
    name,
    slug: uniqueSlug(document, input.slug ?? name),
    order: document.pages.length,
    isHome: false,
    visible: input.visible ?? true,
    visibleInNavigation: input.visibleInNavigation ?? true,
    sections: [],
  };
  return {
    page,
    navigationItem: {
      id: navigationItemId,
      pageId,
      label: name,
      order: document.navigation.items.length,
    },
  };
};

export const addPage = (
  document: SiteBuilderDocument,
  input: AddPageInput,
  idFactory: IdFactory = createIdFactory(),
): SiteBuilderDocument => {
  const created = createPageAndNavigationItem(document, input, idFactory);
  const next = normalizeDocument({
    ...document,
    pages: insertAtPosition(document.pages, created.page, input.position),
    navigation: {
      ...document.navigation,
      items: [...document.navigation.items, created.navigationItem],
    },
  });
  assertHasVisiblePage(next);
  assertUsableBooking(next);
  return next;
};

export const moveSectionToNewPage = (
  document: SiteBuilderDocument,
  input: MoveSectionToNewPageInput,
  idFactory: IdFactory = createIdFactory(),
): SiteBuilderDocument => {
  const created = createPageAndNavigationItem(document, input, idFactory);
  const withPage = normalizeDocument({
    ...document,
    pages: insertAtPosition(document.pages, created.page, input.position),
    navigation: {
      ...document.navigation,
      items: [...document.navigation.items, created.navigationItem],
    },
  });
  return moveSectionToPage(
    withPage,
    input.sectionId,
    created.page.id,
    input.sectionPosition,
  );
};

export const removePage = (
  document: SiteBuilderDocument,
  pageId: string,
): SiteBuilderDocument => {
  const pageIndex = getPageIndex(document, pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${pageId}`);
  }
  if (page.isHome) {
    return fail(
      'home_page_required',
      'Home cannot be removed. Rename it or move its sections instead.',
    );
  }
  if (page.sections.some((section) => section.sectionType === 'booking')) {
    return fail('booking_required', BOOKING_REQUIRED_MESSAGE);
  }
  const navigationItem = document.navigation.items.find(
    (item) => item.pageId === pageId,
  );
  if (!navigationItem) {
    return fail('not_found', `Navigation item not found for page: ${pageId}`);
  }
  const { sections: removedSections, ...pageRecord } = page;
  const placeholderSections = removedSections.filter(
    (section): section is PlaceholderSectionInstance =>
      section.sectionType !== 'booking',
  );
  const next = normalizeDocument({
    ...document,
    pages: document.pages.filter((candidate) => candidate.id !== pageId),
    navigation: {
      ...document.navigation,
      items: document.navigation.items.filter((item) => item.pageId !== pageId),
    },
    unusedSections: [
      ...document.unusedSections,
      ...placeholderSections.map((section, index) => ({
        ...section,
        order: document.unusedSections.length + index,
      })),
    ],
    removedPages: [
      ...document.removedPages,
      {
        page: pageRecord,
        sectionIds: placeholderSections.map((section) => section.id),
        navigationItem,
        removedAtOrder: page.order,
      },
    ],
  });
  assertHasVisiblePage(next);
  assertUsableBooking(next);
  return next;
};

export const restorePage = (
  document: SiteBuilderDocument,
  pageId: string,
): SiteBuilderDocument => {
  const recordIndex = document.removedPages.findIndex(
    (record) => record.page.id === pageId,
  );
  if (recordIndex < 0) {
    return fail('not_found', `Removed page not found: ${pageId}`);
  }
  const record = document.removedPages[recordIndex];
  if (!record) {
    return fail('not_found', `Removed page not found: ${pageId}`);
  }
  if (document.pages.some((page) => page.id === record.page.id)) {
    return fail('duplicate_id', `Page is already active: ${pageId}`);
  }

  const availableById = new Map(
    document.unusedSections.map((section) => [section.id, section]),
  );
  const sections = record.sectionIds.flatMap((sectionId) => {
    const section = availableById.get(sectionId);
    return section ? [section] : [];
  });
  const restoredPage: PageDocument = {
    ...record.page,
    slug: uniqueSlug(document, record.page.slug, record.page.id),
    sections,
  };
  const pagePosition = Math.min(record.removedAtOrder + 1, document.pages.length + 1);
  const navigationPosition = Math.min(
    record.navigationItem.order + 1,
    document.navigation.items.length + 1,
  );
  const restoredSectionIds = new Set(sections.map((section) => section.id));
  const next = normalizeDocument({
    ...document,
    pages: insertAtPosition(document.pages, restoredPage, pagePosition),
    navigation: {
      ...document.navigation,
      items: insertAtPosition(
        document.navigation.items,
        record.navigationItem,
        navigationPosition,
      ),
    },
    unusedSections: document.unusedSections.filter(
      (section) => !restoredSectionIds.has(section.id),
    ),
    removedPages: document.removedPages.filter(
      (_candidate, index) => index !== recordIndex,
    ),
  });
  assertHasVisiblePage(next);
  assertUsableBooking(next);
  return next;
};

export const renamePage = (
  document: SiteBuilderDocument,
  pageId: string,
  requestedName: string,
): SiteBuilderDocument => {
  const name = requestedName.trim();
  if (name.length === 0) {
    return fail('invalid_input', 'Page name cannot be empty.');
  }
  const pageIndex = getPageIndex(document, pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${pageId}`);
  }
  if (page.name === name) {
    return document;
  }
  const navigationItems = document.navigation.items.map((item) =>
    item.pageId === pageId && item.label === page.name
      ? { ...item, label: name }
      : item,
  );
  return normalizeDocument({
    ...replacePage(document, pageIndex, { ...page, name }),
    navigation: { ...document.navigation, items: navigationItems },
  });
};

export const setPageSlug = (
  document: SiteBuilderDocument,
  pageId: string,
  slug: string,
): SiteBuilderDocument => {
  const pageIndex = getPageIndex(document, pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${pageId}`);
  }
  const normalizedSlug =
    page.isHome && normalizeSlug(slug) === ''
      ? ''
      : uniqueSlug(document, slug, pageId);
  if (page.slug === normalizedSlug) {
    return document;
  }
  return normalizeDocument(
    replacePage(document, pageIndex, { ...page, slug: normalizedSlug }),
  );
};

export const setPageVisible = (
  document: SiteBuilderDocument,
  pageId: string,
  visible: boolean,
): SiteBuilderDocument => {
  const pageIndex = getPageIndex(document, pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${pageId}`);
  }
  if (page.visible === visible) {
    return document;
  }
  const next = normalizeDocument(
    replacePage(document, pageIndex, { ...page, visible }),
  );
  assertUsableBooking(next);
  assertHasVisiblePage(next);
  return next;
};

export const setPageNavigationVisibility = (
  document: SiteBuilderDocument,
  pageId: string,
  visibleInNavigation: boolean,
): SiteBuilderDocument => {
  const pageIndex = getPageIndex(document, pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${pageId}`);
  }
  if (page.visibleInNavigation === visibleInNavigation) {
    return document;
  }
  return normalizeDocument(
    replacePage(document, pageIndex, { ...page, visibleInNavigation }),
  );
};

export const updatePageSettings = (
  document: SiteBuilderDocument,
  pageId: string,
  settings: {
    name: string;
    slug: string;
    visible: boolean;
    visibleInNavigation: boolean;
  },
): SiteBuilderDocument => {
  // Compose pure operations before returning so validation is atomic and the
  // history layer records one owner action for one Save page submission.
  let next = setPageVisible(document, pageId, settings.visible);
  next = setPageNavigationVisibility(
    next,
    pageId,
    settings.visibleInNavigation,
  );
  next = renamePage(next, pageId, settings.name);
  return setPageSlug(next, pageId, settings.slug);
};

export const movePage = (
  document: SiteBuilderDocument,
  pageId: string,
  position: number,
): SiteBuilderDocument => {
  const pageIndex = getPageIndex(document, pageId);
  if (pageIndex === position - 1) {
    return document;
  }
  return normalizeDocument({
    ...document,
    pages: moveToPosition(document.pages, pageIndex, position),
  });
};

export const toggleNavigation = (
  document: SiteBuilderDocument,
  enabled: boolean,
): SiteBuilderDocument =>
  document.navigation.enabled === enabled
    ? document
    : {
        ...document,
        navigation: { ...document.navigation, enabled },
      };

export const moveNavigationItem = (
  document: SiteBuilderDocument,
  pageId: string,
  position: number,
): SiteBuilderDocument => {
  const itemIndex = document.navigation.items.findIndex(
    (item) => item.pageId === pageId,
  );
  if (itemIndex < 0) {
    return fail('not_found', `Navigation item not found for page: ${pageId}`);
  }
  if (itemIndex === position - 1) {
    return document;
  }
  return normalizeDocument({
    ...document,
    navigation: {
      ...document.navigation,
      items: moveToPosition(document.navigation.items, itemIndex, position),
    },
  });
};

export const renameNavigationItem = (
  document: SiteBuilderDocument,
  pageId: string,
  requestedLabel: string,
): SiteBuilderDocument => {
  const label = requestedLabel.trim();
  if (label.length === 0) {
    return fail('invalid_input', 'Navigation label cannot be empty.');
  }
  const itemIndex = document.navigation.items.findIndex(
    (item) => item.pageId === pageId,
  );
  if (itemIndex < 0) {
    return fail('not_found', `Navigation item not found for page: ${pageId}`);
  }
  const item = document.navigation.items[itemIndex];
  if (!item || item.label === label) {
    return document;
  }
  return normalizeDocument({
    ...document,
    navigation: {
      ...document.navigation,
      items: document.navigation.items.map((candidate, index) =>
        index === itemIndex ? { ...candidate, label } : candidate,
      ),
    },
  });
};

export const getSectionMoveAnnouncement = (
  document: SiteBuilderDocument,
  sectionId: string,
): string => {
  const located = locateSection(document, sectionId);
  return `${located.section.label} moved to position ${located.sectionIndex + 1} of ${located.page.sections.length}.`;
};

export const applyBuilderCommand = (
  document: SiteBuilderDocument,
  command: BuilderCommand,
  idFactory: IdFactory = createIdFactory(),
): SiteBuilderDocument => {
  switch (command.type) {
    case 'add_section':
      return addSection(document, command.input, idFactory);
    case 'remove_section':
      return removeSection(document, command.sectionId);
    case 'restore_section':
      return restoreSection(
        document,
        command.sectionId,
        command.pageId,
        command.position,
      );
    case 'set_section_visible':
      return setSectionVisible(document, command.sectionId, command.visible);
    case 'update_section_settings':
      return updateSectionSettings(document, command.sectionId, command);
    case 'update_booking_presentation':
      return updateBookingSectionPresentation(
        document,
        command.sectionId,
        command.settings,
      );
    case 'reset_booking_presentation':
      return resetBookingSectionPresentation(document, command.sectionId);
    case 'move_section':
      return moveSection(document, command.sectionId, command.position);
    case 'move_section_up':
      return moveSectionUp(document, command.sectionId);
    case 'move_section_down':
      return moveSectionDown(document, command.sectionId);
    case 'move_section_to_page':
      return moveSectionToPage(
        document,
        command.sectionId,
        command.pageId,
        command.position,
      );
    case 'move_section_to_new_page':
      return moveSectionToNewPage(document, command.input, idFactory);
    case 'add_page':
      return addPage(document, command.input, idFactory);
    case 'remove_page':
      return removePage(document, command.pageId);
    case 'restore_page':
      return restorePage(document, command.pageId);
    case 'rename_page':
      return renamePage(document, command.pageId, command.name);
    case 'update_page_settings':
      return updatePageSettings(document, command.pageId, command);
    case 'set_page_slug':
      return setPageSlug(document, command.pageId, command.slug);
    case 'set_page_visible':
      return setPageVisible(document, command.pageId, command.visible);
    case 'set_page_navigation_visibility':
      return setPageNavigationVisibility(
        document,
        command.pageId,
        command.visible,
      );
    case 'move_page':
      return movePage(document, command.pageId, command.position);
    case 'toggle_navigation':
      return toggleNavigation(document, command.enabled);
    case 'move_navigation_item':
      return moveNavigationItem(document, command.pageId, command.position);
    case 'rename_navigation_item':
      return renameNavigationItem(document, command.pageId, command.label);
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
};
