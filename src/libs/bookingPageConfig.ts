/**
 * bookingPage modular config contract (Luster UI/UX plan rev 3, section 4A.C).
 *
 * This module owns the versioned persisted shape, safe resolution,
 * section-order safety net, and targeted draft writer. The public renderer
 * consumes only the validated page layout/order/visibility, independent
 * `serviceMenuLayout`, and `sectionVariants` presentation seams; `stylePack`
 * and `tokenOverrides` deliberately remain renderer-inert until their
 * separately entitled release boundary.
 *
 * Mirrors the pattern in src/libs/bookingExperience.ts: a DEFAULTS constant,
 * zod schemas, a resolver that uses zod safeParse with a documented
 * catch-all fallback instead of throwing, and reuse (never reimplementation)
 * of the shared colour/contrast helpers.
 */

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  CANONICAL_HEX_COLOR,
  getAccessibleBookingForeground,
  getBookingExperienceCssVariables,
  getColorContrastRatio,
} from '@/libs/bookingExperience';
import {
  applyBookingPageBuilderOperation,
  type BookingPageBuilderErrorCode,
  type BookingPageBuilderOperation,
  type BookingPagePresentationPatch,
  type BookingPagePresentationState,
  resolveBookingPageStartingPresentation,
} from '@/libs/bookingPageBuilder';
import {
  BOOKING_PAGE_PRESET_IDS,
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  type BookingPagePresetReference,
  isBookingPagePresetRecipeVersion,
  resolveBookingPagePresetRecipe,
} from '@/libs/bookingPagePresetRecipes';
import {
  CUSTOMER_SITE_PALETTE_PRESETS,
  CUSTOMER_SITE_STYLE_PRESETS,
  type CustomerSitePalettePreset,
  type CustomerSiteStylePreset,
  resolveCustomerSitePalettePreset,
  resolveCustomerSiteStylePreset,
} from '@/libs/customerSitePresentation';
import { db } from '@/libs/DB';
import {
  DEFAULT_QUICK_BOOK_SITE_LAYOUT,
  QUICK_BOOK_SITE_LAYOUTS,
  type QuickBookSiteLayout,
  resolveQuickBookSiteLayout,
} from '@/libs/quickBookSiteLayout';
import {
  isSupportedSectionVariant,
  type SectionVariantOverrides,
} from '@/libs/sectionPresentation';
import {
  DEFAULT_SERVICE_MENU_LAYOUT,
  resolveServiceMenuLayout,
  SERVICE_MENU_LAYOUTS,
  type ServiceMenuLayout,
} from '@/libs/serviceMenuLayout';
import { salonSchema } from '@/models/Schema';

// The full "one appearance pipeline" (plan section 4A.D) is:
//   stylePack preset → tokenOverrides → validate (CANONICAL_HEX_COLOR,
//   getColorContrastRatio, getAccessibleBookingForeground) → resolved
//   EspressoTheme → getBookingExperienceCssVariables().
// Style-pack resolution and CSS-variable emission are PR 20 / rendering-PR
// concerns, not this PR's — nothing here computes contrast or emits CSS yet.
// These three are re-exported (not reimplemented) purely so a later PR can
// pull the whole pipeline's helpers from this one module; only
// CANONICAL_HEX_COLOR is actually consumed below, by accentColorSchema.
export {
  getAccessibleBookingForeground,
  getBookingExperienceCssVariables,
  getColorContrastRatio,
};

// =============================================================================
// SECTION REGISTRY IDS
// =============================================================================

/**
 * The 12 stable section IDs shared by persistence, the Stage 2 semantic
 * registry and the Stage 4 presentation contract. This module owns the
 * closed persisted ID set used to validate sectionOrder/hiddenSections.
 */
export const SECTION_IDS = [
  'salonProfile',
  'technicianProfile',
  'featuredServices',
  'serviceMenu',
  'whatsIncluded',
  'technicianList',
  'portfolio',
  'reviews',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

const SECTION_ID_SET: ReadonlySet<string> = new Set(SECTION_IDS);

function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && SECTION_ID_SET.has(value);
}

/**
 * `serviceMenu` hosts the one shared booking engine; `bookingCta` is the only
 * always-available entry point into it; `salonProfile` is the one section
 * that hosts the page's only `<h1>` on both layouts (Quick Book's via
 * `BookingStepHeader`, Editorial's via its hero heading — see
 * `BookServiceClient.tsx`). None of the three may ever be removed from
 * sectionOrder or added to hiddenSections — see validateSectionOrder below.
 *
 * Post-launch fix: `salonProfile` was missing from this set, so a crafted
 * authenticated `PATCH { config: { hiddenSections: ['salonProfile'] } }`
 * persisted and published, deleting the page's only heading (a WCAG
 * heading-structure failure) — the SAME hiddenSections-floor bug this
 * constant already closed for `serviceMenu`/`bookingCta`, just not extended
 * to this id yet. `salonProfile.canRender` (`@/libs/sectionRegistry`) is a
 * separate, independent gate this floor does NOT reach — it stays
 * conditional on the salon having a non-empty name, which a real resolved
 * salon always does (see that entry's own comment); this floor only
 * guarantees the id survives sectionOrder/hiddenSections, not that it always
 * visually renders.
 */
const REQUIRED_SECTION_IDS: readonly SectionId[] = ['salonProfile', 'serviceMenu', 'bookingCta'];

// =============================================================================
// LAYOUT / STYLE PACK / MODE ENUMS
// =============================================================================

export const BOOKING_PAGE_LAYOUTS = [
  'quick_book',
  'editorial',
  'tech_profile',
  'portfolio',
  'catalogue',
] as const;

export type BookingPageLayout = (typeof BOOKING_PAGE_LAYOUTS)[number];

/**
 * Style packs are registered by key (PR 20 adds real packs — soft_luxury,
 * clean_studio, bold_art, soft_beauty, dark_premium, warm_classic). Only
 * `default` renders anything today. The type stays a plain `string` (per
 * spec) so registering a new pack later never requires a schema change here;
 * an *unregistered* key still resolves safely to `default` below rather than
 * being trusted, since no pack implementation exists yet to honour it.
 */
export const REGISTERED_STYLE_PACKS = ['default'] as const;
export type StylePack = string;
const DEFAULT_STYLE_PACK: StylePack = 'default';

export const BUSINESS_MODES = ['solo', 'team'] as const;
export type BusinessMode = (typeof BUSINESS_MODES)[number];

export const START_MODES = ['services_first', 'staff_first'] as const;
export type StartMode = (typeof START_MODES)[number];

// =============================================================================
// TOKEN OVERRIDES
// =============================================================================

export type BookingPageTokenOverrides = {
  accentColor?: string | null;
  fontPairing?: string | null;
  cardStyle?: string | null;
  buttonStyle?: string | null;
  imageStyle?: string | null;
};

// =============================================================================
// QUICK BOOK PROFILE VISIBILITY
// =============================================================================

