import type {
  BookingPageLayout,
  SectionId,
} from '@/libs/bookingPageConfig';
import type { SectionVariantId } from '@/libs/sectionPresentation';

/**
 * Client-safe, versioned booking-page preset recipes.
 *
 * Recipes contain presentation metadata only. They never contain salon
 * content, style packs, token overrides, renderer callbacks, or arbitrary
 * markup. `presetBase` is the logical per-side provenance value supplied by
 * the owner/config layer; it is deliberately not part of the anonymous
 * `BookingPageConfigSide` renderer contract.
 */

export const BOOKING_PAGE_PRESET_IDS = [
  'quick_book',
  'signature',
  'menu',
  'collective',
] as const;

export type BookingPagePresetId = (typeof BOOKING_PAGE_PRESET_IDS)[number];

/**
 * Every shipped recipe version remains addressable here. Appending a new
 * version must not remove an older entry: persisted owner provenance uses the
 * exact version to retain its original reset/inheritance semantics.
 */
export const BOOKING_PAGE_PRESET_RECIPE_VERSIONS = [1] as const;
export type BookingPagePresetRecipeVersion
  = (typeof BOOKING_PAGE_PRESET_RECIPE_VERSIONS)[number];
export const BOOKING_PAGE_PRESET_RECIPE_VERSION
  = 1 satisfies BookingPagePresetRecipeVersion;

export type BookingPagePresetReference = Readonly<{
  presetId: BookingPagePresetId;
  recipeVersion: BookingPagePresetRecipeVersion;
}>;

const PRESET_VARIANT_SECTION_IDS = [
  'salonProfile',
  'technicianProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const satisfies readonly SectionId[];

export type BookingPagePresetSectionVariants = Readonly<{
  [S in (typeof PRESET_VARIANT_SECTION_IDS)[number]]: SectionVariantId<S>;
}>;

export type BookingPagePresetPresentationState = Readonly<{
  layout: BookingPageLayout;
  sectionOrder: readonly SectionId[];
  hiddenSections: readonly SectionId[];
  sectionVariants: Readonly<Partial<Record<SectionId, string>>>;
  presetBase: BookingPagePresetReference | null;
}>;

export type BookingPagePresetRecipe = Readonly<{
  reference: BookingPagePresetReference;
  layout: BookingPageLayout;
  sectionOrder: readonly SectionId[];
  hiddenSections: readonly SectionId[];
  sectionVariants: BookingPagePresetSectionVariants;
  presetBase: BookingPagePresetReference;
}>;

const QUICK_BOOK_ORDER = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
] as const satisfies readonly SectionId[];

const SIGNATURE_ORDER = [
  'salonProfile',
  'featuredServices',
  'technicianProfile',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const satisfies readonly SectionId[];

const MENU_ORDER = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
] as const satisfies readonly SectionId[];

