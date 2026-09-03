import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import {
  type BookingPagePresetReference,
  resolveBookingPagePresetRecipe,
} from '@/libs/bookingPagePresetRecipes';

/**
 * Client-safe query contract used by the guarded owner preview iframe.
 *
 * The id and recipe version travel as an exact pair (for example
 * `presetPreview=collective&presetPreviewVersion=1`). Parsing remains
 * fail-closed: whitespace, missing pieces, repeated values, unknown ids, and
 * future versions are all ignored.
 */
export const BOOKING_PAGE_PRESET_PREVIEW_QUERY_KEY = 'presetPreview' as const;
export const BOOKING_PAGE_PRESET_PREVIEW_VERSION_QUERY_KEY = 'presetPreviewVersion' as const;

export type BookingPagePresetPreviewQueryValue = string | readonly string[] | null | undefined;

export function formatBookingPagePresetPreviewQuery(
  reference: BookingPagePresetReference,
): Readonly<{
    presetPreview: string;
    presetPreviewVersion: string;
  }> {
  return {
    presetPreview: reference.presetId,
    presetPreviewVersion: String(reference.recipeVersion),
  };
}

function parseBookingPagePresetPreviewQuery(
  presetPreview: BookingPagePresetPreviewQueryValue,
  presetPreviewVersion: BookingPagePresetPreviewQueryValue,
): BookingPagePresetReference | null {
  if (typeof presetPreview !== 'string' || typeof presetPreviewVersion !== 'string') {
    return null;
  }

  if (!/^[a-z][a-z\d_]*$/.test(presetPreview)
    || !/^[1-9]\d*$/.test(presetPreviewVersion)) {
    return null;
  }

  const recipe = resolveBookingPagePresetRecipe({
    presetId: presetPreview,
    recipeVersion: Number(presetPreviewVersion),
  });

  return recipe?.reference ?? null;
}

/**
 * Resolves a temporary presentation recipe for an already-authorized draft
 * preview. This is deliberately a pure, in-memory overlay over the side the
 * public page already selected; it neither reads nor writes persistence.
 *
 * Only the four presentation dimensions owned by a preset recipe are
 * replaced. Business/start mode and the dormant styling fields remain the
 * exact values from the current side. The caller must pass the existing
 * `resolveDraftSalonAccess().isPreviewingDraftConfig` decision rather than
 * introducing another authorization mechanism.
 */
export function resolveBookingPagePresetPreviewSide({
  currentSide,
  isPreviewingDraftConfig,
  previewQuery,
}: {
  currentSide: BookingPageConfigSide;
  isPreviewingDraftConfig: boolean;
  previewQuery: Readonly<{
    presetPreview?: BookingPagePresetPreviewQueryValue;
    presetPreviewVersion?: BookingPagePresetPreviewQueryValue;
  }>;
}): BookingPageConfigSide {
  if (!isPreviewingDraftConfig) {
    return currentSide;
  }

  const reference = parseBookingPagePresetPreviewQuery(
    previewQuery.presetPreview,
    previewQuery.presetPreviewVersion,
  );
  const recipe = reference ? resolveBookingPagePresetRecipe(reference) : null;
  if (!recipe) {
    return currentSide;
  }

  return {
    layout: recipe.layout,
    quickBookLayout: currentSide.quickBookLayout,
    serviceMenuLayout: currentSide.serviceMenuLayout,
    sitePalettePreset: currentSide.sitePalettePreset,
    siteStylePreset: currentSide.siteStylePreset,
    stylePack: currentSide.stylePack,
    tokenOverrides: currentSide.tokenOverrides,
    sectionOrder: [...recipe.sectionOrder],
    sectionVariants: { ...recipe.sectionVariants },
    hiddenSections: [...recipe.hiddenSections],
    businessMode: currentSide.businessMode,
    startMode: currentSide.startMode,
    quickBookProfile: { ...currentSide.quickBookProfile },
  };
}
