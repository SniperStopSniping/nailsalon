import {
  LIBRARY_SECTION_TYPES,
  SECTION_LIBRARY_REGISTRY,
  type SectionLibraryCategory,
} from './section-library/registry';
import type {
  AddSectionCatalogueItem,
  CatalogueSectionType,
  CustomDesignCatalogueItem,
  LibrarySectionType,
  SectionCatalogueItem,
  SectionNumber,
  SectionSize,
} from './types';

const SECTION_NUMBERS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
] as const satisfies readonly SectionNumber[];

const SIZE_CYCLE: readonly SectionSize[] = ['compact', 'medium', 'large'];

export const SECTION_CATALOGUE: readonly SectionCatalogueItem[]
  = SECTION_NUMBERS.map((number, index) => ({
    sectionType: `section_${number}` as CatalogueSectionType,
    label: `Section ${number}`,
    defaultSize: SIZE_CYCLE[index % SIZE_CYCLE.length] ?? 'medium',
    supportedSizes: ['compact', 'medium', 'large'],
    // These optional fields intentionally establish future catalogue shape without
    // enforcing page, plan, content, instance, or variant restrictions in the Lab.
    allowedPages: undefined,
    maximumInstances: undefined,
    contentRequirements: undefined,
    planCapability: undefined,
    variants: undefined,
  }));

export const CUSTOM_DESIGN_CATALOGUE_ITEM: CustomDesignCatalogueItem = {
  sectionType: 'custom_design',
  label: 'Custom Design',
  description: 'Upload a Canva design, flyer, policy page, or branded image.',
  helper: 'Best for designs you already made.',
  searchKeywords: [
    'Canva',
    'graphic',
    'flyer',
    'upload',
    'policy',
    'about',
    'poster',
    'design',
    'image',
    'Acuity',
  ],
  tags: ['Upload', 'Design', 'About', 'Policies'],
};

/**
 * Since schema v2 the numbered placeholder slots are no longer offered in Add
 * Section — the named library (see `getAddSectionLibrary`) replaces them.
 * `SECTION_CATALOGUE` stays exported so legacy instances keep resolving
 * labels and sizes.
 */
export const ADD_SECTION_CATALOGUE: readonly AddSectionCatalogueItem[] = [
  CUSTOM_DESIGN_CATALOGUE_ITEM,
];

export type AddSectionLibraryItem = {
  kind: 'library';
  sectionType: LibrarySectionType;
  label: string;
  description: string;
  category: SectionLibraryCategory;
  presetIds: readonly string[];
  defaultPresetId: string;
  maxPerPage?: number;
  maxPerSite?: number;
  limitKind: 'hard' | 'soft';
};

/**
 * The Add Section library: every named V1 section (Booking and Custom Design
 * keep their existing dedicated affordances), grouped for the dialog by
 * category in registry order.
 */
export const getAddSectionLibrary = (): readonly AddSectionLibraryItem[] =>
  LIBRARY_SECTION_TYPES.map((type) => {
    const entry = SECTION_LIBRARY_REGISTRY[type];
    return {
      category: entry.category,
      defaultPresetId: entry.defaultPresetId,
      description: entry.description,
      kind: 'library' as const,
      label: entry.label,
      limitKind: entry.limitKind,
      ...(entry.maxPerPage !== undefined ? { maxPerPage: entry.maxPerPage } : {}),
      ...(entry.maxPerSite !== undefined ? { maxPerSite: entry.maxPerSite } : {}),
      presetIds: entry.presetIds,
      sectionType: entry.type,
    };
  });

export const getSectionCatalogueItem = (
  sectionType: CatalogueSectionType,
): SectionCatalogueItem => {
  const item = SECTION_CATALOGUE.find(
    candidate => candidate.sectionType === sectionType,
  );

  if (!item) {
    throw new Error(`Unknown section type: ${sectionType}`);
  }

  return item;
};