const COLLECTIVE_ORDER = [
  'salonProfile',
  'technicianProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const satisfies readonly SectionId[];

function freezeReference(
  presetId: BookingPagePresetId,
  recipeVersion: BookingPagePresetRecipeVersion,
): BookingPagePresetReference {
  return Object.freeze({
    presetId,
    recipeVersion,
  });
}

function freezeRecipe(input: {
  presetId: BookingPagePresetId;
  recipeVersion: BookingPagePresetRecipeVersion;
  layout: BookingPageLayout;
  sectionOrder: readonly SectionId[];
  sectionVariants: BookingPagePresetSectionVariants;
}): BookingPagePresetRecipe {
  const reference = freezeReference(input.presetId, input.recipeVersion);
  const sectionVariants = Object.fromEntries(
    PRESET_VARIANT_SECTION_IDS.map(sectionId => [sectionId, input.sectionVariants[sectionId]]),
  ) as BookingPagePresetSectionVariants;

  return Object.freeze({
    reference,
    layout: input.layout,
    sectionOrder: Object.freeze([...input.sectionOrder]),
    hiddenSections: Object.freeze([]) as readonly SectionId[],
    sectionVariants: Object.freeze(sectionVariants),
    presetBase: reference,
  });
}

const BOOKING_PAGE_PRESET_RECIPES_V1: Readonly<Record<BookingPagePresetId, BookingPagePresetRecipe>> = Object.freeze({
  quick_book: freezeRecipe({
    presetId: 'quick_book',
    recipeVersion: 1,
    layout: 'quick_book',
    sectionOrder: QUICK_BOOK_ORDER,
    sectionVariants: {
      salonProfile: 'compact',
      technicianProfile: 'full',
      featuredServices: 'carousel',
      serviceMenu: 'list',
      hoursLocation: 'full',
      policies: 'card',
      socialLinks: 'icons',
      bookingCta: 'sticky',
    },
  }),
  signature: freezeRecipe({
    presetId: 'signature',
    recipeVersion: 1,
    layout: 'editorial',
    sectionOrder: SIGNATURE_ORDER,
    sectionVariants: {
      salonProfile: 'hero_image',
      technicianProfile: 'full',
      featuredServices: 'signature',
      serviceMenu: 'list',
      hoursLocation: 'full',
      policies: 'inline',
      socialLinks: 'icons',
      bookingCta: 'sticky',
    },
  }),
  menu: freezeRecipe({
    presetId: 'menu',
    recipeVersion: 1,
    layout: 'editorial',
    sectionOrder: MENU_ORDER,
    sectionVariants: {
      salonProfile: 'hero_image',
      technicianProfile: 'full',
      featuredServices: 'carousel',
      serviceMenu: 'grouped_categories',
      hoursLocation: 'full',
      policies: 'inline',
      socialLinks: 'icons',
      bookingCta: 'sticky',
    },
  }),
  collective: freezeRecipe({
    presetId: 'collective',
    recipeVersion: 1,
    layout: 'editorial',
    sectionOrder: COLLECTIVE_ORDER,
    sectionVariants: {
      salonProfile: 'hero_image',
      technicianProfile: 'cards',
      featuredServices: 'signature',
      serviceMenu: 'list',
      hoursLocation: 'location_cards',
      policies: 'inline',
      socialLinks: 'labeled',
      bookingCta: 'sticky',
    },
  }),
});

/**
 * Version-indexed catalogue. The current alias below is for owner pickers;
 * persisted references always resolve through this complete catalogue.
 */
export const BOOKING_PAGE_PRESET_RECIPES_BY_VERSION: Readonly<Record<BookingPagePresetRecipeVersion, Readonly<Record<BookingPagePresetId, BookingPagePresetRecipe>>>>
  = Object.freeze({
    1: BOOKING_PAGE_PRESET_RECIPES_V1,
  });

export const BOOKING_PAGE_PRESET_RECIPES
  = BOOKING_PAGE_PRESET_RECIPES_BY_VERSION[BOOKING_PAGE_PRESET_RECIPE_VERSION];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresetId(value: unknown): value is BookingPagePresetId {
  return typeof value === 'string'
    && (BOOKING_PAGE_PRESET_IDS as readonly string[]).includes(value);
}

export function isBookingPagePresetRecipeVersion(
  value: unknown,
): value is BookingPagePresetRecipeVersion {
  return typeof value === 'number'
    && (BOOKING_PAGE_PRESET_RECIPE_VERSIONS as readonly number[]).includes(value);
}

export function isCurrentBookingPagePresetReference(
  reference: Readonly<{ recipeVersion: number }> | null,
): boolean {
  return reference?.recipeVersion === BOOKING_PAGE_PRESET_RECIPE_VERSION;
}

function parsePresetReference(value: unknown): BookingPagePresetReference | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'presetId' || keys[1] !== 'recipeVersion') {
    return null;
  }
  if (!isPresetId(value.presetId)
    || !isBookingPagePresetRecipeVersion(value.recipeVersion)) {
    return null;
  }

  return {
    presetId: value.presetId,
    recipeVersion: value.recipeVersion,
  };
}

function cloneReference(reference: BookingPagePresetReference): BookingPagePresetReference {
  return {
    presetId: reference.presetId,
    recipeVersion: reference.recipeVersion,
  };
}

function cloneRecipe(recipe: BookingPagePresetRecipe): BookingPagePresetRecipe {
  return {
    reference: cloneReference(recipe.reference),
    layout: recipe.layout,
    sectionOrder: [...recipe.sectionOrder],
    hiddenSections: [...recipe.hiddenSections],
    sectionVariants: { ...recipe.sectionVariants },
    presetBase: cloneReference(recipe.presetBase),
  };
}

/** Resolves an exact supported reference and always returns a defensive clone. */
export function resolveBookingPagePresetRecipe(
  reference: unknown,
): BookingPagePresetRecipe | null {
  const parsed = parsePresetReference(reference);
  if (!parsed) {
    return null;
  }

  return cloneRecipe(
    BOOKING_PAGE_PRESET_RECIPES_BY_VERSION[parsed.recipeVersion][parsed.presetId],
  );
}

