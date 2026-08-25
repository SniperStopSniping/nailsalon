import { validateBookingPresentationSettings } from '../booking/presentation';
import { hasNormalizedOrdering, normalizeDocument } from './normalize';
import {
  SITE_BUILDER_SCHEMA_VERSION,
  type DocumentImportResult,
  type DocumentValidationResult,
  type SiteBuilderDocument,
} from './types';

export const SITE_BUILDER_STORAGE_KEY =
  'luster:site-builder-v2-booking-integration-lab:document:v1';
export const MAX_SITE_BUILDER_IMPORT_JSON_LENGTH = 500_000;

const ROOT_KEYS = new Set([
  'schemaVersion',
  'siteId',
  'siteName',
  'originStarter',
  'navigation',
  'pages',
  'unusedSections',
  'removedPages',
]);
const NAVIGATION_KEYS = new Set(['enabled', 'style', 'items']);
const NAVIGATION_ITEM_KEYS = new Set(['id', 'pageId', 'label', 'order']);
const PAGE_KEYS = new Set([
  'id',
  'name',
  'slug',
  'order',
  'isHome',
  'visible',
  'visibleInNavigation',
  'sections',
]);
const REMOVED_PAGE_DOCUMENT_KEYS = new Set([
  'id',
  'name',
  'slug',
  'order',
  'isHome',
  'visible',
  'visibleInNavigation',
]);
const REMOVED_PAGE_RECORD_KEYS = new Set([
  'page',
  'sectionIds',
  'navigationItem',
  'removedAtOrder',
]);
const PLACEHOLDER_SECTION_KEYS = new Set([
  'id',
  'sectionType',
  'label',
  'order',
  'visible',
  'size',
  'placeholderSettings',
]);
const BOOKING_SECTION_KEYS = new Set([
  'id',
  'sectionType',
  'label',
  'order',
  'visible',
  'settings',
]);
const PLACEHOLDER_SETTINGS_KEYS = new Set(['note']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';
const isOrder = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isCatalogueSectionType = (value: unknown): boolean =>
  typeof value === 'string' && /^section_(0[1-9]|1[0-9]|20)$/.test(value);

const isSectionSize = (value: unknown): boolean =>
  value === 'compact' || value === 'medium' || value === 'large';

const rejectUnknownKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: string[],
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(`${path}.${key} is not supported.`);
    }
  }
};

const validateNavigationItemShape = (
  value: unknown,
  path: string,
  issues: string[],
): void => {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  rejectUnknownKeys(value, NAVIGATION_ITEM_KEYS, path, issues);
  if (!isString(value.id) || value.id.length === 0) {
    issues.push(`${path}.id must be a non-empty string.`);
  }
  if (!isString(value.pageId) || value.pageId.length === 0) {
    issues.push(`${path}.pageId must be a non-empty string.`);
  }
  if (!isString(value.label) || value.label.trim().length === 0) {
    issues.push(`${path}.label must be a non-empty string.`);
  }
  if (!isOrder(value.order)) {
    issues.push(`${path}.order must be a non-negative integer.`);
  }
};

const validateSectionBaseShape = (
  value: Record<string, unknown>,
  path: string,
  issues: string[],
): void => {
  if (!isString(value.id) || value.id.length === 0) {
    issues.push(`${path}.id must be a non-empty string.`);
  }
  if (!isString(value.label) || value.label.trim().length === 0) {
    issues.push(`${path}.label must be a non-empty string.`);
  }
  if (!isOrder(value.order)) {
    issues.push(`${path}.order must be a non-negative integer.`);
  }
  if (!isBoolean(value.visible)) {
    issues.push(`${path}.visible must be a boolean.`);
  }
};

