import { describe, expect, it } from 'vitest';

import {
  applyBookingPageBuilderOperation,
  type BookingPagePresentationState,
  getBookingPageBuilderSectionDefinition,
  isBookingPagePresentationCustomized,
  isBookingPageSectionCustomized,
  resolveBookingPageStartingPresentation,
} from './bookingPageBuilder';
import type { SectionId } from './bookingPageConfig';
import {
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  BOOKING_PAGE_PRESET_RECIPES,
  getBookingPagePresentationSignature,
} from './bookingPagePresetRecipes';

function editorialState(
  overrides: Partial<BookingPagePresentationState> = {},
): BookingPagePresentationState {
  const inherited = resolveBookingPageStartingPresentation('editorial');

  return {
    layout: 'editorial',
    sectionOrder: [...inherited.sectionOrder],
    sectionVariants: { ...inherited.sectionVariants },
    hiddenSections: [...inherited.hiddenSections],
    ...overrides,
  };
}

describe('booking-page builder operations', () => {
  it.each([
    ['grouped_categories', 'category_menu'],
    ['list', 'visual_grid'],
    [null, 'visual_grid'],
  ] as const)('maps a direct Services %s selection to canonical %s', (variant, serviceMenuLayout) => {
    const current = editorialState({ serviceMenuLayout: 'editorial_cards' });
    const snapshot = structuredClone(current);
    const result = applyBookingPageBuilderOperation(current, {
      type: 'set_variant',
      sectionId: 'serviceMenu',
      variant,
    });

    expect(result).toMatchObject({ ok: true, patch: { serviceMenuLayout } });
    expect(current).toEqual(snapshot);

    if (!result.ok) {
      throw new Error('Expected a valid service presentation');
    }

    expect(Object.keys(result.patch).sort()).toEqual(['sectionVariants', 'serviceMenuLayout']);
  });

  it('resets only an explicitly targeted Services layout to its inherited recipe', () => {
    const current = editorialState({ serviceMenuLayout: 'category_menu' });

    expect(isBookingPageSectionCustomized(current, 'serviceMenu')).toBe(true);
    expect(applyBookingPageBuilderOperation(current, {
      type: 'reset_section',
      sectionId: 'serviceMenu',
    })).toEqual({ ok: true, patch: { serviceMenuLayout: 'visual_grid' } });
    expect(applyBookingPageBuilderOperation(current, {
      type: 'reset_section',
      sectionId: 'policies',
    })).toEqual({ ok: true, patch: {} });

    const menu = BOOKING_PAGE_PRESET_RECIPES.menu;
    const menuState = { ...current, ...menu, presetBase: menu.presetBase };

    expect(applyBookingPageBuilderOperation(menuState, {
      type: 'set_variant',
      sectionId: 'serviceMenu',
      variant: null,
    })).toMatchObject({ ok: true, patch: { serviceMenuLayout: 'category_menu' } });
  });

  it.each(['visual_grid', 'clean_list', 'editorial_cards', 'category_menu', 'editorial_price_list'] as const)(
    'preserves independent %s on site preset and page reset operations',
    (serviceMenuLayout) => {
      const current = editorialState({ serviceMenuLayout });
      const expectedPresentationSignature = getBookingPagePresentationSignature({
        ...current,
        presetBase: current.presetBase ?? null,
      });

      for (const operation of [
        { type: 'reset_all', expectedPresentationSignature },
        { type: 'apply_preset', presetId: 'menu', presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION, expectedPresentationSignature },
        { type: 'set_variant', sectionId: 'policies', variant: 'inline' },
      ] as const) {
        const result = applyBookingPageBuilderOperation(current, operation);

        expect(result.ok).toBe(true);

        if (!result.ok) {
          throw new Error('Expected a valid site presentation operation');
        }

        expect(result.patch).not.toHaveProperty('serviceMenuLayout');
        expect({ ...current, ...result.patch }.serviceMenuLayout).toBe(serviceMenuLayout);
      }
    },
  );

  it('rejects hiding every protected Stage 2 floor section', () => {
    const current = editorialState();

    for (const sectionId of ['salonProfile', 'serviceMenu', 'bookingCta'] as const) {
      expect(applyBookingPageBuilderOperation(current, {
        type: 'set_visibility',
        sectionId,
        visible: false,
      })).toEqual({ ok: false, code: 'SECTION_NOT_CONFIGURABLE' });
    }
  });

  it('hides and restores a supported owner-configurable section without dropping it from order', () => {
    const current = editorialState();
    const hidden = applyBookingPageBuilderOperation(current, {
      type: 'set_visibility',
      sectionId: 'policies',
      visible: false,
    });

    expect(hidden).toMatchObject({
      ok: true,
      patch: {
        hiddenSections: ['policies'],
      },
    });

    if (!hidden.ok) {
      throw new Error('Expected supported section to be hideable');
    }

    const restored = applyBookingPageBuilderOperation(
      { ...current, ...hidden.patch },
      { type: 'set_visibility', sectionId: 'policies', visible: true },
    );

    expect(restored).toMatchObject({
      ok: true,
      patch: {
        hiddenSections: [],
      },
    });
  });

  it('restores a supported section missing from order immediately before booking access', () => {
    const current = editorialState({
      sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
      hiddenSections: ['hoursLocation'],
    });

    const result = applyBookingPageBuilderOperation(current, {
      type: 'set_visibility',
      sectionId: 'hoursLocation',
      visible: true,
    });

    expect(result).toEqual({
      ok: true,
      patch: {
        sectionOrder: ['salonProfile', 'serviceMenu', 'hoursLocation', 'bookingCta'],
        hiddenSections: [],
      },
    });
  });

  it('moves only visible flow sections and leaves non-participating order entries intact', () => {
    const current = editorialState();
    const result = applyBookingPageBuilderOperation(current, {
      type: 'move_section',
      sectionId: 'hoursLocation',
      targetSectionId: 'technicianProfile',
      direction: 'up',
    });

    expect(result).toEqual({
      ok: true,
      patch: {
        sectionOrder: [
          'salonProfile',
          'featuredServices',
          'hoursLocation',
          'technicianProfile',
          'portfolio',
          'reviews',
          'serviceMenu',
          'policies',
          'socialLinks',
          'bookingCta',
        ],
      },
    });
  });

  it.each([
    ['a protected system section', 'bookingCta'],
    ['a nested service-menu-slot section', 'socialLinks'],
    ['an unsupported section', 'portfolio'],
  ] as const)('rejects moving %s', (_label, sectionId) => {
    expect(applyBookingPageBuilderOperation(editorialState(), {
      type: 'move_section',
      sectionId,
      targetSectionId: 'featuredServices',
      direction: 'up',
    })).toEqual({ ok: false, code: 'SECTION_NOT_REORDERABLE' });
  });

  it('rejects hidden/missing flow sections and movement beyond either bound', () => {
    expect(applyBookingPageBuilderOperation(editorialState({
      hiddenSections: ['technicianProfile'],
    }), {
      type: 'move_section',
      sectionId: 'technicianProfile',
      targetSectionId: 'featuredServices',
      direction: 'up',
    })).toEqual({ ok: false, code: 'SECTION_NOT_IN_ORDER' });

    expect(applyBookingPageBuilderOperation(editorialState(), {
      type: 'move_section',
      sectionId: 'featuredServices',
      targetSectionId: 'technicianProfile',
      direction: 'up',
    })).toEqual({ ok: false, code: 'MOVE_OUT_OF_BOUNDS' });

    expect(applyBookingPageBuilderOperation(editorialState(), {
      type: 'move_section',
      sectionId: 'policies',
      targetSectionId: 'hoursLocation',
      direction: 'down',
    })).toEqual({ ok: false, code: 'MOVE_OUT_OF_BOUNDS' });
  });

  it('accepts only section-owned, layout-compatible variants and clears an override with null', () => {
    expect(applyBookingPageBuilderOperation(editorialState(), {
      type: 'set_variant',
      sectionId: 'salonProfile',
      variant: 'hero_image',
    })).toMatchObject({ ok: true, patch: { sectionVariants: { salonProfile: 'hero_image' } } });

    const quickBook = {
      layout: 'quick_book',
      ...resolveBookingPageStartingPresentation('quick_book'),
    } as const;

    expect(applyBookingPageBuilderOperation(quickBook, {
      type: 'set_variant',
      sectionId: 'salonProfile',
      variant: 'hero_image',
    })).toEqual({ ok: false, code: 'VARIANT_NOT_ALLOWED' });

    expect(applyBookingPageBuilderOperation(editorialState(), {
      type: 'set_variant',
      sectionId: 'serviceMenu',
      variant: 'cards',
    })).toEqual({ ok: false, code: 'VARIANT_NOT_ALLOWED' });

    expect(applyBookingPageBuilderOperation(editorialState({
      sectionVariants: { policies: 'inline' },
    }), {
      type: 'set_variant',
      sectionId: 'policies',
      variant: null,
    })).toMatchObject({ ok: true, patch: { sectionVariants: {} } });
  });

  it('preserves unrelated legacy and future variant strings during a targeted edit', () => {
    const current = editorialState({
      sectionVariants: {
        salonProfile: 'hero',
        serviceMenu: 'future_menu',
        policies: 'inline',
      },
    });

    expect(applyBookingPageBuilderOperation(current, {
      type: 'set_variant',
      sectionId: 'socialLinks',
      variant: 'labeled',
    })).toEqual({
      ok: true,
      patch: {
        sectionVariants: {
          salonProfile: 'hero',
          serviceMenu: 'future_menu',
          policies: 'inline',
          socialLinks: 'labeled',
        },
      },
    });

    expect(applyBookingPageBuilderOperation(current, {
      type: 'reset_section',
      sectionId: 'policies',
    })).toMatchObject({
      ok: true,
      patch: {
        sectionVariants: {
          salonProfile: 'hero',
          serviceMenu: 'future_menu',
        },
      },
    });
  });

  it('resets one section to its inherited position, visibility, and variant state', () => {
    const inherited = resolveBookingPageStartingPresentation('editorial');
    const current = editorialState({
      sectionOrder: [
        'salonProfile',
        'policies',
        'featuredServices',
        'technicianProfile',
        'portfolio',
        'reviews',
        'serviceMenu',
        'hoursLocation',
        'socialLinks',
        'bookingCta',
      ],
      sectionVariants: { policies: 'card', socialLinks: 'labeled' },
      hiddenSections: ['policies', 'socialLinks'],
    });

    const result = applyBookingPageBuilderOperation(
      current,
      { type: 'reset_section', sectionId: 'policies' },
      inherited,
    );

    expect(result).toEqual({
      ok: true,
      patch: {
        sectionOrder: inherited.sectionOrder,
        sectionVariants: { socialLinks: 'labeled' },
        hiddenSections: ['socialLinks'],
      },
    });
    expect(isBookingPageSectionCustomized(
      { ...current, ...(result.ok ? result.patch : {}) },
      'policies',
      inherited,
    )).toBe(false);
  });

  it('restores an explicit inherited variant rather than assuming every starting design is variantless', () => {
    const inherited = {
      ...resolveBookingPageStartingPresentation('editorial'),
      sectionVariants: { policies: 'inline' },
    } as const;
    const current = editorialState({ sectionVariants: { policies: 'card' } });

    expect(applyBookingPageBuilderOperation(
      current,
      { type: 'reset_section', sectionId: 'policies' },
      inherited,
    )).toMatchObject({
      ok: true,
      patch: { sectionVariants: { policies: 'inline' } },
    });
  });

  it('resets the whole page exactly to inherited presentation and returns no business/style fields', () => {
    const inherited = resolveBookingPageStartingPresentation('editorial');
    const current = editorialState({
      sectionOrder: ['salonProfile', 'serviceMenu', 'policies', 'bookingCta'],
      sectionVariants: { policies: 'card' },
      hiddenSections: ['policies'],
    });

    const result = applyBookingPageBuilderOperation(current, {
      type: 'reset_all',
      expectedPresentationSignature: getBookingPagePresentationSignature({
        ...current,
        presetBase: null,
      }),
    }, inherited);

    expect(result).toEqual({
      ok: true,
      patch: {
        layout: 'editorial',
        ...inherited,
        presetBase: null,
      },
    });

    if (!result.ok) {
      throw new Error('Expected reset_all to succeed');
    }

    expect(Object.keys(result.patch).sort()).toEqual([
      'hiddenSections',
      'layout',
      'presetBase',
      'sectionOrder',
      'sectionVariants',
    ]);
    expect(result.patch).not.toHaveProperty('stylePack');
    expect(result.patch).not.toHaveProperty('tokenOverrides');
    expect(isBookingPagePresentationCustomized(
      { ...current, ...result.patch },
      inherited,
    )).toBe(false);
  });

  it('applies an exact versioned recipe from a fresh signature and rejects stale or unavailable recipes', () => {
    const currentRecipe = BOOKING_PAGE_PRESET_RECIPES.quick_book;
    const current = {
      layout: currentRecipe.layout,
      sectionOrder: [...currentRecipe.sectionOrder],
      sectionVariants: { ...currentRecipe.sectionVariants },
      hiddenSections: [...currentRecipe.hiddenSections],
      presetBase: { ...currentRecipe.presetBase },
    };
    const currentSnapshot = structuredClone(current);
    const expectedPresentationSignature = getBookingPagePresentationSignature(current);
    const target = BOOKING_PAGE_PRESET_RECIPES.collective;

    expect(applyBookingPageBuilderOperation(current, {
      type: 'apply_preset',
      presetId: 'collective',
      presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
      expectedPresentationSignature,
    })).toEqual({
      ok: true,
      patch: {
        layout: target.layout,
        sectionOrder: [...target.sectionOrder],
        sectionVariants: { ...target.sectionVariants },
        hiddenSections: [...target.hiddenSections],
        presetBase: { ...target.presetBase },
      },
    });
    expect(applyBookingPageBuilderOperation(current, {
      type: 'apply_preset',
      presetId: 'collective',
      presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
      expectedPresentationSignature: `${expectedPresentationSignature}-stale`,
    })).toEqual({ ok: false, code: 'STALE_PRESENTATION' });
    expect(applyBookingPageBuilderOperation(current, {
      type: 'apply_preset',
      presetId: 'collective',
      presetVersion: 2,
      expectedPresentationSignature,
    } as never)).toEqual({ ok: false, code: 'PRESET_NOT_FOUND' });
    expect(current).toEqual(currentSnapshot);
  });

  it('never mutates the current or inherited inputs', () => {
    const current = editorialState({
      sectionVariants: { hoursLocation: 'location_cards' },
      hiddenSections: ['policies'],
    });
    const inherited = resolveBookingPageStartingPresentation('editorial');
    const currentSnapshot = structuredClone(current);
    const inheritedSnapshot = structuredClone(inherited);
    Object.freeze(current.sectionOrder);
    Object.freeze(current.sectionVariants);
    Object.freeze(current.hiddenSections);
    Object.freeze(current);
    Object.freeze(inherited.sectionOrder);
    Object.freeze(inherited.sectionVariants);
    Object.freeze(inherited.hiddenSections);
    Object.freeze(inherited);

    expect(() => applyBookingPageBuilderOperation(current, {
      type: 'move_section',
      sectionId: 'hoursLocation',
      targetSectionId: 'technicianProfile',
      direction: 'up',
    }, inherited)).not.toThrow();
    expect(() => applyBookingPageBuilderOperation(current, {
      type: 'reset_section',
      sectionId: 'policies',
    }, inherited)).not.toThrow();
    expect(current).toEqual(currentSnapshot);
    expect(inherited).toEqual(inheritedSnapshot);
  });

  it('derives builder protection and reorderability from the canonical contracts', () => {
    const protectedIds: SectionId[] = ['salonProfile', 'serviceMenu', 'bookingCta'];
    for (const sectionId of protectedIds) {
      expect(getBookingPageBuilderSectionDefinition(sectionId, 'editorial')).toMatchObject({
        protected: true,
        reorderable: false,
      });
    }

    expect(getBookingPageBuilderSectionDefinition('hoursLocation', 'editorial')).toMatchObject({
      ownerConfigurable: true,
      supported: true,
      placement: 'flow',
      reorderable: true,
    });
    expect(getBookingPageBuilderSectionDefinition('socialLinks', 'editorial')).toMatchObject({
      ownerConfigurable: true,
      supported: true,
      placement: 'serviceMenuSlot',
      reorderable: false,
    });
  });
});
