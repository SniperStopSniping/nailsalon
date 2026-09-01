import type { SiteLibraryContext } from './section-library/registry';
import type { SectionInstance, SectionType } from './types';

/**
 * Customer content is resolved once for the complete semantic site. Renderers
 * consume this plan; they do not independently decide where shared data lives.
 */
export const SITE_CONTENT_PLACEMENT_VERSION = 1 as const;

export type SiteContentKey =
  | 'brand_logo'
  | 'owner_profile_photo'
  | 'hero_media'
  | 'instagram'
  | 'phone'
  | 'text'
  | 'email'
  | 'location'
  | 'exact_address'
  | 'arrival_details'
  | 'business_hours'
  | 'appointment_mode'
  | 'new_client_status'
  | 'minimum_notice'
  | 'deposit_cancellation_policy'
  | 'before_you_book_policies'
  | 'service_marketing'
  | 'service_catalogue'
  | 'gallery_media'
  | 'team_profiles'
  | 'reviews'
  | 'custom_design';

export type ContentPlacementOwner = string | 'site_header' | null;

export type ContentPlacement = {
  contentKey: SiteContentKey;
  ownerPageId: string | null;
  ownerSectionId: ContentPlacementOwner;
  suppressedSectionIds: string[];
  reasonBySectionId: Record<string, string>;
};

export type SectionContentSuppression = {
  actionLabel: string | null;
  contentKey: SiteContentKey;
  ownerSectionId: ContentPlacementOwner;
  reason: string;
  suppressEntireSection: boolean;
};

export type SiteContentPlacementPlan = {
  version: typeof SITE_CONTENT_PLACEMENT_VERSION;
  placements: Record<SiteContentKey, ContentPlacement>;
  pagePlacements: Record<string, Partial<Record<SiteContentKey, ContentPlacement>>>;
  sectionSuppressions: Record<string, SectionContentSuppression[]>;
  /** Booking's optional marketing rail is hidden when another page owns it. */
  showBookingFeaturedRail: boolean;
};

export type SiteContentAvailability = Partial<Record<SiteContentKey, boolean>>;

export type SiteContentPlacementOptions = {
  /** Exact shared staff record representing the Business Profile owner. */
  ownerStaffMemberId?: string | null;
};

/** Shared-data eligibility is computed once beside readiness, never in render order. */
export const getSiteContentAvailability = (
  context: SiteLibraryContext,
): SiteContentAvailability => {
  const publicMethods = new Set(context.publicContactMethods);
  return {
    arrival_details: Object.values(context.arrivalNotes).some(Boolean),
    appointment_mode: context.availableQuickFacts.includes('visit_mode'),
    before_you_book_policies: context.availablePolicyTopics.length > 0,
    brand_logo: context.hasLogoGraphic,
    business_hours: context.hoursConfigured && context.hoursShownOnSite,
    custom_design: true,
    deposit_cancellation_policy: context.depositsSummaryPublishable
      || context.depositsWordingPublishable,
    email: publicMethods.has('email'),
    exact_address: context.hasPublicExactAddress,
    gallery_media: context.galleryImageIds.length > 0,
    hero_media: false,
    instagram: publicMethods.has('instagram'),
    location: context.hasPublicLocation,
    minimum_notice: context.availableQuickFacts.includes('minimum_notice'),
    new_client_status: context.availableQuickFacts.includes('new_clients'),
    owner_profile_photo: context.hasProfilePhoto,
    phone: publicMethods.has('phone'),
    reviews: context.siteContent.reviews.some(review => review.visible),
    service_catalogue: context.canonicalServiceIds.length > 0,
    service_marketing: context.featuredServiceIds.length > 0,
    team_profiles: context.siteContent.staff.length > 0,
    text: publicMethods.has('text'),
  };
};

type PlacementSection = {
  id: string;
  label: string;
  section?: SectionInstance;
  sectionType: SectionType;
};

type PlacementPage = {
  id: string;
  label: string;
  sections: readonly PlacementSection[];
};

type SectionCandidate = PlacementSection & { pageId: string };

const SITE_KEYS: readonly SiteContentKey[] = [
  'brand_logo',
  'owner_profile_photo',
  'hero_media',
  'instagram',
  'phone',
  'text',
  'email',
  'location',
  'exact_address',
  'arrival_details',
  'business_hours',
  'appointment_mode',
  'new_client_status',
  'minimum_notice',
  'deposit_cancellation_policy',
  'before_you_book_policies',
  'service_marketing',
  'service_catalogue',
  'gallery_media',
  'team_profiles',
  'reviews',
  'custom_design',
];

