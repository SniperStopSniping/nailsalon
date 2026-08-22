import type {
  BookingPageLayout,
  SectionId,
} from '@/libs/bookingPageConfig';
import type { SalonContent } from '@/libs/salonContent';

/**
 * Client-safe Stage 4 presentation contract.
 *
 * This module deliberately imports the persisted booking-page types with
 * `import type`: `bookingPageConfig.ts` owns DB resolution/writes and must not
 * enter the client graph. Presentation variants are enum selectors only; they
 * never become component names, CSS, visibility rules, or owner diagnostics.
 */

export const SECTION_PRESENTATION_CONTRACT = {
  salonProfile: {
    variants: ['compact', 'hero_image'],
    defaults: { quick_book: 'compact', editorial: 'hero_image' },
    placement: { quick_book: 'flow', editorial: 'flow' },
  },
  technicianProfile: {
    variants: ['full', 'cards'],
    defaults: { quick_book: 'full', editorial: 'full' },
    placement: { quick_book: 'flow', editorial: 'flow' },
  },
  featuredServices: {
    variants: ['carousel', 'signature'],
    defaults: { quick_book: 'carousel', editorial: 'signature' },
    placement: { quick_book: 'serviceMenuSlot', editorial: 'flow' },
  },
  serviceMenu: {
    variants: ['list', 'grouped_categories'],
    defaults: { quick_book: 'list', editorial: 'list' },
    placement: { quick_book: 'flow', editorial: 'flow' },
  },
  whatsIncluded: {
    variants: [],
    defaults: { quick_book: null, editorial: null },
    placement: { quick_book: 'unsupported', editorial: 'unsupported' },
  },
  technicianList: {
    variants: [],
    defaults: { quick_book: null, editorial: null },
    placement: { quick_book: 'unsupported', editorial: 'unsupported' },
  },
  portfolio: {
    variants: [],
    defaults: { quick_book: null, editorial: null },
    placement: { quick_book: 'unsupported', editorial: 'unsupported' },
  },
  reviews: {
    variants: [],
    defaults: { quick_book: null, editorial: null },
    placement: { quick_book: 'unsupported', editorial: 'unsupported' },
  },
  hoursLocation: {
    variants: ['full', 'location_cards'],
    defaults: { quick_book: 'full', editorial: 'full' },
    placement: { quick_book: 'flow', editorial: 'flow' },
  },
  policies: {
    variants: ['card', 'inline'],
    defaults: { quick_book: 'card', editorial: 'inline' },
    placement: { quick_book: 'serviceMenuSlot', editorial: 'flow' },
  },
  socialLinks: {
    variants: ['icons', 'labeled'],
    defaults: { quick_book: 'icons', editorial: 'icons' },
    placement: { quick_book: 'serviceMenuSlot', editorial: 'serviceMenuSlot' },
  },
  bookingCta: {
    variants: ['sticky'],
    defaults: { quick_book: 'sticky', editorial: 'sticky' },
    placement: { quick_book: 'system', editorial: 'system' },
  },
} as const satisfies Record<SectionId, {
  variants: readonly string[];
  defaults: Record<RenderableLayout, string | null>;
  placement: Record<RenderableLayout, SectionPlacementKind>;
}>;

export type RenderableLayout = 'quick_book' | 'editorial';
export type SectionPlacementKind = 'flow' | 'serviceMenuSlot' | 'system' | 'unsupported';
export type SectionVariantId<S extends SectionId> = (typeof SECTION_PRESENTATION_CONTRACT)[S]['variants'][number];
export type SectionVariantOverrides = Partial<{
  [S in SectionId]: SectionVariantId<S>;
}>;
export type ResolvedSectionVariantMap = {
  [S in SectionId]: SectionVariantId<S> | null;
};
export type ResolvedSectionPlacementMap = Record<SectionId, SectionPlacementKind>;

export type SectionPresentationPlan = {
  layout: RenderableLayout;
  pageFrame: 'compact' | 'editorial';
  serviceMenuFrame: 'plain' | 'services-anchor';
  bookingAccess: 'continue' | 'editorial-handoff';
  variants: ResolvedSectionVariantMap;
  placements: ResolvedSectionPlacementMap;
};

