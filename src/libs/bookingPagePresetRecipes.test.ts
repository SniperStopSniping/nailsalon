import { describe, expect, it } from 'vitest';

import type { SectionId } from '@/libs/bookingPageConfig';
import { isSectionVariantAllowedForLayout } from '@/libs/sectionPresentation';

import {
  BOOKING_PAGE_PRESET_IDS,
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  BOOKING_PAGE_PRESET_RECIPE_VERSIONS,
  BOOKING_PAGE_PRESET_RECIPES,
  BOOKING_PAGE_PRESET_RECIPES_BY_VERSION,
  type BookingPagePresetPresentationState,
  type BookingPagePresetRecipe,
  type BookingPagePresetReference,
  describeBookingPagePresetChanges,
  findMatchingBookingPagePreset,
  getBookingPagePresentationSignature,
  isCurrentBookingPagePresetReference,
  resolveBookingPagePresetRecipe,
} from './bookingPagePresetRecipes';

const EXPECTED_RECIPES = {
  quick_book: {
    layout: 'quick_book',
    sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
    hiddenSections: [],
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
  },
  signature: {
    layout: 'editorial',
    sectionOrder: ['salonProfile', 'featuredServices', 'technicianProfile', 'serviceMenu', 'hoursLocation', 'policies', 'socialLinks', 'bookingCta'],
    hiddenSections: [],
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
  },
  menu: {
    layout: 'editorial',
    sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
    hiddenSections: [],
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
  },
  collective: {
    layout: 'editorial',
    sectionOrder: ['salonProfile', 'technicianProfile', 'featuredServices', 'serviceMenu', 'hoursLocation', 'policies', 'socialLinks', 'bookingCta'],
    hiddenSections: [],
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
  },
} as const;

function reference(presetId: keyof typeof EXPECTED_RECIPES): BookingPagePresetReference {
  return { presetId, recipeVersion: 1 };
}

function presentation(recipe: BookingPagePresetRecipe): BookingPagePresetPresentationState {
  return {
    layout: recipe.layout,
    sectionOrder: recipe.sectionOrder,
    hiddenSections: recipe.hiddenSections,
    sectionVariants: recipe.sectionVariants,
    presetBase: recipe.presetBase,
  };
}

