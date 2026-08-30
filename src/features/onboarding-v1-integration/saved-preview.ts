import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { ONBOARDING_EXAMPLE_GALLERY_IMAGES } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/gallery-examples';
import type {
  LocalImageReference,
  OnboardingLabState,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import type {
  OnboardingCompiledSiteDocument,
  OnboardingPersistedSnapshot,
  OnboardingSiteMediaRole,
} from './contracts';

export type SavedPreviewMedia = {
  assetId: string;
  altText: string | null;
  fileName: string;
  fileSize: number | null;
  height: number | null;
  mimeType: string;
  publicUrl: string;
  role: OnboardingSiteMediaRole;
  sortOrder: number;
  width: number | null;
};

export type SavedPreviewMediaRecord = SavedPreviewMedia & {
  localItemId: string;
};

export type SavedSitePreviewModel = {
  document: SiteBuilderDocument;
  media: SavedPreviewMedia[];
  state: OnboardingLabState;
};

const imageReference = (
  media: SavedPreviewMedia | undefined,
): LocalImageReference | undefined => media
  ? {
      ...(media.altText ? { altText: media.altText } : {}),
      fileName: media.fileName,
      ...(media.height ? { height: media.height } : {}),
      id: media.assetId,
      mimeType: media.mimeType,
      previewUrl: media.publicUrl,
      source: 'fixture',
      storageId: media.assetId,
      ...(media.width ? { width: media.width } : {}),
    }
  : undefined;

const roleMedia = (
  media: readonly SavedPreviewMediaRecord[],
  role: OnboardingSiteMediaRole,
): SavedPreviewMediaRecord[] => media
  .filter(item => item.role === role)
  .sort((left, right) => left.sortOrder - right.sortOrder);

/**
 * Projects one validated account-backed snapshot into the already-accepted
 * customer Preview renderer. The persisted universal Builder document remains
 * the structural authority; this adapter only restores connected profile and
 * server-owned media references that the renderer consumes.
 */
export function createSavedSitePreviewModel(input: {
  document: OnboardingCompiledSiteDocument;
  media: readonly SavedPreviewMediaRecord[];
  snapshot: OnboardingPersistedSnapshot;
}): SavedSitePreviewModel {
  const { document, media, snapshot } = input;
  const state = createDefaultOnboardingState();
  const profiles = roleMedia(media, 'profile');
  const logos = roleMedia(media, 'logo');
  const galleryMedia = roleMedia(media, 'gallery');
  const customDesignMedia = roleMedia(media, 'custom_design');
  const {
    logoItemId: _logoItemId,
    profilePhotoItemId: _profilePhotoItemId,
    ...persistedProfile
  } = snapshot.profile;
  const gallery = snapshot.gallery.source === 'mock_luster'
    ? snapshot.gallery.imageItemIds.flatMap((id) => {
        const example = ONBOARDING_EXAMPLE_GALLERY_IMAGES.find(item => item.id === id);
        return example ? [{ ...example }] : [];
      })
    : snapshot.gallery.imageItemIds.flatMap((id) => {
        const item = galleryMedia.find(candidate => candidate.localItemId === id);
        const reference = imageReference(item);
        return reference ? [reference] : [];
      });
  const canvaImages = snapshot.customDesign.imageItemIds.flatMap((id) => {
    const item = customDesignMedia.find(candidate => candidate.localItemId === id);
    const reference = imageReference(item);
    return reference ? [reference] : [];
  });
  const assetIdByLocalItemId = new Map(
    media.map(item => [item.localItemId, item.assetId]),
  );
  const remapSettings = (
    sectionId: string,
    settings: Extract<
      SiteBuilderDocument['pages'][number]['sections'][number],
      { sectionType: 'custom_design' }
    >['settings'],
  ) => {
    const imageIdMap = new Map(settings.images.map((image, index) => [
      image.id,
      assetIdByLocalItemId.get(image.assetId) ?? `missing-${sectionId}-${index}`,
    ]));
    return {
      ...structuredClone(settings),
      cta: settings.cta.type === 'none'
        || settings.cta.placement.type === 'after_all'
        ? structuredClone(settings.cta)
        : {
            ...structuredClone(settings.cta),
            placement: {
              imageItemId: imageIdMap.get(settings.cta.placement.imageItemId)
                ?? `missing-${sectionId}-cta`,
              type: 'after_image' as const,
            },
          },
      images: settings.images.map((image, index) => {
        const assetId = imageIdMap.get(image.id) ?? `missing-${sectionId}-${index}`;
        return { ...structuredClone(image), assetId, id: assetId };
      }),
    };
  };
  const remapCustomDesignAssets = (
    source: SiteBuilderDocument,
  ): SiteBuilderDocument => ({
    ...structuredClone(source),
    pages: source.pages.map(page => ({
      ...structuredClone(page),
      sections: page.sections.map(section => section.sectionType === 'custom_design'
        ? {
            ...structuredClone(section),
            settings: remapSettings(section.id, section.settings),
          }
        : structuredClone(section)),
    })),
    unusedSections: source.unusedSections.map(section => section.sectionType === 'custom_design'
      ? {
          ...structuredClone(section),
          settings: remapSettings(section.id, section.settings),
        }
      : structuredClone(section)),
  });

  return {
    document: remapCustomDesignAssets(document.builderDocument),
    media: media.map(item => ({
      altText: item.altText,
      assetId: item.assetId,
      fileName: item.fileName,
      fileSize: item.fileSize,
      height: item.height,
      mimeType: item.mimeType,
      publicUrl: item.publicUrl,
      role: item.role,
      sortOrder: item.sortOrder,
      width: item.width,
    })),
    state: {
      ...state,
      canva: {
        ...state.canva,
        customDesignSectionId: snapshot.customDesign.customDesignSectionId,
        displayMode: snapshot.customDesign.displayMode,
        images: canvaImages,
        ownedAssetIds: canvaImages.flatMap(image => image.storageId ? [image.storageId] : []),
        placement: snapshot.customDesign.placement,
        status: snapshot.customDesign.status,
      },
      gallery: {
        images: gallery,
        layout: snapshot.gallery.layout,
        source: snapshot.gallery.source,
      },
      profile: {
        ...state.profile,
        ...persistedProfile,
        logo: imageReference(
          logos.find(item => item.localItemId === snapshot.profile.logoItemId),
        ),
        profilePhoto: imageReference(
          profiles.find(item => item.localItemId === snapshot.profile.profilePhotoItemId),
        ),
      },
      recipe: {
        ...state.recipe,
        aboutEnabled: snapshot.site.aboutEnabled,
        aboutPreset: snapshot.site.aboutPreset,
        canvaEnabled: snapshot.site.canvaEnabled,
        galleryEnabled: snapshot.site.galleryEnabled,
        paletteConfirmed: true,
        palettePreset: snapshot.site.palettePresetId,
        policiesEnabled: snapshot.site.policiesEnabled,
        starter: snapshot.site.starter,
        starterDocumentSiteId: document.builderDocument.siteId,
        styleConfirmed: true,
        stylePreset: snapshot.site.stylePresetId,
      },
    },
  };
}