/**
 * Presentation-only public visibility for the compact Quick Book profile.
 *
 * The values themselves continue to live in their canonical salon, staff,
 * contact, hours, policy and social-profile authorities. These switches only
 * decide whether Quick Book may present those values; switching templates
 * must never copy, delete, or otherwise mutate the underlying information.
 *
 * Every flag deliberately defaults to false. Older salons did not consent to
 * this new compact profile exposing stored contact or business information,
 * so a missing or malformed stored value always resolves private.
 */
export type QuickBookProfileVisibilityValues = {
  showTechName: boolean;
  showTechPhoto: boolean;
  showLocation: boolean;
  showHours: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showBookingPolicy: boolean;
  showCancellationPolicy: boolean;
  showReviews: boolean;
  showInstagram: boolean;
  showBio: boolean;
};

export type QuickBookProfileVisibility = QuickBookProfileVisibilityValues & {
  /**
   * Marks adoption of the compact Quick Book profile presentation.
   *
   * This is intentionally optional in the TypeScript shape so the resolver
   * can recognize the predecessor unversioned boolean object. Resolved legacy
   * sides use version 0; new defaults and every profile write use version 1.
   */
  version?: 0 | 1;
};

export type QuickBookProfileVisibilityPatch = Partial<QuickBookProfileVisibilityValues>;

function createDefaultQuickBookProfileVisibility(): QuickBookProfileVisibility {
  return {
    version: 1,
    showTechName: false,
    showTechPhoto: false,
    showLocation: false,
    showHours: false,
    showPhone: false,
    showEmail: false,
    showBookingPolicy: false,
    showCancellationPolicy: false,
    showReviews: false,
    showInstagram: false,
    showBio: false,
  };
}

export const QUICK_BOOK_PROFILE_VISIBILITY_DEFAULTS: QuickBookProfileVisibility
  = createDefaultQuickBookProfileVisibility();

// =============================================================================
// SIDE SHAPE (identical for draft and live)
// =============================================================================

export type BookingPageConfigSide = {
  layout: BookingPageLayout;
  /** Free customer-site colour selected during onboarding; not a premium token override. */
  sitePalettePreset?: CustomerSitePalettePreset;
  /** Free customer-site visual character selected during onboarding; not a premium style pack. */
  siteStylePreset?: CustomerSiteStylePreset;
  /** Presentation of canonical business data above Quick Book's service menu. */
  quickBookLayout?: QuickBookSiteLayout;
  /** Presentation of the canonical catalogue inside the shared booking engine. */
  serviceMenuLayout: ServiceMenuLayout;
  stylePack: StylePack;
  tokenOverrides: BookingPageTokenOverrides | null;
  sectionOrder: SectionId[];
  sectionVariants: Partial<Record<SectionId, string>>;
  hiddenSections: SectionId[];
  businessMode: BusinessMode;
  startMode: StartMode;
  quickBookProfile: QuickBookProfileVisibility;
};

export type BookingPageConfig = {
  version: 1;
  draft: BookingPageConfigSide;
  live: BookingPageConfigSide;
  /** Admin-only recipe provenance, kept outside the anonymous renderer side. */
  draftPresetBase: BookingPagePresetReference | null;
  /** Published counterpart copied atomically with `live`. */
  livePresetBase: BookingPagePresetReference | null;
};

// =============================================================================
// DEFAULTS — reproduce current rendering exactly. No visual change on merge.
// =============================================================================

/**
 * Every layout currently resolves to this same section order. Only
 * `quick_book` actually renders today (this PR's DEFAULTS mirror the
 * existing, unconditional booking page exactly), so there is no curated
 * per-layout default yet to fall back to. Layout-specific default orders
 * arrive with the section registry and each layout's own PR; until then all
 * five layout keys intentionally share this array. Recorded as a documented
 * decision, not an oversight.
 */
const DEFAULT_SECTION_ORDER: readonly SectionId[]
  = resolveBookingPageStartingPresentation('quick_book').sectionOrder;

/**
 * Editorial's own default section order (Luster UI/UX plan rev 3, PR 6,
 * section 6 wireframe): hero/profile image (with fallback to the Quick Book
 * identity band — a rendering-time decision, not a config one) → featured
 * services near the top → About the tech → portfolio/reviews (registered
 * here, not omitted from the order, so PR 10 only has to add data — both
 * always resolve to omitted today via `canRender`, since
 * `SalonContent.proof` is always empty until then) → the SAME serviceMenu
 * engine block Quick Book uses, anchored for Skip-to-services → Visit
 * (hoursLocation) → policies → bookingCta (symbolic placement only — the
 * actual sticky mobile CTA hands off to the existing sticky Continue bar and
 * is rendered outside the section-order flow entirely, same as Quick Book's
 * sticky Continue bar; see BookServiceClient.tsx).
 */
const EDITORIAL_SECTION_ORDER: readonly SectionId[]
  = resolveBookingPageStartingPresentation('editorial').sectionOrder;

// PR 6's Editorial default omitted socialLinks from the stored order even
// though the renderer always embedded authored links inside serviceMenu.
// Stage 4 makes every pixel-producing stored section flow through the
// canonical plan, so the exact legacy default signature is repaired on read
// to preserve those existing pixels without keeping the renderer bypass.
const LEGACY_EDITORIAL_SECTION_ORDER: readonly SectionId[] = [
  'salonProfile',
  'featuredServices',
  'technicianProfile',
  'portfolio',
  'reviews',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'bookingCta',
];

function layoutDefaultSectionOrder(layout: BookingPageLayout): SectionId[] {
  if (layout === 'editorial') {
    return [...EDITORIAL_SECTION_ORDER];
  }
  return [...DEFAULT_SECTION_ORDER];
}

function createDefaultSide(): BookingPageConfigSide {
  return {
    layout: 'quick_book',
    quickBookLayout: DEFAULT_QUICK_BOOK_SITE_LAYOUT,
    serviceMenuLayout: DEFAULT_SERVICE_MENU_LAYOUT,
    stylePack: DEFAULT_STYLE_PACK,
    tokenOverrides: null,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    sectionVariants: {},
    hiddenSections: [],
    businessMode: 'solo',
    startMode: 'services_first',
    quickBookProfile: createDefaultQuickBookProfileVisibility(),
  };
}

/**
 * Frozen reference for equality checks / documentation. Always clone (via
 * createDefaultSide / createDefaultConfig) before handing a default out to a
 * caller that might merge or mutate it — arrays here are shared.
 */
export const BOOKING_PAGE_CONFIG_SIDE_DEFAULTS: BookingPageConfigSide = createDefaultSide();

export function createDefaultBookingPageConfig(): BookingPageConfig {
  const quickBookPresetBase = {
    presetId: 'quick_book',
    recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
  } as const satisfies BookingPagePresetReference;

  return {
    version: 1,
    draft: createDefaultSide(),
    live: createDefaultSide(),
    draftPresetBase: { ...quickBookPresetBase },
    livePresetBase: { ...quickBookPresetBase },
  };
}

export const BOOKING_PAGE_CONFIG_DEFAULTS: BookingPageConfig = createDefaultBookingPageConfig();

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveWithDefault<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

