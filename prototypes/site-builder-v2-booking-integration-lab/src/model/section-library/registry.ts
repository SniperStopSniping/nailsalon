/**
 * The authoritative V1 section registry.
 *
 * Every discoverable section type is described here once: identity, category,
 * data domains, defaults, normalization, validation, presets, instance
 * limits, overlap metadata, adjacency surface, and onboarding role mapping.
 * The Add Section catalogue, Builder editors, customer renderers, the plan
 * builder, the overlap engine, and the onboarding compiler all read this
 * table — none of them keep their own section list.
 *
 * The registry is deliberately UI-free (this package's model layer has no
 * React); customer renderers and owner editors register against these type
 * ids from the preview/ui layers.
 */

import type {
  AboutSectionSettings,
  AnnouncementBarSettings,
  BoundText,
  ContactSectionSettings,
  DepositsCancellationsSettings,
  FaqSettings,
  FeaturedServicesSettings,
  FinalCtaSettings,
  FooterSettings,
  GallerySectionSettings,
  HeroSettings,
  HoursSectionSettings,
  LibrarySectionSettingsByType,
  LibrarySectionType,
  OffersSettings,
  PoliciesSectionSettings,
  PolicyToggleId,
  QuickInfoFactId,
  QuickInfoSettings,
  ReviewsSettings,
  SectionNavigationSettings,
  TeamSettings,
  VisitUsSettings,
  VisitUsSummaryMode,
} from './settings';
import { POLICY_TOGGLE_IDS, QUICK_INFO_FACT_IDS } from './settings';
import type { SiteContentCollections } from './site-content';

export type SectionLibraryCategory =
  | 'conversion'
  | 'booking'
  | 'portfolio'
  | 'trust'
  | 'operations'
  | 'media'
  | 'composition';

export type SiteDataDomain =
  | 'profile'
  | 'contact'
  | 'location'
  | 'hours'
  | 'booking'
  | 'policies'
  | 'staff'
  | 'reviews'
  | 'offers'
  | 'faq'
  | 'media'
  | 'document'
  | 'none';

/** Surface tone a section prefers; the adjacency resolver arbitrates neighbours. */
export type SectionSurfaceTone = 'base' | 'tint' | 'contrast' | 'accent';

export type PageKind = 'home' | 'content';

/**
 * Pure, render-agnostic snapshot of the shared authorities a section needs to
 * judge its own readiness and validity. Built once per document render/compile
 * by the plan builder; never contains copies a section could persist.
 */
export type SiteLibraryContext = {
  businessStructure: 'solo' | 'multi_tech' | null;
  hasPublicContact: boolean;
  /** Broad Contact-section predicate: any location, contact, or hours content. */
  hasContactSectionContent: boolean;
  hasPublicLocation: boolean;
  galleryImageIds: string[];
  hoursConfigured: boolean;
  hoursShownOnSite: boolean;
  policiesMeaningful: boolean;
  depositMode: 'none' | 'fixed';
  /** Arrival notes with real text, keyed the way Visit Us's toggles are. */
  arrivalNotes: { entrance: boolean; parking: boolean; transit: boolean };
  /** Before-You-Book topics whose owner wording resolves to real copy. */
  availablePolicyTopics: PolicyToggleId[];
  canonicalServiceIds: string[];
  /** The deposits summary is complete, visible, and non-empty. */
  depositsSummaryPublishable: boolean;
  /** The owner-authored deposits/cancellations wording is visible and non-empty. */
  depositsWordingPublishable: boolean;
  featuredServiceIds: string[];
  /** Quick Info facts that resolve to real content right now. */
  availableQuickFacts: QuickInfoFactId[];
  siteContent: SiteContentCollections;
};

export type SectionValidationIssue = { code: string; message: string };

export type SectionReadinessLevel = 'ready' | 'attention' | 'empty';

export type SectionReadiness = {
  level: SectionReadinessLevel;
  /** Customer side omits `empty` sections entirely; `attention` renders with issues listed owner-side. */
  issues: SectionValidationIssue[];
};

export type OverlapWarningRule = {
  id: string;
  /** The other section type whose visible presence triggers the warning. */
  otherType: LibrarySectionType | 'booking' | 'custom_design';
  /** True when the rule only applies to immediately adjacent placement. */
  adjacentOnly?: boolean;
};

