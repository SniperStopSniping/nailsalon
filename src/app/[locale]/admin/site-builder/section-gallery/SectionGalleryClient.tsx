'use client';

import { useMemo, useState } from 'react';

import { createDefaultBookingPresentationSettings } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/booking/presentation';
import { CustomDesignAssetProvider } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider';
import {
  buildWebsiteRecipeDocument,
  WEBSITE_RECIPES,
  type WebsiteRecipeId,
} from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/section-library/recipes';
import {
  getSectionRegistryEntry,
  SECTION_LIBRARY_REGISTRY,
} from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/section-library/registry';
import type { SitePlanPage } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/site-plan';
import { initializeStarter } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import type {
  LibrarySectionType,
  SectionInstance,
  SiteBuilderDocument,
} from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import {
  createDemoOnboardingState,
  DEMO_SITE_CONTENT,
} from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/demo-content';
import { SITE_PALETTE_PRESETS } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/palettes';
import type {
  SitePalettePresetId,
  SiteStylePresetId,
} from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import {
  ONBOARDING_STYLE_ROLES,
  type OnboardingPreviewDevice,
  OnboardingSitePreview,
} from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/OnboardingSitePreview';

/** Gallery ordering mirrors the master section responsibility matrix. */
const GALLERY_ORDER: readonly GalleryTypeId[] = [
  'announcement_bar',
  'hero',
  'quick_info',
  'section_navigation',
  'featured_services',
  'booking',
  'offers',
  'gallery',
  'about',
  'team',
  'reviews',
  'deposits_cancellations',
  'policies',
  'faq',
  'hours',
  'visit_us',
  'contact',
  'custom_design',
  'final_cta',
  'footer',
];

type GalleryTypeId = LibrarySectionType | 'booking' | 'custom_design';

const STYLE_IDS = Object.keys(ONBOARDING_STYLE_ROLES) as SiteStylePresetId[];

const DEVICES: readonly OnboardingPreviewDevice[] = ['phone', 'tablet', 'desktop'];

const getGalleryAssetIds = (): ReadonlySet<string> => new Set();

/** Demo-record bindings so content-bound sections preview populated. */
const DEMO_BOUND_SETTINGS: Partial<Record<LibrarySectionType, Record<string, unknown>>> = {
  announcement_bar: {
    action: { kind: 'booking', label: 'Book September appointments' },
    dismissible: true,
    message: 'September appointments are now open.',
    reassurance: 'New clients are welcome.',
  },
  faq: { itemIds: DEMO_SITE_CONTENT.faq.map(item => item.id) },
  offers: { offerIds: DEMO_SITE_CONTENT.offers.map(offer => offer.id) },
  reviews: { reviewIds: DEMO_SITE_CONTENT.reviews.map(review => review.id) },
  team: { memberIds: DEMO_SITE_CONTENT.staff.map(member => member.id) },
};

type GalleryEntryMeta = {
  id: GalleryTypeId;
  label: string;
  description: string;
  category: string;
  presetIds: readonly string[];
  defaultPresetId: string;
  sampleContent: boolean;
};

const ENGINE_META: Record<'booking' | 'custom_design', GalleryEntryMeta> = {
  booking: {
    category: 'engine',
    defaultPresetId: 'canonical',
    description: 'The canonical booking engine — services, add-ons, artists, times, and confirmation. Always exactly one per site.',
    id: 'booking',
    label: 'Services & Booking',
    presetIds: ['canonical'],
    sampleContent: false,
  },
  custom_design: {
    category: 'engine',
    defaultPresetId: 'poster',
    description: 'Your own Canva design, uploaded as images with validated customer actions. Previews only with your uploaded artwork — nothing is faked here.',
    id: 'custom_design',
    label: 'Custom Design',
    presetIds: ['poster'],
    sampleContent: false,
  },
};

