import type { BookingSectionPresentationSettings } from '../booking/types';
import type { CustomDesignSettings } from '../custom-design/model/types';

export type { BookingSectionPresentationSettings } from '../booking/types';

export const SITE_BUILDER_SCHEMA_VERSION = 1 as const;

export type OriginStarter = 'quick_book' | 'one_page' | 'multi_page';

export type SectionNumber =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16'
  | '17'
  | '18'
  | '19'
  | '20';

export type CatalogueSectionType = `section_${SectionNumber}`;

export type SectionType = CatalogueSectionType | 'booking' | 'custom_design';

export type SectionSize = 'compact' | 'medium' | 'large';

/**
 * Stable customer-facing meaning assigned only to sections created by a
 * starter. Catalogue section numbers are reusable presentation slots, so they
 * cannot safely communicate this meaning by themselves.
 *
 * The field is optional to keep schema-v1 documents created before this
 * metadata was introduced importable. New starter documents always include
 * it; owner-added catalogue sections deliberately do not.
 */
export const STARTER_SECTION_SEMANTIC_ROLES = [
  'hero',
  'services',
  'featured_work',
  'gallery',
  'about',
  'reviews',
  'visit',
  'contact',
] as const;

export type StarterSectionSemanticRole =
  (typeof STARTER_SECTION_SEMANTIC_ROLES)[number];

export type NavigationItem = {
  id: string;
  pageId: string;
  label: string;
  order: number;
};

export type NavigationSettings = {
  enabled: boolean;
  style: 'simple';
  items: NavigationItem[];
};

type SectionInstanceBase = {
  id: string;
  label: string;
  order: number;
  visible: boolean;
};

export type PlaceholderSectionInstance = SectionInstanceBase & {
  sectionType: CatalogueSectionType;
  size: SectionSize;
  starterSemanticRole?: StarterSectionSemanticRole;
  placeholderSettings: {
    note?: string;
  };
};

export type BookingSectionInstance = SectionInstanceBase & {
  sectionType: 'booking';
  settings: BookingSectionPresentationSettings;
};

export type CustomDesignSectionInstance = SectionInstanceBase & {
  sectionType: 'custom_design';
  settings: CustomDesignSettings;
};

/**
 * The section type is the document-level discriminator. Booking owns only
 * bounded presentation settings; canonical services and customer intent live
 * outside the site document.
 */
export type SectionInstance =
  | PlaceholderSectionInstance
  | BookingSectionInstance
  | CustomDesignSectionInstance;

export type RestorableSectionInstance =
  | PlaceholderSectionInstance
  | CustomDesignSectionInstance;

export type PageDocument = {
  id: string;
  name: string;
  slug: string;
  order: number;
  isHome: boolean;
  visible: boolean;
  visibleInNavigation: boolean;
  sections: SectionInstance[];
};

export type RemovedPageRecord = {
  page: Omit<PageDocument, 'sections'>;
  sectionIds: string[];
  navigationItem: NavigationItem;
  removedAtOrder: number;
};

export type SiteBuilderDocument = {
  schemaVersion: typeof SITE_BUILDER_SCHEMA_VERSION;
  siteId: string;
  siteName: string;
  originStarter: OriginStarter;
  navigation: NavigationSettings;
  pages: PageDocument[];
  unusedSections: RestorableSectionInstance[];
  removedPages: RemovedPageRecord[];
};

export type EntityKind = 'site' | 'page' | 'section' | 'navigation_item';

export type IdFactory = (kind: EntityKind) => string;

export type SectionCatalogueItem = {
  sectionType: CatalogueSectionType;
  label: string;
  defaultSize: SectionSize;
  supportedSizes: readonly SectionSize[];
  allowedPages?: readonly string[];
  maximumInstances?: number;
  contentRequirements?: readonly string[];
  planCapability?: string;
  variants?: readonly string[];
};