const layoutSchema = z.enum(BOOKING_PAGE_LAYOUTS);
const sitePalettePresetSchema = z.enum(CUSTOMER_SITE_PALETTE_PRESETS);
const siteStylePresetSchema = z.enum(CUSTOMER_SITE_STYLE_PRESETS);
const quickBookSiteLayoutSchema = z.enum(QUICK_BOOK_SITE_LAYOUTS);
const serviceMenuLayoutSchema = z.enum(SERVICE_MENU_LAYOUTS);

/**
 * S4 (Stage 1) — the layouts a NEW write may set.
 *
 * `BOOKING_PAGE_LAYOUTS` still declares all five keys and `layoutSchema` still
 * ACCEPTS all five on READ, deliberately: `resolveBookingPageConfig` resolves a
 * stored layout through `resolveWithDefault(layoutSchema, ...)`, so a legacy row
 * holding `tech_profile` / `portfolio` / `catalogue` keeps parsing and keeps
 * rendering through the documented shared fallback. Nothing 500s and no
 * migration is required.
 *
 * What changes is only that the three unimplemented keys can no longer be
 * WRITTEN. The admin UI already refuses them; this closes the API-level gap so
 * a direct PATCH can no longer persist a layout that silently renders something
 * else. Add a key here in the same PR that gives it a real renderer.
 */
export const WRITABLE_BOOKING_PAGE_LAYOUTS = [
  'quick_book',
  'editorial',
] as const satisfies readonly BookingPageLayout[];

const writableLayoutSchema = z.enum(WRITABLE_BOOKING_PAGE_LAYOUTS);
const businessModeSchema = z.enum(BUSINESS_MODES);
const startModeSchema = z.enum(START_MODES);
const sectionIdSchema = z.enum(SECTION_IDS);
const bookingPagePresetReferenceSchema = z.object({
  presetId: z.enum(BOOKING_PAGE_PRESET_IDS),
  recipeVersion: z.custom<BookingPagePresetReference['recipeVersion']>(
    isBookingPagePresetRecipeVersion,
    'Unsupported preset recipe version',
  ),
}).strict();

/**
 * Registered-only for now: an unregistered key is treated the same as a
 * missing one (falls back to `default`) because no pack implementation
 * exists yet to render it. Extending REGISTERED_STYLE_PACKS in PR 20 is the
 * only change needed to accept a new key — this schema does not otherwise
 * change shape (`StylePack` stays a plain string on the type level).
 */
const stylePackSchema = z.enum(REGISTERED_STYLE_PACKS);

const accentColorSchema = z.union([z.string(), z.null()]).transform((value, context) => {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === '') {
    return null;
  }
  if (!CANONICAL_HEX_COLOR.test(normalized)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'accentColor must use the #RRGGBB format',
    });
    return z.NEVER;
  }
  return normalized;
});

const nullableTokenStringSchema = z.union([z.string(), z.null()]).transform((value) => {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
});

const tokenOverridesObjectSchema = z.object({
  accentColor: accentColorSchema.optional(),
  fontPairing: nullableTokenStringSchema.optional(),
  cardStyle: nullableTokenStringSchema.optional(),
  buttonStyle: nullableTokenStringSchema.optional(),
  imageStyle: nullableTokenStringSchema.optional(),
});

const tokenOverridesSchema = tokenOverridesObjectSchema.nullable();

const sectionIdArraySchema = z.array(sectionIdSchema);
// z.record already treats every key as optional at parse time (an empty
// object and a partial object both pass) while rejecting any key outside the
// enum, which is exactly Partial<Record<SectionId, string>>.
const sectionVariantsSchema = z.record(sectionIdSchema, z.string().min(1)).superRefine((value, context) => {
  for (const [sectionId, variant] of Object.entries(value)) {
    if (!isSupportedSectionVariant(sectionId as SectionId, variant)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [sectionId],
        message: `${variant} is not a supported ${sectionId} presentation variant`,
      });
    }
  }
}).transform(value => value as SectionVariantOverrides);

const quickBookProfileVisibilitySchema = z.object({
  version: z.union([z.literal(0), z.literal(1)]).optional(),
  showTechName: z.boolean(),
  showTechPhoto: z.boolean(),
  showLocation: z.boolean(),
  showHours: z.boolean(),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showBookingPolicy: z.boolean(),
  showCancellationPolicy: z.boolean(),
  showReviews: z.boolean(),
  showInstagram: z.boolean(),
  showBio: z.boolean(),
}).strict();

const quickBookProfileVisibilityPatchSchema = quickBookProfileVisibilitySchema
  .omit({ version: true })
  .partial()
  .strict();

/**
 * Full, non-partial side schema. Used to validate a caller-supplied draft
 * patch wholesale (see updateBookingPageDraft) — invalid patches are the
 * caller's contract violation and are expected to have been validated
 * upstream by a route before this helper is ever called, so this schema
 * intentionally does not swallow errors the way resolveBookingPageConfig's
 * per-field resolution does.
 */
const bookingPageSideSchema = z.object({
  layout: layoutSchema,
  sitePalettePreset: sitePalettePresetSchema.optional(),
  siteStylePreset: siteStylePresetSchema.optional(),
  quickBookLayout: quickBookSiteLayoutSchema.optional(),
  serviceMenuLayout: serviceMenuLayoutSchema,
  stylePack: stylePackSchema,
  tokenOverrides: tokenOverridesSchema,
  sectionOrder: sectionIdArraySchema,
  sectionVariants: sectionVariantsSchema,
  hiddenSections: sectionIdArraySchema,
  businessMode: businessModeSchema,
  startMode: startModeSchema,
  quickBookProfile: quickBookProfileVisibilitySchema,
});

export type WritableBookingPageLayout = (typeof WRITABLE_BOOKING_PAGE_LAYOUTS)[number];

export type BookingPageDraftPatch = Omit<
  Partial<BookingPageConfigSide>,
  'layout' | 'quickBookProfile' | 'sectionVariants'
> & {
  /**
   * S4 (Stage 1) — narrowed at the TYPE level as well as at runtime, so a
   * direct `updateBookingPageDraft` caller writing an unimplemented layout is
   * a compile error rather than a runtime zod throw.
   */
  layout?: WritableBookingPageLayout;
  /** New writes accept only section-compatible canonical variant IDs. */
  sectionVariants?: SectionVariantOverrides;
  /** Merge-only Quick Book presentation switches; omitted flags are preserved. */
  quickBookProfile?: QuickBookProfileVisibilityPatch;
  /**
   * S2 (Stage 1) — the ONLY way to replace `sectionOrder`/`hiddenSections`
   * with the selected layout's defaults. Absent means preserve.
   */
  resetPresentation?: true;
};

export const bookingPageDraftPatchSchema = bookingPageSideSchema
  .partial()
  .extend({
    // S4: writes are restricted to implemented layouts. Reads are not.
    layout: writableLayoutSchema.optional(),
    quickBookProfile: quickBookProfileVisibilityPatchSchema.optional(),
    // S2: an explicit, narrowly named intent. `z.literal(true)` means a caller
    // cannot ask for a reset by accident with a falsy value, and the key is
    // never persisted into the stored side — it only selects a branch below.
    resetPresentation: z.literal(true).optional(),
  })
  .strict();

