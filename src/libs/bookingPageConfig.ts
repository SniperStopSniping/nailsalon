/**
 * bookingPage modular config contract (Luster UI/UX plan rev 3, section 4A.C).
 *
 * This is a pure library addition. Nothing reads or renders `bookingPage` yet
 * — the section registry (PR 4), the preview surface (PR 3) and the owner
 * editor route all land in later PRs of this stack. Until then this module
 * only defines the versioned shape, a safe resolver, the section-order safety
 * net, and a targeted DB writer for the draft side.
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
import { db } from '@/libs/DB';
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
 * The 12 section IDs from the rev 3 plan's section registry (PR 4 will add
 * the registry itself: id, variants, canRender, degrade). This module only
 * needs the closed ID set to type and validate sectionOrder/hiddenSections.
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
// SIDE SHAPE (identical for draft and live)
// =============================================================================

export type BookingPageConfigSide = {
  layout: BookingPageLayout;
  stylePack: StylePack;
  tokenOverrides: BookingPageTokenOverrides | null;
  sectionOrder: SectionId[];
  sectionVariants: Partial<Record<SectionId, string>>;
  hiddenSections: SectionId[];
  businessMode: BusinessMode;
  startMode: StartMode;
};

export type BookingPageConfig = {
  version: 1;
  draft: BookingPageConfigSide;
  live: BookingPageConfigSide;
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
const DEFAULT_SECTION_ORDER: readonly SectionId[] = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
];

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
const EDITORIAL_SECTION_ORDER: readonly SectionId[] = [
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
    stylePack: DEFAULT_STYLE_PACK,
    tokenOverrides: null,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    sectionVariants: {},
    hiddenSections: [],
    businessMode: 'solo',
    startMode: 'services_first',
  };
}

/**
 * Frozen reference for equality checks / documentation. Always clone (via
 * createDefaultSide / createDefaultConfig) before handing a default out to a
 * caller that might merge or mutate it — arrays here are shared.
 */
export const BOOKING_PAGE_CONFIG_SIDE_DEFAULTS: BookingPageConfigSide = createDefaultSide();

export function createDefaultBookingPageConfig(): BookingPageConfig {
  return {
    version: 1,
    draft: createDefaultSide(),
    live: createDefaultSide(),
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
const sectionVariantsSchema = z.record(sectionIdSchema, z.string().min(1));

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
  stylePack: stylePackSchema,
  tokenOverrides: tokenOverridesSchema,
  sectionOrder: sectionIdArraySchema,
  sectionVariants: sectionVariantsSchema,
  hiddenSections: sectionIdArraySchema,
  businessMode: businessModeSchema,
  startMode: startModeSchema,
});

export type BookingPageDraftPatch = Partial<BookingPageConfigSide> & {
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
    // S2: an explicit, narrowly named intent. `z.literal(true)` means a caller
    // cannot ask for a reset by accident with a falsy value, and the key is
    // never persisted into the stored side — it only selects a branch below.
    resetPresentation: z.literal(true).optional(),
  });

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

function resolveStylePack(value: unknown): StylePack {
  if (typeof value !== 'string') {
    return DEFAULT_STYLE_PACK;
  }
  return resolveWithDefault(stylePackSchema, value, DEFAULT_STYLE_PACK);
}

function resolveSide(rawSide: unknown): BookingPageConfigSide {
  const source = isRecord(rawSide) ? rawSide : {};

  const layout = resolveWithDefault(layoutSchema, source.layout, BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.layout);
  const stylePack = resolveStylePack(source.stylePack);
  const tokenOverrides = resolveTokenOverrides(
    hasOwn(source, 'tokenOverrides') ? source.tokenOverrides : null,
  );
  const sectionVariants = resolveSectionVariants(source.sectionVariants);
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
    stylePack,
    tokenOverrides,
    sectionOrder,
    sectionVariants,
    hiddenSections,
    businessMode,
    startMode,
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
    draft: resolveSide(rawBookingPage.draft),
    live: resolveSide(rawBookingPage.live),
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
 *      bookingExperience.ts), entitlement-gated and validated with the same
 *      CANONICAL_HEX_COLOR pattern reused here. Weakest link in the chain:
 *      pure fallback for salons that never touched anything newer.
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
 * Known accepted limitation: `layout` used to validate a sectionOrder/
 * hiddenSections-only patch (when the patch does not itself change layout)
 * is read from a SELECT issued before the UPDATE, so a concurrent layout
 * change landing in between could validate the new order against a
 * just-stale layout. This mirrors an already-accepted risk elsewhere in the
 * settings route (e.g. its own pre-fetched currentBookingExperience used to
 * merge bookingPolicy) and does not clobber any other field — recorded as
 * debt, not silently ignored.
 *
 * Returns the resolved config after the write, or null if the salon id does
 * not exist.
 */
export async function updateBookingPageDraft(
  salonId: string,
  patch: BookingPageDraftPatch,
): Promise<BookingPageConfig | null> {
  const validatedPatch = bookingPageDraftPatchSchema.parse(patch);

  const [existing] = await db
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!existing) {
    return null;
  }

  const currentConfig = resolveBookingPageConfig(existing.settings);

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
  } else if (validatedPatch.sectionOrder !== undefined || validatedPatch.hiddenSections !== undefined) {
    const layout = validatedPatch.layout ?? currentConfig.draft.layout;
    const nextOrderInput = validatedPatch.sectionOrder ?? currentConfig.draft.sectionOrder;
    const nextHiddenInput = validatedPatch.hiddenSections ?? currentConfig.draft.hiddenSections;
    const { sectionOrder, hiddenSections } = validateSectionOrder(nextOrderInput, nextHiddenInput, layout);
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,sectionOrder}', ${JSON.stringify(sectionOrder)}::jsonb)`;
    settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingPage,draft,hiddenSections}', ${JSON.stringify(hiddenSections)}::jsonb)`;
  }

  const [updated] = await db
    .update(salonSchema)
    .set({ settings: settingsExpression })
    .where(eq(salonSchema.id, salonId))
    .returning();

  if (!updated) {
    return null;
  }

  return resolveBookingPageConfig(updated.settings);
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
// Same accepted concurrency limitation as updateBookingPageDraft: the SELECT
// used to read the current config happens before the UPDATE, so a
// concurrent write landing in between is not serialized against this one.
// Each write is still a single targeted jsonb_set against the live settings
// column expression (never the JS snapshot), so it can never clobber any
// sibling settings key.

async function readCurrentBookingPageConfig(
  salonId: string,
): Promise<BookingPageConfig | null> {
  const [existing] = await db
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!existing) {
    return null;
  }

  return resolveBookingPageConfig(existing.settings);
}

async function writeBookingPageSide(
  salonId: string,
  targetSide: 'draft' | 'live',
  value: BookingPageConfigSide,
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

  const [updated] = await db
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
  const current = await readCurrentBookingPageConfig(salonId);
  if (!current) {
    return null;
  }
  return writeBookingPageSide(salonId, 'live', current.draft);
}

/** Resets `draft` to match the current `live` side. Returns null if the salon id does not exist. */
export async function revertBookingPageDraft(salonId: string): Promise<BookingPageConfig | null> {
  const current = await readCurrentBookingPageConfig(salonId);
  if (!current) {
    return null;
  }
  return writeBookingPageSide(salonId, 'draft', current.live);
}