export type CustomDesignCatalogueItem = {
  sectionType: 'custom_design';
  label: 'Custom Design';
  description: string;
  helper: string;
  searchKeywords: readonly string[];
  tags: readonly string[];
};

export type AddSectionCatalogueItem =
  | SectionCatalogueItem
  | CustomDesignCatalogueItem;

export type AddPlaceholderSectionInput = {
  pageId: string;
  sectionType: CatalogueSectionType;
  position?: number;
  size?: SectionSize;
  label?: string;
  note?: string;
};

export type AddBookingSectionInput = {
  pageId: string;
  sectionType: 'booking';
  position?: number;
};

export type AddCustomDesignSectionInput = {
  pageId: string;
  sectionType: 'custom_design';
  position?: number;
};

export type AddSectionInput =
  | AddPlaceholderSectionInput
  | AddBookingSectionInput
  | AddCustomDesignSectionInput;

export type AddPageInput = {
  name: string;
  slug?: string;
  position?: number;
  visible?: boolean;
  visibleInNavigation?: boolean;
};

export type MoveSectionToNewPageInput = AddPageInput & {
  sectionId: string;
  sectionPosition?: number;
};

export type CommitSectionMoveDestination =
  | {
      type: 'existing_page';
      pageId: string;
      position?: number;
    }
  | {
      type: 'new_page';
      name: string;
      slug?: string;
      position?: number;
    };

export type CommitSectionMoveInput = {
  sourcePageId: string;
  orderedSectionIds: string[];
  sectionId: string;
  destination?: CommitSectionMoveDestination;
};

export type BuilderCommand =
  | { type: 'add_section'; input: AddSectionInput }
  | { type: 'remove_section'; sectionId: string }
  | {
      type: 'restore_section';
      sectionId: string;
      pageId: string;
      position?: number;
    }
  | { type: 'set_section_visible'; sectionId: string; visible: boolean }
  | {
      type: 'update_section_settings';
      sectionId: string;
      note?: string;
      size?: SectionSize;
      label?: string;
    }
  | {
      type: 'update_booking_presentation';
      sectionId: string;
      settings: BookingSectionPresentationSettings;
    }
  | {
      type: 'update_custom_design_settings';
      sectionId: string;
      settings: CustomDesignSettings;
    }
  | { type: 'reset_booking_presentation'; sectionId: string }
  | { type: 'move_section'; sectionId: string; position: number }
  | { type: 'move_section_up'; sectionId: string }
  | { type: 'move_section_down'; sectionId: string }
  | { type: 'commit_section_move'; input: CommitSectionMoveInput }
  | {
      type: 'move_section_to_page';
      sectionId: string;
      pageId: string;
      position?: number;
    }
  | { type: 'move_section_to_new_page'; input: MoveSectionToNewPageInput }
  | { type: 'add_page'; input: AddPageInput }
  | { type: 'remove_page'; pageId: string }
  | { type: 'restore_page'; pageId: string }
  | { type: 'rename_page'; pageId: string; name: string }
  | {
      type: 'update_page_settings';
      pageId: string;
      name: string;
      slug: string;
      visible: boolean;
      visibleInNavigation: boolean;
    }
  | { type: 'set_page_slug'; pageId: string; slug: string }
  | { type: 'set_page_visible'; pageId: string; visible: boolean }
  | {
      type: 'set_page_navigation_visibility';
      pageId: string;
      visible: boolean;
    }
  | { type: 'move_page'; pageId: string; position: number }
  | { type: 'toggle_navigation'; enabled: boolean }
  | { type: 'move_navigation_item'; pageId: string; position: number }
  | { type: 'rename_navigation_item'; pageId: string; label: string };

export type HistoryState = {
  past: SiteBuilderDocument[];
  present: SiteBuilderDocument;
  future: SiteBuilderDocument[];
};

export type DocumentValidationResult =
  | { success: true; document: SiteBuilderDocument }
  | { success: false; issues: string[] };

export type DocumentImportResult =
  | { success: true; document: SiteBuilderDocument }
  | { success: false; issues: string[] };
