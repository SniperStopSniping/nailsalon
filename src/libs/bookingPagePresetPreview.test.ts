import { describe, expect, it } from 'vitest';

import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import {
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  resolveBookingPagePresetRecipe,
} from '@/libs/bookingPagePresetRecipes';

import {
  BOOKING_PAGE_PRESET_PREVIEW_QUERY_KEY,
  BOOKING_PAGE_PRESET_PREVIEW_VERSION_QUERY_KEY,
  formatBookingPagePresetPreviewQuery,
  resolveBookingPagePresetPreviewSide,
} from './bookingPagePresetPreview';

function currentSide(): BookingPageConfigSide {
  return {
    layout: 'quick_book',
    serviceMenuLayout: 'clean_list',
    sitePalettePreset: 'black_champagne',
    siteStylePreset: 'luxury',
    stylePack: 'future-premium-style',
    tokenOverrides: {
      accentColor: '#AABBCC',
      fontPairing: 'future-font-pairing',
    },
    sectionOrder: [
      'salonProfile',
      'serviceMenu',
      'featuredServices',
      'policies',
      'socialLinks',
      'bookingCta',
    ],
    sectionVariants: {
      salonProfile: 'compact',
      serviceMenu: 'list',
    },
    hiddenSections: ['socialLinks'],
    businessMode: 'team',
    startMode: 'staff_first',
    quickBookProfile: {
      showTechName: true,
      showTechPhoto: true,
      showLocation: true,
      showHours: true,
      showPhone: false,
      showEmail: true,
      showBookingPolicy: true,
      showCancellationPolicy: false,
      showReviews: false,
      showInstagram: true,
      showBio: true,
    },
  };
}

describe('booking-page preset target preview', () => {
  it('exposes one exact, versioned client-safe query contract', () => {
    expect(BOOKING_PAGE_PRESET_PREVIEW_QUERY_KEY).toBe('presetPreview');
    expect(BOOKING_PAGE_PRESET_PREVIEW_VERSION_QUERY_KEY).toBe('presetPreviewVersion');
    expect(formatBookingPagePresetPreviewQuery({
      presetId: 'collective',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    })).toEqual({
      presetPreview: 'collective',
      presetPreviewVersion: '1',
    });
  });

  it('overlays only recipe-owned presentation fields for an authorized draft preview', () => {
    const current = currentSide();
    const currentSnapshot = structuredClone(current);
    const tokenOverrides = current.tokenOverrides;
    const recipe = resolveBookingPagePresetRecipe({
      presetId: 'collective',
      recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    });

    expect(recipe).not.toBeNull();

    const result = resolveBookingPagePresetPreviewSide({
      currentSide: current,
      isPreviewingDraftConfig: true,
      previewQuery: { presetPreview: 'collective', presetPreviewVersion: '1' },
    });

    expect(result).toEqual({
      layout: recipe!.layout,
      quickBookLayout: current.quickBookLayout,
      serviceMenuLayout: current.serviceMenuLayout,
      sitePalettePreset: current.sitePalettePreset,
      siteStylePreset: current.siteStylePreset,
      stylePack: current.stylePack,
      tokenOverrides,
      sectionOrder: [...recipe!.sectionOrder],
      sectionVariants: { ...recipe!.sectionVariants },
      hiddenSections: [...recipe!.hiddenSections],
      businessMode: current.businessMode,
      startMode: current.startMode,
      quickBookProfile: current.quickBookProfile,
    });
    expect(result.tokenOverrides).toBe(tokenOverrides);
    expect(current).toEqual(currentSnapshot);
    expect(result.sectionOrder).not.toBe(recipe!.sectionOrder);
    expect(result.sectionVariants).not.toBe(recipe!.sectionVariants);
    expect(result.hiddenSections).not.toBe(recipe!.hiddenSections);
    expect(result.quickBookProfile).toEqual(current.quickBookProfile);
    expect(result.quickBookProfile).not.toBe(current.quickBookProfile);
  });

  it('does not copy, duplicate, or mutate an accidental canonical-content extension', () => {
    const canonicalContent = Object.freeze({
      salonName: 'Synthetic Salon',
      services: Object.freeze([{ id: 'svc-1', priceCents: 4200, durationMinutes: 60 }]),
    });
    const current = Object.assign(currentSide(), { canonicalContent });

    const result = resolveBookingPagePresetPreviewSide({
      currentSide: current,
      isPreviewingDraftConfig: true,
      previewQuery: { presetPreview: 'menu', presetPreviewVersion: '1' },
    });

    expect(result).not.toHaveProperty('canonicalContent');
    expect(canonicalContent).toEqual({
      salonName: 'Synthetic Salon',
      services: [{ id: 'svc-1', priceCents: 4200, durationMinutes: 60 }],
    });
    expect(Object.isFrozen(canonicalContent)).toBe(true);
    expect(Object.isFrozen(canonicalContent.services)).toBe(true);
  });

  it('ignores a valid target for an unauthorized/non-draft-preview request', () => {
    const current = currentSide();

    const result = resolveBookingPagePresetPreviewSide({
      currentSide: current,
      isPreviewingDraftConfig: false,
      previewQuery: { presetPreview: 'collective', presetPreviewVersion: '1' },
    });

    expect(result).toBe(current);
  });

  it.each([
    [undefined, '1'],
    [null, '1'],
    ['', '1'],
    ['collective', undefined],
    ['collective', null],
    ['collective', ''],
    [' collective', '1'],
    ['collective ', '1'],
    ['COLLECTIVE', '1'],
    ['collective', '01'],
    ['collective', '1 '],
    [['collective'], '1'],
    ['collective', ['1']],
  ])('ignores a missing or malformed target pair: %j / %j', (
    presetPreview,
    presetPreviewVersion,
  ) => {
    const current = currentSide();

    const result = resolveBookingPagePresetPreviewSide({
      currentSide: current,
      isPreviewingDraftConfig: true,
      previewQuery: { presetPreview, presetPreviewVersion },
    });

    expect(result).toBe(current);
  });

  it.each([
    ['lookbook', '1'],
    ['collective', '2'],
    ['future_preset', '99'],
  ])('ignores an unknown or future recipe: %s v%s', (
    presetPreview,
    presetPreviewVersion,
  ) => {
    const current = currentSide();

    const result = resolveBookingPagePresetPreviewSide({
      currentSide: current,
      isPreviewingDraftConfig: true,
      previewQuery: { presetPreview, presetPreviewVersion },
    });

    expect(result).toBe(current);
  });
});