const OWNER_LABEL_BY_TYPE: Partial<Record<SectionType, string>> = {
  about: 'About',
  booking: 'Services & Booking',
  contact: 'Contact',
  deposits_cancellations: 'Deposits & Cancellations',
  featured_services: 'Featured Services',
  footer: 'Footer',
  gallery: 'Gallery',
  hours: 'Hours',
  policies: 'Before You Book',
  quick_info: 'Quick Info',
  visit_us: 'Visit Us',
};

const displayOwner = (owner: SectionCandidate | null): string => owner
  ? OWNER_LABEL_BY_TYPE[owner.sectionType] ?? owner.label
  : '';

const defaultPlacement = (contentKey: SiteContentKey): ContentPlacement => ({
  contentKey,
  ownerPageId: null,
  ownerSectionId: null,
  reasonBySectionId: {},
  suppressedSectionIds: [],
});

const reasonFor = (
  key: SiteContentKey,
  owner: SectionCandidate | null,
): string => {
  const label = displayOwner(owner);
  if (key === 'owner_profile_photo') {
    return owner
      ? `Profile photo is shown in ${label}.`
      : 'Profile photo is published only from About; it is not reused as Hero media.';
  }
  if (key === 'instagram') {
    return `Instagram is already shown in ${label}.`;
  }
  if (key === 'phone') {
    return `Phone is already shown in ${label}.`;
  }
  if (key === 'text') {
    return `Text is already shown in ${label}.`;
  }
  if (key === 'email') {
    return `Email is already shown in ${label}.`;
  }
  if (key === 'location' || key === 'exact_address') {
    return `Location is already shown in ${label}.`;
  }
  if (key === 'arrival_details') {
    return 'Arrival details are shown only in Visit Us.';
  }
  if (key === 'business_hours') {
    return `Hours are shown in the ${label} section.`;
  }
  if (key === 'appointment_mode' || key === 'new_client_status' || key === 'minimum_notice') {
    return `Booking facts are already shown in ${label}.`;
  }
  if (key === 'deposit_cancellation_policy') {
    return owner
      ? 'Deposit and cancellation details are shown in Deposits & Cancellations.'
      : 'Deposit and cancellation details publish only from Deposits & Cancellations.';
  }
  if (key === 'before_you_book_policies') {
    return owner
      ? 'Other policies are shown in Before You Book.'
      : 'Other policies publish only from Before You Book.';
  }
  return label ? `${key.replaceAll('_', ' ')} is already shown in ${label}.` : '';
};

const actionFor = (owner: SectionCandidate | null): string | null => owner
  ? `Go to ${displayOwner(owner)}`
  : null;

const getContentPlacementFromRecords = (
  placements: SiteContentPlacementPlan['placements'],
  pagePlacements: SiteContentPlacementPlan['pagePlacements'],
  key: SiteContentKey,
  pageId?: string,
): ContentPlacement => pageId
  ? pagePlacements[pageId]?.[key] ?? placements[key]
  : placements[key];

/**
 * Builds deterministic ownership from visible, customer-ready pages and their
 * final section order. Component render order never participates.
 */