const galleryMeta = (id: GalleryTypeId): GalleryEntryMeta => {
  if (id === 'booking' || id === 'custom_design') return ENGINE_META[id];
  const entry = SECTION_LIBRARY_REGISTRY[id];
  return {
    category: entry.category,
    defaultPresetId: entry.defaultPresetId,
    description: entry.description,
    id,
    label: entry.label,
    presetIds: entry.presetIds,
    sampleContent: id === 'announcement_bar' || entry.dataDomains.some(domain =>
      domain === 'staff' || domain === 'reviews' || domain === 'offers' || domain === 'faq'),
  };
};

export function SectionGalleryClient() {
  const [mode, setMode] = useState<'sections' | 'websites'>('sections');
  const [recipeId, setRecipeId] = useState<WebsiteRecipeId>('quick_book');
  const [selectedId, setSelectedId] = useState<GalleryTypeId>('hero');
  const [styleId, setStyleId] = useState<SiteStylePresetId>('modern');
  const [paletteId, setPaletteId] = useState<SitePalettePresetId>('luster_berry');
  const [device, setDevice] = useState<OnboardingPreviewDevice>('phone');
  const [presetById, setPresetById] = useState<Partial<Record<GalleryTypeId, string>>>({});

  const meta = galleryMeta(selectedId);
  const selectedPreset = presetById[selectedId] ?? meta.defaultPresetId;

  const demoState = useMemo(() => {
    const state = createDemoOnboardingState();
    return {
      ...state,
      gallery: {
        ...state.gallery,
        layout: (selectedId === 'gallery'
          && (selectedPreset === 'grid' || selectedPreset === 'carousel' || selectedPreset === 'editorial'))
          ? selectedPreset
          : state.gallery.layout,
      },
      recipe: {
        ...state.recipe,
        aboutEnabled: true,
        aboutPreset: (selectedId === 'about'
          && (selectedPreset === 'photo_right'
            || selectedPreset === 'editorial_portrait'
            || selectedPreset === 'profile_quick_facts'
            || selectedPreset === 'about_before_you_book'))
          ? selectedPreset
          : state.recipe.aboutPreset,
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
  }, [paletteId, selectedId, selectedPreset, styleId]);

  const recipe = WEBSITE_RECIPES.find(candidate => candidate.id === recipeId)
    ?? WEBSITE_RECIPES[0]!;
  const recipeDocument = useMemo<SiteBuilderDocument>(
    () => buildWebsiteRecipeDocument(recipe.id, { siteContent: DEMO_SITE_CONTENT }),
    [recipe.id],
  );
  const recipeState = useMemo(() => {
    const state = createDemoOnboardingState();
    return {
      ...state,
      recipe: {
        ...state.recipe,
        aboutEnabled: true,
        canvaEnabled: false,
        galleryEnabled: true,
        paletteConfirmed: true,
        palettePreset: paletteId,
        policiesEnabled: true,
        starter: recipe.originStarter,
        styleConfirmed: true,
        stylePreset: styleId,
      },
    };
  }, [paletteId, recipe.originStarter, styleId]);

  const demoDocument = useMemo<SiteBuilderDocument>(() => {
    let counter = 0;
    const base = initializeStarter('quick_book', {
      idFactory: kind => `section-gallery-${kind}-${counter++}`,
    });
    return { ...base, siteContent: DEMO_SITE_CONTENT };
  }, []);

  const previewPlan = useMemo<SitePlanPage[] | null>(() => {
    if (selectedId === 'custom_design') return null;
    const sectionId = `gallery-preview-${selectedId}`;
    let section: SectionInstance;
    if (selectedId === 'booking') {
      section = {
        id: sectionId,
        label: 'Booking',
        order: 0,
        sectionType: 'booking',
        settings: createDefaultBookingPresentationSettings(),
        visible: true,
      };
    } else {
      const entry = getSectionRegistryEntry(selectedId);
      const settings = entry.normalize({
        ...entry.defaultSettings(),
        ...DEMO_BOUND_SETTINGS[selectedId],
        preset: selectedPreset,
      });
      section = {
        id: sectionId,
        label: entry.label,
        order: 0,
        sectionType: selectedId,
        settings,
        visible: true,
      // The registry's own normalizer produced the settings, so the
      // correlated (type, settings) pair is definitionally valid.
      } as SectionInstance;
    }

    const sections: SectionInstance[] = [section];

    // Section Navigation needs real, visible destinations in order to render
    // meaningful customer output. Keep those destinations inside the gallery
    // fixture so the standalone preview exercises the same plan used by a
    // customer site instead of displaying an empty navigation band.
    if (selectedId === 'section_navigation') {
      (['featured_services', 'reviews'] as const).forEach((sectionType, index) => {
        const entry = getSectionRegistryEntry(sectionType);
        sections.push({
          id: `gallery-preview-navigation-target-${sectionType}`,
          label: entry.label,
          order: index + 1,
          sectionType,
          settings: entry.normalize({
            ...entry.defaultSettings(),
            ...DEMO_BOUND_SETTINGS[sectionType],
          }),
          visible: true,
        } as SectionInstance);
      });
    }

    return [{
      id: 'section-gallery-page',
      isHome: true,
      label: 'Preview',
      order: 0,
      sections: sections.map(candidate => ({
        attachedToPrevious: false,
        id: candidate.id,
        injected: false,
        label: candidate.label,
        section: candidate,
        sectionType: candidate.sectionType,
        surface: candidate.sectionType === 'booking'
          ? 'base'
          : getSectionRegistryEntry(candidate.sectionType as LibrarySectionType).surface,
      })),
      slug: '',
      visibleInNavigation: true,
    }];
  }, [selectedId, selectedPreset]);

  const gallery = (
    <main className="section-gallery">
      <header className="section-gallery__header">
        <div>
          <p className="section-gallery__eyebrow">Site builder</p>
          <h1>Section Gallery</h1>
          <p className="section-gallery__lede">
            Every section your website can use, previewed with Isla Nail
            Studio’s styling. Sections marked “sample content” show
            demonstration records until you add your own.
          </p>
          <div aria-label="Gallery view" className="section-gallery__mode" role="group">
            <button
              aria-pressed={mode === 'sections'}
              onClick={() => setMode('sections')}
              type="button"
            >
              Sections
            </button>
            <button
              aria-pressed={mode === 'websites'}
              onClick={() => setMode('websites')}
              type="button"
            >
              Complete websites
            </button>
          </div>
        </div>
      </header>

      {mode === 'websites' ? (
        <div className="section-gallery__body">
          <nav aria-label="Website recipes" className="section-gallery__list">
            {WEBSITE_RECIPES.map((candidate) => (
              <button
                aria-pressed={candidate.id === recipeId}
                className="section-gallery__item"
                key={candidate.id}
                onClick={() => setRecipeId(candidate.id)}
                type="button"
              >
                <span className="section-gallery__item-copy">
                  <strong>{candidate.name}</strong>
                  <small>{candidate.audience}</small>
                </span>
              </button>
            ))}
          </nav>
          <section aria-label={`${recipe.name} website preview`} className="section-gallery__stage">
            <div className="section-gallery__stage-head">
              <div>
                <h2>{recipe.name}</h2>
                <p>{recipe.description}</p>
                <p className="section-gallery__sample-note">
                  Shown with sample content — your own appears once you add it.
                </p>
              </div>
            </div>
            <div className="section-gallery__controls">
              <div aria-label="Style" className="section-gallery__control" role="group">
                <span>Style</span>
                <div>
                  {STYLE_IDS.map(id => (
                    <button
                      aria-pressed={id === styleId}
                      key={id}
                      onClick={() => setStyleId(id)}
                      type="button"
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
              <div aria-label="Palette" className="section-gallery__control" role="group">
                <span>Palette</span>
                <div>
                  {SITE_PALETTE_PRESETS.map(palette => (
                    <button
                      aria-pressed={palette.id === paletteId}
                      key={palette.id}
                      onClick={() => setPaletteId(palette.id)}
                      style={{ ['--swatch' as string]: palette.roles.accent }}
                      title={palette.description}
                      type="button"
                    >
                      <i aria-hidden="true" />
                      {palette.label}
                    </button>
                  ))}
                </div>
              </div>
              <div aria-label="Device" className="section-gallery__control" role="group">
                <span>Device</span>
                <div>
                  {DEVICES.map(id => (
                    <button
                      aria-pressed={id === device}
                      key={id}
                      onClick={() => setDevice(id)}
                      type="button"
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="section-gallery__preview" data-device={device}>
              <OnboardingSitePreview
                device={device}
                document={recipeDocument}
                includeOptionalSections={false}
                interactionMode="interactive"
                key={`${recipe.id}-${styleId}-${paletteId}-${device}`}
                label={`${recipe.name} website preview`}
                state={recipeState}
              />
            </div>
          </section>
        </div>
      ) : (
      <div className="section-gallery__body">
        <nav aria-label="Sections" className="section-gallery__list">
          {GALLERY_ORDER.map((id, index) => {
            const item = galleryMeta(id);
            return (
              <button
                aria-pressed={id === selectedId}
                className="section-gallery__item"
                key={id}
                onClick={() => setSelectedId(id)}
                type="button"
              >
                <span className="section-gallery__item-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="section-gallery__item-copy">
                  <strong>{item.label}</strong>
                  <small>{item.category}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <section aria-label={`${meta.label} preview`} className="section-gallery__stage">
          <div className="section-gallery__stage-head">
            <div>
              <h2>{meta.label}</h2>
              <p>{meta.description}</p>
              {meta.sampleContent ? (
                <p className="section-gallery__sample-note">
                  Shown with sample content — your own appears once you add it.
                </p>
              ) : null}
            </div>
          </div>

          <div className="section-gallery__controls">
            {meta.presetIds.length > 1 ? (
              <div aria-label="Section design" className="section-gallery__control" role="group">
                <span>Design</span>
                <div>
                  {meta.presetIds.map(presetId => (
                    <button
                      aria-pressed={presetId === selectedPreset}
                      key={presetId}
                      onClick={() => setPresetById(current => ({
                        ...current,
                        [selectedId]: presetId,
                      }))}
                      type="button"
                    >
                      {presetId.replaceAll('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div aria-label="Style" className="section-gallery__control" role="group">
              <span>Style</span>
              <div>
                {STYLE_IDS.map(id => (
                  <button
                    aria-pressed={id === styleId}
                    key={id}
                    onClick={() => setStyleId(id)}
                    type="button"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
            <div aria-label="Palette" className="section-gallery__control" role="group">
              <span>Palette</span>
              <div>
                {SITE_PALETTE_PRESETS.map(palette => (
                  <button
                    aria-pressed={palette.id === paletteId}
                    key={palette.id}
                    onClick={() => setPaletteId(palette.id)}
                    style={{ ['--swatch' as string]: palette.roles.accent }}
                    title={palette.description}
                    type="button"
                  >
                    <i aria-hidden="true" />
                    {palette.label}
                  </button>
                ))}
              </div>
            </div>
            <div aria-label="Device" className="section-gallery__control" role="group">
              <span>Device</span>
              <div>
                {DEVICES.map(id => (
                  <button
                    aria-pressed={id === device}
                    key={id}
                    onClick={() => setDevice(id)}
                    type="button"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="section-gallery__preview" data-device={device}>
            {previewPlan ? (
              <OnboardingSitePreview
                customerPagePlan={previewPlan}
                device={device}
                document={demoDocument}
                includeOptionalSections={false}
                interactionMode="interactive"
                key={`${selectedId}-${selectedPreset}-${styleId}-${paletteId}-${device}`}
                label={`${meta.label} section preview`}
                state={demoState}
              />
            ) : (
              <div className="section-gallery__honest-empty">
                <h3>Custom Design previews with your artwork only</h3>
                <p>
                  This section renders images you upload from Canva, with
                  validated customer actions. There is no sample artwork to
                  show, because nothing here is allowed to fake your design.
                  Add a Custom Design in the Builder to see it live.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      )}
    </main>
  );

  return (
    <CustomDesignAssetProvider getReachableAssetIds={getGalleryAssetIds}>
      {gallery}
    </CustomDesignAssetProvider>
  );
}
