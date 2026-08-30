import { createDefaultBookingPresentationSettings } from '../booking/presentation';
import { createDefaultCustomDesignSettings } from '../custom-design/model/settings';
import { getSectionCatalogueItem } from './catalogue';
import { createIdFactory } from './ids';
import { normalizeDocument } from './normalize';
import {
  type BookingSectionInstance,
  type CatalogueSectionType,
  type CustomDesignSectionInstance,
  type IdFactory,
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

export type StarterSectionDefinition =
  | {
    previewLabel: string;
    semanticRole: StarterSectionSemanticRole;
    sectionType: CatalogueSectionType;
    size?: SectionSize;
  }
  | { previewLabel: 'Booking'; sectionType: 'booking' };

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
        {
          previewLabel: 'Salon intro',
          semanticRole: 'hero',
          sectionType: 'section_01',
          size: 'compact',
        },
        {
          previewLabel: 'Services',
          semanticRole: 'services',
          sectionType: 'section_02',
          size: 'medium',
        },
        { previewLabel: 'Booking', sectionType: 'booking' },
      ],
    },
  ],
  one_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        {
          previewLabel: 'Welcome',
          semanticRole: 'hero',
          sectionType: 'section_01',
          size: 'large',
        },
        {
          previewLabel: 'About',
          semanticRole: 'about',
          sectionType: 'section_02',
          size: 'medium',
        },
        {
          previewLabel: 'Services',
          semanticRole: 'services',
          sectionType: 'section_03',
          size: 'medium',
        },
        {
          previewLabel: 'Gallery',
          semanticRole: 'gallery',
          sectionType: 'section_04',
          size: 'large',
        },
        {
          previewLabel: 'Reviews',
          semanticRole: 'reviews',
          sectionType: 'section_05',
          size: 'compact',
        },
        { previewLabel: 'Booking', sectionType: 'booking' },
      ],
    },
  ],
  multi_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        {
          previewLabel: 'Welcome',
          semanticRole: 'hero',
          sectionType: 'section_01',
        },
        {
          previewLabel: 'Featured work',
          semanticRole: 'featured_work',
          sectionType: 'section_02',
        },
      ],
    },
    {
      name: 'Services / Book',
      previewLabel: 'Services & Booking',
      slug: 'services-book',
      sections: [
        {
          previewLabel: 'Services',
          semanticRole: 'services',
          sectionType: 'section_03',
        },
        { previewLabel: 'Booking', sectionType: 'booking' },
      ],
    },
    {
      name: 'Gallery',
      slug: 'gallery',
      sections: [{
        previewLabel: 'Gallery',
        semanticRole: 'gallery',
        sectionType: 'section_04',
      }],
    },
    {
      name: 'About',
      slug: 'about',
      sections: [{
        previewLabel: 'About',
        semanticRole: 'about',
        sectionType: 'section_05',
      }],
    },
    {
      name: 'Contact',
      slug: 'contact',
      sections: [
        {
          previewLabel: 'Visit us',
          semanticRole: 'visit',
          sectionType: 'section_06',
        },
        {
          previewLabel: 'Contact',
          semanticRole: 'contact',
          sectionType: 'section_07',
        },
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
    section.sectionType !== 'booking' && section.sectionType !== 'custom_design'
  ));
  const hasExplicitMetadata = activeAndUnusedPlaceholders.some(
    section => section.starterSemanticRole !== undefined,
  );
  const definitionByRole = new Map<StarterSectionSemanticRole, {
    pageSlug: string;
    previewLabel: string;
    sectionOrder: number;
    sectionType: PlaceholderSectionInstance['sectionType'];
  }>();

  for (const pageDefinition of pageDefinitions) {
    pageDefinition.sections.forEach((sectionDefinition, sectionOrder) => {
      if (sectionDefinition.sectionType === 'booking') {
        return;
      }
      definitionByRole.set(sectionDefinition.semanticRole, {
        pageSlug: pageDefinition.slug,
        previewLabel: sectionDefinition.previewLabel,
        sectionOrder,
        sectionType: sectionDefinition.sectionType,
      });
    });
  }

  const infoBySectionId = new Map<string, StarterDocumentSemanticInfo>();
  if (hasExplicitMetadata) {
    for (const section of activeAndUnusedPlaceholders) {
      if (!section.starterSemanticRole) {
        continue;
      }
      const definition = definitionByRole.get(section.starterSemanticRole);
      infoBySectionId.set(section.id, {
        previewLabel: definition?.previewLabel ?? section.label,
        role: section.starterSemanticRole,
      });
    }
    return infoBySectionId;
  }

  const assignedSectionIds = new Set<string>();
  for (const [role, definition] of definitionByRole) {
    const candidates = pages.flatMap(page => page.sections
      .filter((section): section is PlaceholderSectionInstance => (
        section.sectionType === definition.sectionType
        && !assignedSectionIds.has(section.id)
      ))
      .map(section => ({ page, section })));
    const matched = candidates.find(({ page, section }) => (
      page.slug === definition.pageSlug && section.order === definition.sectionOrder
    )) ?? candidates.find(({ page }) => page.slug === definition.pageSlug)
    ?? candidates[0];
    if (!matched) {
      continue;
    }
    assignedSectionIds.add(matched.section.id);
    infoBySectionId.set(matched.section.id, {
      previewLabel: definition.previewLabel,
      role,
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

export const createSectionInstance = (
  sectionType: SectionType,
  idFactory: IdFactory,
  options: {
    size?: SectionSize;
    label?: string;
    note?: string;
    order?: number;
  } = {},
): SectionInstance =>
  sectionType === 'booking'
    ? createBookingSectionInstance(idFactory, { order: options.order })
    : sectionType === 'custom_design'
      ? createCustomDesignSectionInstance(idFactory, { order: options.order })
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
      : createPlaceholderSectionInstance(section.sectionType, idFactory, {
          order: sectionOrder,
          starterSemanticRole: section.semanticRole,
          size:
            section.size ?? getDefaultSectionSize(section.sectionType),
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
    unusedSections: [],
    removedPages: [],
  });
};