export const bookingPageBuilderOperationSchema: z.ZodType<BookingPageBuilderOperation> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_visibility'),
    sectionId: sectionIdSchema,
    visible: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal('move_section'),
    sectionId: sectionIdSchema,
    targetSectionId: sectionIdSchema,
    direction: z.enum(['up', 'down']),
  }).strict(),
  z.object({
    type: z.literal('set_variant'),
    sectionId: sectionIdSchema,
    variant: z.string().min(1).nullable(),
  }).strict(),
  z.object({
    type: z.literal('reset_section'),
    sectionId: sectionIdSchema,
  }).strict(),
  z.object({
    type: z.literal('reset_all'),
    expectedPresentationSignature: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('apply_preset'),
    presetId: z.enum(BOOKING_PAGE_PRESET_IDS),
    presetVersion: z.literal(BOOKING_PAGE_PRESET_RECIPE_VERSION),
    expectedPresentationSignature: z.string().min(1),
  }).strict(),
]);

type BookingPageBuilderWriteOptions = {
  builderOperation: BookingPageBuilderOperation;
};

export class BookingPageBuilderWriteError extends Error {
  readonly code: BookingPageBuilderErrorCode;

  constructor(code: BookingPageBuilderErrorCode) {
    super(`Booking page builder write failed: ${code}`);
    this.name = 'BookingPageBuilderWriteError';
    this.code = code;
  }
}

type PersistableBookingPageDraftPatch = Omit<BookingPageDraftPatch, 'sectionVariants'> & {
  sectionVariants?: Partial<Record<SectionId, string>>;
  presetBase?: BookingPagePresetReference | null;
};

const preservedSectionVariantsSchema = z.record(sectionIdSchema, z.string().min(1));

function validateBuilderSectionVariantSnapshot(
  value: unknown,
  current: BookingPageConfigSide['sectionVariants'],
  operation: BookingPageBuilderOperation,
): BookingPageConfigSide['sectionVariants'] {
  const next = preservedSectionVariantsSchema.parse(value);
  const targetMayChange = operation.type === 'set_variant' || operation.type === 'reset_section'
    ? operation.sectionId
    : null;

  for (const sectionId of SECTION_IDS) {
    const currentValue = current[sectionId];
    const nextValue = next[sectionId];

    if (operation.type !== 'reset_all'
      && operation.type !== 'apply_preset'
      && sectionId !== targetMayChange
      && currentValue !== nextValue) {
      throw new Error(`Builder operation changed unrelated ${sectionId} presentation state`);
    }

    // A semantic builder operation may carry an unsupported value only when
    // it is preserving the exact legacy/future string already stored for
    // that known section. New values still require the canonical contract.
    if (nextValue !== undefined
      && !isSupportedSectionVariant(sectionId, nextValue)
      && currentValue !== nextValue) {
      throw new Error(`Builder operation introduced unsupported ${sectionId} presentation state`);
    }
  }

  return next;
}

// =============================================================================
// C.2 — validateSectionOrder (safety critical)
// =============================================================================

/**
 * Enforces the one load-bearing invariant of the config contract: booking
 * must always be reachable, with a heading, at every layout. Real, enforced
 * logic (not a comment):
 *
 *  1. Strips any ID that is not one of the 12 registered SECTION_IDS.
 *  2. Removes duplicates, keeping the first occurrence.
 *  3. Removes `salonProfile` / `serviceMenu` / `bookingCta` from
 *     hiddenSections — none of the three can ever be hidden.
 *  4. Guarantees all three are present in the final order: `salonProfile` is
 *     inserted at the FRONT if missing (it hosts the page's only `<h1>` on
 *     both layouts — appending it after `serviceMenu`/`bookingCta` like the
 *     other two would push the salon header below the service menu instead
 *     of just being a harmless reorder), then `serviceMenu`/`bookingCta` are
 *     appended if still missing (in that order) rather than dropping the
 *     rest of an otherwise-valid order.
 *  5. If, after stripping unknown IDs, nothing usable survives (empty array
 *     or non-array input), the order falls back entirely to the layout
 *     default order — hiddenSections is still cleaned independently in that
 *     case, not reset.
 */
export function validateSectionOrder(
  order: readonly unknown[],
  hiddenSections: readonly unknown[],
  layout: BookingPageLayout,
): { sectionOrder: SectionId[]; hiddenSections: SectionId[] } {
  const rawOrder = Array.isArray(order) ? order : [];
  const rawHidden = Array.isArray(hiddenSections) ? hiddenSections : [];

  // Strip unknown IDs, dedupe keeping first occurrence.
  const seenOrder = new Set<SectionId>();
  const cleanedOrder: SectionId[] = [];
  for (const entry of rawOrder) {
    if (isSectionId(entry) && !seenOrder.has(entry)) {
      seenOrder.add(entry);
      cleanedOrder.push(entry);
    }
  }

  const seenHidden = new Set<SectionId>();
  const cleanedHidden: SectionId[] = [];
  for (const entry of rawHidden) {
    if (
      isSectionId(entry)
      && !seenHidden.has(entry)
      // salonProfile/serviceMenu/bookingCta may never be hidden.
      && !REQUIRED_SECTION_IDS.includes(entry)
    ) {
      seenHidden.add(entry);
      cleanedHidden.push(entry);
    }
  }

  const finalOrder = cleanedOrder.length > 0
    ? cleanedOrder
    : layoutDefaultSectionOrder(layout);

  if (
    layout === 'editorial'
    && finalOrder.length === LEGACY_EDITORIAL_SECTION_ORDER.length
    && finalOrder.every((id, index) => id === LEGACY_EDITORIAL_SECTION_ORDER[index])
  ) {
    finalOrder.splice(finalOrder.indexOf('bookingCta'), 0, 'socialLinks');
  }

  // salonProfile carries the page's only <h1> on both layouts. Repairing it
  // back in the SAME way serviceMenu/bookingCta are repaired below —
  // appending to the end — would render the salon header/step-progress
  // BELOW the service menu whenever a stored/crafted sectionOrder omits it;
  // harmless for serviceMenu/bookingCta (bookingCta has no renderer at all,
  // and serviceMenu's position is exactly where an appended id would already
  // want to land in every real default order) but not for a page-top heading.
  // Every real default sectionOrder already places salonProfile first, so
  // inserting it at the front on repair matches that, not just avoids the
  // append bug.
  if (!finalOrder.includes('salonProfile')) {
    finalOrder.unshift('salonProfile');
  } else if (layout === 'quick_book' && finalOrder[0] !== 'salonProfile') {
    // Quick Book's compact salon profile is the page header, not a movable
    // content block. Older or hand-crafted configuration can contain the
    // required id in a stale mid-page position; repair that input instead of
    // rendering the page identity below customer booking controls.
    finalOrder.splice(finalOrder.indexOf('salonProfile'), 1);
    finalOrder.unshift('salonProfile');
  }

  for (const requiredId of REQUIRED_SECTION_IDS) {
    if (!finalOrder.includes(requiredId)) {
      finalOrder.push(requiredId);
    }
  }

  return {
    sectionOrder: finalOrder,
    hiddenSections: cleanedHidden,
  };
}

