/**
 * Deterministic showcase surface for automated visual evidence. Reachable
 * only through the audit/test harness (`?surface=sections&audit=1`), it
 * renders exactly what the owner Section Gallery renders — single sections,
 * ordered pairs, or complete website recipes — from URL parameters, so
 * Playwright can capture the full style × palette × device matrix without
 * product authentication. Nothing here is a second renderer: it constructs a
 * plan and hands it to the one real OnboardingSitePreview.
 */

import { useMemo } from 'react';

import { createDefaultBookingPresentationSettings } from '../../booking/presentation';
import {
  buildWebsiteRecipeDocument,
  getRecipeRequiredToggles,
  WEBSITE_RECIPE_BY_ID,
  type WebsiteRecipeId,
} from '../../model/section-library/recipes';
import {
  getSectionRegistryEntry,
  SECTION_LIBRARY_REGISTRY,
} from '../../model/section-library/registry';
import { buildCustomerPagePlan, type SitePlanPage } from '../../model/site-plan';
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
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../model/site-library-context';
import type { SitePalettePresetId, SiteStylePresetId } from '../model/types';
import {
  ONBOARDING_STYLE_ROLES,
  type OnboardingPreviewDevice,
  OnboardingSitePreview,
} from './OnboardingSitePreview';

type ShowcaseTypeId = LibrarySectionType | 'booking' | 'custom_design';

const BOUND_SETTINGS: Partial<Record<LibrarySectionType, Record<string, unknown>>> = {
  announcement_bar: { message: 'Now booking September appointments' },
  faq: { itemIds: DEMO_SITE_CONTENT.faq.map(item => item.id) },
  offers: { offerIds: DEMO_SITE_CONTENT.offers.map(offer => offer.id) },
  reviews: { reviewIds: DEMO_SITE_CONTENT.reviews.map(review => review.id) },
  team: { memberIds: DEMO_SITE_CONTENT.staff.map(member => member.id) },
};

const isShowcaseType = (value: string): value is ShowcaseTypeId =>
  value === 'booking'
  || value === 'custom_design'
  || Object.hasOwn(SECTION_LIBRARY_REGISTRY, value);

const sectionFor = (
  type: ShowcaseTypeId,
  id: string,
  order: number,
  presetId?: string | null,
): SectionInstance => {
  if (type === 'booking') {
    return {
      id,
      label: 'Booking',
      order,
      sectionType: 'booking',
      settings: createDefaultBookingPresentationSettings(),
      visible: true,
    };
  }
  if (type === 'custom_design') {
    throw new Error('Custom Design has no demo artwork to showcase.');
  }
  const entry = getSectionRegistryEntry(type);
  return {
    id,
    label: entry.label,
    order,
    sectionType: type,
    settings: entry.normalize({
      ...entry.defaultSettings(),
      ...BOUND_SETTINGS[type],
      ...(presetId && entry.presetIds.includes(presetId) ? { preset: presetId } : {}),
    }),
    visible: true,
  } as SectionInstance;
};

