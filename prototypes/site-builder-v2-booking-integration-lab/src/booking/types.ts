export const BOOKING_MENU_LAYOUTS = [
  'visual_grid',
  'clean_list',
  'editorial_cards',
  'category_menu',
  'editorial_price_list',
] as const;

export type BookingMenuLayout = (typeof BOOKING_MENU_LAYOUTS)[number];

export const SERVICE_CATEGORIES = [
  'manicure',
  'builder_gel',
  'gel_x',
  'pedicure',
  'nail_art',
  'combos',
  'add_ons',
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export type CategoryDefinition = {
  readonly id: ServiceCategory;
  readonly label: string;
};

export type MockSalon = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly tagline: string;
  readonly location: string;
};

export type ServiceImage = {
  readonly id: string;
  readonly src: string;
  readonly alt: string;
};

export type MockPrice =
  | { readonly behavior: 'fixed'; readonly amountCents: number }
  | { readonly behavior: 'starts_at'; readonly amountCents: number }
  | { readonly behavior: 'range'; readonly minCents: number; readonly maxCents: number }
  | { readonly behavior: 'varies' }
  | { readonly behavior: 'free' };

export type MockAddOn = {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly durationMinutes: number;
};

export type MockService = {
  readonly id: string;
  readonly name: string;
  readonly category: ServiceCategory;
  readonly shortDescription: string | null;
  readonly longDescription: string | null;
  readonly price: MockPrice;
  readonly durationMinutes: number;
  readonly image: ServiceImage | null;
  readonly featured: boolean;
  readonly badge?: string;
  readonly compatibleAddOnIds: readonly string[];
};

export type ImageFixture = 'image_rich' | 'partial_images' | 'no_images';
export type MenuSize = 'canonical' | 'stress_100';

export type MockMenuFixture = {
  readonly salon: MockSalon;
  readonly categories: readonly CategoryDefinition[];
  readonly services: readonly MockService[];
  readonly addOns: readonly MockAddOn[];
  readonly imageFixture: ImageFixture;
  readonly menuSize: MenuSize;
};

export type TypographyPreset = 'modern' | 'editorial' | 'soft' | 'bold' | 'classic';
export type HeadingScale = 'small' | 'standard' | 'large';
export type BodyScale = 'standard' | 'large';
export type BookingSpacing = 'compact' | 'comfortable' | 'spacious';
export type BookingTokenPresetId = 'warm' | 'neutral';

export type VisualGridSettings = {
  density: 'compact' | 'comfortable' | 'spacious';
  imageMode: 'auto' | 'show' | 'hide';
  showFeatured: boolean;
  categoryNavigation: 'pills' | 'none';
  showDescriptions: boolean;
};

export type CleanListSettings = {
  density: 'compact' | 'comfortable';
  showThumbnails: boolean;
  showDescriptions: boolean;
  categoryNavigation: 'pills' | 'none';
};

export type EditorialCardsSettings = {
  density: 'comfortable' | 'spacious';
  imageShape: 'landscape' | 'portrait' | 'adaptive';
  descriptionLength: 'short' | 'full';
  featuredTreatment: 'standard' | 'large';
};

export type CategoryMenuSettings = {
  density: 'compact' | 'comfortable';
  mobileNavigation: 'pills' | 'tabs' | 'accordion';
  desktopNavigation: 'sidebar' | 'top';
  showDescriptions: boolean;
  showCategoryCounts: boolean;
};

export type EditorialPriceListSettings = {
  density: 'comfortable' | 'spacious';
  showCategoryImages: boolean;
  descriptionLength: 'short' | 'full';
  dividerStyle: 'fine' | 'strong' | 'none';
};

export type LayoutSettingsByLayout = {
  visual_grid: VisualGridSettings;
  clean_list: CleanListSettings;
  editorial_cards: EditorialCardsSettings;
  category_menu: CategoryMenuSettings;
  editorial_price_list: EditorialPriceListSettings;
};

export type BookingLayoutMemory = Partial<{
  [Layout in BookingMenuLayout]: LayoutSettingsByLayout[Layout];
}>;

type BookingPresentationBase = {
  version: 1;
  typographyPreset: TypographyPreset;
  headingScale: HeadingScale;
  bodyScale: BodyScale;
  spacing: BookingSpacing;
  layoutMemory?: BookingLayoutMemory;
};

type BookingPresentationFor<Layout extends BookingMenuLayout> =
  BookingPresentationBase & {
    layout: Layout;
    layoutSettings: LayoutSettingsByLayout[Layout];
  };

/**
 * The active layout and its controls are a discriminated pair. Incompatible
 * controls cannot be constructed without an explicit unsafe cast, and import
 * validation rejects them at runtime.
 */
export type BookingSectionPresentationSettings = {
  [Layout in BookingMenuLayout]: BookingPresentationFor<Layout>;
}[BookingMenuLayout];

export type BookingPresentationTokens = {
  readonly background: string;
  readonly surface: string;
  readonly card: string;
  readonly selected: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly accentContrast: string;
  readonly highlight: string;
  readonly focus: string;
  readonly headingFamily: string;
  readonly bodyFamily: string;
  readonly radiusControl: string;
  readonly radiusDialog: string;
  readonly spacingScale: string;
};

export type BookingSelection = {
  readonly serviceId: string | null;
  readonly addOnIds: readonly string[];
};

export type BookingSessionState = {
  readonly selection: BookingSelection;
  readonly query: string;
  readonly activeCategory: ServiceCategory | 'all';
  readonly detailServiceId: string | null;
  readonly draftAddOnIds: readonly string[];
  readonly handoffOpen: boolean;
};

export type SelectionPriceSummary = {
  readonly behavior: MockPrice['behavior'];
  readonly label: string;
  readonly knownAddOnPriceCents: number;
  readonly minTotalCents: number | null;
  readonly maxTotalCents: number | null;
};

export type SelectionSummary = {
  readonly service: MockService;
  readonly addOns: readonly MockAddOn[];
  readonly totalDurationMinutes: number;
  readonly durationLabel: string;
  readonly price: SelectionPriceSummary;
};

export type BookingPresentationValidationResult =
  | { success: true; settings: BookingSectionPresentationSettings }
  | { success: false; issues: string[] };