// =============================================================================
// RESOLUTION — resolveBookingPageConfig (never throws)
// =============================================================================

function resolveTokenOverrides(value: unknown): BookingPageTokenOverrides | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const result = tokenOverridesObjectSchema.safeParse(value);
  // A malformed field anywhere inside tokenOverrides (e.g. an invalid
  // accentColor) discards the whole override object rather than guessing
  // which nested fields were "intended" — safe because no field here has any
  // visual effect until PR 20's style packs land, so the only risk today is
  // an owner-support surprise, not a public-page break.
  return result.success ? result.data : null;
}

function resolveSectionVariants(value: unknown): Partial<Record<SectionId, string>> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Partial<Record<SectionId, string>> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (isSectionId(key) && typeof entryValue === 'string' && entryValue.trim() !== '') {
      result[key] = entryValue;
    }
  }
  return result;
}

function resolvePresetBase(value: unknown): BookingPagePresetReference | null {
  const result = bookingPagePresetReferenceSchema.safeParse(value);
  if (!result.success || !resolveBookingPagePresetRecipe(result.data)) {
    return null;
  }
  return result.data;
}

function resolveStylePack(value: unknown): StylePack {
  if (typeof value !== 'string') {
    return DEFAULT_STYLE_PACK;
  }
  return resolveWithDefault(stylePackSchema, value, DEFAULT_STYLE_PACK);
}

function resolveQuickBookProfileVisibility(value: unknown): QuickBookProfileVisibility {
  const source = isRecord(value) ? value : {};
  const knownVisibilityValues = [
    source.showTechName,
    source.showTechPhoto,
    source.showLocation,
    source.showHours,
    source.showPhone,
    source.showEmail,
    source.showBookingPolicy,
    source.showCancellationPolicy,
    source.showReviews,
    source.showInstagram,
    source.showBio,
  ];
  // Configs written before the explicit marker landed already persisted the
  // full boolean object. Recognize that exact predecessor shape as adopted,
  // but do not treat an absent, empty, malformed, or future-version object as
  // consent to replace the legacy public presentation.
  const adoptedVersion = source.version === 1
    || (source.version === undefined
      && knownVisibilityValues.some(entry => typeof entry === 'boolean'));

  // Resolve every field independently. A malformed sibling must not expose
  // anything or discard a separate explicit consent value.
  return {
    version: adoptedVersion ? 1 : 0,
    showTechName: source.showTechName === true,
    showTechPhoto: source.showTechPhoto === true,
    showLocation: source.showLocation === true,
    showHours: source.showHours === true,
    showPhone: source.showPhone === true,
    showEmail: source.showEmail === true,
    showBookingPolicy: source.showBookingPolicy === true,
    showCancellationPolicy: source.showCancellationPolicy === true,
    showReviews: source.showReviews === true,
    showInstagram: source.showInstagram === true,
    showBio: source.showBio === true,
  };
}

function resolveSide(
  rawSide: unknown,
  defaultToNewQuickBookProfile = false,
): BookingPageConfigSide {
  const source = isRecord(rawSide) ? rawSide : {};

  const layout = resolveWithDefault(layoutSchema, source.layout, BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.layout);
  const sitePalettePreset = hasOwn(source, 'sitePalettePreset')
    ? resolveCustomerSitePalettePreset(source.sitePalettePreset)
    : undefined;
  const siteStylePreset = hasOwn(source, 'siteStylePreset')
    ? resolveCustomerSiteStylePreset(source.siteStylePreset)
    : undefined;
  const quickBookLayout = resolveQuickBookSiteLayout(source.quickBookLayout);
  const stylePack = resolveStylePack(source.stylePack);
  const tokenOverrides = resolveTokenOverrides(
    hasOwn(source, 'tokenOverrides') ? source.tokenOverrides : null,
  );
  const sectionVariants = resolveSectionVariants(source.sectionVariants);
  // Before the dedicated catalogue field existed, grouped service menus were
  // represented by the section variant. Preserve that public presentation on
  // read while making every new write use the independent five-layout field.
  const serviceMenuLayout = hasOwn(source, 'serviceMenuLayout')
    ? resolveServiceMenuLayout(source.serviceMenuLayout)
    : sectionVariants.serviceMenu === 'grouped_categories'
      ? 'category_menu'
      : DEFAULT_SERVICE_MENU_LAYOUT;
  const businessMode = resolveWithDefault(
    businessModeSchema,
    source.businessMode,
    BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.businessMode,
  );
  const resolvedStartMode = resolveWithDefault(
    startModeSchema,
    source.startMode,
    BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.startMode,
  );
  const quickBookProfile = defaultToNewQuickBookProfile && !hasOwn(source, 'quickBookProfile')
    ? createDefaultQuickBookProfileVisibility()
    : resolveQuickBookProfileVisibility(source.quickBookProfile);
  /**
   * PR 6 (Rev 3 plan section 6): "Editorial requires startMode:
   * services_first — the config layer rejects Editorial + staff_first with
   * a clear owner message." This resolver's whole contract is to NEVER
   * throw (see `resolveBookingPageConfig`'s own doc comment), and a public
   * booking page can never be allowed to misrender or crash over a stored
   * combination — so "rejected" here means a documented, conservative
   * fallback rather than an exception: a persisted/legacy `staff_first`
   * value alongside `layout: 'editorial'` resolves to `services_first`
   * instead. (The "clear owner message" half of that plan sentence belongs
   * to the owner-surface UI, which does not yet expose a startMode picker
   * at all — PR 7 adds business/start modes — so there is no UI path today
   * that could even set this combination; this is a defensive resolver
   * guarantee, not yet a user-visible rejection message.) Recorded as a
   * conservative decision, not silently guessed at.
   */
  const startMode = layout === 'editorial' ? 'services_first' : resolvedStartMode;

  const rawOrder = Array.isArray(source.sectionOrder) ? source.sectionOrder : [];
  const rawHidden = Array.isArray(source.hiddenSections) ? source.hiddenSections : [];
  const { sectionOrder, hiddenSections } = validateSectionOrder(rawOrder, rawHidden, layout);

  return {
    layout,
    ...(sitePalettePreset ? { sitePalettePreset } : {}),
    ...(siteStylePreset ? { siteStylePreset } : {}),
    quickBookLayout,
    serviceMenuLayout,
    stylePack,
    tokenOverrides,
    sectionOrder,
    sectionVariants,
    hiddenSections,
    businessMode,
    startMode,
    quickBookProfile,
  };
}

/**
 * Resolves whatever is stored at `settings.bookingPage` into a valid,
 * fully-typed BookingPageConfig. NEVER throws: missing settings, a
 * non-object settings value, a missing/malformed bookingPage block, an
 * unknown layout, or corrupt section lists all resolve independently to
 * their documented default via zod safeParse rather than raising — this
 * runs on every public page load once the section registry (PR 4) lands, so
 * one bad stored value must never break the page.
 *
 * `version` is read from the stored value and respected when it matches the
 * only schema version that exists today (1); anything else — including a
 * future version number this build does not understand yet — falls back to
 * 1 rather than being blindly trusted or passed through.
 */
