import {
  LEGACY_SITE_BUILDER_SCHEMA_VERSION,
  SITE_BUILDER_SCHEMA_VERSION,
} from '../types';
import { LIBRARY_TYPE_BY_LEGACY_ROLE, SECTION_LIBRARY_REGISTRY } from './registry';
/**
 * Lossless v1 → v2 document upgrade.
 *
 * v1 starter documents carried numbered placeholder sections tagged (or, for
 * pre-metadata documents, positionally resolvable) with a semantic role. v2
 * turns those into real library sections with default settings while
 * preserving id, order, visibility, and any owner-authored label. Owner-added
 * placeholders without a role survive unchanged as legacy instances — nothing
 * is deleted, renamed, or reinterpreted.
 *
 * The v1 starter layouts are frozen HERE as historical facts: the live
 * starter definitions evolve with the library, but what a v1 document meant
 * can never change.
 */
import type { LibrarySectionType } from './settings';
import { createEmptySiteContent } from './site-content';

type RawRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type LegacyRole =
  | 'hero'
  | 'services'
  | 'featured_work'
  | 'gallery'
  | 'about'
  | 'reviews'
  | 'visit'
  | 'contact';

type LegacyStarterSection = {
  role: LegacyRole;
  sectionType: string;
  pageSlug: string;
  sectionOrder: number;
  previewLabel: string;
};

/** Historical v1 STARTER_PAGES, frozen for upgrade fidelity. */
const LEGACY_V1_STARTER_SECTIONS: Record<string, readonly LegacyStarterSection[]> = {
  multi_page: [
    { pageSlug: '', previewLabel: 'Welcome', role: 'hero', sectionOrder: 0, sectionType: 'section_01' },
    { pageSlug: '', previewLabel: 'Featured work', role: 'featured_work', sectionOrder: 1, sectionType: 'section_02' },
    { pageSlug: 'services-book', previewLabel: 'Services', role: 'services', sectionOrder: 0, sectionType: 'section_03' },
    { pageSlug: 'gallery', previewLabel: 'Gallery', role: 'gallery', sectionOrder: 0, sectionType: 'section_04' },
    { pageSlug: 'about', previewLabel: 'About', role: 'about', sectionOrder: 0, sectionType: 'section_05' },
    { pageSlug: 'contact', previewLabel: 'Visit us', role: 'visit', sectionOrder: 0, sectionType: 'section_06' },
    { pageSlug: 'contact', previewLabel: 'Contact', role: 'contact', sectionOrder: 1, sectionType: 'section_07' },
  ],
  one_page: [
    { pageSlug: '', previewLabel: 'Welcome', role: 'hero', sectionOrder: 0, sectionType: 'section_01' },
    { pageSlug: '', previewLabel: 'About', role: 'about', sectionOrder: 1, sectionType: 'section_02' },
    { pageSlug: '', previewLabel: 'Services', role: 'services', sectionOrder: 2, sectionType: 'section_03' },
    { pageSlug: '', previewLabel: 'Gallery', role: 'gallery', sectionOrder: 3, sectionType: 'section_04' },
    { pageSlug: '', previewLabel: 'Reviews', role: 'reviews', sectionOrder: 4, sectionType: 'section_05' },
  ],
  quick_book: [
    { pageSlug: '', previewLabel: 'Salon intro', role: 'hero', sectionOrder: 0, sectionType: 'section_01' },
    { pageSlug: '', previewLabel: 'Services', role: 'services', sectionOrder: 1, sectionType: 'section_02' },
  ],
};

const LEGACY_CATALOGUE_LABEL = /^Section (?:0[1-9]|1\d|20)$/u;

const isLegacyPlaceholder = (section: RawRecord): boolean =>
  typeof section.sectionType === 'string'
  && /^section_(?:0[1-9]|1\d|20)$/u.test(section.sectionType);

/**
 * Preset adjustments the role mapping implies beyond registry defaults:
 * v1's "featured work" module becomes an editorial gallery.
 */
const presetForRole = (role: LegacyRole): string | null =>
  role === 'featured_work' ? 'editorial' : null;

const upgradePlaceholderToLibrarySection = (
  section: RawRecord,
  role: LegacyRole,
  previewLabel: string,
): RawRecord => {
  const type = LIBRARY_TYPE_BY_LEGACY_ROLE[role] as LibrarySectionType | undefined;
  if (!type) {
    return section;
  }
  const entry = SECTION_LIBRARY_REGISTRY[type];
  const settings: RawRecord = { ...entry.defaultSettings() };
  const preset = presetForRole(role);
  if (preset && 'preset' in settings) {
    settings.preset = preset;
  }
  const label = typeof section.label === 'string'
    && !LEGACY_CATALOGUE_LABEL.test(section.label)
    ? section.label
    : previewLabel;
  return {
    id: section.id,
    ...(type === 'gallery'
      ? {
          galleryPresentationOwner: role === 'featured_work'
            ? 'recipe'
            : 'onboarding',
        }
      : {}),
    label,
    order: section.order,
    sectionType: type,
    settings,
    visible: section.visible,
  };
};