function canonicalVariantEntries(
  variants: BookingPagePresetPresentationState['sectionVariants'],
): Array<readonly [string, string]> {
  return Object.entries(variants)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Stable, structured presentation signature. JSON encoding of nested arrays
 * avoids delimiter collisions, while sorted variant entries make object-key
 * insertion order irrelevant. This is a concurrency/equality token, not an
 * authentication primitive.
 */
export function getBookingPagePresentationSignature(
  presentation: BookingPagePresetPresentationState,
): string {
  return JSON.stringify([
    'booking-page-presentation-signature-v1',
    presentation.layout,
    [...presentation.sectionOrder],
    [...presentation.hiddenSections],
    canonicalVariantEntries(presentation.sectionVariants),
    presentation.presetBase
      ? [presentation.presetBase.presetId, presentation.presetBase.recipeVersion]
      : null,
  ]);
}

function recipeAsPresentation(recipe: BookingPagePresetRecipe): BookingPagePresetPresentationState {
  return {
    layout: recipe.layout,
    sectionOrder: recipe.sectionOrder,
    hiddenSections: recipe.hiddenSections,
    sectionVariants: recipe.sectionVariants,
    presetBase: recipe.presetBase,
  };
}

/** Returns a preset only for an exact structural match; Custom is represented by null. */
export function findMatchingBookingPagePreset(
  presentation: BookingPagePresetPresentationState,
): BookingPagePresetReference | null {
  const signature = getBookingPagePresentationSignature(presentation);

  for (const recipeVersion of BOOKING_PAGE_PRESET_RECIPE_VERSIONS) {
    for (const presetId of BOOKING_PAGE_PRESET_IDS) {
      const recipe = BOOKING_PAGE_PRESET_RECIPES_BY_VERSION[recipeVersion][presetId];
      if (getBookingPagePresentationSignature(recipeAsPresentation(recipe)) === signature) {
        return cloneReference(recipe.reference);
      }
    }
  }

  return null;
}

function titleForPreset(presetId: BookingPagePresetId): string {
  switch (presetId) {
    case 'quick_book':
      return 'Quick Book';
    case 'signature':
      return 'Signature';
    case 'menu':
      return 'Menu';
    case 'collective':
      return 'Collective';
  }
}

function referenceDescription(reference: BookingPagePresetReference | null): string {
  return reference
    ? `${titleForPreset(reference.presetId)} v${reference.recipeVersion}`
    : 'Custom';
}

/**
 * Produces a deterministic, content-free summary suitable for a guarded
 * preset-switch confirmation. An unavailable reference returns one explicit
 * description instead of guessing at a newer recipe.
 */
export function describeBookingPagePresetChanges(
  current: BookingPagePresetPresentationState,
  target: BookingPagePresetRecipe | BookingPagePresetReference,
): string[] {
  const targetRecipe = 'reference' in target
    ? target
    : resolveBookingPagePresetRecipe(target);
  if (!targetRecipe) {
    return ['The selected preset recipe version is unavailable.'];
  }

  const targetPresentation = recipeAsPresentation(targetRecipe);
  if (getBookingPagePresentationSignature(current)
    === getBookingPagePresentationSignature(targetPresentation)) {
    return [];
  }

  const changes: string[] = [];
  if (current.presetBase?.presetId !== targetRecipe.presetBase.presetId
    || current.presetBase?.recipeVersion !== targetRecipe.presetBase.recipeVersion) {
    changes.push(
      `Preset base: ${referenceDescription(current.presetBase)} → ${referenceDescription(targetRecipe.presetBase)}`,
    );
  }
  if (current.layout !== targetRecipe.layout) {
    changes.push(`Layout: ${current.layout} → ${targetRecipe.layout}`);
  }
  if (JSON.stringify(current.sectionOrder) !== JSON.stringify(targetRecipe.sectionOrder)) {
    changes.push(`Section order: ${targetRecipe.sectionOrder.join(', ')}`);
  }
  if (JSON.stringify(current.hiddenSections) !== JSON.stringify(targetRecipe.hiddenSections)) {
    changes.push(targetRecipe.hiddenSections.length === 0
      ? 'Hidden sections: none'
      : `Hidden sections: ${targetRecipe.hiddenSections.join(', ')}`);
  }

  const variantIds = new Set<SectionId>([
    ...Object.keys(current.sectionVariants) as SectionId[],
    ...Object.keys(targetRecipe.sectionVariants) as SectionId[],
  ]);
  const targetVariants: Readonly<Partial<Record<SectionId, string>>>
    = targetRecipe.sectionVariants;
  for (const sectionId of [...variantIds].sort()) {
    const currentVariant = current.sectionVariants[sectionId] ?? 'inherited';
    const targetVariant = targetVariants[sectionId] ?? 'inherited';
    if (currentVariant !== targetVariant) {
      changes.push(`Presentation (${sectionId}): ${currentVariant} → ${targetVariant}`);
    }
  }

  return changes;
}
