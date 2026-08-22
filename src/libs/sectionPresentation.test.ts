import { describe, expect, expectTypeOf, it } from 'vitest';

import type { BookingPageLayout, SectionId } from '@/libs/bookingPageConfig';
import { EMPTY_SALON_CONTENT } from '@/libs/salonContent';

import {
  deriveSalonProfileHeroAlt,
  isSupportedSectionVariant,
  resolveRenderableLayout,
  resolveSectionPresentation,
  SECTION_PRESENTATION_CONTRACT,
  SECTION_PRESENTATION_SECTION_IDS,
  SECTION_PRESENTATION_UIQI_CAPABILITIES,
  type SectionVariantId,
  type SectionVariantOverrides,
} from './sectionPresentation';

function content(heroImageUrl: string | null = 'https://images.example/hero.jpg') {
  return {
    identity: {
      ...EMPTY_SALON_CONTENT.identity,
      name: 'Isla Nail Studio',
      heroImageUrl,
    },
  };
}

describe('typed section presentation contract', () => {
  it('keeps runtime section keys exhaustive and section-specific unions narrow', () => {
    expect(Object.keys(SECTION_PRESENTATION_CONTRACT)).toEqual(SECTION_PRESENTATION_SECTION_IDS);

    expectTypeOf<SectionVariantId<'salonProfile'>>().toEqualTypeOf<'compact' | 'hero_image'>();
    expectTypeOf<SectionVariantId<'serviceMenu'>>().toEqualTypeOf<'list'>();
    expectTypeOf<SectionVariantId<'portfolio'>>().toEqualTypeOf<never>();
    expectTypeOf<SectionVariantOverrides>().toMatchTypeOf<{
      salonProfile?: 'compact' | 'hero_image';
      serviceMenu?: 'list';
    }>();

    for (const sectionId of SECTION_PRESENTATION_SECTION_IDS) {
      const definition = SECTION_PRESENTATION_CONTRACT[sectionId];
      for (const layout of ['quick_book', 'editorial'] as const) {
        const fallback = definition.defaults[layout];
        if (fallback !== null) {
          expect(definition.variants, `${sectionId}:${layout}`).toContain(fallback);
        }
      }
    }
  });

  it('maps every legacy stored layout to the documented Quick Book compatibility mode', () => {
    const legacy: BookingPageLayout[] = ['tech_profile', 'portfolio', 'catalogue'];

    expect(resolveRenderableLayout('quick_book')).toBe('quick_book');
    expect(resolveRenderableLayout('editorial')).toBe('editorial');

    for (const layout of legacy) {
      expect(resolveRenderableLayout(layout), layout).toBe('quick_book');
    }

    expect(resolveRenderableLayout('future-forged-layout')).toBe('quick_book');
  });

  it('resolves layout defaults without reading style or visibility state', () => {
    const quickBook = resolveSectionPresentation({
      layout: 'quick_book',
      sectionVariants: {},
      content: content(),
    });
    const editorial = resolveSectionPresentation({
      layout: 'editorial',
      sectionVariants: {},
      content: content(),
    });

    expect(quickBook).toMatchObject({
      layout: 'quick_book',
      pageFrame: 'compact',
      serviceMenuFrame: 'plain',
      bookingAccess: 'continue',
      variants: {
        salonProfile: 'compact',
        featuredServices: 'carousel',
        serviceMenu: 'list',
        policies: 'card',
      },
      placements: {
        featuredServices: 'serviceMenuSlot',
        policies: 'serviceMenuSlot',
        socialLinks: 'serviceMenuSlot',
      },
    });
    expect(editorial).toMatchObject({
      layout: 'editorial',
      pageFrame: 'editorial',
      serviceMenuFrame: 'services-anchor',
      bookingAccess: 'editorial-handoff',
      variants: {
        salonProfile: 'hero_image',
        featuredServices: 'signature',
        serviceMenu: 'list',
        policies: 'inline',
      },
      placements: {
        featuredServices: 'flow',
        policies: 'flow',
        socialLinks: 'serviceMenuSlot',
      },
    });
  });

  it('accepts only the requested section\'s supported and layout-compatible variant', () => {
    const editorial = resolveSectionPresentation({
      layout: 'editorial',
      sectionVariants: {
        salonProfile: 'compact',
        featuredServices: 'carousel',
        policies: 'card',
      },
      content: content(),
    });

    expect(editorial.variants).toMatchObject({
      salonProfile: 'compact',
      featuredServices: 'carousel',
      policies: 'card',
    });

    const wrongSection = resolveSectionPresentation({
      layout: 'quick_book',
      sectionVariants: {
        serviceMenu: 'hero_image',
        policies: 'signature',
        salonProfile: 'hero_image',
      },
      content: content(),
    });

    expect(wrongSection.variants).toMatchObject({
      serviceMenu: 'list',
      policies: 'card',
      salonProfile: 'compact',
    });
  });

  it.each([
    ['unknown string', { salonProfile: 'future_variant' }],
    ['whitespace', { salonProfile: '   ' }],
    ['wrong primitive', { salonProfile: 42 }],
    ['wrong container', ['compact']],
    ['missing value', {}],
  ])('falls back deterministically for %s', (_label, sectionVariants) => {
    const resolved = resolveSectionPresentation({
      layout: 'quick_book',
      sectionVariants,
      content: content(),
    });

    expect(resolved.variants.salonProfile).toBe('compact');
  });

  it('exposes only public renderer decisions and never echoes invalid owner diagnostics', () => {
    const ownerOnlyDiagnostic = 'future_variant_owner_debug_reason';
    const resolved = resolveSectionPresentation({
      layout: 'editorial',
      sectionVariants: { salonProfile: ownerOnlyDiagnostic },
      content: content(),
    });

    expect(Object.keys(resolved).sort()).toEqual([
      'bookingAccess',
      'layout',
      'pageFrame',
      'placements',
      'serviceMenuFrame',
      'variants',
    ]);
    expect(resolved).not.toHaveProperty('sources');
    expect(JSON.stringify(resolved)).not.toContain(ownerOnlyDiagnostic);
  });

  it('reads the inert pre-Stage-4 hero alias but never exposes it as a canonical write value', () => {
    const resolved = resolveSectionPresentation({
      layout: 'editorial',
      sectionVariants: { salonProfile: 'hero' },
      content: content(),
    });

    expect(resolved.variants.salonProfile).toBe('hero_image');
    expect(isSupportedSectionVariant('salonProfile', 'hero')).toBe(false);
    expect(isSupportedSectionVariant('salonProfile', 'hero_image')).toBe(true);
  });

  it('degrades a hero request with no canonical image to compact without mutating content', () => {
    const immutableContent = content(null);
    Object.freeze(immutableContent.identity);
    Object.freeze(immutableContent);
    const snapshot = structuredClone(immutableContent);

    const resolved = resolveSectionPresentation({
      layout: 'editorial',
      sectionVariants: { salonProfile: 'hero_image' },
      content: immutableContent,
    });

    expect(resolved.variants.salonProfile).toBe('compact');
    expect(immutableContent).toEqual(snapshot);
  });

  it('activates the Stage 3 hero obligation with derived canonical alt text', () => {
    expect(SECTION_PRESENTATION_UIQI_CAPABILITIES).toEqual({
      salonProfileHeroImage: true,
      salonProfileHeroDerivedAlt: true,
    });
    expect(deriveSalonProfileHeroAlt(content().identity)).toBe('Isla Nail Studio salon');
  });

  it('never accepts a variant belonging to another section', () => {
    const allVariants = new Map<string, SectionId[]>();
    for (const sectionId of SECTION_PRESENTATION_SECTION_IDS) {
      for (const variant of SECTION_PRESENTATION_CONTRACT[sectionId].variants) {
        allVariants.set(variant, [...(allVariants.get(variant) ?? []), sectionId]);
      }
    }

    for (const [variant, owners] of allVariants) {
      for (const sectionId of SECTION_PRESENTATION_SECTION_IDS) {
        expect(isSupportedSectionVariant(sectionId, variant), `${sectionId}:${variant}`)
          .toBe(owners.includes(sectionId));
      }
    }
  });
});
