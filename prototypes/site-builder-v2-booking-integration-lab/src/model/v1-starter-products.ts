import type {
  LibrarySectionType,
  PageDocument,
  SiteBuilderDocument,
} from './types';

export const V1_CORE_LIBRARY_SECTION_TYPES = [
  'hero',
  'gallery',
  'about',
  'team',
  'reviews',
  'policies',
  'visit_us',
] as const satisfies readonly LibrarySectionType[];

export type V1CoreLibrarySectionType =
  (typeof V1_CORE_LIBRARY_SECTION_TYPES)[number];

export type V1CoreSectionType = V1CoreLibrarySectionType | 'booking';

export type V1StarterPageRole =
  | 'about'
  | 'contact'
  | 'gallery'
  | 'home'
  | 'services';

export type V1ProfileSectionType = 'about' | 'team';

type GetNormalV1AddSectionTypesInput = {
  businessStructure: 'multi_tech' | 'solo' | null;
  document: SiteBuilderDocument;
  page: PageDocument;
};

const normalizePageIdentity = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-');

const pageHasAnySection = (
  page: PageDocument,
  sectionTypes: readonly string[],
): boolean => page.sections.some(section => sectionTypes.includes(section.sectionType));

/**
 * Resolves a multi-page starter's authoritative page even after an owner
 * changes the visible page name. Stable starter slugs win, existing core
 * content provides a migration-safe fallback. Unknown owner-created pages
 * remain outside the locked recipe instead of inheriting a role by position.
 */
export const getV1StarterPageRole = (
  document: SiteBuilderDocument,
  page: PageDocument,
): V1StarterPageRole | null => {
  if (page.isHome) {
    return 'home';
  }
  if (document.originStarter !== 'multi_page') {
    return null;
  }

  const identity = normalizePageIdentity(`${page.slug} ${page.name}`);
  if (identity.includes('services-book') || identity.includes('booking')) {
    return 'services';
  }
  if (identity.includes('gallery')) {
    return 'gallery';
  }
  if (identity.includes('about') || identity.includes('team')) {
    return 'about';
  }
  if (identity.includes('contact') || identity.includes('visit')) {
    return 'contact';
  }

  if (pageHasAnySection(page, ['booking', 'policies'])) {
    return 'services';
  }
  if (pageHasAnySection(page, ['gallery'])) {
    return 'gallery';
  }
  if (pageHasAnySection(page, ['about', 'team'])) {
    return 'about';
  }
  if (pageHasAnySection(page, ['visit_us'])) {
    return 'contact';
  }

  return null;
};

const getProfileSectionType = (
  document: SiteBuilderDocument,
  businessStructure: GetNormalV1AddSectionTypesInput['businessStructure'],
): V1ProfileSectionType => {
  const activeProfileSection = document.pages
    .flatMap(page => page.sections)
    .find(section => section.sectionType === 'about' || section.sectionType === 'team');
  if (activeProfileSection?.sectionType === 'team') {
    return 'team';
  }
  if (activeProfileSection?.sectionType === 'about') {
    return 'about';
  }

  const removedProfileSection = document.unusedSections.find(
    section => section.sectionType === 'about' || section.sectionType === 'team',
  );
  if (businessStructure === null && removedProfileSection?.sectionType === 'team') {
    return 'team';
  }
  return businessStructure === 'multi_tech' ? 'team' : 'about';
};

const getAllowedTypesForPage = (
  document: SiteBuilderDocument,
  page: PageDocument,
  profileSectionType: V1ProfileSectionType,
): readonly V1CoreSectionType[] => {
  const role = getV1StarterPageRole(document, page);
  if (role === null) {
    return [];
  }

  if (document.originStarter === 'quick_book') {
    return role === 'home'
      ? ['hero', 'booking', 'gallery', 'visit_us']
      : [];
  }
  if (document.originStarter === 'one_page') {
    return role === 'home'
      ? [
          'hero',
          'gallery',
          profileSectionType,
          'booking',
          'reviews',
          'policies',
          'visit_us',
        ]
      : [];
  }

  switch (role) {
    case 'home':
      return ['hero', 'reviews'];
    case 'services':
      return ['booking', 'policies'];
    case 'gallery':
      return ['gallery'];
    case 'about':
      return [profileSectionType];
    case 'contact':
      return ['visit_us'];
  }
};

/**
 * Normal V1 owners only see missing core families for the recipe slot they
 * are editing. A section already present anywhere in the document is not
 * offered again, which preserves the single-home content-ownership contract.
 * Audit mode intentionally bypasses this selector and uses the full registry.
 */
export const getNormalV1AddSectionTypes = ({
  businessStructure,
  document,
  page,
}: GetNormalV1AddSectionTypesInput): readonly V1CoreSectionType[] => {
  const activeTypes = new Set(
    document.pages.flatMap(candidate => candidate.sections.map(section => section.sectionType)),
  );
  const profileSectionType = getProfileSectionType(document, businessStructure);
  return getAllowedTypesForPage(document, page, profileSectionType)
    .filter(sectionType => !activeTypes.has(sectionType));
};