export type ResolveSectionPresentationInput = {
  layout: BookingPageLayout | string | null | undefined;
  sectionVariants: unknown;
  content: Pick<SalonContent, 'identity'>;
};

export const SECTION_PRESENTATION_SECTION_IDS = Object.keys(SECTION_PRESENTATION_CONTRACT) as SectionId[];
const SECTION_VARIANT_LAYOUT_ALLOWLIST = {
  salonProfile: { quick_book: ['compact'], editorial: ['compact', 'hero_image'] },
  technicianProfile: { quick_book: ['full', 'cards'], editorial: ['full', 'cards'] },
  featuredServices: { quick_book: ['carousel'], editorial: ['carousel', 'signature'] },
  serviceMenu: { quick_book: ['list', 'grouped_categories'], editorial: ['list', 'grouped_categories'] },
  whatsIncluded: { quick_book: [], editorial: [] },
  technicianList: { quick_book: [], editorial: [] },
  portfolio: { quick_book: [], editorial: [] },
  reviews: { quick_book: [], editorial: [] },
  hoursLocation: { quick_book: ['full', 'location_cards'], editorial: ['full', 'location_cards'] },
  policies: { quick_book: ['card'], editorial: ['card', 'inline'] },
  socialLinks: { quick_book: ['icons', 'labeled'], editorial: ['icons', 'labeled'] },
  bookingCta: { quick_book: ['sticky'], editorial: ['sticky'] },
} as const satisfies Record<SectionId, Record<RenderableLayout, readonly string[]>>;
const LEGACY_VARIANT_ALIASES: Partial<Record<SectionId, Readonly<Record<string, string>>>> = {
  // The pre-Stage-4 registry advertised `hero` as inert metadata. Accept a
  // stored value without making it a writable canonical ID.
  salonProfile: { hero: 'hero_image' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveRenderableLayout(layout: ResolveSectionPresentationInput['layout']): RenderableLayout {
  // All three historical, no-longer-writable layout values have always used
  // Quick Book public behavior. Keep that compatibility explicit.
  return layout === 'editorial' ? 'editorial' : 'quick_book';
}

export function isSupportedSectionVariant<S extends SectionId>(
  sectionId: S,
  value: unknown,
): value is SectionVariantId<S> {
  return typeof value === 'string'
    && (SECTION_PRESENTATION_CONTRACT[sectionId].variants as readonly string[]).includes(value);
}

/**
 * Client-safe owner/builder view of the same compatibility matrix the public
 * resolver enforces. A control must never advertise a variant that the
 * renderer would immediately replace with a layout fallback.
 */
export function getAllowedSectionVariants<S extends SectionId>(
  sectionId: S,
  rawLayout: ResolveSectionPresentationInput['layout'],
): readonly SectionVariantId<S>[] {
  const layout = resolveRenderableLayout(rawLayout);

  return SECTION_VARIANT_LAYOUT_ALLOWLIST[sectionId][layout] as readonly SectionVariantId<S>[];
}

export function isSectionVariantAllowedForLayout<S extends SectionId>(
  sectionId: S,
  variant: unknown,
  rawLayout: ResolveSectionPresentationInput['layout'],
): variant is SectionVariantId<S> {
  return isSupportedSectionVariant(sectionId, variant)
    && (getAllowedSectionVariants(sectionId, rawLayout) as readonly string[]).includes(variant);
}

export function getSectionPresentationPlacement(
  sectionId: SectionId,
  rawLayout: ResolveSectionPresentationInput['layout'],
): SectionPlacementKind {
  return SECTION_PRESENTATION_CONTRACT[sectionId].placement[resolveRenderableLayout(rawLayout)];
}

export function deriveSalonProfileHeroAlt(identity: Pick<SalonContent['identity'], 'name'>): string {
  return `${identity.name.trim()} salon`;
}

export const SALON_PROFILE_HERO_IMAGE_CONTRACT = {
  variant: 'hero_image',
  altStrategy: 'derived-canonical-identity',
} as const;

/**
 * Stage 5's grouped service vocabulary carries its UIQI obligation beside the
 * variant that activates it. The renderer evidence must use real headings;
 * styled generic containers cannot satisfy this strategy declaration.
 */
export const SERVICE_MENU_GROUPED_CATEGORIES_CONTRACT = {
  variant: 'grouped_categories',
  headingStrategy: 'semantic-heading-structure',
} as const;

function resolveRequestedVariant(
  sectionId: SectionId,
  rawValue: unknown,
): string | null {
  if (isSupportedSectionVariant(sectionId, rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === 'string') {
    const alias = LEGACY_VARIANT_ALIASES[sectionId]?.[rawValue];
    if (alias && isSupportedSectionVariant(sectionId, alias)) {
      return alias;
    }
  }
  return null;
}

export function resolveSectionPresentation({
  layout: rawLayout,
  sectionVariants: rawSectionVariants,
  content,
}: ResolveSectionPresentationInput): SectionPresentationPlan {
  const layout = resolveRenderableLayout(rawLayout);
  const requested = isRecord(rawSectionVariants) ? rawSectionVariants : {};
  const variants = {} as ResolvedSectionVariantMap;
  const placements = {} as ResolvedSectionPlacementMap;

  for (const sectionId of SECTION_PRESENTATION_SECTION_IDS) {
    const definition = SECTION_PRESENTATION_CONTRACT[sectionId];
    placements[sectionId] = definition.placement[layout];

    if (definition.variants.length === 0) {
      variants[sectionId] = null;
      continue;
    }

    const resolvedRequest = resolveRequestedVariant(sectionId, requested[sectionId]);
    const layoutDefault = definition.defaults[layout];
    const requestedVariantIsLayoutCompatible = resolvedRequest !== null
      && isSectionVariantAllowedForLayout(sectionId, resolvedRequest, layout);
    let variant = requestedVariantIsLayoutCompatible ? resolvedRequest : layoutDefault;

    // The hero is a presentation enhancement, never a readiness/visibility
    // gate. With no canonical image it deterministically degrades to the
    // compact identity renderer instead of producing an empty frame.
    if (sectionId === 'salonProfile' && variant === 'hero_image' && !content.identity.heroImageUrl?.trim()) {
      variant = 'compact';
    }

    variants[sectionId] = variant as never;
  }

  const editorial = layout === 'editorial';
  return {
    layout,
    pageFrame: editorial ? 'editorial' : 'compact',
    serviceMenuFrame: editorial ? 'services-anchor' : 'plain',
    bookingAccess: editorial ? 'editorial-handoff' : 'continue',
    variants,
    placements,
  };
}

/**
 * Stage 3 named obligations become real release inputs here. The capability
 * declaration is enforced against the shipped renderer by the UIQI evidence
 * bundle: the architecture guard requires the canonical helper at the hero
 * image seam, pins its resulting accessible name, and verifies that grouped
 * service categories use labelled semantic headings. No owner alt field exists
 * or crosses the anonymous boundary.
 */
export const SECTION_PRESENTATION_UIQI_CAPABILITIES = {
  salonProfileHeroImage: SECTION_PRESENTATION_CONTRACT.salonProfile.variants.includes(
    SALON_PROFILE_HERO_IMAGE_CONTRACT.variant,
  ),
  salonProfileHeroDerivedAlt:
    SALON_PROFILE_HERO_IMAGE_CONTRACT.altStrategy === 'derived-canonical-identity',
  serviceMenuGroupedCategories: SECTION_PRESENTATION_CONTRACT.serviceMenu.variants.includes(
    SERVICE_MENU_GROUPED_CATEGORIES_CONTRACT.variant,
  ),
  serviceMenuGroupedSemanticHeadings:
    SERVICE_MENU_GROUPED_CATEGORIES_CONTRACT.headingStrategy === 'semantic-heading-structure',
} as const;
