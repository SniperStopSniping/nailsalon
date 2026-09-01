import { createDefaultBookingPresentationSettings } from '../booking/presentation';
import { createDefaultCustomDesignSettings } from '../custom-design/model/settings';
import { getSectionCatalogueItem } from './catalogue';
import { createIdFactory } from './ids';
import { normalizeDocument } from './normalize';
import {
  getSectionRegistryEntry,
  isLibrarySectionType,
} from './section-library/registry';
import { createEmptySiteContent } from './section-library/site-content';
import {
  type BookingSectionInstance,
  type CatalogueSectionType,
  type CustomDesignSectionInstance,
  type GalleryPresentationOwner,
  type IdFactory,
  type LibrarySectionType,
  type NavigationItem,
  type OriginStarter,
  type PageDocument,
  type PlaceholderSectionInstance,
  type SectionInstance,
  type SectionSize,
  type SectionType,
  SITE_BUILDER_SCHEMA_VERSION,
  type SiteBuilderDocument,
  type StarterSectionSemanticRole,
} from './types';

const DEFAULT_SECTION_NOTE = 'Content and settings will be designed later.';

/**
 * `summary: false` marks composition chrome (announcement, navigation, CTAs,
 * footer, policy blocks) that stays out of the starter cards' "Includes"
 * copy and animated mini-preview scenes — the cards keep describing what the
 * owner recognizes as content, while the real document carries the full
 * coordinated section set.
 */
export type StarterSectionDefinition =
  | {
    previewLabel: string;
    sectionType: LibrarySectionType;
    preset?: string;
    label?: string;
    galleryPresentationOwner?: GalleryPresentationOwner;
    summary?: boolean;
  }
  | { previewLabel: 'Booking'; sectionType: 'booking'; summary?: boolean };

export type StarterPageDefinition = {
  name: string;
  previewLabel?: string;
  slug: string;
  sections: readonly StarterSectionDefinition[];
};

export type InitializeStarterOptions = {
  idFactory?: IdFactory;
  siteId?: string;
  siteName?: string;
};