describe('booking-page preset recipe v1 contract', () => {
  it('independently pins the closed preset IDs and exact recipes', () => {
    expect(BOOKING_PAGE_PRESET_IDS).toEqual([
      'quick_book',
      'signature',
      'menu',
      'collective',
    ]);
    expect(BOOKING_PAGE_PRESET_RECIPE_VERSION).toBe(1);
    expect(BOOKING_PAGE_PRESET_RECIPE_VERSIONS).toEqual([1]);
    expect(BOOKING_PAGE_PRESET_RECIPE_VERSION)
      .toBe(BOOKING_PAGE_PRESET_RECIPE_VERSIONS.at(-1));
    expect(Object.keys(BOOKING_PAGE_PRESET_RECIPES_BY_VERSION)).toEqual(['1']);
    expect(BOOKING_PAGE_PRESET_RECIPES_BY_VERSION[1]).toBe(BOOKING_PAGE_PRESET_RECIPES);
    expect(Object.keys(BOOKING_PAGE_PRESET_RECIPES)).toEqual(BOOKING_PAGE_PRESET_IDS);

    for (const presetId of BOOKING_PAGE_PRESET_IDS) {
      const recipe = BOOKING_PAGE_PRESET_RECIPES[presetId];

      expect(recipe.reference).toEqual(reference(presetId));
      expect(recipe.presetBase).toEqual(reference(presetId));
      expect({
        layout: recipe.layout,
        sectionOrder: recipe.sectionOrder,
        hiddenSections: recipe.hiddenSections,
        sectionVariants: recipe.sectionVariants,
      }).toEqual(EXPECTED_RECIPES[presetId]);
    }
  });

  it('contains full explicit supported variant maps and no Custom recipe', () => {
    const supportedVariantIds = [
      'salonProfile',
      'technicianProfile',
      'featuredServices',
      'serviceMenu',
      'hoursLocation',
      'policies',
      'socialLinks',
      'bookingCta',
    ];

    expect(BOOKING_PAGE_PRESET_IDS).not.toContain('custom');
    expect(BOOKING_PAGE_PRESET_RECIPES).not.toHaveProperty('custom');

    for (const recipe of Object.values(BOOKING_PAGE_PRESET_RECIPES)) {
      expect(Object.keys(recipe.sectionVariants)).toEqual(supportedVariantIds);
      expect(recipe.hiddenSections).toEqual([]);
      expect(new Set(recipe.sectionOrder).size).toBe(recipe.sectionOrder.length);
      expect(recipe.sectionOrder).toContain('salonProfile');
      expect(recipe.sectionOrder).toContain('serviceMenu');
      expect(recipe.sectionOrder).toContain('bookingCta');

      for (const [sectionId, variant] of Object.entries(recipe.sectionVariants)) {
        expect(isSectionVariantAllowedForLayout(
          sectionId as SectionId,
          variant,
          recipe.layout,
        )).toBe(true);
      }
    }
  });

  it('is deeply immutable at the exported registry boundary', () => {
    expect(Object.isFrozen(BOOKING_PAGE_PRESET_RECIPES_BY_VERSION)).toBe(true);
    expect(Object.isFrozen(BOOKING_PAGE_PRESET_RECIPES)).toBe(true);

    for (const recipe of Object.values(BOOKING_PAGE_PRESET_RECIPES)) {
      expect(Object.isFrozen(recipe)).toBe(true);
      expect(Object.isFrozen(recipe.reference)).toBe(true);
      expect(Object.isFrozen(recipe.presetBase)).toBe(true);
      expect(Object.isFrozen(recipe.sectionOrder)).toBe(true);
      expect(Object.isFrozen(recipe.hiddenSections)).toBe(true);
      expect(Object.isFrozen(recipe.sectionVariants)).toBe(true);
    }
  });

  it('resolves persisted provenance through its exact retained version catalogue', () => {
    for (const presetId of BOOKING_PAGE_PRESET_IDS) {
      const persistedReference = {
        presetId,
        recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSIONS[0],
      } as const;

      expect(resolveBookingPagePresetRecipe(persistedReference))
        .toEqual(BOOKING_PAGE_PRESET_RECIPES_BY_VERSION[1][presetId]);
    }

    expect(resolveBookingPagePresetRecipe({ presetId: 'menu', recipeVersion: 2 }))
      .toBeNull();
    expect(isCurrentBookingPagePresetReference(reference('menu'))).toBe(true);
    expect(isCurrentBookingPagePresetReference({
      presetId: 'menu',
      recipeVersion: 2,
    } as unknown as BookingPagePresetReference)).toBe(false);
  });

  it.each([
    null,
    undefined,
    'quick_book',
    {},
    { presetId: 'custom', recipeVersion: 1 },
    { presetId: 'catalogue', recipeVersion: 1 },
    { presetId: 'signature', recipeVersion: 2 },
    { presetId: 'signature', recipeVersion: '1' },
    { presetId: 'signature', recipeVersion: 1, extra: true },
  ])('rejects an unknown, malformed, stale, or widened reference %#', (value) => {
    expect(resolveBookingPagePresetRecipe(value)).toBeNull();
  });

  it('returns independent defensive clones without exposing registry mutation', () => {
    const first = resolveBookingPagePresetRecipe(reference('menu'))!;
    const second = resolveBookingPagePresetRecipe(reference('menu'))!;

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.sectionOrder).not.toBe(second.sectionOrder);
    expect(first.sectionVariants).not.toBe(second.sectionVariants);
    expect(first.reference).not.toBe(second.reference);
    expect(first.presetBase).not.toBe(second.presetBase);

    (first.sectionOrder as SectionId[]).push('hoursLocation');
    (first.sectionVariants as Record<string, string>).serviceMenu = 'list';
    (first.presetBase as { presetId: string }).presetId = 'quick_book';

    expect(resolveBookingPagePresetRecipe(reference('menu'))).toEqual(second);
    expect(BOOKING_PAGE_PRESET_RECIPES.menu.sectionOrder).toEqual(EXPECTED_RECIPES.menu.sectionOrder);
    expect(BOOKING_PAGE_PRESET_RECIPES.menu.sectionVariants.serviceMenu).toBe('grouped_categories');
    expect(BOOKING_PAGE_PRESET_RECIPES.menu.presetBase.presetId).toBe('menu');
  });

  it('keeps every recipe pairwise structurally distinct', () => {
    const signatures = BOOKING_PAGE_PRESET_IDS.map(presetId => (
      getBookingPagePresentationSignature({
        ...presentation(BOOKING_PAGE_PRESET_RECIPES[presetId]),
        // Provenance alone is not a structural difference. The recipes must
        // remain pairwise distinct even when their identities are erased.
        presetBase: null,
      })
    ));

    expect(new Set(signatures)).toHaveLength(BOOKING_PAGE_PRESET_IDS.length);
  });

  it('creates stable, insertion-order-independent and delimiter-safe signatures', () => {
    const recipe = BOOKING_PAGE_PRESET_RECIPES.signature;
    const reorderedVariants = Object.fromEntries(
      Object.entries(recipe.sectionVariants).toReversed(),
    );
    const base = presentation(recipe);

    expect(getBookingPagePresentationSignature({
      ...base,
      sectionVariants: reorderedVariants,
    })).toBe(getBookingPagePresentationSignature(base));

    const first = {
      ...base,
      sectionVariants: { serviceMenu: 'list|hoursLocation:full' },
    } as BookingPagePresetPresentationState;
    const second = {
      ...base,
      sectionVariants: { serviceMenu: 'list', hoursLocation: 'full' },
    } as BookingPagePresetPresentationState;

    expect(getBookingPagePresentationSignature(first))
      .not.toBe(getBookingPagePresentationSignature(second));
  });

  it('matches only the exact recipe including its preset base', () => {
    for (const presetId of BOOKING_PAGE_PRESET_IDS) {
      const recipe = BOOKING_PAGE_PRESET_RECIPES[presetId];

      expect(findMatchingBookingPagePreset(presentation(recipe))).toEqual(reference(presetId));
    }

    const menu = presentation(BOOKING_PAGE_PRESET_RECIPES.menu);

    expect(findMatchingBookingPagePreset({ ...menu, presetBase: null })).toBeNull();
    expect(findMatchingBookingPagePreset({ ...menu, layout: 'quick_book' })).toBeNull();
    expect(findMatchingBookingPagePreset({
      ...menu,
      sectionOrder: [...menu.sectionOrder].toReversed(),
    })).toBeNull();
    expect(findMatchingBookingPagePreset({ ...menu, hiddenSections: ['policies'] })).toBeNull();
    expect(findMatchingBookingPagePreset({
      ...menu,
      sectionVariants: { ...menu.sectionVariants, serviceMenu: 'list' },
    })).toBeNull();
  });

  it('describes a guarded change deterministically and returns no changes for an exact match', () => {
    const quickBook = presentation(BOOKING_PAGE_PRESET_RECIPES.quick_book);
    const collectiveReference = reference('collective');

    expect(describeBookingPagePresetChanges(quickBook, collectiveReference)).toEqual([
      'Preset base: Quick Book v1 → Collective v1',
      'Layout: quick_book → editorial',
      'Section order: salonProfile, technicianProfile, featuredServices, serviceMenu, hoursLocation, policies, socialLinks, bookingCta',
      'Presentation (featuredServices): carousel → signature',
      'Presentation (hoursLocation): full → location_cards',
      'Presentation (policies): card → inline',
      'Presentation (salonProfile): compact → hero_image',
      'Presentation (socialLinks): icons → labeled',
      'Presentation (technicianProfile): full → cards',
    ]);
    expect(describeBookingPagePresetChanges(
      presentation(BOOKING_PAGE_PRESET_RECIPES.collective),
      collectiveReference,
    )).toEqual([]);
    expect(describeBookingPagePresetChanges(quickBook, {
      presetId: 'collective',
      recipeVersion: 2,
    } as unknown as BookingPagePresetReference)).toEqual([
      'The selected preset recipe version is unavailable.',
    ]);
  });

  it('contains presentation/provenance only, never style, tokens, or salon content', () => {
    const forbiddenKeys = new Set([
      'stylePack',
      'tokenOverrides',
      'content',
      'salonContent',
      'businessMode',
      'startMode',
      'custom',
    ]);

    for (const recipe of Object.values(BOOKING_PAGE_PRESET_RECIPES)) {
      expect(Object.keys(recipe).filter(key => forbiddenKeys.has(key))).toEqual([]);
      expect(JSON.stringify(recipe)).not.toMatch(/stylePack|tokenOverrides|salonContent|businessMode|startMode/);
    }
  });
});
