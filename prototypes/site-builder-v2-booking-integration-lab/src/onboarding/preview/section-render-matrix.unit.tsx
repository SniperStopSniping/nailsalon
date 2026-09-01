/**
 * Machine-checked renderer matrix: all 20 section types × 6 styles × 8
 * palettes × 2 devices (1,920 combinations) render through the real
 * OnboardingSitePreview with a fully populated demo state. Each combination
 * asserts the section actually renders (or is honestly absent, for Custom
 * Design without artwork) and that the chosen palette/style tokens reach the
 * preview root — so a broken style/palette/renderer pairing names itself.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultBookingPresentationSettings } from '../../booking/presentation';
import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import {
  getSectionRegistryEntry,
  SECTION_LIBRARY_REGISTRY,
} from '../../model/section-library/registry';
import type { SitePlanPage } from '../../model/site-plan';
import { initializeStarter } from '../../model/starters';
import type {
  LibrarySectionType,
  SectionInstance,
  SiteBuilderDocument,
} from '../../model/types';
import {
  createDemoOnboardingState,
  DEMO_SITE_CONTENT,
} from '../model/demo-content';
import { SITE_PALETTE_PRESETS } from '../model/palettes';
import type { SitePalettePresetId, SiteStylePresetId } from '../model/types';
import {
  ONBOARDING_STYLE_ROLES,
  type OnboardingPreviewDevice,
  OnboardingSitePreview,
} from './OnboardingSitePreview';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

type MatrixTypeId = LibrarySectionType | 'booking' | 'custom_design';

const ALL_TYPES: MatrixTypeId[] = [
  ...(Object.keys(SECTION_LIBRARY_REGISTRY) as LibrarySectionType[]),
  'booking',
  'custom_design',
];

const STYLE_IDS = Object.keys(ONBOARDING_STYLE_ROLES) as SiteStylePresetId[];
const PALETTE_IDS = SITE_PALETTE_PRESETS.map(preset => preset.id) as SitePalettePresetId[];
const DEVICES: readonly OnboardingPreviewDevice[] = ['phone', 'desktop'];

const BOUND_SETTINGS: Partial<Record<LibrarySectionType, Record<string, unknown>>> = {
  announcement_bar: { message: 'Now booking September appointments' },
  faq: { itemIds: DEMO_SITE_CONTENT.faq.map(item => item.id) },
  offers: { offerIds: DEMO_SITE_CONTENT.offers.map(offer => offer.id) },
  reviews: { reviewIds: DEMO_SITE_CONTENT.reviews.map(review => review.id) },
  team: { memberIds: DEMO_SITE_CONTENT.staff.map(member => member.id) },
};

const sectionFor = (type: MatrixTypeId): SectionInstance => {
  const id = `matrix-${type}`;
  if (type === 'booking') {
    return {
      id,
      label: 'Booking',
      order: 0,
      sectionType: 'booking',
      settings: createDefaultBookingPresentationSettings(),
      visible: true,
    };
  }
  if (type === 'custom_design') {
    return {
      id,
      label: 'Custom Design',
      order: 0,
      sectionType: 'custom_design',
      settings: createDefaultCustomDesignSettings(),
      visible: true,
    };
  }
  const entry = getSectionRegistryEntry(type);
  return {
    id,
    label: entry.label,
    order: 0,
    sectionType: type,
    settings: entry.normalize({
      ...entry.defaultSettings(),
      ...BOUND_SETTINGS[type],
    }),
    visible: true,
  } as SectionInstance;
};

const planFor = (type: MatrixTypeId): SitePlanPage[] => {
  const section = sectionFor(type);
  return [{
    id: 'matrix-page',
    isHome: true,
    label: 'Matrix',
    order: 0,
    sections: [{
      attachedToPrevious: false,
      id: section.id,
      injected: false,
      label: section.label,
      section,
      sectionType: section.sectionType,
      surface: type === 'booking' || type === 'custom_design'
        ? 'base'
        : getSectionRegistryEntry(type).surface,
    }],
    slug: '',
    visibleInNavigation: true,
  }];
};

/**
 * Section types that render no customer markup in this matrix, honestly:
 * Custom Design has no artwork (and fakes none); Section Navigation needs at
 * least two anchor targets on its page, and the matrix page has one section.
 */
const HONESTLY_ABSENT = new Set<MatrixTypeId>(['custom_design', 'section_navigation']);

describe('section renderer matrix (20 types × 6 styles × 8 palettes × 2 devices)', () => {
  afterEach(() => {
    cleanup();
  });

  const baseState = createDemoOnboardingState();
  let documentCounter = 0;
  const demoDocument: SiteBuilderDocument = {
    ...initializeStarter('quick_book', {
      idFactory: kind => `matrix-doc-${kind}-${documentCounter++}`,
    }),
    siteContent: DEMO_SITE_CONTENT,
  };

  it.each(ALL_TYPES.map(type => [type] as const))(
    'renders %s across every style, palette, and device',
    (type) => {
      const plan = planFor(type);
      for (const styleId of STYLE_IDS) {
        for (const paletteId of PALETTE_IDS) {
          for (const device of DEVICES) {
            const comboLabel = `${type} / ${styleId} / ${paletteId} / ${device}`;
            const state = {
              ...baseState,
              recipe: {
                ...baseState.recipe,
                aboutEnabled: true,
                canvaEnabled: true,
                galleryEnabled: true,
                paletteConfirmed: true,
                palettePreset: paletteId,
                policiesEnabled: true,
                styleConfirmed: true,
                stylePreset: styleId,
              },
            };
            const renderDocument: SiteBuilderDocument = {
              ...demoDocument,
              navigation: { ...demoDocument.navigation, enabled: false, items: [] },
              pages: [{
                ...demoDocument.pages[0]!,
                id: plan[0]!.id,
                isHome: true,
                name: plan[0]!.label,
                order: 0,
                sections: plan[0]!.sections.map(section => section.section),
                slug: plan[0]!.slug,
                visible: true,
                visibleInNavigation: plan[0]!.visibleInNavigation,
              }],
            };
            const { container, unmount } = render(
              <OnboardingSitePreview
                customerPagePlan={plan}
                device={device}
                document={renderDocument}
                interactionMode="interactive"
                state={state}
              />,
            );

            const root = container.querySelector<HTMLElement>('.onboarding-site-preview');
            expect(root, `missing preview root for ${comboLabel}`).not.toBeNull();

            const palette = SITE_PALETTE_PRESETS.find(preset => preset.id === paletteId)!;
            const styleRoles = ONBOARDING_STYLE_ROLES[styleId];
            const styleAttr = root!.getAttribute('style') ?? '';
            expect(styleAttr, `palette accent missing for ${comboLabel}`)
              .toContain(`--customer-accent: ${palette.roles.accent}`);
            expect(styleAttr, `heading font missing for ${comboLabel}`)
              .toContain(styleRoles.headingFont);

            const sectionNode = container.querySelector(
              `[data-section-id="matrix-${type}"]`,
            );
            if (HONESTLY_ABSENT.has(type)) {
              expect(sectionNode, `${comboLabel} should be honestly absent`).toBeNull();
            } else {
              expect(sectionNode, `${comboLabel} rendered nothing`).not.toBeNull();
            }

            unmount();
          }
        }
      }
    },
    120_000,
  );
});