const resolveLegacyRoles = (
  document: RawRecord,
): Map<unknown, { role: LegacyRole; previewLabel: string }> => {
  const layout = LEGACY_V1_STARTER_SECTIONS[
    typeof document.originStarter === 'string' ? document.originStarter : ''
  ] ?? [];
  const pages = Array.isArray(document.pages) ? document.pages.filter(isRecord) : [];
  const unused = Array.isArray(document.unusedSections)
    ? document.unusedSections.filter(isRecord)
    : [];
  const allPlaceholders = [
    ...pages.flatMap(page =>
      (Array.isArray(page.sections) ? page.sections.filter(isRecord) : [])),
    ...unused,
  ].filter(isLegacyPlaceholder);

  const byId = new Map<unknown, { role: LegacyRole; previewLabel: string }>();
  const hasExplicit = allPlaceholders.some(
    section => typeof section.starterSemanticRole === 'string',
  );

  if (hasExplicit) {
    for (const section of allPlaceholders) {
      const role = section.starterSemanticRole;
      if (typeof role !== 'string') {
        continue;
      }
      const definition = layout.find(candidate => candidate.role === role);
      byId.set(section.id, {
        previewLabel: definition?.previewLabel
          ?? (typeof section.label === 'string' ? section.label : 'Section'),
        role: role as LegacyRole,
      });
    }
    return byId;
  }

  // Pre-metadata documents: bounded positional fallback, mirroring the
  // historical resolution order (exact slot → same page slug → first match).
  const assigned = new Set<unknown>();
  for (const definition of layout) {
    const candidates = pages.flatMap((page) => {
      const sections = Array.isArray(page.sections)
        ? page.sections.filter(isRecord)
        : [];
      return sections
        .filter(section => isLegacyPlaceholder(section)
          && section.sectionType === definition.sectionType
          && !assigned.has(section.id))
        .map(section => ({ page, section }));
    });
    const matched = candidates.find(({ page, section }) =>
      page.slug === definition.pageSlug && section.order === definition.sectionOrder)
      ?? candidates.find(({ page }) => page.slug === definition.pageSlug)
      ?? candidates[0];
    if (!matched) {
      continue;
    }
    assigned.add(matched.section.id);
    byId.set(matched.section.id, {
      previewLabel: definition.previewLabel,
      role: definition.role,
    });
  }
  return byId;
};

/**
 * Upgrades a raw parsed document to the current schema. v2 documents pass
 * through untouched; v1 documents are structurally upgraded and re-versioned;
 * anything else is returned as-is for validation to reject with its own
 * messages.
 */
export const upgradeSiteBuilderDocument = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  if (value.schemaVersion === SITE_BUILDER_SCHEMA_VERSION) {
    return value;
  }
  if (value.schemaVersion !== LEGACY_SITE_BUILDER_SCHEMA_VERSION) {
    return value;
  }

  const roles = resolveLegacyRoles(value);

  const upgradeSection = (section: unknown): unknown => {
    if (!isRecord(section) || !isLegacyPlaceholder(section)) {
      return section;
    }
    const resolved = roles.get(section.id);
    if (!resolved) {
      // Owner-added placeholder: survives as a legacy instance, minus the
      // starter-only metadata field.
      const { starterSemanticRole: _dropped, ...rest } = section;
      return rest;
    }
    return upgradePlaceholderToLibrarySection(
      section,
      resolved.role,
      resolved.previewLabel,
    );
  };

  const pages = Array.isArray(value.pages)
    ? value.pages.map(page => isRecord(page)
      ? {
          ...page,
          sections: Array.isArray(page.sections)
            ? page.sections.map(upgradeSection)
            : page.sections,
        }
      : page)
    : value.pages;

  const unusedSections = Array.isArray(value.unusedSections)
    ? value.unusedSections.map(upgradeSection)
    : value.unusedSections;

  return {
    ...value,
    pages,
    schemaVersion: SITE_BUILDER_SCHEMA_VERSION,
    siteContent: isRecord(value.siteContent)
      ? value.siteContent
      : createEmptySiteContent(),
    unusedSections,
  };
};
