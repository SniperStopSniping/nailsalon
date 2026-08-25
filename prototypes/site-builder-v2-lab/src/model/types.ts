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

export type SectionType = CatalogueSectionType | 'booking_access';

export type SectionSize = 'compact' | 'medium' | 'large';

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

export type SectionInstance = {
  id: string;
  sectionType: SectionType;
  label: string;
  order: number;
  visible: boolean;
  size: SectionSize;
  protectedCapabilities: string[];
  placeholderSettings: {
    note?: string;
  };
};

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
  unusedSections: SectionInstance[];
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

export type AddSectionInput = {
  pageId: string;
  sectionType: SectionType;
  position?: number;
  size?: SectionSize;
  label?: string;
  note?: string;
};

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
  | { type: 'move_section'; sectionId: string; position: number }
  | { type: 'move_section_up'; sectionId: string }
  | { type: 'move_section_down'; sectionId: string }
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