export function SectionShowcaseSurface() {
  const search = new URLSearchParams(window.location.search);
  const styleParam = search.get('style') ?? 'modern';
  const paletteParam = search.get('palette') ?? 'luster_berry';
  const deviceParam = search.get('device') ?? 'phone';
  const styleId: SiteStylePresetId = Object.hasOwn(ONBOARDING_STYLE_ROLES, styleParam)
    ? styleParam as SiteStylePresetId
    : 'modern';
  const paletteId: SitePalettePresetId = Object.hasOwn(SITE_PALETTE_BY_ID, paletteParam)
    ? paletteParam as SitePalettePresetId
    : 'luster_berry';
  const device: OnboardingPreviewDevice = deviceParam === 'desktop' || deviceParam === 'tablet'
    ? deviceParam
    : 'phone';
  // Evidence capture: unclip the device frame so a full-page screenshot
  // contains the whole customer page rather than one viewport of it.
  const fullFlow = search.get('full') === '1';
  const recipeParam = search.get('recipe');
  const typeParam = search.get('type');
  const secondParam = search.get('second');
  // `types=a,b,c` renders an ordered run; `type`/`second` stay supported.
  const typesParam = search.get('types');
  const presetParam = search.get('preset');

  const model = useMemo(() => {
    const state = createDemoOnboardingState();
    const showcaseState = {
      ...state,
      recipe: {
        ...state.recipe,
        aboutEnabled: true,
        canvaEnabled: false,
        galleryEnabled: true,
        paletteConfirmed: true,
        palettePreset: paletteId,
        policiesEnabled: true,
        starter: 'one_page' as const,
        styleConfirmed: true,
        stylePreset: styleId,
      },
    };

    if (recipeParam && Object.hasOwn(WEBSITE_RECIPE_BY_ID, recipeParam)) {
      const recipe = WEBSITE_RECIPE_BY_ID[recipeParam as WebsiteRecipeId];
      const document = buildWebsiteRecipeDocument(recipe.id, {
        siteContent: DEMO_SITE_CONTENT,
      });
      return {
        document,
        label: `${recipe.name} website showcase`,
        plan: undefined,
        state: {
          ...showcaseState,
          recipe: {
            ...showcaseState.recipe,
            // A recipe is shown with the optional-content toggles its own
            // pages need, not with everything switched on: the showcase
            // should demonstrate what applying the recipe gives you.
            ...getRecipeRequiredToggles(recipe.id),
            starter: recipe.originStarter,
          },
        },
      };
    }

    const requested = typesParam
      ? typesParam.split(',').map(value => value.trim())
      : [typeParam, secondParam];
    const types = requested
      .filter((value): value is string => Boolean(value))
      .filter(isShowcaseType)
      .filter(type => type !== 'custom_design');
    if (types.length === 0) {
      return null;
    }

    let counter = 0;
    const document: SiteBuilderDocument = {
      ...initializeStarter('quick_book', {
        idFactory: kind => `showcase-doc-${kind}-${counter++}`,
      }),
      siteContent: DEMO_SITE_CONTENT,
    };
    const sections = types.map((type, index) =>
      sectionFor(type, `showcase-${type}-${index}`, index, index === 0 ? presetParam : null));
    // Parking one instance of every injectable type in the unused bin
    // suppresses the legacy-era injections, so the page shows EXACTLY the
    // requested sections while adjacency still resolves through the real
    // ladder (optional toggles stay on so about/gallery pairs render).
    const injectionSuppressors = (
      ['about', 'gallery', 'deposits_cancellations', 'policies', 'contact'] as const
    ).map((type, index) => sectionFor(type, `showcase-suppressor-${type}`, index));
    const pairDocument: SiteBuilderDocument = {
      ...document,
      pages: [{ ...document.pages[0]!, sections }],
      unusedSections: [
        ...document.unusedSections,
        ...injectionSuppressors as SiteBuilderDocument['unusedSections'],
      ],
    };
    const plan: SitePlanPage[] = buildCustomerPagePlan(pairDocument, {
      context: deriveSiteLibraryContext(showcaseState, pairDocument),
      toggles: deriveSitePlanToggles(showcaseState),
    });
    return {
      document: pairDocument,
      label: `${types.join(' + ')} section showcase`,
      plan,
      state: showcaseState,
    };
  }, [paletteId, presetParam, recipeParam, secondParam, styleId, typeParam, typesParam]);

  if (!model) {
    return (
      <main data-showcase-error="unknown-target" style={{ padding: 24 }}>
        <h1>Section showcase</h1>
        <p>
          Pass ?type=&lt;section&gt; (optionally &second=…&preset=…) or
          ?recipe=&lt;id&gt;, plus style/palette/device.
        </p>
      </main>
    );
  }

  return (
    <main
      className={fullFlow ? 'section-showcase is-full-flow' : 'section-showcase'}
      data-showcase-ready="true"
      data-showcase-target={model.label}
    >
      <OnboardingSitePreview
        customerPagePlan={model.plan}
        device={device}
        document={model.document}
        interactionMode="interactive"
        label={model.label}
        overlayMode={fullFlow ? 'page' : 'contained'}
        state={model.state}
      />
    </main>
  );
}