export function resolveBookingPageConfig(settings: unknown): BookingPageConfig {
  const settingsRecord = isRecord(settings) ? settings : {};
  const rawBookingPage = isRecord(settingsRecord.bookingPage) ? settingsRecord.bookingPage : {};

  const version = resolveWithDefault(z.literal(1), rawBookingPage.version, 1);

  return {
    version,
    draft: resolveSide(rawBookingPage.draft, !hasOwn(rawBookingPage, 'draft')),
    live: resolveSide(rawBookingPage.live, !hasOwn(rawBookingPage, 'live')),
    draftPresetBase: hasOwn(rawBookingPage, 'draftPresetBase')
      ? resolvePresetBase(rawBookingPage.draftPresetBase)
      : (isRecord(rawBookingPage.draft)
          ? null
          : { ...BOOKING_PAGE_CONFIG_DEFAULTS.draftPresetBase! }),
    livePresetBase: hasOwn(rawBookingPage, 'livePresetBase')
      ? resolvePresetBase(rawBookingPage.livePresetBase)
      : (isRecord(rawBookingPage.live)
          ? null
          : { ...BOOKING_PAGE_CONFIG_DEFAULTS.livePresetBase! }),
  };
}

/** Admin-only logical presentation state used by guarded builder operations. */
export function getBookingPageDraftPresentationState(
  config: BookingPageConfig,
): BookingPagePresentationState {
  return {
    ...config.draft,
    presetBase: config.draftPresetBase,
  };
}

// =============================================================================
// D — ONE APPEARANCE PIPELINE: foldLegacyAppearanceInputs
// =============================================================================

/**
 * Documented precedence for the accent colour an appearance pipeline should
 * end up rendering with, highest priority first (rev 3 plan section 4A.D):
 *
 *   1. A per-page `salon_page_appearance.themeKey` selection, if the owner
 *      has picked one for this specific page (table in src/models/Schema.ts,
 *      resolved by src/libs/pageAppearance.ts). Independent of both
 *      registries below.
 *   2. The tenant-level `salon.themeKey`, resolved against one of the two
 *      divergent registries in src/theme/themes.ts: `themes` (3 colour-only
 *      entries: nail-salon-no5, premium-glass, luxury-rewards) or
 *      `fullThemes` (3 full 44-token EspressoTheme entries: espresso,
 *      lavender, pastel) via `getFullTheme`. The two registries use disjoint
 *      keys and are not unified by this PR — style packs (PR 20) are what
 *      finally collapses them into `tokenOverrides`.
 *   3. This module's own `bookingPage.{draft,live}.tokenOverrides.accentColor`
 *      — an explicit override the owner set through the modular config.
 *   4. The legacy `bookingExperience.primaryColor` (src/libs/
 *      bookingExperience.ts) — UNIVERSAL owner content as of Stage 1
 *      (UX-OD-02), validated with the same CANONICAL_HEX_COLOR pattern reused
 *      here. Weakest link in the chain: pure fallback for salons that never
 *      touched anything newer.
 *
 *      S1 (Stage 1) correction: this step previously said "entitlement-gated".
 *      It is not, and the distinction matters for the PR that adds the premium
 *      boundary — step 4 is NOT already protected and must be considered
 *      separately from steps 1-3.
 *
 * Steps 1–2 read from a theme key / a separate DB table, not from a
 * BookingPageConfig value, so they are out of this function's two-parameter
 * contract (`config`, `legacyPrimaryColor`) by construction — resolving them
 * is deferred to whichever later PR wires the public render path, and is
 * recorded as follow-up debt rather than guessed at here. What this function
 * does implement is the boundary between steps 3 and 4, which is the part
 * expressible with the inputs it is given: `tokenOverrides.accentColor`
 * always wins when the owner has explicitly set one; the legacy primary
 * colour folds in only when that field is null/absent, on both draft and
 * live independently (each side keeps its own explicit-vs-inherited state).
 * Reuses CANONICAL_HEX_COLOR — never re-validates or reimplements it.
 */
export function foldLegacyAppearanceInputs(
  config: BookingPageConfig,
  legacyPrimaryColor: string | null,
): BookingPageConfig {
  const normalizedLegacyColor = resolveWithDefault(accentColorSchema, legacyPrimaryColor, null);

  const foldSide = (side: BookingPageConfigSide): BookingPageConfigSide => {
    const explicitAccentColor = side.tokenOverrides?.accentColor ?? null;
    if (explicitAccentColor !== null) {
      // An explicit value always wins — never overwritten by legacy input.
      return side;
    }
    if (normalizedLegacyColor === null) {
      return side;
    }

    return {
      ...side,
      tokenOverrides: {
        ...side.tokenOverrides,
        accentColor: normalizedLegacyColor,
      },
    };
  };

  return {
    ...config,
    draft: foldSide(config.draft),
    live: foldSide(config.live),
  };
}

// =============================================================================
// updateBookingPageDraft — targeted, concurrency-safe jsonb_set write
// =============================================================================

/**
 * Writes a patch into `salon.settings.bookingPage.draft` only, following the
 * exact jsonb_set pattern used by PATCH /api/admin/salon/settings (each
 * owned field is written with its own jsonb_set against the *live* settings
 * column expression, not the JS snapshot read at the top of this function) —
 * so a concurrent write to any sibling settings key (booking, notifications,
 * bookingExperience, merchandising, `bookingPage.live`, …) is never
 * clobbered. `sectionOrder` and `hiddenSections` are written together
 * whenever either is present in the patch, since validateSectionOrder's
 * guarantee is a joint invariant over both.
 *
 * The patch itself must already be valid (validate it with
 * bookingPageDraftPatchSchema, e.g. in the owner-facing route a later PR in
 * this stack adds, before calling this helper) — an invalid patch is a
 * caller contract violation and throws here rather than being silently
 * partially applied.
 *
 * The read/validate/write sequence runs under one transaction after locking
 * the salon row. That lock is shared with publish/revert below, so semantic
 * builder operations are always applied to the latest committed draft and
 * concurrent lifecycle requests cannot overwrite one another from stale
 * snapshots. Ordinary raw patches keep their existing targeted-field
 * semantics; the lock only makes the snapshot used for their joint
 * order/visibility validation authoritative.
 *
 * Returns the resolved config after the write, or null if the salon id does
 * not exist.
 */
