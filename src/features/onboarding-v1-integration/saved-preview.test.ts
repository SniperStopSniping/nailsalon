import { describe, expect, it } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { ONBOARDING_EXAMPLE_GALLERY_IMAGES } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/gallery-examples';
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
    expect(model.state.profile.profilePhoto).toMatchObject({
      id: 'server-profile',
      previewUrl: '/api/onboarding/v1/media/server-profile',
    });
    expect(model.state.profile.logo).toMatchObject({
      id: 'server-logo',
      previewUrl: '/api/onboarding/v1/media/server-logo',
    });
    expect(model.state.profile.profilePhoto?.id).not.toBe(model.state.profile.logo?.id);
    expect(JSON.stringify(model)).not.toContain('profile-local');
    expect(JSON.stringify(model)).not.toContain('logo-local');
    expect(model.state.gallery.images.map(image => image.id))
      .toEqual(snapshot.gallery.imageItemIds);
    expect(model.state.recipe).toMatchObject({
      palettePreset: 'black_champagne',
      stylePreset: 'luxury',
    });
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
      id: 'server-custom-media',
    });
    expect(savedCustom.settings.cta).toMatchObject({
      placement: { imageItemId: 'server-custom-media', type: 'after_image' },
    });
    expect(savedCustom.settings.images[0]?.interactiveAreas[0]?.action).toEqual({
      destination: { pageId: document.pages[0]!.id, sectionId: booking.id },
      type: 'internal',
    });
    expect(model.media).toEqual([expect.objectContaining({
      assetId: 'server-custom-media',
      role: 'custom_design',
    })]);
    expect(JSON.stringify(model)).not.toContain('custom-image');
  });
});