export type SectionRegistryEntry<TType extends LibrarySectionType> = {
  type: TType;
  version: 1;
  label: string;
  description: string;
  category: SectionLibraryCategory;
  dataDomains: readonly SiteDataDomain[];
  presetIds: readonly string[];
  defaultPresetId: string;
  defaultSettings: () => LibrarySectionSettingsByType[TType];
  normalize: (input: unknown) => LibrarySectionSettingsByType[TType];
  validate: (
    settings: LibrarySectionSettingsByType[TType],
    context: SiteLibraryContext,
  ) => SectionValidationIssue[];
  readiness: (
    settings: LibrarySectionSettingsByType[TType],
    context: SiteLibraryContext,
  ) => SectionReadiness;
  maxPerPage?: number;
  maxPerSite?: number;
  /** Hard limits block; soft limits warn with an "add anyway" path. */
  limitKind: 'hard' | 'soft';
  overlapWarnings: readonly OverlapWarningRule[];
  allowedPageKinds: readonly PageKind[];
  recommendedPageKinds: readonly PageKind[];
  surface: SectionSurfaceTone;
  /** Renders attached to the following section with no gap (announcement → hero). */
  attachesToNext?: boolean;
  /** Semantic role this type absorbs when upgrading v1 starter documents. */
  legacySemanticRoles: readonly string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : [];

const asChoice = <T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T => (choices.includes(value as T) ? (value as T) : fallback);

const asBoundText = (value: unknown): BoundText => {
  if (isRecord(value) && value.source === 'override' && typeof value.value === 'string') {
    return { source: 'override', value: value.value };
  }
  return { source: 'shared' };
};

const ready = (): SectionReadiness => ({ issues: [], level: 'ready' });

const empty = (code: string, message: string): SectionReadiness => ({
  issues: [{ code, message }],
  level: 'empty',
});

export const attention = (issues: SectionValidationIssue[]): SectionReadiness => ({
  issues,
  level: 'attention',
});

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */

const announcementBar: SectionRegistryEntry<'announcement_bar'> = {
  allowedPageKinds: ['home', 'content'],
  attachesToNext: true,
  category: 'conversion',
  dataDomains: ['none'],
  defaultPresetId: 'standard',
  defaultSettings: (): AnnouncementBarSettings => ({
    action: null,
    dismissible: true,
    message: '',
    reassurance: '',
    tone: 'tint',
    version: 1,
  }),
  description: 'A single short line for a promotion, holiday notice, or announcement.',
  label: 'Announcement Bar',
  legacySemanticRoles: [],
  limitKind: 'hard',
  maxPerPage: 1,
  normalize: (input): AnnouncementBarSettings => {
    const record = isRecord(input) ? input : {};
    const action = isRecord(record.action)
      ? record.action.kind === 'url'
        && typeof record.action.label === 'string'
        && typeof record.action.url === 'string'
        ? { kind: 'url' as const, label: record.action.label, url: record.action.url }
        : record.action.kind === 'booking' && typeof record.action.label === 'string'
          ? { kind: 'booking' as const, label: record.action.label }
          : null
      : null;
    return {
      action,
      dismissible: asBoolean(record.dismissible, true),
      message: asString(record.message, '').slice(0, 120),
      reassurance: asString(record.reassurance, '').slice(0, 90),
      tone: asChoice(record.tone, ['accent', 'tint'] as const, 'tint'),
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['standard'],
  readiness: (settings) =>
    settings.message.trim()
      ? ready()
      : empty('announcement_empty', 'Add a short announcement message.'),
  recommendedPageKinds: ['home'],
  surface: 'tint',
  type: 'announcement_bar',
  validate: (settings) => {
    const issues: SectionValidationIssue[] = [];
    if (settings.action?.kind === 'url' && !/^https?:\/\//u.test(settings.action.url)) {
      issues.push({
        code: 'announcement_unsafe_link',
        message: 'The announcement link must start with http:// or https://.',
      });
    }
    return issues;
  },
  version: 1,
};

const hero: SectionRegistryEntry<'hero'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'conversion',
  dataDomains: ['profile', 'location', 'booking', 'hours'],
  defaultPresetId: 'image_right',
  defaultSettings: (): HeroSettings => ({
    headline: { source: 'shared' },
    intro: { source: 'shared' },
    media: 'profile_photo',
    preset: 'image_right',
    primaryCtaLabel: 'Book an appointment',
    showLocationEyebrow: true,
    showStatusLine: true,
    version: 1,
  }),
  description: 'The first impression: salon identity, location, and the primary booking action.',
  label: 'Hero',
  legacySemanticRoles: ['hero'],
  limitKind: 'hard',
  maxPerPage: 1,
  normalize: (input): HeroSettings => {
    const record = isRecord(input) ? input : {};
    return {
      headline: asBoundText(record.headline),
      intro: asBoundText(record.intro),
      media: asChoice(
        record.media,
        ['profile_photo', 'logo_emblem', 'gradient'] as const,
        'profile_photo',
      ),
      preset: asChoice(
        record.preset,
        ['image_right', 'full_bleed', 'editorial_split', 'booking_first'] as const,
        'image_right',
      ),
      primaryCtaLabel: asString(record.primaryCtaLabel, 'Book an appointment').slice(0, 40)
        || 'Book an appointment',
      showLocationEyebrow: asBoolean(record.showLocationEyebrow, true),
      showStatusLine: asBoolean(record.showStatusLine, true),
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['image_right', 'full_bleed', 'editorial_split', 'booking_first'],
  readiness: () => ready(),
  recommendedPageKinds: ['home'],
  surface: 'base',
  type: 'hero',
  validate: () => [],
  version: 1,
};

const quickInfo: SectionRegistryEntry<'quick_info'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'conversion',
  dataDomains: ['location', 'booking', 'hours'],
  defaultPresetId: 'strip',
  defaultSettings: (): QuickInfoSettings => ({
    facts: ['location', 'visit_mode', 'new_clients', 'open_status'],
    version: 1,
  }),
  description: 'Up to four compact key facts — area, appointment mode, new clients, open status.',
  label: 'Quick Info',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerPage: 1,
  normalize: (input): QuickInfoSettings => {
    const record = isRecord(input) ? input : {};
    const facts = asStringArray(record.facts)
      .filter((fact): fact is QuickInfoFactId =>
        (QUICK_INFO_FACT_IDS as readonly string[]).includes(fact))
      .slice(0, 4);
    return {
      facts: facts.length > 0
        ? facts
        : ['location', 'visit_mode', 'new_clients', 'open_status'],
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['strip'],
  readiness: (settings, context) => (
    // Mirrors the renderer, which drops facts with no value and shows
    // nothing at all once every selected fact is empty.
    settings.facts.some(fact => context.availableQuickFacts.includes(fact))
      ? ready()
      : empty('quick_info_empty', 'None of the selected facts have content yet.')
  ),
  recommendedPageKinds: ['home'],
  surface: 'tint',
  type: 'quick_info',
  validate: () => [],
  version: 1,
};

const sectionNavigation: SectionRegistryEntry<'section_navigation'> = {
  allowedPageKinds: ['home', 'content'],
  attachesToNext: true,
  category: 'composition',
  dataDomains: ['document'],
  defaultPresetId: 'anchor_bar',
  defaultSettings: (): SectionNavigationSettings => ({
    labelOverrides: {},
    sticky: true,
    version: 1,
  }),
  description: 'Anchor navigation over the visible sections of this page.',
  label: 'Section Navigation',
  legacySemanticRoles: [],
  limitKind: 'hard',
  maxPerPage: 1,
  normalize: (input): SectionNavigationSettings => {
    const record = isRecord(input) ? input : {};
    const overrides: Record<string, string> = {};
    if (isRecord(record.labelOverrides)) {
      for (const [key, value] of Object.entries(record.labelOverrides)) {
        if (typeof value === 'string' && value.trim()) overrides[key] = value.slice(0, 40);
      }
    }
    return {
      labelOverrides: overrides,
      sticky: asBoolean(record.sticky, true),
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['anchor_bar'],
  readiness: () => ready(),
  recommendedPageKinds: ['home'],
  surface: 'base',
  type: 'section_navigation',
  validate: () => [],
  version: 1,
};

const featuredServices: SectionRegistryEntry<'featured_services'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'conversion',
  dataDomains: ['booking'],
  defaultPresetId: 'grid',
  defaultSettings: (): FeaturedServicesSettings => ({
    preset: 'grid',
    serviceIds: [],
    source: 'featured',
    version: 1,
  }),
  description: 'Highlight three to six services from your canonical menu.',
  label: 'Featured Services',
  legacySemanticRoles: ['services'],
  limitKind: 'soft',
  maxPerPage: 1,
  normalize: (input): FeaturedServicesSettings => {
    const record = isRecord(input) ? input : {};
    return {
      preset: asChoice(record.preset, ['grid', 'carousel', 'editorial'] as const, 'grid'),
      serviceIds: asStringArray(record.serviceIds).slice(0, 6),
      source: asChoice(record.source, ['manual', 'featured'] as const, 'featured'),
      version: 1,
    };
  },
  overlapWarnings: [
    { adjacentOnly: true, id: 'featured_beside_full_menu', otherType: 'booking' },
  ],
  presetIds: ['grid', 'carousel', 'editorial'],
  readiness: (settings, context) => {
    const resolved = settings.source === 'manual'
      ? settings.serviceIds.filter(id => context.canonicalServiceIds.includes(id))
      : context.featuredServiceIds;
    return resolved.length > 0
      ? ready()
      : empty('featured_services_empty', 'Choose services to feature.');
  },
  recommendedPageKinds: ['home'],
  surface: 'base',
  type: 'featured_services',
  validate: (settings, context) => {
    const issues: SectionValidationIssue[] = [];
    if (settings.source === 'manual') {
      const unknown = settings.serviceIds.filter(
        id => !context.canonicalServiceIds.includes(id),
      );
      if (unknown.length > 0) {
        issues.push({
          code: 'featured_unknown_service',
          message: `${unknown.length} selected service(s) are no longer on the menu.`,
        });
      }
    }
    return issues;
  },
  version: 1,
};

const offers: SectionRegistryEntry<'offers'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'conversion',
  dataDomains: ['offers'],
  defaultPresetId: 'cards',
  defaultSettings: (): OffersSettings => ({
    offerIds: [],
    preset: 'cards',
    version: 1,
  }),
  description: 'One to three truthful promotions or packages.',
  label: 'Offers',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerPage: 1,
  normalize: (input): OffersSettings => {
    const record = isRecord(input) ? input : {};
    return {
      offerIds: asStringArray(record.offerIds).slice(0, 3),
      preset: asChoice(record.preset, ['cards', 'single_banner'] as const, 'cards'),
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['cards', 'single_banner'],
  readiness: (settings, context) => {
    const resolved = settings.offerIds.filter(id =>
      context.siteContent.offers.some(offer => offer.id === id));
    return resolved.length > 0
      ? ready()
      : empty('offers_empty', 'Add an offer to show here.');
  },
  recommendedPageKinds: ['home'],
  surface: 'tint',
  type: 'offers',
  validate: (settings, context) => {
    const issues: SectionValidationIssue[] = [];
    const now = Date.now();
    for (const id of settings.offerIds) {
      const offer = context.siteContent.offers.find(candidate => candidate.id === id);
      if (offer?.expiresAt && Number.isFinite(Date.parse(offer.expiresAt))
        && Date.parse(offer.expiresAt) < now) {
        issues.push({
          code: 'offer_expired',
          message: `“${offer.title}” has expired and will not be shown.`,
        });
      }
    }
    return issues;
  },
  version: 1,
};

const gallery: SectionRegistryEntry<'gallery'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'portfolio',
  dataDomains: ['media'],
  defaultPresetId: 'grid',
  defaultSettings: (): GallerySectionSettings => ({
    preset: 'grid',
    selection: { mode: 'all' },
    version: 1,
  }),
  description: 'Your nail portfolio from the shared gallery.',
  label: 'Gallery',
  legacySemanticRoles: ['gallery', 'featured_work'],
  limitKind: 'soft',
  maxPerSite: 2,
  normalize: (input): GallerySectionSettings => {
    const record = isRecord(input) ? input : {};
    const selection = isRecord(record.selection) && record.selection.mode === 'picked'
      ? { imageIds: asStringArray(record.selection.imageIds), mode: 'picked' as const }
      : { mode: 'all' as const };
    return {
      preset: asChoice(record.preset, ['grid', 'carousel', 'editorial'] as const, 'grid'),
      selection,
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['grid', 'carousel', 'editorial'],
  readiness: (settings, context) => {
    const ids = settings.selection.mode === 'picked'
      ? settings.selection.imageIds.filter(id => context.galleryImageIds.includes(id))
      : context.galleryImageIds;
    return ids.length > 0
      ? ready()
      : empty('gallery_empty', 'Add photos to your gallery to show this section.');
  },
  recommendedPageKinds: ['home', 'content'],
  surface: 'base',
  type: 'gallery',
  validate: () => [],
  version: 1,
};

const about: SectionRegistryEntry<'about'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'trust',
  dataDomains: ['profile', 'booking', 'policies'],
  defaultPresetId: 'photo_right',
  defaultSettings: (): AboutSectionSettings => ({
    intro: { source: 'shared' },
    preset: 'photo_right',
    version: 1,
  }),
  description: 'Your story and profile, from the shared About authority.',
  label: 'About',
  legacySemanticRoles: ['about'],
  limitKind: 'soft',
  maxPerSite: 1,
  normalize: (input): AboutSectionSettings => {
    const record = isRecord(input) ? input : {};
    return {
      intro: asBoundText(record.intro),
      preset: asChoice(
        record.preset,
        ['photo_right', 'editorial_portrait', 'profile_quick_facts', 'about_before_you_book'] as const,
        'photo_right',
      ),
      version: 1,
    };
  },
  overlapWarnings: [
    { id: 'about_policy_summary_duplicate', otherType: 'deposits_cancellations' },
  ],
  presetIds: ['photo_right', 'editorial_portrait', 'profile_quick_facts', 'about_before_you_book'],
  readiness: () => ready(),
  recommendedPageKinds: ['home', 'content'],
  surface: 'tint',
  type: 'about',
  validate: () => [],
  version: 1,
};

const team: SectionRegistryEntry<'team'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'trust',
  dataDomains: ['staff'],
  defaultPresetId: 'profile_grid',
  defaultSettings: (): TeamSettings => ({
    memberIds: [],
    preset: 'profile_grid',
    version: 1,
  }),
  description: 'Profiles for a team or multi-tech salon.',
  label: 'Team',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerSite: 1,
  normalize: (input): TeamSettings => {
    const record = isRecord(input) ? input : {};
    return {
      memberIds: asStringArray(record.memberIds),
      preset: asChoice(
        record.preset,
        ['profile_grid', 'swipeable', 'editorial_team'] as const,
        'profile_grid',
      ),
      version: 1,
    };
  },
  overlapWarnings: [{ id: 'team_on_solo_business', otherType: 'team' }],
  presetIds: ['profile_grid', 'swipeable', 'editorial_team'],
  readiness: (settings, context) => {
    const resolved = settings.memberIds.filter(id =>
      context.siteContent.staff.some(member => member.id === id));
    return resolved.length > 0
      ? ready()
      : empty('team_empty', 'Add team members to show this section.');
  },
  recommendedPageKinds: ['content'],
  surface: 'base',
  type: 'team',
  validate: (_settings, context) =>
    context.businessStructure === 'solo'
      ? [{
          code: 'team_solo_business',
          message: 'Your business is set up as a solo nail tech; the Team section is usually hidden.',
        }]
      : [],
  version: 1,
};

const reviews: SectionRegistryEntry<'reviews'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'trust',
  dataDomains: ['reviews'],
  defaultPresetId: 'testimonial_cards',
  defaultSettings: (): ReviewsSettings => ({
    preset: 'testimonial_cards',
    reviewIds: [],
    showRatings: true,
    version: 1,
  }),
  description: 'Real client words from the shared reviews collection.',
  label: 'Reviews',
  legacySemanticRoles: ['reviews'],
  limitKind: 'soft',
  maxPerSite: 2,
  normalize: (input): ReviewsSettings => {
    const record = isRecord(input) ? input : {};
    return {
      preset: asChoice(
        record.preset,
        ['testimonial_cards', 'editorial_quote', 'carousel'] as const,
        'testimonial_cards',
      ),
      reviewIds: asStringArray(record.reviewIds),
      showRatings: asBoolean(record.showRatings, true),
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['testimonial_cards', 'editorial_quote', 'carousel'],
  readiness: (settings, context) => {
    const resolved = settings.reviewIds.filter(id =>
      context.siteContent.reviews.some(review => review.id === id && review.visible));
    return resolved.length > 0
      ? ready()
      : empty('reviews_empty', 'Add a client review to show this section.');
  },
  recommendedPageKinds: ['home', 'content'],
  surface: 'tint',
  type: 'reviews',
  validate: () => [],
  version: 1,
};

const depositsCancellations: SectionRegistryEntry<'deposits_cancellations'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'operations',
  dataDomains: ['booking', 'policies'],
  defaultPresetId: 'summary_card',
  defaultSettings: (): DepositsCancellationsSettings => ({
    version: 1,
    wordingMode: 'summary',
  }),
  description: 'Deposit and cancellation expectations in client language.',
  label: 'Deposits & Cancellations',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerSite: 1,
  normalize: (input): DepositsCancellationsSettings => {
    const record = isRecord(input) ? input : {};
    return {
      version: 1,
      wordingMode: asChoice(record.wordingMode, ['summary', 'full'] as const, 'summary'),
    };
  },
  overlapWarnings: [],
  presetIds: ['summary_card'],
  /*
   * A fixed deposit amount alone is not something to publish — the renderer
   * shows nothing until there is visible, owner-authored wording, and
   * readiness has to agree or the section reports ready and draws a blank.
   */
  readiness: (settings, context) => (
    // Mirrors the renderer's own branch: the summary is used only when it is
    // complete and the owner has not hidden that copy, and anything else
    // falls back to the authored wording. `policiesMeaningful` is true for
    // policy topics this section cannot draw, so it cannot answer this.
    (settings.wordingMode === 'summary' && context.depositsSummaryPublishable)
      || context.depositsWordingPublishable
      ? ready()
      : empty('deposits_empty', 'Set a deposit or cancellation policy to show this section.')
  ),
  recommendedPageKinds: ['content'],
  surface: 'tint',
  type: 'deposits_cancellations',
  validate: () => [],
  version: 1,
};

const policies: SectionRegistryEntry<'policies'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'operations',
  dataDomains: ['policies'],
  defaultPresetId: 'expandable_list',
  defaultSettings: (): PoliciesSectionSettings => ({
    includedSections: [...POLICY_TOGGLE_IDS],
    version: 1,
  }),
  description: 'Before-you-book expectations: arrivals, no-shows, repairs, house rules.',
  label: 'Before You Book',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerSite: 1,
  normalize: (input): PoliciesSectionSettings => {
    const record = isRecord(input) ? input : {};
    const included = asStringArray(record.includedSections)
      .filter((id): id is PolicyToggleId =>
        (POLICY_TOGGLE_IDS as readonly string[]).includes(id));
    return {
      includedSections: included.length > 0 ? included : [...POLICY_TOGGLE_IDS],
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['expandable_list'],
  readiness: (settings, context) =>
    // Only the ticked topics can render, and only where the wording
    // resolved — which is exactly what the editor's own hint promises.
    settings.includedSections.some(topic => context.availablePolicyTopics.includes(topic))
      ? ready()
      : empty('policies_empty', 'Answer the policy questions to show this section.'),
  recommendedPageKinds: ['content'],
  surface: 'base',
  type: 'policies',
  validate: () => [],
  version: 1,
};

const faq: SectionRegistryEntry<'faq'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'operations',
  dataDomains: ['faq'],
  defaultPresetId: 'accordion',
  defaultSettings: (): FaqSettings => ({ itemIds: [], version: 1 }),
  description: 'Frequently asked questions in an accessible accordion.',
  label: 'FAQ',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerPage: 1,
  normalize: (input): FaqSettings => {
    const record = isRecord(input) ? input : {};
    return { itemIds: asStringArray(record.itemIds).slice(0, 12), version: 1 };
  },
  overlapWarnings: [],
  presetIds: ['accordion'],
  readiness: (settings, context) => {
    const resolved = settings.itemIds.filter(id =>
      context.siteContent.faq.some(item => item.id === id));
    return resolved.length > 0
      ? ready()
      : empty('faq_empty', 'Add a question to show this section.');
  },
  recommendedPageKinds: ['content'],
  surface: 'base',
  type: 'faq',
  validate: () => [],
  version: 1,
};

const hours: SectionRegistryEntry<'hours'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'operations',
  dataDomains: ['hours'],
  defaultPresetId: 'compact',
  defaultSettings: (): HoursSectionSettings => ({ layout: 'compact', version: 1 }),
  description: 'Your public weekly schedule from the single shared hours authority.',
  label: 'Hours',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerSite: 1,
  normalize: (input): HoursSectionSettings => {
    const record = isRecord(input) ? input : {};
    return {
      layout: asChoice(record.layout, ['compact', 'full'] as const, 'compact'),
      version: 1,
    };
  },
  overlapWarnings: [{ id: 'hours_inside_visit_us', otherType: 'visit_us' }],
  presetIds: ['compact', 'full'],
  readiness: (_settings, context) =>
    context.hoursConfigured && context.hoursShownOnSite
      ? ready()
      : empty('hours_empty', 'Set weekly hours (and show them on your site) first.'),
  recommendedPageKinds: ['content'],
  surface: 'tint',
  type: 'hours',
  validate: () => [],
  version: 1,
};

const visitUs: SectionRegistryEntry<'visit_us'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'operations',
  dataDomains: ['location', 'hours', 'contact'],
  defaultPresetId: 'map_details',
  defaultSettings: (): VisitUsSettings => ({
    contactSummary: 'auto',
    hoursSummary: 'auto',
    preset: 'map_details',
    showEntrance: true,
    showParking: true,
    showTransit: true,
    version: 1,
  }),
  description: 'Where to find you, with privacy-safe directions and arrival details.',
  label: 'Visit Us',
  legacySemanticRoles: ['visit'],
  limitKind: 'soft',
  maxPerSite: 1,
  normalize: (input): VisitUsSettings => {
    const record = isRecord(input) ? input : {};
    const summary = (value: unknown): VisitUsSummaryMode =>
      asChoice(value, ['auto', 'show', 'hide'] as const, 'auto');
    return {
      contactSummary: summary(record.contactSummary),
      hoursSummary: summary(record.hoursSummary),
      preset: asChoice(
        record.preset,
        ['map_details', 'editorial_visit', 'compact_info'] as const,
        'map_details',
      ),
      showEntrance: asBoolean(record.showEntrance, true),
      showParking: asBoolean(record.showParking, true),
      showTransit: asBoolean(record.showTransit, true),
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['map_details', 'editorial_visit', 'compact_info'],
  readiness: (settings, context) =>
    // The renderer publishes a section built purely from arrival notes, so
    // an area is not the only way this section has something to say. Each
    // note counts only while its own toggle is on, exactly as it renders.
    context.hasPublicLocation
      || (settings.showParking && context.arrivalNotes.parking)
      || (settings.showEntrance && context.arrivalNotes.entrance)
      || (settings.showTransit && context.arrivalNotes.transit)
      ? ready()
      : empty('visit_us_empty', 'Add your city or general area to show this section.'),
  recommendedPageKinds: ['content'],
  surface: 'base',
  type: 'visit_us',
  validate: () => [],
  version: 1,
};

const contact: SectionRegistryEntry<'contact'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'operations',
  dataDomains: ['contact'],
  defaultPresetId: 'card',
  defaultSettings: (): ContactSectionSettings => ({ preset: 'card', version: 1 }),
  description: 'The public ways to reach you; booking stays primary.',
  label: 'Contact',
  legacySemanticRoles: ['contact'],
  limitKind: 'soft',
  maxPerSite: 1,
  normalize: (input): ContactSectionSettings => {
    const record = isRecord(input) ? input : {};
    return {
      preset: asChoice(record.preset, ['card', 'action_row'] as const, 'card'),
      version: 1,
    };
  },
  overlapWarnings: [{ id: 'contact_inside_visit_us', otherType: 'visit_us' }],
  presetIds: ['card', 'action_row'],
  readiness: (_settings, context) =>
    context.hasContactSectionContent
      ? ready()
      : empty('contact_empty', 'Add a public contact method (or Booking-only stays canonical).'),
  recommendedPageKinds: ['content'],
  surface: 'tint',
  type: 'contact',
  validate: () => [],
  version: 1,
};

const finalCta: SectionRegistryEntry<'final_cta'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'conversion',
  dataDomains: ['profile', 'booking', 'contact'],
  defaultPresetId: 'simple_banner',
  defaultSettings: (): FinalCtaSettings => ({
    headline: { source: 'shared' },
    preset: 'simple_banner',
    version: 1,
  }),
  description: 'End-of-page conversion moment routing to your canonical Booking.',
  label: 'Final Booking CTA',
  legacySemanticRoles: [],
  limitKind: 'soft',
  maxPerPage: 1,
  normalize: (input): FinalCtaSettings => {
    const record = isRecord(input) ? input : {};
    return {
      headline: asBoundText(record.headline),
      preset: asChoice(
        record.preset,
        ['simple_banner', 'image_cta', 'editorial_cta'] as const,
        'simple_banner',
      ),
      version: 1,
    };
  },
  overlapWarnings: [{ id: 'cta_density', otherType: 'final_cta' }],
  presetIds: ['simple_banner', 'image_cta', 'editorial_cta'],
  readiness: () => ready(),
  recommendedPageKinds: ['home', 'content'],
  surface: 'contrast',
  type: 'final_cta',
  validate: () => [],
  version: 1,
};

const footer: SectionRegistryEntry<'footer'> = {
  allowedPageKinds: ['home', 'content'],
  category: 'composition',
  dataDomains: ['document', 'contact', 'profile', 'policies'],
  defaultPresetId: 'columns',
  defaultSettings: (): FooterSettings => ({
    preset: 'columns',
    showAttribution: true,
    version: 1,
  }),
  description: 'Final navigation, contact, and business identity.',
  label: 'Footer',
  legacySemanticRoles: [],
  limitKind: 'hard',
  maxPerPage: 1,
  normalize: (input): FooterSettings => {
    const record = isRecord(input) ? input : {};
    return {
      preset: asChoice(record.preset, ['columns', 'compact'] as const, 'columns'),
      showAttribution: asBoolean(record.showAttribution, true),
      version: 1,
    };
  },
  overlapWarnings: [],
  presetIds: ['columns', 'compact'],
  readiness: () => ready(),
  recommendedPageKinds: ['home', 'content'],
  surface: 'contrast',
  type: 'footer',
  validate: () => [],
  version: 1,
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

type AnyEntry = { [T in LibrarySectionType]: SectionRegistryEntry<T> }[LibrarySectionType];

/**
 * Section types that make sense as in-page anchor targets. The customer
 * renderer, the plan (which decides whether an anchor menu has anything to
 * point at) and the Section Navigation editor all read this one list — three
 * copies of it used to drift.
 */
export const NAVIGABLE_SECTION_TYPES: ReadonlySet<string> = new Set([
  'about',
  'booking',
  'contact',
  'deposits_cancellations',
  'faq',
  'featured_services',
  'gallery',
  'hours',
  'offers',
  'policies',
  'reviews',
  'team',
  'visit_us',
]);

export const SECTION_LIBRARY_REGISTRY: {
  readonly [T in LibrarySectionType]: SectionRegistryEntry<T>;
} = {
  about,
  announcement_bar: announcementBar,
  contact,
  deposits_cancellations: depositsCancellations,
  faq,
  featured_services: featuredServices,
  final_cta: finalCta,
  footer,
  gallery,
  hero,
  hours,
  offers,
  policies,
  quick_info: quickInfo,
  reviews,
  section_navigation: sectionNavigation,
  team,
  visit_us: visitUs,
};

export const LIBRARY_SECTION_TYPES = Object.keys(
  SECTION_LIBRARY_REGISTRY,
) as LibrarySectionType[];

export const isLibrarySectionType = (value: unknown): value is LibrarySectionType =>
  typeof value === 'string'
  && Object.hasOwn(SECTION_LIBRARY_REGISTRY, value);

/** Object-level narrowing for section instances. */
export const isLibrarySection = <S extends { sectionType: string }>(
  section: S,
): section is Extract<S, { sectionType: LibrarySectionType }> =>
  isLibrarySectionType(section.sectionType);

export const getSectionRegistryEntry = (type: LibrarySectionType): AnyEntry =>
  SECTION_LIBRARY_REGISTRY[type];

/** Roles absorbed from v1 starter documents, resolved once. */
export const LIBRARY_TYPE_BY_LEGACY_ROLE: Readonly<Record<string, LibrarySectionType>> =
  Object.freeze(Object.fromEntries(
    LIBRARY_SECTION_TYPES.flatMap(type =>
      SECTION_LIBRARY_REGISTRY[type].legacySemanticRoles.map(role => [role, type])),
  ));