const STARTER_PAGES: Record<OriginStarter, readonly StarterPageDefinition[]> = {
  quick_book: [
    {
      name: 'Home',
      slug: '',
      sections: [
        { previewLabel: 'Announcement', sectionType: 'announcement_bar', summary: false },
        { label: 'Salon intro', preset: 'booking_first', previewLabel: 'Salon intro', sectionType: 'hero' },
        { previewLabel: 'Services', sectionType: 'featured_services' },
        { previewLabel: 'Booking', sectionType: 'booking' },
        { previewLabel: 'Final CTA', sectionType: 'final_cta', summary: false },
        { previewLabel: 'Footer', sectionType: 'footer', summary: false },
      ],
    },
  ],
  one_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        { previewLabel: 'Announcement', sectionType: 'announcement_bar', summary: false },
        { label: 'Welcome', previewLabel: 'Welcome', sectionType: 'hero' },
        { previewLabel: 'Quick facts', sectionType: 'quick_info', summary: false },
        { previewLabel: 'On-page menu', sectionType: 'section_navigation', summary: false },
        { previewLabel: 'About', sectionType: 'about' },
        { previewLabel: 'Services', sectionType: 'featured_services' },
        {
          galleryPresentationOwner: 'onboarding',
          previewLabel: 'Gallery',
          sectionType: 'gallery',
        },
        { previewLabel: 'Reviews', sectionType: 'reviews' },
        { previewLabel: 'Deposits', sectionType: 'deposits_cancellations', summary: false },
        { previewLabel: 'Policies', sectionType: 'policies', summary: false },
        { previewLabel: 'Visit us', sectionType: 'visit_us', summary: false },
        { previewLabel: 'Booking', sectionType: 'booking' },
        { previewLabel: 'Final CTA', sectionType: 'final_cta', summary: false },
        { previewLabel: 'Footer', sectionType: 'footer', summary: false },
      ],
    },
  ],
  multi_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        { previewLabel: 'Announcement', sectionType: 'announcement_bar', summary: false },
        { label: 'Welcome', previewLabel: 'Welcome', sectionType: 'hero' },
        { previewLabel: 'Quick facts', sectionType: 'quick_info', summary: false },
        { previewLabel: 'Services', sectionType: 'featured_services' },
        {
          galleryPresentationOwner: 'recipe',
          label: 'Featured work',
          preset: 'editorial',
          previewLabel: 'Featured work',
          sectionType: 'gallery',
        },
        { previewLabel: 'Reviews', sectionType: 'reviews', summary: false },
        { previewLabel: 'Final CTA', sectionType: 'final_cta', summary: false },
        { previewLabel: 'Footer', sectionType: 'footer', summary: false },
      ],
    },
    {
      name: 'Services / Book',
      previewLabel: 'Services & Booking',
      slug: 'services-book',
      sections: [
        { previewLabel: 'Booking', sectionType: 'booking' },
        { previewLabel: 'Deposits', sectionType: 'deposits_cancellations', summary: false },
        { previewLabel: 'Policies', sectionType: 'policies', summary: false },
        { previewLabel: 'FAQ', sectionType: 'faq', summary: false },
        { previewLabel: 'Footer', sectionType: 'footer', summary: false },
      ],
    },
    {
      name: 'Gallery',
      slug: 'gallery',
      sections: [
        {
          galleryPresentationOwner: 'onboarding',
          previewLabel: 'Gallery',
          sectionType: 'gallery',
        },
        { previewLabel: 'Final CTA', sectionType: 'final_cta', summary: false },
        { previewLabel: 'Footer', sectionType: 'footer', summary: false },
      ],
    },
    {
      name: 'Team',
      slug: 'team',
      sections: [
        { previewLabel: 'Team', sectionType: 'team' },
        { previewLabel: 'About', sectionType: 'about' },
        { previewLabel: 'Footer', sectionType: 'footer', summary: false },
      ],
    },
    {
      name: 'Contact',
      slug: 'contact',
      sections: [
        { previewLabel: 'Visit us', sectionType: 'visit_us' },
        { previewLabel: 'Hours', sectionType: 'hours', summary: false },
        { previewLabel: 'Contact', sectionType: 'contact' },
        { previewLabel: 'Footer', sectionType: 'footer', summary: false },
      ],
    },
  ],
};

export const getStarterPageDefinitions = (
  starter: OriginStarter,
): readonly StarterPageDefinition[] => STARTER_PAGES[starter];

export const getSectionLabel = (sectionType: SectionType): string =>
  sectionType === 'booking'
    ? 'Booking'
    : sectionType === 'custom_design'
      ? 'Custom Design'
      : isLibrarySectionType(sectionType)
        ? getSectionRegistryEntry(sectionType).label
        : getSectionCatalogueItem(sectionType).label;

export type StarterDocumentSemanticInfo = {
  previewLabel: string;
  role: StarterSectionSemanticRole;
};

/**
 * Resolves the immutable starter role for active, hidden, moved, renamed, and
 * unused sections. New documents use persisted role metadata. The bounded
 * fallback exists only for schema-v1 documents created before that metadata.
 */
