import {
  buildCustomerPagePlan,
  type SitePlanPage,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/site-plan';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { ONBOARDING_EXAMPLE_GALLERY_IMAGES } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/gallery-examples';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-library-context';
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

type PersistedSavedPreviewMedia = {
  altText: string | null;
  claimStatus: string;
  fileName: string;
  fileSize: number | null;
  height: number | null;
  id: string;
  localItemId: string;
  metadata: Record<string, unknown>;
  mimeType: string;
  publicUrl: string | null;
  role: OnboardingSiteMediaRole;
  sortOrder: number;
  storageKey: string | null;
  width: number | null;
};

export type SavedSitePreviewModel = {
  document: SiteBuilderDocument;
  media: SavedPreviewMedia[];
  pagePlan: SitePlanPage[];
  state: OnboardingLabState;
};

/**
 * Converts tenant-authorized, revision-scoped media rows into same-origin
 * customer-preview references. Storage paths and provider URLs never cross
 * the Server Component boundary.
 */
export const createSavedPreviewMediaRecords = (
  media: readonly PersistedSavedPreviewMedia[],
): SavedPreviewMediaRecord[] => media.flatMap((item) => {
  if (
    item.claimStatus !== 'ready'
    || !item.storageKey
    || !item.publicUrl
    || !item.publicUrl.startsWith('/api/onboarding/v1/media/')
  ) {
    return [];
  }
  const metadataByteSize = item.metadata.byteSize;
  return [{
    altText: item.altText,
    assetId: item.id,
    fileName: item.fileName,
    fileSize: item.fileSize
      ?? (typeof metadataByteSize === 'number' ? metadataByteSize : null),
    height: item.height,
    localItemId: item.localItemId,
    mimeType: item.mimeType,
    publicUrl: `/api/onboarding/v1/media/${encodeURIComponent(item.id)}`,
    role: item.role,
    sortOrder: item.sortOrder,
    width: item.width,
  }];
});

const imageReference = (
  media: SavedPreviewMediaRecord | undefined,
): LocalImageReference | undefined => media
  ? {
      ...(media.altText ? { altText: media.altText } : {}),
      fileName: media.fileName,
      ...(media.height ? { height: media.height } : {}),
      id: media.localItemId,
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
 * customer Preview renderer. Persisted compiled pages are the customer-tree
 * authority; the Builder document is retained only for native section settings
 * and Custom Design actions. This adapter also restores connected profile and
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
    customDesignMedia.map(item => [item.localItemId, item.assetId]),
  );
  const remapSettings = (
    sectionId: string,
    settings: Extract<
      SiteBuilderDocument['pages'][number]['sections'][number],
      { sectionType: 'custom_design' }
    >['settings'],
  ) => {
    return {
      ...structuredClone(settings),
      cta: structuredClone(settings.cta),
      images: settings.images.map((image, index) => {
        const assetId = assetIdByLocalItemId.get(image.assetId)
          ?? `missing-${sectionId}-${index}`;
        return { ...structuredClone(image), assetId };
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

  const previewDocument = remapCustomDesignAssets(document.builderDocument);
  const savedState: OnboardingLabState = {
      ...state,
      canva: {
        ...state.canva,
        customDesignSectionId: snapshot.customDesign.customDesignSectionId,
        displayMode: snapshot.customDesign.displayMode,
        images: canvaImages,
        ownedAssetIds: [],
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
      reviewOptions: {
        ...state.reviewOptions,
        previewTimestamp: snapshot.previewTimestamp,
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
        quickBookProfile: { ...snapshot.site.quickBookProfile },
        starter: snapshot.site.starter,
        starterDocumentSiteId: document.builderDocument.siteId,
        styleConfirmed: true,
        stylePreset: snapshot.site.stylePresetId,
      },
  };

  // The saved plan re-derives from the persisted Builder document through the
  // same shared ladder the live preview and compiler use; compiler-minted
  // injected ids are reproduced so section anchors stay stable across saves.
  const pagePlan = buildCustomerPagePlan(previewDocument, {
    context: deriveSiteLibraryContext(savedState, previewDocument),
    customDesignFallback: snapshot.customDesign.settings
      ? {
          id: snapshot.customDesign.customDesignSectionId
            ?? `${document.siteId}:onboarding:custom_design`,
          placement: snapshot.customDesign.placement,
          settings: snapshot.customDesign.settings,
        }
      : undefined,
    injectionId: type => `${document.siteId}:onboarding:${type}`,
    toggles: deriveSitePlanToggles(savedState),
  });

  return {
    document: previewDocument,
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
    pagePlan,
    state: savedState,
  };
}