const validatePlaceholderSectionShape = (
  value: Record<string, unknown>,
  path: string,
  issues: string[],
): void => {
  rejectUnknownKeys(value, PLACEHOLDER_SECTION_KEYS, path, issues);
  validateSectionBaseShape(value, path, issues);
  if (!isCatalogueSectionType(value.sectionType)) {
    issues.push(`${path}.sectionType is not in the placeholder catalogue.`);
  }
  if (!isSectionSize(value.size)) {
    issues.push(`${path}.size is invalid.`);
  }
  if (!isRecord(value.placeholderSettings)) {
    issues.push(`${path}.placeholderSettings must be an object.`);
    return;
  }
  rejectUnknownKeys(
    value.placeholderSettings,
    PLACEHOLDER_SETTINGS_KEYS,
    `${path}.placeholderSettings`,
    issues,
  );
  if (
    value.placeholderSettings.note !== undefined &&
    !isString(value.placeholderSettings.note)
  ) {
    issues.push(`${path}.placeholderSettings.note must be a string.`);
  }
};

const validateBookingSectionShape = (
  value: Record<string, unknown>,
  path: string,
  issues: string[],
): void => {
  rejectUnknownKeys(value, BOOKING_SECTION_KEYS, path, issues);
  validateSectionBaseShape(value, path, issues);
  if (value.sectionType !== 'booking') {
    issues.push(`${path}.sectionType must be booking.`);
  }
  if (value.label !== 'Booking') {
    issues.push(`${path}.label must be Booking.`);
  }
  const result = validateBookingPresentationSettings(value.settings);
  if (!result.success) {
    result.issues.forEach((issue) =>
      issues.push(`${path}.settings: ${issue}`),
    );
  }
};

const validateSectionShape = (
  value: unknown,
  path: string,
  issues: string[],
  allowBooking: boolean,
): void => {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  if (value.sectionType === 'booking') {
    if (!allowBooking) {
      issues.push(`${path} cannot contain the protected Booking section.`);
      return;
    }
    validateBookingSectionShape(value, path, issues);
    return;
  }
  validatePlaceholderSectionShape(value, path, issues);
};

const validatePageShape = (
  value: unknown,
  path: string,
  issues: string[],
  includeSections: boolean,
): void => {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  rejectUnknownKeys(
    value,
    includeSections ? PAGE_KEYS : REMOVED_PAGE_DOCUMENT_KEYS,
    path,
    issues,
  );
  if (!isString(value.id) || value.id.length === 0) {
    issues.push(`${path}.id must be a non-empty string.`);
  }
  if (!isString(value.name) || value.name.trim().length === 0) {
    issues.push(`${path}.name must be a non-empty string.`);
  }
  if (!isString(value.slug)) {
    issues.push(`${path}.slug must be a string.`);
  }
  if (!isOrder(value.order)) {
    issues.push(`${path}.order must be a non-negative integer.`);
  }
  if (!isBoolean(value.isHome)) {
    issues.push(`${path}.isHome must be a boolean.`);
  }
  if (!isBoolean(value.visible)) {
    issues.push(`${path}.visible must be a boolean.`);
  }
  if (!isBoolean(value.visibleInNavigation)) {
    issues.push(`${path}.visibleInNavigation must be a boolean.`);
  }
  if (!includeSections) {
    return;
  }
  if (!Array.isArray(value.sections)) {
    issues.push(`${path}.sections must be an array.`);
    return;
  }
  value.sections.forEach((section, index) =>
    validateSectionShape(section, `${path}.sections[${index}]`, issues, true),
  );
};

const validateRemovedPageShape = (
  value: unknown,
  path: string,
  issues: string[],
): void => {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  rejectUnknownKeys(value, REMOVED_PAGE_RECORD_KEYS, path, issues);
  validatePageShape(value.page, `${path}.page`, issues, false);
  if (!Array.isArray(value.sectionIds) || !value.sectionIds.every(isString)) {
    issues.push(`${path}.sectionIds must be a string array.`);
  }
  validateNavigationItemShape(
    value.navigationItem,
    `${path}.navigationItem`,
    issues,
  );
  if (!isOrder(value.removedAtOrder)) {
    issues.push(`${path}.removedAtOrder must be a non-negative integer.`);
  }
};