export const getStarterDocumentSemanticInfoBySectionId = (
  document: SiteBuilderDocument,
): Map<string, StarterDocumentSemanticInfo> => {
  const pageDefinitions = getStarterPageDefinitions(document.originStarter);
  const pages = [...document.pages].sort((left, right) => left.order - right.order);
  const activeAndUnusedPlaceholders = [
    ...pages.flatMap(page => page.sections),
    ...document.unusedSections,
  ].filter((section): section is PlaceholderSectionInstance => (
    section.sectionType !== 'booking'
    && section.sectionType !== 'custom_design'
    && !isLibrarySectionType(section.sectionType)
  ));
  // Since schema v2, role-tagged placeholders no longer exist in validated
  // documents — the upgrade path converts them into real library sections
  // before any consumer sees them. The map stays exported for the compiler's
  // legacy branch, and only ever carries entries for a residual v1-era
  // placeholder that slipped past the upgrade (explicit metadata only; the
  // positional fallback moved into the upgrade module with the frozen v1
  // starter layouts).
  void pageDefinitions;
  void pages;
  const infoBySectionId = new Map<string, StarterDocumentSemanticInfo>();
  for (const section of activeAndUnusedPlaceholders) {
    if (!section.starterSemanticRole) {
      continue;
    }
    infoBySectionId.set(section.id, {
      previewLabel: section.label,
      role: section.starterSemanticRole,
    });
  }
  return infoBySectionId;
};

export type StarterDocumentOutlinePage = {
  id: string;
  label: string;
  sections: Array<{
    id: string;
    label: string;
    sectionType: SectionType;
    semanticRole?: StarterSectionSemanticRole;
  }>;
};

/**
 * Presents the structure of the real universal document. Semantic labels live
 * beside the definitions used to create that document, so onboarding cannot
 * drift into a separate starter recipe.
 */
export const getStarterDocumentOutline = (
  document: SiteBuilderDocument | null,
): StarterDocumentOutlinePage[] => {
  if (!document) {
    return [];
  }
  const semanticInfoBySectionId = getStarterDocumentSemanticInfoBySectionId(document);
  return [...document.pages]
    .filter(page => page.visible)
    .sort((left, right) => left.order - right.order)
    .map((page) => {
      return {
        id: page.id,
        label: page.name,
        sections: [...page.sections]
          .filter(section => section.visible)
          .sort((left, right) => left.order - right.order)
          .map((section) => {
            const semanticInfo = semanticInfoBySectionId.get(section.id);
            const catalogueLabel = getSectionLabel(section.sectionType);
            return {
              id: section.id,
              label: semanticInfo && section.label === catalogueLabel
                ? semanticInfo.previewLabel
                : section.label,
              ...(semanticInfo
                ? { semanticRole: semanticInfo.role }
                : {}),
              sectionType: section.sectionType,
            };
          }),
      };
    });
};

export const getDefaultSectionSize = (
  sectionType: CatalogueSectionType,
): SectionSize => getSectionCatalogueItem(sectionType).defaultSize;

export const createPlaceholderSectionInstance = (
  sectionType: CatalogueSectionType,
  idFactory: IdFactory,
  options: {
    size?: SectionSize;
    label?: string;
    note?: string;
    order?: number;
    starterSemanticRole?: StarterSectionSemanticRole;
  } = {},
): PlaceholderSectionInstance => ({
  id: idFactory('section'),
  sectionType,
  label: options.label ?? getSectionLabel(sectionType),
  order: options.order ?? 0,
  visible: true,
  size: options.size ?? getDefaultSectionSize(sectionType),
  ...(options.starterSemanticRole
    ? { starterSemanticRole: options.starterSemanticRole }
    : {}),
  placeholderSettings: {
    note: options.note ?? DEFAULT_SECTION_NOTE,
  },
});

export const createBookingSectionInstance = (
  idFactory: IdFactory,
  options: { order?: number } = {},
): BookingSectionInstance => ({
  id: idFactory('section'),
  sectionType: 'booking',
  label: 'Booking',
  order: options.order ?? 0,
  visible: true,
  settings: createDefaultBookingPresentationSettings(),
});

export const createCustomDesignSectionInstance = (
  idFactory: IdFactory,
  options: { order?: number } = {},
): CustomDesignSectionInstance => ({
  id: idFactory('section'),
  sectionType: 'custom_design',
  label: 'Custom Design',
  order: options.order ?? 0,
  visible: true,
  settings: createDefaultCustomDesignSettings(),
});

