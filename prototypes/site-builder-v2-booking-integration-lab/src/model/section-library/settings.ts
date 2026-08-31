/**
 * Per-type settings contracts for the V1 section library.
 *
 * Sections own presentation, presets, and deliberate overrides only. Business
 * data stays with its shared authority (profile, contact, location, hours,
 * booking, policies) or in the document's shared `siteContent` collections
 * (staff, reviews, offers, faq) — sections bind to records by id and never
 * copy them.
 */

/**
 * A value a section shows either from its shared authority or as a deliberate
 * local override. Overrides never rewrite the shared source.
 */
export type BoundText =
  | { source: 'shared' }
  | { source: 'override'; value: string };

export const sharedText = (): BoundText => ({ source: 'shared' });

export type AnnouncementBarTone = 'accent' | 'tint';

export type AnnouncementBarAction =
  | { kind: 'booking'; label: string }
  | { kind: 'url'; label: string; url: string };

export type AnnouncementBarSettings = {
  version: 1;
  /** Single short line; renderers clamp to one line and never wrap to a paragraph. */
  message: string;
  action: AnnouncementBarAction | null;
  dismissible: boolean;
  tone: AnnouncementBarTone;
  /** Reassurance line under the action, e.g. "Deposit applies to your service." */
  reassurance: string;
};

export type HeroPresetId =
  | 'image_right'
  | 'full_bleed'
  | 'editorial_split'
  | 'booking_first';

export type HeroMediaChoice = 'profile_photo' | 'logo_emblem' | 'gradient';

export type HeroSettings = {
  version: 1;
  preset: HeroPresetId;
  /** Defaults to the shared business name. */
  headline: BoundText;
  /** Defaults to the shared structure-aware intro line. */
  intro: BoundText;
  media: HeroMediaChoice;
  showLocationEyebrow: boolean;
  showStatusLine: boolean;
  primaryCtaLabel: string;
};

export const QUICK_INFO_FACT_IDS = [
  'location',
  'visit_mode',
  'new_clients',
  'minimum_notice',
  'open_status',
] as const;

export type QuickInfoFactId = (typeof QUICK_INFO_FACT_IDS)[number];

export type QuickInfoSettings = {
  version: 1;
  /** Ordered, at most four; missing facts collapse at render time. */
  facts: QuickInfoFactId[];
};

export type SectionNavigationSettings = {
  version: 1;
  sticky: boolean;
  /** Optional per-target label overrides keyed by section id. */
  labelOverrides: Record<string, string>;
};

export type FeaturedServicesPresetId = 'grid' | 'carousel' | 'editorial';

export type FeaturedServicesSettings = {
  version: 1;
  preset: FeaturedServicesPresetId;
  /** `featured` derives from the canonical catalogue's featured flags. */
  source: 'manual' | 'featured';
  /** Canonical service ids; renderers clamp to 3–6 present services. */
  serviceIds: string[];
};

export type OffersPresetId = 'cards' | 'single_banner';

export type OffersSettings = {
  version: 1;
  preset: OffersPresetId;
  /** Bound records from siteContent.offers, in display order. */
  offerIds: string[];
};

export type GalleryPresetId = 'grid' | 'carousel' | 'editorial';

export type GallerySelection = { mode: 'all' } | { mode: 'picked'; imageIds: string[] };

export type GallerySectionSettings = {
  version: 1;
  preset: GalleryPresetId;
  selection: GallerySelection;
};

/** Mirrors the shared About preset vocabulary; visibility stays on the profile authority. */
export type AboutSectionPresetId =
  | 'photo_right'
  | 'editorial_portrait'
  | 'profile_quick_facts'
  | 'about_before_you_book';

export type AboutSectionSettings = {
  version: 1;
  preset: AboutSectionPresetId;
  intro: BoundText;
};

export type TeamPresetId = 'profile_grid' | 'swipeable' | 'editorial_team';

export type TeamSettings = {
  version: 1;
  preset: TeamPresetId;
  /** Bound records from siteContent.staff, in display order. */
  memberIds: string[];
};

export type ReviewsPresetId = 'testimonial_cards' | 'editorial_quote' | 'carousel';

export type ReviewsSettings = {
  version: 1;
  preset: ReviewsPresetId;
  /** Bound records from siteContent.reviews, in display order. */
  reviewIds: string[];
  showRatings: boolean;
};

export type DepositsCancellationsSettings = {
  version: 1;
  wordingMode: 'summary' | 'full';
};

export const POLICY_TOGGLE_IDS = [
  'late_arrivals',
  'no_shows',
  'repairs',
  'other',
] as const;

/** Deposits & cancellations are structurally excluded — owned by section 12. */
export type PolicyToggleId = (typeof POLICY_TOGGLE_IDS)[number];

export type PoliciesSectionSettings = {
  version: 1;
  includedSections: PolicyToggleId[];
};

export type FaqSettings = {
  version: 1;
  /** Bound records from siteContent.faq, in display order. */
  itemIds: string[];
};

export type HoursSectionSettings = {
  version: 1;
  layout: 'compact' | 'full';
};

export type VisitUsPresetId = 'map_details' | 'editorial_visit' | 'compact_info';

export type VisitUsSummaryMode = 'auto' | 'show' | 'hide';

export type VisitUsSettings = {
  version: 1;
  preset: VisitUsPresetId;
  showParking: boolean;
  showEntrance: boolean;
  showTransit: boolean;
  /** `auto` suppresses the summary when a dedicated Hours/Contact section is visible. */
  hoursSummary: VisitUsSummaryMode;
  contactSummary: VisitUsSummaryMode;
};

export type ContactPresetId = 'card' | 'action_row';

export type ContactSectionSettings = {
  version: 1;
  preset: ContactPresetId;
};

export type FinalCtaPresetId = 'simple_banner' | 'image_cta' | 'editorial_cta';

export type FinalCtaSettings = {
  version: 1;
  preset: FinalCtaPresetId;
  headline: BoundText;
};

export type FooterPresetId = 'columns' | 'compact';

export type FooterSettings = {
  version: 1;
  preset: FooterPresetId;
  showAttribution: boolean;
};

/** Union of every V1 library settings shape, discriminated by the owning section type. */
export type LibrarySectionSettingsByType = {
  announcement_bar: AnnouncementBarSettings;
  hero: HeroSettings;
  quick_info: QuickInfoSettings;
  section_navigation: SectionNavigationSettings;
  featured_services: FeaturedServicesSettings;
  offers: OffersSettings;
  gallery: GallerySectionSettings;
  about: AboutSectionSettings;
  team: TeamSettings;
  reviews: ReviewsSettings;
  deposits_cancellations: DepositsCancellationsSettings;
  policies: PoliciesSectionSettings;
  faq: FaqSettings;
  hours: HoursSectionSettings;
  visit_us: VisitUsSettings;
  contact: ContactSectionSettings;
  final_cta: FinalCtaSettings;
  footer: FooterSettings;
};

export type LibrarySectionType = keyof LibrarySectionSettingsByType;

export type LibrarySectionSettings =
  LibrarySectionSettingsByType[LibrarySectionType];