export type BookingPageConfigTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function updateBookingPageDraftInTransaction(
  tx: BookingPageConfigTransaction,
  salonId: string,
  validatedOrdinaryPatch: BookingPageDraftPatch | null,
  options?: BookingPageBuilderWriteOptions,
): Promise<BookingPageConfig | null> {
  const [existing] = await tx
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .for('update')
    .limit(1);

  if (!existing) {
    return null;
  }

  const currentConfig = resolveBookingPageConfig(existing.settings);
  let validatedPatch: PersistableBookingPageDraftPatch;

  if (options) {
    // Re-apply the semantic operation to the freshest row snapshot available
    // to this writer. The route performs an earlier application to return a
    // useful 400 for an invalid request, but persisting that older full-array
    // snapshot could undo a hide or reorder performed in another tab between
    // authorization and this write.
    const currentResult = applyBookingPageBuilderOperation(
      getBookingPageDraftPresentationState(currentConfig),
      options.builderOperation,
    );
    if (!currentResult.ok) {
      throw new BookingPageBuilderWriteError(currentResult.code);
    }
    const {
      presetBase,
      sectionVariants,
      ...nonVariantPatch
    } = currentResult.patch;
    const validatedNonVariantPatch = bookingPageDraftPatchSchema.parse(nonVariantPatch);
    validatedPatch = {
      ...validatedNonVariantPatch,
      ...(sectionVariants === undefined
        ? {}
        : {
            sectionVariants: validateBuilderSectionVariantSnapshot(
              sectionVariants,
              currentConfig.draft.sectionVariants,
              options.builderOperation,
            ),
          }),
      ...(presetBase === undefined
        ? {}
        : { presetBase: bookingPagePresetReferenceSchema.nullable().parse(presetBase) }),
    };
  } else {
    // Ordinary callers retain the strict canonical-write contract and are
    // validated before the database read, exactly as before Stage 6.
    validatedPatch = validatedOrdinaryPatch!;
  }

  // Ensure `settings` is a JSON object (legacy non-object JSONB cannot accept
  // a jsonb_set path).
  let settingsExpression = sql`
    CASE
      WHEN jsonb_typeof(${salonSchema.settings}) = 'object'
        THEN ${salonSchema.settings}
      ELSE '{}'::jsonb
    END
  `;

  // Ensure `bookingPage` exists as an object without discarding an existing
  // one (preserves the sibling `live` side and `version`).
  settingsExpression = sql`
    jsonb_set(
      ${settingsExpression},
      '{bookingPage}',
      CASE
        WHEN jsonb_typeof(${settingsExpression}->'bookingPage') = 'object'
          THEN ${settingsExpression}->'bookingPage'
        ELSE '{}'::jsonb
      END
    )
  `;
  settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,version}', '1'::jsonb)`;

  // Ensure `bookingPage.draft` exists as an object, seeded from the resolved
  // current value (which already applies documented defaults) if absent.
  settingsExpression = sql`
    jsonb_set(
      ${settingsExpression},
      '{bookingPage,draft}',
      CASE
        WHEN jsonb_typeof(${settingsExpression}#>'{bookingPage,draft}') = 'object'
          THEN ${settingsExpression}#>'{bookingPage,draft}'
        ELSE ${JSON.stringify(currentConfig.draft)}::jsonb
      END
    )
  `;

  if (validatedPatch.layout !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,layout}', ${JSON.stringify(validatedPatch.layout)}::jsonb)`;
  }
  if (validatedPatch.sitePalettePreset !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,sitePalettePreset}', ${JSON.stringify(validatedPatch.sitePalettePreset)}::jsonb)`;
  }
  if (validatedPatch.siteStylePreset !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,siteStylePreset}', ${JSON.stringify(validatedPatch.siteStylePreset)}::jsonb)`;
  }
  // Materialize the resolved legacy default on the next config write while
  // preserving it unless this patch explicitly selects another composition.
  const nextQuickBookLayout = validatedPatch.quickBookLayout
    ?? currentConfig.draft.quickBookLayout
    ?? DEFAULT_QUICK_BOOK_SITE_LAYOUT;
  settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,quickBookLayout}', ${JSON.stringify(nextQuickBookLayout)}::jsonb)`;
  // Materialize the resolved value on every legacy draft's next write. This
  // freezes the old section-variant fallback before a site preset changes
  // sectionVariants, keeping the newly independent catalogue presentation
  // stable unless its own field is explicitly changed.
  const nextServiceMenuLayout = validatedPatch.serviceMenuLayout
    ?? currentConfig.draft.serviceMenuLayout;
  settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,serviceMenuLayout}', ${JSON.stringify(nextServiceMenuLayout)}::jsonb)`;
  if (validatedPatch.stylePack !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,stylePack}', ${JSON.stringify(validatedPatch.stylePack)}::jsonb)`;
  }
  if (validatedPatch.tokenOverrides !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,tokenOverrides}', ${JSON.stringify(validatedPatch.tokenOverrides)}::jsonb)`;
  }
  if (validatedPatch.sectionVariants !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,sectionVariants}', ${JSON.stringify(validatedPatch.sectionVariants)}::jsonb)`;
  }
  if (validatedPatch.businessMode !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,businessMode}', ${JSON.stringify(validatedPatch.businessMode)}::jsonb)`;
  }
  if (validatedPatch.startMode !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,startMode}', ${JSON.stringify(validatedPatch.startMode)}::jsonb)`;
  }
  if (validatedPatch.quickBookProfile !== undefined) {
    const nextQuickBookProfile = {
      ...currentConfig.draft.quickBookProfile,
      ...validatedPatch.quickBookProfile,
      version: 1 as const,
    };
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,quickBookProfile}', ${JSON.stringify(nextQuickBookProfile)}::jsonb)`;
  } else if (validatedPatch.layout === 'quick_book'
    && currentConfig.draft.layout !== 'quick_book') {
    // Choosing Quick Book from another presentation is an explicit adoption
    // of the current compact product. Preserve every visibility value while
    // stamping the presentation version; template switching never mutates
    // the canonical salon information itself.
    const adoptedQuickBookProfile = {
      ...currentConfig.draft.quickBookProfile,
      version: 1 as const,
    };
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,quickBookProfile}', ${JSON.stringify(adoptedQuickBookProfile)}::jsonb)`;
  }
  if (validatedPatch.presetBase !== undefined) {
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draftPresetBase}', ${JSON.stringify(validatedPatch.presetBase)}::jsonb)`;
  }
  // S2 (Stage 1) — SUPERSEDES the PR 6 reset-on-layout-change behaviour.
  //
  // PR 6 reasoned that a caller sending only `{ layout }` could not reasonably
  // intend to keep the previous layout's order, and reset `sectionOrder` and
  // `hiddenSections` to the new layout's defaults. The frozen post-reconciliation
  // Owner contract (Stage 1, Amendment B) supersedes that: an ordinary layout
  // change must NEVER silently discard owner state. Hidden sections in
  // particular were being silently un-hidden, which is destructive and was not
  // visible to the owner at the moment of the click.
  //
  // Presentation state is therefore preserved exactly unless the caller sends
  // the explicit `resetPresentation: true` intent. Deciding WHICH overrides are
  // "compatible" with a destination layout is deliberately NOT attempted here —
  // that analysis belongs to the later builder/preset-switch stage together with
  // its preview-and-diff workflow. This is preserve-or-reset, nothing more.
  //
  // The ordinary admin layout selector does not send the intent, so selecting
  // another layout keeps existing order and visibility.
  const resetPresentationRequested = validatedPatch.resetPresentation === true;

  if (resetPresentationRequested) {
    const resetLayout = validatedPatch.layout ?? currentConfig.draft.layout;
    const { sectionOrder, hiddenSections } = validateSectionOrder([], [], resetLayout);
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,sectionOrder}', ${JSON.stringify(sectionOrder)}::jsonb)`;
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,hiddenSections}', ${JSON.stringify(hiddenSections)}::jsonb)`;
    if (resetLayout === 'quick_book') {
      const adoptedQuickBookProfile = {
        ...currentConfig.draft.quickBookProfile,
        version: 1 as const,
      };
      settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,quickBookProfile}', ${JSON.stringify(adoptedQuickBookProfile)}::jsonb)`;
    }
  } else if (validatedPatch.sectionOrder !== undefined || validatedPatch.hiddenSections !== undefined) {
    const layout = validatedPatch.layout ?? currentConfig.draft.layout;
    const nextOrderInput = validatedPatch.sectionOrder ?? currentConfig.draft.sectionOrder;
    const nextHiddenInput = validatedPatch.hiddenSections ?? currentConfig.draft.hiddenSections;
    const { sectionOrder, hiddenSections } = validateSectionOrder(nextOrderInput, nextHiddenInput, layout);
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,sectionOrder}', ${JSON.stringify(sectionOrder)}::jsonb)`;
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,hiddenSections}', ${JSON.stringify(hiddenSections)}::jsonb)`;
  }

  const [updated] = await tx
    .update(salonSchema)
    .set({ settings: settingsExpression })
    .where(eq(salonSchema.id, salonId))
    .returning();

  if (!updated) {
    return null;
  }

  return resolveBookingPageConfig(updated.settings);
}

