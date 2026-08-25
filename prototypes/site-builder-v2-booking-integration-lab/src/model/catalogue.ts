import type {
  CatalogueSectionType,
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

export const SECTION_CATALOGUE: readonly SectionCatalogueItem[] =
  SECTION_NUMBERS.map((number, index) => ({
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

export const getSectionCatalogueItem = (
  sectionType: CatalogueSectionType,
): SectionCatalogueItem => {
  const item = SECTION_CATALOGUE.find(
    (candidate) => candidate.sectionType === sectionType,
  );

  if (!item) {
    throw new Error(`Unknown section type: ${sectionType}`);
  }

  return item;
};
