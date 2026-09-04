import {
  createDefaultBookingPresentationSettings,
  validateBookingPresentationSettings,
} from '../booking/presentation';
import { validateCustomDesignSettings } from '../custom-design/model/settings';
import type { CustomDesignSettings } from '../custom-design/model/types';
import { createIdFactory } from './ids';
import { normalizeDocument } from './normalize';
import {
  getSectionRegistryEntry,
  isLibrarySectionType,
} from './section-library/registry';
import {
  SITE_CONTENT_COLLECTION_KEYS,
} from './section-library/site-content';
import { createLibrarySectionInstance, createSectionInstance } from './starters';
import type {
  AddLibrarySectionInput,
  AddPageInput,
  AddPlaceholderSectionInput,
  AddSectionInput,
  BookingSectionPresentationSettings,
  BuilderCommand,
  CommitSectionMoveInput,
  IdFactory,
  MoveSectionToNewPageInput,
  NavigationItem,
  PageDocument,
  RestorableSectionInstance,
  SectionInstance,
  SectionSize,
  SiteBuilderDocument,
  UpdateSiteContentInput,
} from './types';
import { validateSiteBuilderDocument } from './validation';

export type BuilderOperationErrorCode =
  | 'booking_required'
  | 'home_page_required'
  | 'last_visible_page'
  | 'not_found'
  | 'invalid_input'
  | 'duplicate_id'
  | 'duplicate_booking'
  | 'section_limit';

export class BuilderOperationError extends Error {
  readonly code: BuilderOperationErrorCode;

  constructor(code: BuilderOperationErrorCode, message: string) {
    super(message);
    this.name = 'BuilderOperationError';
    this.code = code;
  }
}

const BOOKING_REQUIRED_MESSAGE
  = 'Your site needs at least one visible way for clients to start booking.';

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
  const index = document.pages.findIndex(page => page.id === pageId);
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
      section => section.id === sectionId,
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
    page =>
      page.visible
      && page.sections.some(
        section =>
          section.visible && section.sectionType === 'booking',
      ),
  );

const assertUsableBooking = (document: SiteBuilderDocument): void => {
  if (!hasUsableBooking(document)) {
    fail('booking_required', BOOKING_REQUIRED_MESSAGE);
  }
};

const assertHasVisiblePage = (document: SiteBuilderDocument): void => {
  if (!document.pages.some(page => page.visible)) {
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
      .filter(page => page.id !== excludedPageId)
      .map(page => page.slug),
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
    page.sections.forEach(section => ids.add(section.id));
  }
  document.unusedSections.forEach(section => ids.add(section.id));
  document.navigation.items.forEach(item => ids.add(item.id));
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
    input.sectionType === 'booking'
    && document.pages.some(candidate =>
      candidate.sections.some(section => section.sectionType === 'booking'),
    )
  ) {
    return fail(
      'duplicate_booking',
      'Booking is already on this site. Move the existing Booking section instead.',
    );
  }
  let section: SectionInstance;
  if (input.sectionType === 'booking' || input.sectionType === 'custom_design') {
    section = createSectionInstance(input.sectionType, idFactory);
  } else if (isLibrarySectionType(input.sectionType)) {
    const entry = getSectionRegistryEntry(input.sectionType);
    if (entry.limitKind === 'hard' && entry.maxPerPage !== undefined) {
      const existing = page.sections.filter(
        candidate => candidate.sectionType === input.sectionType,
      ).length;
      if (existing >= entry.maxPerPage) {
        return fail(
          'section_limit',
          `${entry.label} is already on this page (maximum ${entry.maxPerPage} per page). Edit the existing one instead.`,
        );
      }
    }
    const libraryInput = input as AddLibrarySectionInput;
    section = createLibrarySectionInstance(input.sectionType, idFactory, {
      ...(libraryInput.presetId !== undefined
        ? { presetId: libraryInput.presetId }
        : {}),
    });
  } else {
    const placeholderInput = input as AddPlaceholderSectionInput;
    section = createSectionInstance(placeholderInput.sectionType, idFactory, {
      label: placeholderInput.label,
      note: placeholderInput.note,
      size: placeholderInput.size,
    });
  }
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
        section => section.id !== sectionId,
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

/**
 * The hard per-page limit is a document invariant, not an add-time nicety:
 * restore and cross-page moves enforce it with the same error contract as
 * addSection, so no operation can hand back a document validation rejects.
 */