export function updateBookingPageDraft(
  salonId: string,
  patch: BookingPageDraftPatch,
): Promise<BookingPageConfig | null>;
export function updateBookingPageDraft(
  salonId: string,
  patch: BookingPagePresentationPatch,
  options: BookingPageBuilderWriteOptions,
): Promise<BookingPageConfig | null>;
export async function updateBookingPageDraft(
  salonId: string,
  patch: BookingPageDraftPatch | BookingPagePresentationPatch,
  options?: BookingPageBuilderWriteOptions,
): Promise<BookingPageConfig | null> {
  // Preserve the ordinary caller contract: malformed raw patches fail before
  // any database work. Builder snapshots remain intentionally ignored here;
  // the semantic operation is re-applied after acquiring the row lock.
  const validatedOrdinaryPatch = options
    ? null
    : bookingPageDraftPatchSchema.parse(patch);

  return db.transaction(tx => updateBookingPageDraftInTransaction(
    tx,
    salonId,
    validatedOrdinaryPatch,
    options,
  ));
}

// =============================================================================
// publishBookingPageConfig / revertBookingPageDraft (PR 5)
// =============================================================================
//
// Owner-surface Publish/Revert on the draft/live pair. Deliberately NOT built
// by refactoring updateBookingPageDraft's inline jsonb_set chain above — that
// function is already relied upon (and, by the time this lands, may already
// be exercised by callers) exactly as written, so this section duplicates its
// small "ensure settings/bookingPage/version are objects" preamble rather
// than risk changing its behaviour by extracting a shared helper.
//
// Documented semantics (Rev 3 plan PR 5 — "document exactly which semantics
// you chose"):
//   - Publish: the resolved `draft` side (already defaulted/validated by
//     resolveBookingPageConfig) overwrites `live` entirely. `draft` itself is
//     left untouched, so the owner keeps editing the same draft they just
//     published — publishing again with no further edits is a safe no-op.
//   - Revert: discards unpublished draft edits by overwriting `draft` with
//     the current `live` value. This is "reset the draft to match live", the
//     documented equivalent named in the PR spec — not a version history or
//     an undo stack, just draft := live.
//
// Publish and revert use the same salon-row lock as updateBookingPageDraft.
// This serializes the complete read/copy/write lifecycle across browser tabs
// while each write remains a targeted jsonb_set against the live settings
// column expression (never the JS snapshot), so sibling settings keys remain
// untouched.

async function readCurrentBookingPageConfig(
  tx: BookingPageConfigTransaction,
  salonId: string,
): Promise<BookingPageConfig | null> {
  const [existing] = await tx
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .for('update')
    .limit(1);

  if (!existing) {
    return null;
  }

  return resolveBookingPageConfig(existing.settings);
}

async function writeBookingPageSide(
  tx: BookingPageConfigTransaction,
  salonId: string,
  targetSide: 'draft' | 'live',
  value: BookingPageConfigSide,
  presetBase: BookingPagePresetReference | null,
): Promise<BookingPageConfig | null> {
  let settingsExpression = sql`
    CASE
      WHEN jsonb_typeof(${salonSchema.settings}) = 'object'
        THEN ${salonSchema.settings}
      ELSE '{}'::jsonb
    END
  `;

  settingsExpression = sql`
    jsonb_set(
      ${settingsExpression},
      '{bookingPage}',
      CASE
        WHEN jsonb_typeof(${settingsExpression}->'bookingPage') = 'object'
          THEN ${settingsExpression}->'bookingPage'
        ELSE '{}'::jsonb
      END
    )
  `;
  settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,version}', '1'::jsonb)`;

  const targetPath = targetSide === 'draft'
    ? sql.raw(`'{bookingPage,draft}'`)
    : sql.raw(`'{bookingPage,live}'`);
  settingsExpression = sql`jsonb_set(${settingsExpression}, ${targetPath}, ${JSON.stringify(value)}::jsonb)`;
  const targetPresetBasePath = targetSide === 'draft'
    ? sql.raw(`'{bookingPage,draftPresetBase}'`)
    : sql.raw(`'{bookingPage,livePresetBase}'`);
  settingsExpression = sql`jsonb_set(${settingsExpression}, ${targetPresetBasePath}, ${JSON.stringify(presetBase)}::jsonb)`;

  const [updated] = await tx
    .update(salonSchema)
    .set({ settings: settingsExpression })
    .where(eq(salonSchema.id, salonId))
    .returning();

  if (!updated) {
    return null;
  }

  return resolveBookingPageConfig(updated.settings);
}

/** Copies the resolved `draft` side into `live`. Returns null if the salon id does not exist. */
export async function publishBookingPageConfig(salonId: string): Promise<BookingPageConfig | null> {
  return db.transaction(async (tx) => {
    const current = await readCurrentBookingPageConfig(tx, salonId);
    if (!current) {
      return null;
    }
    return writeBookingPageSide(
      tx,
      salonId,
      'live',
      current.draft,
      current.draftPresetBase,
    );
  });
}

/** Resets `draft` to match the current `live` side. Returns null if the salon id does not exist. */
export async function revertBookingPageDraft(salonId: string): Promise<BookingPageConfig | null> {
  return db.transaction(async (tx) => {
    const current = await readCurrentBookingPageConfig(tx, salonId);
    if (!current) {
      return null;
    }
    return writeBookingPageSide(
      tx,
      salonId,
      'draft',
      current.live,
      current.livePresetBase,
    );
  });
}
