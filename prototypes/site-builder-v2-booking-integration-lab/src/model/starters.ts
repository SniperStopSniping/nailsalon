import { createDefaultBookingPresentationSettings } from '../booking/presentation';
import { createDefaultCustomDesignSettings } from '../custom-design/model/settings';
import { getSectionCatalogueItem } from './catalogue';
import { createIdFactory } from './ids';
import { normalizeDocument } from './normalize';
import {
  SITE_BUILDER_SCHEMA_VERSION,
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
  type SiteBuilderDocument,
} from './types';

const DEFAULT_SECTION_NOTE = 'Content and settings will be designed later.';

export type StarterSectionDefinition =
  | {
      previewLabel: string;
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
        { previewLabel: 'Salon intro', sectionType: 'section_01', size: 'compact' },
        { previewLabel: 'Services', sectionType: 'section_02', size: 'medium' },
        { previewLabel: 'Booking', sectionType: 'booking' },
      ],
    },
  ],
  one_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        { previewLabel: 'Welcome', sectionType: 'section_01', size: 'large' },
        { previewLabel: 'About', sectionType: 'section_02', size: 'medium' },
        { previewLabel: 'Services', sectionType: 'section_03', size: 'medium' },
        { previewLabel: 'Gallery', sectionType: 'section_04', size: 'large' },
        { previewLabel: 'Reviews', sectionType: 'section_05', size: 'compact' },
        { previewLabel: 'Booking', sectionType: 'booking' },
      ],
    },
  ],
  multi_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        { previewLabel: 'Welcome', sectionType: 'section_01' },
        { previewLabel: 'Featured work', sectionType: 'section_02' },
      ],
    },
    {
      name: 'Services / Book',
      previewLabel: 'Services & Booking',
      slug: 'services-book',
      sections: [
        { previewLabel: 'Services', sectionType: 'section_03' },
        { previewLabel: 'Booking', sectionType: 'booking' },
      ],
    },
    {
      name: 'Gallery',
      slug: 'gallery',
      sections: [{ previewLabel: 'Gallery', sectionType: 'section_04' }],
    },
    {
      name: 'About',
      slug: 'about',
      sections: [{ previewLabel: 'About', sectionType: 'section_05' }],
    },
    {
      name: 'Contact',
      slug: 'contact',
      sections: [
        { previewLabel: 'Visit us', sectionType: 'section_06' },
        { previewLabel: 'Contact', sectionType: 'section_07' },
      ],
    },
  ],
};

export const getStarterPageDefinitions = (
  starter: OriginStarter,
): readonly StarterPageDefinition[] => STARTER_PAGES[starter];

export type StarterDocumentOutlinePage = {
  id: string;
  label: string;
  sections: Array<{ id: string; label: string; sectionType: SectionType }>;
};

/**
 * Presents the structure of the real universal document. Semantic labels live
 * beside the definitions used to create that document, so onboarding cannot
 * drift into a separate starter recipe.
 */
export const getStarterDocumentOutline = (
  document: SiteBuilderDocument | null,
): StarterDocumentOutlinePage[] => {
  if (!document) return [];
  const definitions = STARTER_PAGES[document.originStarter];
  return [...document.pages]
    .filter((page) => page.visible)
    .sort((left, right) => left.order - right.order)
    .map((page, pageIndex) => {
      const definition = definitions[pageIndex];
      return {
        id: page.id,
        label: definition?.previewLabel ?? page.name,
        sections: [...page.sections]
          .filter((section) => section.visible)
          .sort((left, right) => left.order - right.order)
          .map((section) => ({
            id: section.id,
            label: definition?.sections.find(
              (candidate) => candidate.sectionType === section.sectionType,
            )?.previewLabel ?? getSectionLabel(section.sectionType),
            sectionType: section.sectionType,
          })),
      };
    });
};

export const getSectionLabel = (sectionType: SectionType): string =>
  sectionType === 'booking'
    ? 'Booking'
    : sectionType === 'custom_design'
      ? 'Custom Design'
    : getSectionCatalogueItem(sectionType).label;

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
  } = {},
): PlaceholderSectionInstance => ({
  id: idFactory('section'),
  sectionType,
  label: options.label ?? getSectionLabel(sectionType),
  order: options.order ?? 0,
  visible: true,
  size: options.size ?? getDefaultSectionSize(sectionType),
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