const validateRootShape = (
  value: unknown,
  issues: string[],
): value is SiteBuilderDocument => {
  if (!isRecord(value)) {
    issues.push('Document must be an object.');
    return false;
  }
  rejectUnknownKeys(value, ROOT_KEYS, 'document', issues);
  if (value.schemaVersion !== SITE_BUILDER_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${SITE_BUILDER_SCHEMA_VERSION}.`);
  }
  if (!isString(value.siteId) || value.siteId.length === 0) {
    issues.push('siteId must be a non-empty string.');
  }
  if (!isString(value.siteName) || value.siteName.trim().length === 0) {
    issues.push('siteName must be a non-empty string.');
  }
  if (
    value.originStarter !== 'quick_book' &&
    value.originStarter !== 'one_page' &&
    value.originStarter !== 'multi_page'
  ) {
    issues.push('originStarter is invalid.');
  }
  if (!isRecord(value.navigation)) {
    issues.push('navigation must be an object.');
  } else {
    rejectUnknownKeys(value.navigation, NAVIGATION_KEYS, 'navigation', issues);
    if (!isBoolean(value.navigation.enabled)) {
      issues.push('navigation.enabled must be a boolean.');
    }
    if (value.navigation.style !== 'simple') {
      issues.push('navigation.style must be simple.');
    }
    if (!Array.isArray(value.navigation.items)) {
      issues.push('navigation.items must be an array.');
    } else {
      value.navigation.items.forEach((item, index) =>
        validateNavigationItemShape(
          item,
          `navigation.items[${index}]`,
          issues,
        ),
      );
    }
  }
  if (!Array.isArray(value.pages)) {
    issues.push('pages must be an array.');
  } else {
    value.pages.forEach((page, index) =>
      validatePageShape(page, `pages[${index}]`, issues, true),
    );
  }
  if (!Array.isArray(value.unusedSections)) {
    issues.push('unusedSections must be an array.');
  } else {
    value.unusedSections.forEach((section, index) =>
      validateSectionShape(
        section,
        `unusedSections[${index}]`,
        issues,
        false,
      ),
    );
  }
  if (!Array.isArray(value.removedPages)) {
    issues.push('removedPages must be an array.');
  } else {
    value.removedPages.forEach((record, index) =>
      validateRemovedPageShape(record, `removedPages[${index}]`, issues),
    );
  }
  return issues.length === 0;
};

const findDuplicates = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
};

const validateDocumentInvariants = (
  document: SiteBuilderDocument,
  issues: string[],
): void => {
  if (document.pages.length === 0) {
    issues.push('Document must have at least one page.');
  }
  if (document.pages.filter((page) => page.isHome).length !== 1) {
    issues.push('Document must have exactly one Home page.');
  }
  if (!document.pages.some((page) => page.visible)) {
    issues.push('Document must have at least one visible page.');
  }

  const bookingLocations = document.pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.sectionType === 'booking' ? [{ page, section }] : [],
    ),
  );
  if (bookingLocations.length !== 1) {
    issues.push('Document must contain exactly one Booking section.');
  } else {
    const booking = bookingLocations[0];
    if (!booking?.page.visible || !booking.section.visible) {
      issues.push('Booking must be visible on a visible page.');
    }
  }

  if (!hasNormalizedOrdering(document.pages)) {
    issues.push('Page ordering must be normalized.');
  }
  if (!hasNormalizedOrdering(document.navigation.items)) {
    issues.push('Navigation ordering must be normalized.');
  }
  if (!hasNormalizedOrdering(document.unusedSections)) {
    issues.push('Unused section ordering must be normalized.');
  }
  document.pages.forEach((page) => {
    if (!hasNormalizedOrdering(page.sections)) {
      issues.push(`Section ordering for page ${page.id} must be normalized.`);
    }
  });

  const pageIds = document.pages.map((page) => page.id);
  const removedPageIds = document.removedPages.map((record) => record.page.id);
  const navigationIds = [
    ...document.navigation.items.map((item) => item.id),
    ...document.removedPages.map((record) => record.navigationItem.id),
  ];
  const activeSectionIds = document.pages.flatMap((page) =>
    page.sections.map((section) => section.id),
  );
  const sectionIds = [
    ...activeSectionIds,
    ...document.unusedSections.map((section) => section.id),
  ];
  const entityIds = [
    document.siteId,
    ...pageIds,
    ...removedPageIds,
    ...navigationIds,
    ...sectionIds,
  ];
  const duplicateIds = findDuplicates(entityIds);
  if (duplicateIds.length > 0) {
    issues.push(`Entity IDs must be unique: ${duplicateIds.join(', ')}.`);
  }

  const duplicateSlugs = findDuplicates(document.pages.map((page) => page.slug));
  if (duplicateSlugs.length > 0) {
    issues.push(`Active page slugs must be unique: ${duplicateSlugs.join(', ')}.`);
  }

  const navigationPageIds = document.navigation.items.map(
    (item) => item.pageId,
  );
  if (
    navigationPageIds.length !== pageIds.length ||
    pageIds.some((pageId) => !navigationPageIds.includes(pageId)) ||
    navigationPageIds.some((pageId) => !pageIds.includes(pageId))
  ) {
    issues.push('Navigation must have exactly one item for each active page.');
  }

  const knownSectionIds = new Set(sectionIds);
  const removedSectionReferences = document.removedPages.flatMap(
    (record) => record.sectionIds,
  );
  const duplicateRemovedReferences = findDuplicates(removedSectionReferences);
  if (duplicateRemovedReferences.length > 0) {
    issues.push(
      `Removed pages cannot share section references: ${duplicateRemovedReferences.join(', ')}.`,
    );
  }
  const bookingId = bookingLocations[0]?.section.id;
  document.removedPages.forEach((record) => {
    if (record.page.isHome) {
      issues.push(`Removed page ${record.page.id} cannot be Home.`);
    }
    if (record.navigationItem.pageId !== record.page.id) {
      issues.push(
        `Removed page ${record.page.id} has an incoherent navigation item.`,
      );
    }
    record.sectionIds.forEach((sectionId) => {
      if (!knownSectionIds.has(sectionId)) {
        issues.push(
          `Removed page ${record.page.id} references missing section ${sectionId}.`,
        );
      }
      if (sectionId === bookingId) {
        issues.push('Removed pages cannot reference the protected Booking section.');
      }
    });
  });
};

export const validateSiteBuilderDocument = (
  value: unknown,
): DocumentValidationResult => {
  const issues: string[] = [];
  if (!validateRootShape(value, issues)) {
    return { success: false, issues };
  }
  validateDocumentInvariants(value, issues);
  if (issues.length > 0) {
    return { success: false, issues };
  }
  return { success: true, document: normalizeDocument(value) };
};

export const exportSiteBuilderDocument = (
  document: SiteBuilderDocument,
): string => {
  const validated = validateSiteBuilderDocument(document);
  if (!validated.success) {
    throw new Error(`Cannot export an invalid site document: ${validated.issues.join(' ')}`);
  }
  return JSON.stringify(validated.document, null, 2);
};

export const parseSiteBuilderDocument = (
  json: string,
): DocumentImportResult => {
  if (json.length > MAX_SITE_BUILDER_IMPORT_JSON_LENGTH) {
    return {
      success: false,
      issues: ['The selected site document is too large.'],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return { success: false, issues: ['The selected file is not valid JSON.'] };
  }
  return validateSiteBuilderDocument(parsed);
};

export const importSiteBuilderDocument = parseSiteBuilderDocument;
