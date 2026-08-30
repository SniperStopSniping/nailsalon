import { describe, expect, it } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { ONBOARDING_EXAMPLE_GALLERY_IMAGES } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/gallery-examples';
import { hasMeaningfulPublishablePolicies } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/policies';
import {
  getCurrentPreviewOutline,
  getCurrentPreviewPagePlan,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/OnboardingSitePreview';
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
    expect(model.pagePlan.flatMap(page => page.sections.map(section => section.id)))
      .toEqual(compiled.pages.flatMap(page => page.sections.flatMap(section => (
        ['about', 'booking', 'contact', 'custom_design', 'gallery', 'hero', 'policies']
          .includes(section.type)
          ? [section.id]
          : []
      ))));
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
  });

  it('uses the persisted compiled customer pages instead of rebuilding the raw starter outline', () => {
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
    const home = compiled.pages[0]!;
    const hero = home.sections.find(section => section.type === 'hero')!;
    const booking = home.sections.find(section => section.type === 'booking')!;
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
    expect(model.pagePlan).toEqual([{
      id: home.id,
      label: home.label,
      sections: [
        { id: hero.id, kind: 'hero', label: hero.presentation.label },
        { id: booking.id, kind: 'booking', label: booking.presentation.label },
      ],
    }]);
  });

  it('keeps public Contact after after-Booking Custom Design in live and saved previews', () => {
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
    const customSettings = createDefaultCustomDesignSettings();
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
      media: [],
      snapshot,
    });
    const live = getCurrentPreviewPagePlan(
      getCurrentPreviewOutline(document, state.recipe, {
        contactHasContent: true,
        galleryHasContent: false,
        includeOptionalSections: true,
        policiesHaveContent: true,
      }),
      { hasPublicContact: true },
    );
    const topology = (pages: typeof live) => pages.map(page => ({
      label: page.label,
      sectionKinds: page.sections.map(section => section.kind),
    }));

    expect(topology(live)).toEqual([{
      label: 'Home',
      sectionKinds: ['hero', 'booking', 'policies', 'custom_design', 'contact'],
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
    const live = getCurrentPreviewPagePlan(
      getCurrentPreviewOutline(document, state.recipe, {
        contactHasContent: false,
        galleryHasContent: false,
        includeOptionalSections: true,
        policiesHaveContent: hasMeaningfulPublishablePolicies(state.profile.policies),
      }),
      { hasPublicContact: false },
    );
    const policyKinds = (pages: typeof live) => pages.flatMap(page => (
      page.sections.filter(section => section.kind === 'policies')
    ));

    expect(policyKinds(live)).toEqual([]);
    expect(policyKinds(saved.pagePlan)).toEqual([]);
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
      const live = getCurrentPreviewPagePlan(
        getCurrentPreviewOutline(document, state.recipe, {
          contactHasContent: false,
          galleryHasContent: false,
          includeOptionalSections: true,
          policiesHaveContent: false,
        }),
        { hasPublicContact: false },
      );
      const customKinds = (pages: typeof live) => pages.flatMap(page => (
        page.sections.filter(section => section.kind === 'custom_design')
      ));

      expect(customKinds(live)).toEqual([]);
      expect(customKinds(saved.pagePlan)).toEqual([]);
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
      const live = getCurrentPreviewPagePlan(
        getCurrentPreviewOutline(document, state.recipe, {
          galleryHasContent: true,
          includeOptionalSections: true,
          policiesHaveContent: false,
        }),
        { hasPublicContact: false },
      );
      const topology = (pages: typeof live) => pages.map(page => ({
        id: page.id,
        sectionKinds: page.sections.map(section => section.kind),
      }));

      expect(topology(saved.pagePlan)).toEqual(topology(live));
    },
  );
});