export const createLibrarySectionInstance = (
  sectionType: LibrarySectionType,
  idFactory: IdFactory,
  options: {
    galleryPresentationOwner?: GalleryPresentationOwner;
    label?: string;
    order?: number;
    presetId?: string;
  } = {},
): SectionInstance => {
  const entry = getSectionRegistryEntry(sectionType);
  const settings: Record<string, unknown> = { ...entry.defaultSettings() };
  if (options.presetId && entry.presetIds.includes(options.presetId)
    && 'preset' in settings) {
    settings.preset = options.presetId;
  }
  // The settings come from the type's own normalizer, so the correlated pair
  // is definitionally valid; TypeScript cannot see across the mapped union.
  return {
    id: idFactory('section'),
    label: options.label ?? entry.label,
    order: options.order ?? 0,
    sectionType,
    settings: entry.normalize(settings),
    visible: true,
    ...(sectionType === 'gallery' && options.galleryPresentationOwner
      ? { galleryPresentationOwner: options.galleryPresentationOwner }
      : {}),
  } as SectionInstance;
};

export const createSectionInstance = (
  sectionType: SectionType,
  idFactory: IdFactory,
  options: {
    galleryPresentationOwner?: GalleryPresentationOwner;
    size?: SectionSize;
    label?: string;
    note?: string;
    order?: number;
    presetId?: string;
  } = {},
): SectionInstance =>
  sectionType === 'booking'
    ? createBookingSectionInstance(idFactory, { order: options.order })
    : sectionType === 'custom_design'
      ? createCustomDesignSectionInstance(idFactory, { order: options.order })
      : isLibrarySectionType(sectionType)
        ? createLibrarySectionInstance(sectionType, idFactory, {
            ...(options.galleryPresentationOwner !== undefined
              ? { galleryPresentationOwner: options.galleryPresentationOwner }
              : {}),
            ...(options.label !== undefined ? { label: options.label } : {}),
            ...(options.order !== undefined ? { order: options.order } : {}),
            ...(options.presetId !== undefined ? { presetId: options.presetId } : {}),
          })
        : createPlaceholderSectionInstance(sectionType, idFactory, options);

const createStarterPage = (
  definition: StarterPageDefinition,
  order: number,
  idFactory: IdFactory,
): PageDocument => ({
  id: idFactory('page'),
  name: definition.name,
  slug: definition.slug,
  order,
  isHome: order === 0,
  visible: true,
  visibleInNavigation: true,
  sections: definition.sections.map((section, sectionOrder) =>
    section.sectionType === 'booking'
      ? createBookingSectionInstance(idFactory, { order: sectionOrder })
      : createLibrarySectionInstance(section.sectionType, idFactory, {
          ...(section.galleryPresentationOwner !== undefined
            ? { galleryPresentationOwner: section.galleryPresentationOwner }
            : {}),
          ...(section.label !== undefined ? { label: section.label } : {}),
          order: sectionOrder,
          ...(section.preset !== undefined ? { presetId: section.preset } : {}),
        }),
  ),
});

export const initializeStarter = (
  originStarter: OriginStarter,
  options: InitializeStarterOptions = {},
): SiteBuilderDocument => {
  const idFactory = options.idFactory ?? createIdFactory();
  const pages = STARTER_PAGES[originStarter].map((definition, order) =>
    createStarterPage(definition, order, idFactory),
  );
  const navigationItems: NavigationItem[] = pages.map((page, order) => ({
    id: idFactory('navigation_item'),
    pageId: page.id,
    label: page.name,
    order,
  }));

  return normalizeDocument({
    schemaVersion: SITE_BUILDER_SCHEMA_VERSION,
    siteId: options.siteId ?? idFactory('site'),
    siteName: options.siteName ?? 'Your nail studio',
    originStarter,
    navigation: {
      enabled: originStarter !== 'quick_book',
      style: 'simple',
      items: navigationItems,
    },
    pages,
    siteContent: createEmptySiteContent(),
    unusedSections: [],
    removedPages: [],
  });
};