export const buildSiteContentPlacementPlan = (
  pages: readonly PlacementPage[],
  availability: SiteContentAvailability = {},
  options: SiteContentPlacementOptions = {},
): SiteContentPlacementPlan => {
  const placements = Object.fromEntries(
    SITE_KEYS.map(key => [key, defaultPlacement(key)]),
  ) as Record<SiteContentKey, ContentPlacement>;
  const pagePlacements: SiteContentPlacementPlan['pagePlacements'] = {};
  const sectionSuppressions: SiteContentPlacementPlan['sectionSuppressions'] = {};
  const candidates: SectionCandidate[] = pages.flatMap(page => page.sections.map(section => ({
    ...section,
    pageId: page.id,
  })));
  const byType = (type: SectionType): SectionCandidate[] => candidates.filter(
    section => section.sectionType === type,
  );
  const supportsContent = (
    candidate: SectionCandidate,
    key: SiteContentKey,
  ): boolean => {
    const instance = candidate.section;
    if (!instance) {
      return true;
    }
    if (instance.sectionType === 'quick_info') {
      const factByKey: Partial<Record<SiteContentKey, string>> = {
        appointment_mode: 'visit_mode',
        business_hours: 'open_status',
        exact_address: 'location',
        location: 'location',
        minimum_notice: 'minimum_notice',
        new_client_status: 'new_clients',
      };
      const fact = factByKey[key];
      return fact ? instance.settings.facts.includes(fact as never) : false;
    }
    if (instance.sectionType === 'visit_us') {
      if (key === 'business_hours') {
        return instance.settings.hoursSummary !== 'hide';
      }
      if (key === 'instagram' || key === 'phone' || key === 'text' || key === 'email') {
        return instance.settings.contactSummary !== 'hide';
      }
    }
    return true;
  };
  const firstByPriority = (
    types: readonly SectionType[],
    key: SiteContentKey,
  ): SectionCandidate | null => {
    for (const type of types) {
      const candidate = byType(type).find(section => supportsContent(section, key));
      if (candidate) {
        return candidate;
      }
    }
    return null;
  };
  const addSuppression = (
    section: SectionCandidate,
    contentKey: SiteContentKey,
    owner: SectionCandidate | null,
    suppressEntireSection = false,
    explicitReason?: string,
  ) => {
    const reason = explicitReason ?? reasonFor(contentKey, owner);
    if (!reason) {
      return;
    }
    (sectionSuppressions[section.id] ??= []).push({
      actionLabel: actionFor(owner),
      contentKey,
      ownerSectionId: owner?.id ?? null,
      reason,
      suppressEntireSection,
    });
  };
  const assign = (
    key: SiteContentKey,
    priority: readonly SectionType[],
    candidateTypes: readonly SectionType[],
    options: {
      owner?: SectionCandidate | null;
      suppressEntireSection?: boolean;
    } = {},
  ) => {
    if (availability[key] === false) {
      return;
    }
    const owner = options.owner === undefined
      ? firstByPriority(priority, key)
      : options.owner;
    const suppressed = candidateTypes.flatMap(type => byType(type))
      .filter(section => section.id !== owner?.id && supportsContent(section, key));
    const reason = reasonFor(key, owner);
    placements[key] = {
      contentKey: key,
      ownerPageId: owner?.pageId ?? null,
      ownerSectionId: owner?.id ?? null,
      reasonBySectionId: Object.fromEntries(suppressed.map(section => [section.id, reason])),
      suppressedSectionIds: suppressed.map(section => section.id),
    };
    for (const section of suppressed) {
      addSuppression(section, key, owner, options.suppressEntireSection);
    }
  };

  placements.brand_logo = {
    ...defaultPlacement('brand_logo'),
    ownerSectionId: 'site_header',
  };
  // No dedicated Hero-media authority exists in V1. Legacy Profile/Logo
  // choices migrate to the style-owned no-media treatment.
  placements.hero_media = defaultPlacement('hero_media');

  const aboutProfileOwner = firstByPriority(['about'], 'owner_profile_photo');
  const teamProfileOwner = options.ownerStaffMemberId
    ? byType('team').find(candidate => (
      candidate.section?.sectionType === 'team'
      && candidate.section.settings.memberIds.includes(options.ownerStaffMemberId!)
    )) ?? null
    : null;
  assign('owner_profile_photo', ['about', 'team'], ['about', 'team', 'hero'], {
    owner: aboutProfileOwner ?? teamProfileOwner,
  });
  assign('instagram', ['contact', 'footer', 'about'], ['contact', 'visit_us', 'footer', 'about']);
  assign('phone', ['contact', 'visit_us', 'footer'], ['contact', 'visit_us', 'footer', 'about']);
  assign('text', ['contact', 'visit_us', 'footer'], ['contact', 'visit_us', 'footer', 'about']);
  assign('email', ['contact', 'visit_us', 'footer'], ['contact', 'visit_us', 'footer', 'about']);
  assign('location', ['visit_us', 'contact', 'quick_info'], [
    'visit_us',
    'contact',
    'quick_info',
    'hero',
    'booking',
    'footer',
  ]);
  assign('exact_address', ['visit_us', 'contact', 'quick_info'], [
    'visit_us',
    'contact',
    'quick_info',
    'hero',
    'booking',
    'footer',
  ]);
  assign('arrival_details', ['visit_us'], ['visit_us', 'contact', 'footer']);
  assign('business_hours', ['hours', 'visit_us', 'quick_info'], [
    'hours',
    'visit_us',
    'quick_info',
    'contact',
    'hero',
    'about',
    'footer',
  ]);
  assign('appointment_mode', ['quick_info', 'booking'], ['quick_info', 'booking', 'hero', 'about']);
  assign('new_client_status', ['quick_info', 'booking'], ['quick_info', 'booking', 'hero', 'about']);
  assign('minimum_notice', ['quick_info', 'booking'], ['quick_info', 'booking', 'hero', 'about']);
  assign('deposit_cancellation_policy', ['deposits_cancellations'], [
    'deposits_cancellations',
    'about',
    'booking',
    'hero',
    'quick_info',
    'footer',
  ]);
  assign('before_you_book_policies', ['policies'], [
    'policies',
    'about',
    'faq',
    'contact',
    'footer',
  ]);
  assign('service_catalogue', ['booking'], ['booking']);
  const galleryCandidates = byType('gallery');
  const dedicatedGalleryOwner = galleryCandidates.find(candidate => (
    pages.find(page => page.id === candidate.pageId)?.label.trim().toLowerCase()
    === 'gallery'
  )) ?? galleryCandidates[0] ?? null;
  assign('gallery_media', ['gallery'], ['gallery'], {
    owner: dedicatedGalleryOwner,
    suppressEntireSection: true,
  });

  for (const page of pages) {
    const pageCandidates = page.sections.map(section => ({ ...section, pageId: page.id }));
    const pageByType = (type: SectionType) => pageCandidates.filter(
      section => section.sectionType === type,
    );
    const assignPageUnique = (
      key: SiteContentKey,
      types: readonly SectionType[],
    ) => {
      if (availability[key] === false) {
        return;
      }
      const eligible = types.flatMap(type => pageByType(type));
      const owner = eligible[0] ?? null;
      const suppressed = eligible.slice(1);
      const placement: ContentPlacement = {
        contentKey: key,
        ownerPageId: owner?.pageId ?? null,
        ownerSectionId: owner?.id ?? null,
        reasonBySectionId: Object.fromEntries(suppressed.map(section => [
          section.id,
          reasonFor(key, owner),
        ])),
        suppressedSectionIds: suppressed.map(section => section.id),
      };
      (pagePlacements[page.id] ??= {})[key] = placement;
      for (const section of suppressed) {
        addSuppression(section, key, owner, true);
      }
    };

    const booking = pageByType('booking')[0] ?? null;
    const featured = pageByType('featured_services');
    if (booking) {
      const reason = 'Featured Services is not shown on this page because Services & Booking already displays your services.';
      (pagePlacements[page.id] ??= {}).service_marketing = {
        contentKey: 'service_marketing',
        ownerPageId: page.id,
        ownerSectionId: booking.id,
        reasonBySectionId: Object.fromEntries(featured.map(section => [section.id, reason])),
        suppressedSectionIds: featured.map(section => section.id),
      };
      for (const section of featured) {
        addSuppression(section, 'service_marketing', booking, true, reason);
      }
    } else {
      assignPageUnique('service_marketing', ['featured_services']);
    }
    assignPageUnique('team_profiles', ['team']);
    assignPageUnique('reviews', ['reviews']);
    assignPageUnique('custom_design', ['custom_design']);
  }

  const renderedFeatured = candidates.filter(section => (
    section.sectionType === 'featured_services'
    && !sectionSuppressions[section.id]?.some(notice => notice.suppressEntireSection)
  ));

  const suppressWhenNoUniqueContent = (
    type: SectionType,
    keys: readonly SiteContentKey[],
    reason: string,
  ) => {
    for (const section of byType(type)) {
      const ownsContent = keys.some(key => (
        getContentPlacementFromRecords(placements, pagePlacements, key, section.pageId)
          .ownerSectionId === section.id
      ));
      if (!ownsContent) {
        addSuppression(section, keys[0] ?? 'location', null, true, reason);
      }
    }
  };
  suppressWhenNoUniqueContent('contact', [
    'instagram',
    'phone',
    'text',
    'email',
    'location',
    'business_hours',
  ], 'Contact is not shown because its shared details are already shown elsewhere.');
  suppressWhenNoUniqueContent('visit_us', [
    'location',
    'arrival_details',
    'business_hours',
    'phone',
    'text',
    'email',
  ], 'Visit Us is not shown because its shared details are already shown elsewhere.');
  suppressWhenNoUniqueContent('quick_info', [
    'location',
    'business_hours',
    'appointment_mode',
    'new_client_status',
    'minimum_notice',
  ], 'Quick Info is not shown because its shared facts are already shown elsewhere.');

  return {
    pagePlacements,
    placements,
    sectionSuppressions,
    showBookingFeaturedRail: renderedFeatured.length === 0,
    version: SITE_CONTENT_PLACEMENT_VERSION,
  };
};

export const getContentPlacement = (
  plan: SiteContentPlacementPlan,
  key: SiteContentKey,
  pageId?: string,
): ContentPlacement => pageId
  ? getContentPlacementFromRecords(plan.placements, plan.pagePlacements, key, pageId)
  : plan.placements[key];

export const sectionOwnsContent = (
  plan: SiteContentPlacementPlan,
  key: SiteContentKey,
  sectionId: ContentPlacementOwner,
  pageId?: string,
): boolean => getContentPlacement(plan, key, pageId).ownerSectionId === sectionId;

export const getSectionContentSuppressions = (
  plan: SiteContentPlacementPlan,
  sectionId: string,
): readonly SectionContentSuppression[] => plan.sectionSuppressions[sectionId] ?? [];
