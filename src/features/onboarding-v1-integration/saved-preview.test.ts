import { describe, expect, it } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import {
  buildCustomerPagePlan,
  type SitePlanPage,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/site-plan';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { ONBOARDING_EXAMPLE_GALLERY_IMAGES } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/gallery-examples';
import { hasMeaningfulPublishablePolicies } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/policies';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-library-context';
import type { OnboardingLabState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import { compileOnboardingToSiteDocument } from './compiler';
import { createSavedSitePreviewModel } from './saved-preview';
import { createPersistableOnboardingDraft } from './snapshot';

const accountDraft = () => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.businessStructure = 'solo';
  state.profile.ownerName = 'Daniela';
  state.profile.profilePhoto = {
    fileName: 'daniela.webp',
    id: 'profile-local',
    mimeType: 'image/webp',
    source: 'indexed_db',
    storageId: 'profile-storage',
  };
  state.profile.logo = {
    fileName: 'isla-logo.webp',
    id: 'logo-local',
    mimeType: 'image/webp',
    source: 'indexed_db',
    storageId: 'logo-storage',
  };
  state.gallery = {
    images: ONBOARDING_EXAMPLE_GALLERY_IMAGES.map(image => ({ ...image })),
    layout: 'grid',
    source: 'mock_luster',
  };
  state.recipe.galleryEnabled = true;
  state.reviewOptions.previewTimestamp = '2026-09-04T17:45:00.000Z';
  state.recipe.palettePreset = 'black_champagne';
  state.recipe.starter = 'one_page';
  state.recipe.stylePreset = 'luxury';
  const document = initializeStarter('one_page', {
    siteId: 'accepted-site-document',
    siteName: state.profile.businessName,
  });
  return { document, state };
};

/**
 * The in-progress (live) customer plan: the same shared ladder the preview
 * component runs, fed straight from the working document and lab state.
 */
const livePagePlan = (
  document: SiteBuilderDocument,
  state: OnboardingLabState,
  customDesignFallback?: {
    id: string;
    placement: 'before_booking' | 'after_booking';
    settings: CustomDesignSettings;
  },
): SitePlanPage[] => buildCustomerPagePlan(document, {
  context: deriveSiteLibraryContext(state, document),
  ...(customDesignFallback ? { customDesignFallback } : {}),
  toggles: deriveSitePlanToggles(state),
});

const topology = (pages: readonly SitePlanPage[]) => pages.map(page => ({
  id: page.id,
  label: page.label,
  sectionTypes: page.sections.map(section => section.sectionType),
}));

describe('createSavedSitePreviewModel', () => {
  it('preserves accepted page/section identity and keeps profile and logo roles independent', () => {
    const { document, state } = accountDraft();
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      null,
      document,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 3,
      siteId: 'account-site',
      snapshot,
    });
    const model = createSavedSitePreviewModel({
      document: compiled,
      media: [
        {
          altText: 'Daniela profile photo',
          assetId: 'server-profile',
          fileName: 'daniela.webp',
          fileSize: 120,
          height: 800,
          localItemId: 'profile-local',
          mimeType: 'image/webp',
          publicUrl: '/api/onboarding/v1/media/server-profile',
          role: 'profile',
          sortOrder: 0,
          width: 600,
        },
        {
          altText: 'Isla Nail Studio logo',
          assetId: 'server-logo',
          fileName: 'isla-logo.webp',
          fileSize: 80,
          height: 300,
          localItemId: 'logo-local',
          mimeType: 'image/webp',
          publicUrl: '/api/onboarding/v1/media/server-logo',
          role: 'logo',
          sortOrder: 0,
          width: 800,
        },
      ],
      snapshot,
    });

    expect(model.document.pages.map(page => page.id))
      .toEqual(document.pages.map(page => page.id));
    expect(model.document.pages.flatMap(page => page.sections.map(section => section.id)))
      .toEqual(document.pages.flatMap(page => page.sections.map(section => section.id)));
    // The saved plan re-derives the persisted compiled tree exactly — every
    // compiled section, in compiled order, including the injected ids.
    expect(model.pagePlan.flatMap(page => page.sections.map(section => section.id)))
      .toEqual(compiled.pages.flatMap(page => page.sections.map(section => section.id)));
    expect(model.pagePlan.flatMap(page => page.sections.map(section => section.sectionType)))
      .toEqual(compiled.pages.flatMap(page => page.sections.map(section => section.type)));
    expect(model.state.profile.profilePhoto).toMatchObject({
      id: 'profile-local',
      previewUrl: '/api/onboarding/v1/media/server-profile',
      storageId: 'server-profile',
    });
    expect(model.state.profile.logo).toMatchObject({
      id: 'logo-local',
      previewUrl: '/api/onboarding/v1/media/server-logo',
      storageId: 'server-logo',
    });
    expect(model.state.profile.profilePhoto?.id).not.toBe(model.state.profile.logo?.id);
    expect(model.state.gallery.images.map(image => image.id))
      .toEqual(snapshot.gallery.imageItemIds);
    expect(model.state.recipe).toMatchObject({
      palettePreset: 'black_champagne',
      stylePreset: 'luxury',
    });
    expect(model.state.reviewOptions.previewTimestamp)
      .toBe('2026-09-04T17:45:00.000Z');
  });

  it('remaps Custom Design media to server-owned IDs without changing actions or topology', () => {
    const { document, state } = accountDraft();
    const booking = document.pages[0]!.sections.find(section => section.sectionType === 'booking')!;
    const customSettings: CustomDesignSettings = {
      ...createDefaultCustomDesignSettings(),
      cta: {
        label: 'Book now',
        placement: { imageItemId: 'custom-image', type: 'after_image' },
        type: 'book_now',
      },
      images: [{
        altText: 'Isla service menu',
        aspectRatio: 0.75,
        assetId: 'custom-image',
        decorative: false,
        fileName: 'menu.webp',
        fileSize: 500,
        height: 800,
        id: 'custom-image',
        interactiveAreas: [{
          accessibleLabel: 'Jump to Booking',
          action: {
            destination: { pageId: document.pages[0]!.id, sectionId: booking.id },
            type: 'internal',
          },
          geometry: { height: 10, width: 30, x: 10, y: 10 },
          id: 'area-booking',
          labelConfirmed: true,
          reviewStatus: 'approved',
          semanticOrder: 0,
          validationStatus: 'valid',
        }],
        mimeType: 'image/webp',
        width: 600,
      }],
    };
    document.pages[0]!.sections.push({
      id: 'custom-section',
      label: 'Custom Design',
      order: document.pages[0]!.sections.length,
      sectionType: 'custom_design',
      settings: customSettings,
      visible: true,
    });
    state.canva = {
      ...state.canva,
      customDesignSectionId: 'custom-section',
      status: 'ready',
    };
    state.recipe.canvaEnabled = true;
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      customSettings,
      document,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 1,
      siteId: 'account-site',
      snapshot,
    });
    const model = createSavedSitePreviewModel({
      document: compiled,
      media: [{
        altText: 'Isla service menu',
        assetId: 'server-custom-media',
        fileName: 'menu.webp',
        fileSize: 500,
        height: 800,
        localItemId: 'custom-image',
        mimeType: 'image/webp',
        publicUrl: '/api/onboarding/v1/media/server-custom-media',
        role: 'custom_design',
        sortOrder: 0,
        width: 600,
      }, {
        altText: 'A profile asset with a colliding local id',
        assetId: 'server-profile-collision',
        fileName: 'profile.webp',
        fileSize: 100,
        height: 800,
        localItemId: 'custom-image',
        mimeType: 'image/webp',
        publicUrl: '/api/onboarding/v1/media/server-profile-collision',
        role: 'profile',
        sortOrder: 0,
        width: 600,
      }],
      snapshot,
    });
    const savedCustom = model.document.pages[0]!.sections.find(
      section => section.sectionType === 'custom_design',
    );

    expect(savedCustom?.sectionType).toBe('custom_design');

    if (savedCustom?.sectionType !== 'custom_design') {
      return;
    }

    expect(savedCustom.settings.images[0]).toMatchObject({
      assetId: 'server-custom-media',
      id: 'custom-image',
    });
    expect(savedCustom.settings.cta).toMatchObject({
      placement: { imageItemId: 'custom-image', type: 'after_image' },
    });
    expect(savedCustom.settings.images[0]?.interactiveAreas[0]?.action).toEqual({
      destination: { pageId: document.pages[0]!.id, sectionId: booking.id },
      type: 'internal',
    });
    expect(model.media).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: 'server-custom-media',
        role: 'custom_design',
      }),
      expect.objectContaining({
        assetId: 'server-profile-collision',
        role: 'profile',
      }),
    ]));
    expect(model.media).toHaveLength(2);
    expect(savedCustom.settings.images[0]?.assetId).not.toBe('server-profile-collision');
    // Remapping the asset ids leaves the customer topology untouched.
    expect(topology(model.pagePlan)).toEqual(topology(livePagePlan(document, state)));
  });

  it('derives the saved customer plan from the persisted builder document, not the compiled page array', () => {
    const { document, state } = accountDraft();
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      null,
      document,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 7,
      siteId: 'account-site',
      snapshot,
    });
    const expectedSections = compiled.pages.flatMap(page => page.sections.map(section => ({
      id: section.id,
      type: section.type,
    })));
    const home = compiled.pages[0]!;
    const hero = home.sections.find(section => section.type === 'hero')!;
    const booking = home.sections.find(section => section.type === 'booking')!;
    // Scrambling and truncating the persisted compiled page array must not
    // move the saved plan: it is re-derived from the Builder document.
    compiled.pages = [{
      ...home,
      sections: [
        { ...booking, order: 1 },
        { ...hero, order: 0 },
      ],
    }];

    const model = createSavedSitePreviewModel({
      document: compiled,
      media: [],
      snapshot,
    });

    expect(model.document.pages[0]?.sections.length).toBeGreaterThan(2);
    expect(model.pagePlan).toHaveLength(1);
    expect(model.pagePlan[0]).toMatchObject({ id: home.id, label: home.label });
    expect(model.pagePlan.flatMap(page => page.sections.map(section => ({
      id: section.id,
      type: section.sectionType,
    })))).toEqual(expectedSections);
  });

  it('keeps an after-Booking Custom Design and public Contact in the same place live and saved', () => {
    const { state } = accountDraft();
    state.recipe.aboutEnabled = false;
    state.recipe.canvaEnabled = true;
    state.recipe.galleryEnabled = false;
    state.recipe.policiesEnabled = true;
    state.recipe.starter = 'quick_book';
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.locationType = 'salon_suite';
    state.profile.policies.other.custom = 'Please arrive with bare nails.';
    state.profile.policies.copy.other.visible = true;
    const document = initializeStarter('quick_book', {
      siteId: 'accepted-quick-book',
      siteName: state.profile.businessName,
    });
    const customSettings: CustomDesignSettings = {
      ...createDefaultCustomDesignSettings(),
      images: [{
        accessibleSummary: 'A customer-ready design panel.',
        altText: 'Isla custom nail design panel',
        aspectRatio: 1,
        assetId: 'custom-after-booking-artwork',
        decorative: false,
        fileName: 'custom-after-booking-artwork.png',
        fileSize: 1_024,
        height: 800,
        id: 'custom-after-booking-artwork',
        interactiveAreas: [],
        mimeType: 'image/png',
        width: 800,
      }],
    };
    document.pages[0]!.sections.push({
      id: 'custom-after-booking',
      label: 'Custom Design',
      order: document.pages[0]!.sections.length,
      sectionType: 'custom_design',
      settings: customSettings,
      visible: true,
    });
    state.canva = {
      ...state.canva,
      customDesignSectionId: 'custom-after-booking',
      status: 'ready',
    };
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      customSettings,
      document,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 2,
      siteId: 'account-quick-book',
      snapshot,
    });
    const saved = createSavedSitePreviewModel({
      document: compiled,
      media: [{
        altText: 'Isla custom nail design panel',
        assetId: 'server-custom-after-booking-artwork',
        fileName: 'custom-after-booking-artwork.png',
        fileSize: 1_024,
        height: 800,
        localItemId: 'custom-after-booking-artwork',
        mimeType: 'image/png',
        publicUrl: '/api/onboarding/v1/media/server-custom-after-booking-artwork',
        role: 'custom_design',
        sortOrder: 0,
        width: 800,
      }],
      snapshot,
    });
    const live = livePagePlan(document, state, {
      id: 'custom-after-booking',
      placement: state.canva.placement,
      settings: customSettings,
    });

    expect(topology(live)).toEqual([{
      id: document.pages[0]!.id,
      label: 'Home',
      sectionTypes: [
        'hero',
        'booking',
        'deposits_cancellations',
        'policies',
        'contact',
        'final_cta',
        'footer',
        'custom_design',
      ],
    }]);
    expect(topology(saved.pagePlan)).toEqual(topology(live));
  });

  it('keeps a partial policy out of both the in-progress and saved customer tree', () => {
    const { state } = accountDraft();
    state.recipe.aboutEnabled = false;
    state.recipe.galleryEnabled = false;
    state.recipe.policiesEnabled = true;
    state.recipe.starter = 'quick_book';
    state.profile.policies.lateArrivals.gracePeriodMinutes = '10';
    const document = initializeStarter('quick_book', {
      siteId: 'accepted-partial-policy',
      siteName: state.profile.businessName,
    });
    const { snapshot } = createPersistableOnboardingDraft(
      state,
      state.recipe.palettePreset,
      null,
      document,
    );
    const compiled = compileOnboardingToSiteDocument({
      revision: 2,
      siteId: 'account-partial-policy',
      snapshot,
    });
    const saved = createSavedSitePreviewModel({
      document: compiled,
      media: [],
      snapshot,
    });
    const live = livePagePlan(document, state);
    const policySections = (pages: readonly SitePlanPage[]) => pages.flatMap(page => (
      page.sections.filter(section => (
        section.sectionType === 'policies'
        || section.sectionType === 'deposits_cancellations'
      ))
    ));

    expect(hasMeaningfulPublishablePolicies(state.profile.policies)).toBe(false);
    expect(policySections(live)).toEqual([]);
    expect(policySections(saved.pagePlan)).toEqual([]);
  });

  it.each(['hidden', 'unused'] as const)(
    'does not resurrect an owner-%s Custom Design when the site is saved',
    (ownershipState) => {
      const { state } = accountDraft();
      state.recipe.aboutEnabled = false;
      state.recipe.canvaEnabled = true;
      state.recipe.galleryEnabled = false;
      state.recipe.policiesEnabled = false;
      state.recipe.starter = 'quick_book';
      const document = initializeStarter('quick_book', {
        siteId: `accepted-${ownershipState}-custom`,
        siteName: state.profile.businessName,
      });
      const customSettings = createDefaultCustomDesignSettings();
      const customSection = {
        id: `${ownershipState}-custom-design`,
        label: 'Custom Design',
        order: ownershipState === 'unused' ? 0 : document.pages[0]!.sections.length,
        sectionType: 'custom_design' as const,
        settings: customSettings,
        visible: ownershipState !== 'hidden',
      };
      if (ownershipState === 'unused') {
        document.unusedSections.push(customSection);
      } else {
        document.pages[0]!.sections.push(customSection);
      }
      state.canva = {
        ...state.canva,
        customDesignSectionId: customSection.id,
        status: 'ready',
      };
      const { snapshot } = createPersistableOnboardingDraft(
        state,
        state.recipe.palettePreset,
        customSettings,
        document,
      );
      const compiled = compileOnboardingToSiteDocument({
        revision: 2,
        siteId: `account-${ownershipState}-custom`,
        snapshot,
      });
      const saved = createSavedSitePreviewModel({
        document: compiled,
        media: [],
        snapshot,
      });
      const live = livePagePlan(document, state, {
        id: customSection.id,
        placement: state.canva.placement,
        settings: customSettings,
      });
      const customSections = (pages: readonly SitePlanPage[]) => pages.flatMap(page => (
        page.sections.filter(section => section.sectionType === 'custom_design')
      ));

      expect(customSections(live)).toEqual([]);
      expect(customSections(saved.pagePlan)).toEqual([]);
      expect(topology(saved.pagePlan)).toEqual(topology(live));
    },
  );

  it.each(['quick_book', 'one_page', 'multi_page'] as const)(
    'keeps the in-progress and account-saved %s customer page topology in parity',
    (starter) => {
      const { state } = accountDraft();
      state.recipe.aboutEnabled = true;
      state.recipe.galleryEnabled = true;
      state.recipe.policiesEnabled = false;
      state.recipe.starter = starter;
      const document = initializeStarter(starter, {
        siteId: `accepted-${starter}`,
        siteName: state.profile.businessName,
      });
      const { snapshot } = createPersistableOnboardingDraft(
        state,
        state.recipe.palettePreset,
        null,
        document,
      );
      const compiled = compileOnboardingToSiteDocument({
        revision: 2,
        siteId: `account-${starter}`,
        snapshot,
      });
      const saved = createSavedSitePreviewModel({
        document: compiled,
        media: [],
        snapshot,
      });
      const live = livePagePlan(document, state);

      expect(live.length).toBeGreaterThan(0);
      expect(topology(saved.pagePlan)).toEqual(topology(live));
      // The persisted compiled record and the re-derived saved plan agree
      // section-for-section, so a saved site never drifts from what the owner
      // accepted in the live preview.
      expect(saved.pagePlan.flatMap(page => page.sections.map(section => section.sectionType)))
        .toEqual(compiled.pages.flatMap(page => page.sections.map(section => section.type)));
    },
  );
});