const failOnHardSectionLimit = (
  page: PageDocument,
  section: SectionInstance,
): void => {
  if (!isLibrarySectionType(section.sectionType)) {
    return;
  }
  const entry = getSectionRegistryEntry(section.sectionType);
  if (entry.limitKind !== 'hard' || entry.maxPerPage === undefined) {
    return;
  }
  const existing = page.sections.filter(
    candidate => candidate.sectionType === section.sectionType
      && candidate.id !== section.id,
  ).length;
  if (existing >= entry.maxPerPage) {
    fail(
      'section_limit',
      `${entry.label} is already on this page (maximum ${entry.maxPerPage} per page). Edit the existing one instead.`,
    );
  }
};

export const restoreSection = (
  document: SiteBuilderDocument,
  sectionId: string,
  pageId: string,
  position?: number,
): SiteBuilderDocument => {
  const unusedIndex = document.unusedSections.findIndex(
    section => section.id === sectionId,
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
  failOnHardSectionLimit(page, section);

  const next = normalizeDocument({
    ...replacePage(document, pageIndex, {
      ...page,
      sections: insertAtPosition(page.sections, section, position),
    }),
    unusedSections: document.unusedSections.filter(
      candidate => candidate.id !== sectionId,
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
  const sections = located.page.sections.map(section =>
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
  if (located.section.sectionType === 'custom_design') {
    return fail(
      'invalid_input',
      'Use Custom Design settings to edit this section.',
    );
  }
  if (isLibrarySectionType(located.section.sectionType)) {
    return fail(
      'invalid_input',
      'Use the section’s own settings to edit this section.',
    );
  }
  const placeholder = located.section as Extract<
    SectionInstance,
    { placeholderSettings: unknown }
  >;
  if (changes.label !== undefined && changes.label.trim().length === 0) {
    return fail('invalid_input', 'Section label cannot be empty.');
  }
  const sections = located.page.sections.map(section =>
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
  const booking = located.section;

  const validated = validateBookingPresentationSettings(settings);
  if (!validated.success) {
    return fail(
      'invalid_input',
      `Booking presentation settings are invalid: ${validated.issues.join(' ')}`,
    );
  }
  if (
    JSON.stringify(booking.settings)
    === JSON.stringify(validated.settings)
  ) {
    return document;
  }

  const sections = located.page.sections.map(section =>
    section.id === sectionId
      ? { ...booking, settings: validated.settings }
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

export const updateCustomDesignSectionSettings = (
  document: SiteBuilderDocument,
  sectionId: string,
  settings: CustomDesignSettings,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  if (located.section.sectionType !== 'custom_design') {
    return fail(
      'invalid_input',
      'Custom Design settings can only be applied to Custom Design.',
    );
  }
  const customDesign = located.section;

  const validated = validateCustomDesignSettings(settings);
  if (!validated.success) {
    return fail(
      'invalid_input',
      `Custom Design settings are invalid: ${validated.issues.join(' ')}`,
    );
  }
  if (
    JSON.stringify(customDesign.settings)
    === JSON.stringify(validated.value)
  ) {
    return document;
  }

  const sections = located.page.sections.map(section =>
    section.id === sectionId
      ? { ...customDesign, settings: validated.value }
      : section,
  );
  const next = normalizeDocument(
    replacePage(document, located.pageIndex, { ...located.page, sections }),
  );
  const documentValidation = validateSiteBuilderDocument(next);
  if (!documentValidation.success) {
    return fail(
      'invalid_input',
      `Custom Design settings conflict with this site document: ${documentValidation.issues.join(' ')}`,
    );
  }
  return documentValidation.document;
};

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

export const reorderSections = (
  document: SiteBuilderDocument,
  pageId: string,
  orderedSectionIds: readonly string[],
): SiteBuilderDocument => {
  const pageIndex = getPageIndex(document, pageId);
  const page = document.pages[pageIndex];
  if (!page) {
    return fail('not_found', `Page not found: ${pageId}`);
  }

  const currentIds = page.sections.map(section => section.id);
  const requestedIds = [...orderedSectionIds];
  if (
    requestedIds.length !== currentIds.length
    || new Set(requestedIds).size !== requestedIds.length
    || currentIds.some(id => !requestedIds.includes(id))
  ) {
    return fail(
      'invalid_input',
      'Section order must contain every section on the page exactly once.',
    );
  }
  if (requestedIds.every((id, index) => id === currentIds[index])) {
    return document;
  }

  const byId = new Map(page.sections.map(section => [section.id, section]));
  const sections = requestedIds.map((id, order) => {
    const section = byId.get(id);
    if (!section) {
      return fail('not_found', `Section not found on page: ${id}`);
    }
    return { ...section, order };
  });
  return normalizeDocument(
    replacePage(document, pageIndex, { ...page, sections }),
  );
};

export const commitSectionMove = (
  document: SiteBuilderDocument,
  input: CommitSectionMoveInput,
  idFactory: IdFactory = createIdFactory(),
): SiteBuilderDocument => {
  const sourcePageIndex = getPageIndex(document, input.sourcePageId);
  const sourcePage = document.pages[sourcePageIndex];
  if (!sourcePage?.sections.some(section => section.id === input.sectionId)) {
    return fail(
      'not_found',
      `Section not found on source page: ${input.sectionId}`,
    );
  }

  const ordered = reorderSections(
    document,
    input.sourcePageId,
    input.orderedSectionIds,
  );
  if (!input.destination) {
    return ordered;
  }
  if (input.destination.type === 'existing_page') {
    return moveSectionToPage(
      ordered,
      input.sectionId,
      input.destination.pageId,
      input.destination.position,
    );
  }
  return moveSectionToNewPage(
    ordered,
    {
      sectionId: input.sectionId,
      name: input.destination.name,
      slug: input.destination.slug,
      sectionPosition: input.destination.position,
    },
    idFactory,
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

export function moveSectionToPage(document: SiteBuilderDocument, sectionId: string, destinationPageId: string, position?: number): SiteBuilderDocument {
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
  failOnHardSectionLimit(destination, located.section);

  const pages = document.pages.map((page) => {
    if (page.id === located.page.id) {
      return {
        ...page,
        sections: page.sections.filter(section => section.id !== sectionId),
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
}

export type SectionMoveDestinationAvailability =
  | { available: true }
  | {
    available: false;
    code: BuilderOperationErrorCode;
    reason: string;
  };

/**
 * Uses the same document invariant checks as the eventual commit so the Move
 * surface can explain an unavailable page before the owner selects it. The
 * operation is immutable; the returned document is intentionally discarded.
 */
export const getSectionMoveDestinationAvailability = (
  document: SiteBuilderDocument,
  sectionId: string,
  destinationPageId: string,
): SectionMoveDestinationAvailability => {
  try {
    moveSectionToPage(document, sectionId, destinationPageId);
    return { available: true };
  } catch (error) {
    if (error instanceof BuilderOperationError) {
      return {
        available: false,
        code: error.code,
        reason: error.message,
      };
    }
    throw error;
  }
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

export function moveSectionToNewPage(document: SiteBuilderDocument, input: MoveSectionToNewPageInput, idFactory: IdFactory = createIdFactory()): SiteBuilderDocument {
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
}

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
  if (page.sections.some(section => section.sectionType === 'booking')) {
    return fail('booking_required', BOOKING_REQUIRED_MESSAGE);
  }
  const navigationItem = document.navigation.items.find(
    item => item.pageId === pageId,
  );
  if (!navigationItem) {
    return fail('not_found', `Navigation item not found for page: ${pageId}`);
  }
  const { sections: removedSections, ...pageRecord } = page;
  const restorableSections = removedSections.filter(
    (section): section is RestorableSectionInstance =>
      section.sectionType !== 'booking',
  );
  const next = normalizeDocument({
    ...document,
    pages: document.pages.filter(candidate => candidate.id !== pageId),
    navigation: {
      ...document.navigation,
      items: document.navigation.items.filter(item => item.pageId !== pageId),
    },
    unusedSections: [
      ...document.unusedSections,
      ...restorableSections.map((section, index) => ({
        ...section,
        order: document.unusedSections.length + index,
      })),
    ],
    removedPages: [
      ...document.removedPages,
      {
        page: pageRecord,
        sectionIds: restorableSections.map(section => section.id),
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
    record => record.page.id === pageId,
  );
  if (recordIndex < 0) {
    return fail('not_found', `Removed page not found: ${pageId}`);
  }
  const record = document.removedPages[recordIndex];
  if (!record) {
    return fail('not_found', `Removed page not found: ${pageId}`);
  }
  if (document.pages.some(page => page.id === record.page.id)) {
    return fail('duplicate_id', `Page is already active: ${pageId}`);
  }

  const availableById = new Map(
    document.unusedSections.map(section => [section.id, section]),
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
  const restoredSectionIds = new Set(sections.map(section => section.id));
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
      section => !restoredSectionIds.has(section.id),
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
  const navigationItems = document.navigation.items.map(item =>
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
  const normalizedSlug
    = page.isHome && normalizeSlug(slug) === ''
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
    item => item.pageId === pageId,
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
    item => item.pageId === pageId,
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

export const updateLibrarySectionSettings = (
  document: SiteBuilderDocument,
  sectionId: string,
  rawSettings: unknown,
): SiteBuilderDocument => {
  const located = locateSection(document, sectionId);
  if (!isLibrarySectionType(located.section.sectionType)) {
    return fail('invalid_input', 'This section does not use library settings.');
  }
  const entry = getSectionRegistryEntry(located.section.sectionType);
  const settings = entry.normalize(rawSettings);
  const sections = located.page.sections.map(section =>
    section.id === sectionId
      ? ({ ...section, settings } as SectionInstance)
      : section,
  );
  const next = normalizeDocument(
    replacePage(document, located.pageIndex, { ...located.page, sections }),
  );
  const validated = validateSiteBuilderDocument(next);
  if (!validated.success) {
    return fail('invalid_input', validated.issues.join(' '));
  }
  return validated.document;
};

export const updateSiteContent = (
  document: SiteBuilderDocument,
  input: UpdateSiteContentInput,
): SiteBuilderDocument => {
  if (!SITE_CONTENT_COLLECTION_KEYS.includes(input.collection)) {
    return fail('invalid_input', `Unknown content collection: ${input.collection}`);
  }
  const collection = document.siteContent[input.collection] as Array<{ id: string }>;
  let nextCollection: Array<{ id: string }>;
  if (input.operation === 'upsert') {
    if (!input.record.id) {
      return fail('invalid_input', 'Content records need an id.');
    }
    nextCollection = collection.some(record => record.id === input.record.id)
      ? collection.map(record =>
        record.id === input.record.id ? input.record : record)
      : [...collection, input.record];
  } else if (input.operation === 'remove') {
    if (!collection.some(record => record.id === input.recordId)) {
      return fail('not_found', `Content record not found: ${input.recordId}`);
    }
    // Section settings that referenced the record keep the dangling id;
    // readiness surfaces it and renderers skip it. Sections are never edited
    // silently on the owner's behalf.
    nextCollection = collection.filter(record => record.id !== input.recordId);
  } else {
    const ids = new Set(collection.map(record => record.id));
    if (
      input.orderedIds.length !== collection.length
      || input.orderedIds.some(id => !ids.has(id))
      || new Set(input.orderedIds).size !== input.orderedIds.length
    ) {
      return fail(
        'invalid_input',
        'Reordering must include every existing record exactly once.',
      );
    }
    const byId = new Map(collection.map(record => [record.id, record]));
    nextCollection = input.orderedIds.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    });
  }
  const next = normalizeDocument({
    ...document,
    siteContent: {
      ...document.siteContent,
      [input.collection]: nextCollection,
    },
  });
  const validated = validateSiteBuilderDocument(next);
  if (!validated.success) {
    return fail('invalid_input', validated.issues.join(' '));
  }
  return validated.document;
};

export const applyBuilderCommand = (
  document: SiteBuilderDocument,
  command: BuilderCommand,
  idFactory: IdFactory = createIdFactory(),
): SiteBuilderDocument => {
  switch (command.type) {
    case 'add_section':
      return addSection(document, command.input, idFactory);
    case 'add_library_section_with_adjustment':
      return addSection(
        updateLibrarySectionSettings(
          document,
          command.adjustment.sectionId,
          command.adjustment.settings,
        ),
        command.input,
        idFactory,
      );
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
    case 'update_custom_design_settings':
      return updateCustomDesignSectionSettings(
        document,
        command.sectionId,
        command.settings,
      );
    case 'update_library_section_settings':
      return updateLibrarySectionSettings(
        document,
        command.sectionId,
        command.settings,
      );
    case 'update_site_content':
      return updateSiteContent(document, command.input);
    case 'reset_booking_presentation':
      return resetBookingSectionPresentation(document, command.sectionId);
    case 'move_section':
      return moveSection(document, command.sectionId, command.position);
    case 'move_section_up':
      return moveSectionUp(document, command.sectionId);
    case 'move_section_down':
      return moveSectionDown(document, command.sectionId);
    case 'commit_section_move':
      return commitSectionMove(document, command.input, idFactory);
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
