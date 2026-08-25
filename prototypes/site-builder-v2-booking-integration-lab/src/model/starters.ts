import { createDefaultBookingPresentationSettings } from '../booking/presentation';
import { getSectionCatalogueItem } from './catalogue';
import { createIdFactory } from './ids';
import { normalizeDocument } from './normalize';
import {
  SITE_BUILDER_SCHEMA_VERSION,
  type BookingSectionInstance,
  type CatalogueSectionType,
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

type StarterSectionDefinition =
  | {
      sectionType: CatalogueSectionType;
      size?: SectionSize;
    }
  | { sectionType: 'booking' };

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
        { sectionType: 'booking' },
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
        { sectionType: 'booking' },
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
        { sectionType: 'booking' },
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

export const getSectionLabel = (sectionType: SectionType): string =>
  sectionType === 'booking'
    ? 'Booking'
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
    siteName: options.siteName ?? 'Isla Nail Studio',
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
