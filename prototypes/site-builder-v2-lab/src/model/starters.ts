import { getSectionCatalogueItem } from './catalogue';
import { createIdFactory } from './ids';
import { normalizeDocument } from './normalize';
import {
  SITE_BUILDER_SCHEMA_VERSION,
  type IdFactory,
  type NavigationItem,
  type OriginStarter,
  type PageDocument,
  type SectionInstance,
  type SectionSize,
  type SectionType,
  type SiteBuilderDocument,
} from './types';

const DEFAULT_SECTION_NOTE = 'Content and settings will be designed later.';
const BOOKING_NOTE =
  'Protected — every published site needs at least one path to booking.';

type StarterSectionDefinition = {
  sectionType: SectionType;
  size?: SectionSize;
};

type StarterPageDefinition = {
  name: string;
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
        { sectionType: 'section_01', size: 'compact' },
        { sectionType: 'section_02', size: 'medium' },
        { sectionType: 'booking_access', size: 'compact' },
      ],
    },
  ],
  one_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        { sectionType: 'section_01', size: 'large' },
        { sectionType: 'section_02', size: 'medium' },
        { sectionType: 'section_03', size: 'medium' },
        { sectionType: 'section_04', size: 'large' },
        { sectionType: 'section_05', size: 'compact' },
        { sectionType: 'booking_access', size: 'compact' },
      ],
    },
  ],
  multi_page: [
    {
      name: 'Home',
      slug: '',
      sections: [
        { sectionType: 'section_01' },
        { sectionType: 'section_02' },
      ],
    },
    {
      name: 'Services / Book',
      slug: 'services-book',
      sections: [
        { sectionType: 'section_03' },
        { sectionType: 'booking_access', size: 'compact' },
      ],
    },
    {
      name: 'Gallery',
      slug: 'gallery',
      sections: [{ sectionType: 'section_04' }],
    },
    {
      name: 'About',
      slug: 'about',
      sections: [{ sectionType: 'section_05' }],
    },
    {
      name: 'Contact',
      slug: 'contact',
      sections: [
        { sectionType: 'section_06' },
        { sectionType: 'section_07' },
      ],
    },
  ],
};

export const getSectionLabel = (sectionType: SectionType): string => {
  if (sectionType === 'booking_access') {
    return 'Booking access';
  }

  return getSectionCatalogueItem(sectionType).label;
};

export const getDefaultSectionSize = (
  sectionType: SectionType,
): SectionSize => {
  if (sectionType === 'booking_access') {
    return 'compact';
  }

  return getSectionCatalogueItem(sectionType).defaultSize;
};

export const createSectionInstance = (
  sectionType: SectionType,
  idFactory: IdFactory,
  options: {
    size?: SectionSize;
    label?: string;
    note?: string;
    order?: number;
  } = {},
): SectionInstance => ({
  id: idFactory('section'),
  sectionType,
  label: options.label ?? getSectionLabel(sectionType),
  order: options.order ?? 0,
  visible: true,
  size: options.size ?? getDefaultSectionSize(sectionType),
  protectedCapabilities:
    sectionType === 'booking_access' ? ['booking_access'] : [],
  placeholderSettings: {
    note:
      options.note ??
      (sectionType === 'booking_access' ? BOOKING_NOTE : DEFAULT_SECTION_NOTE),
  },
});

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
    createSectionInstance(section.sectionType, idFactory, {
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
    siteName: options.siteName ?? 'Luster Site Builder V2 Lab',
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
