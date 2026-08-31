import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { applyOnboardingSitePresentation } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-document-presentation';
import type { OnboardingLabState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import {
  type OnboardingMediaManifestItem,
  onboardingMediaManifestSchema,
  type OnboardingPalettePresetId,
  type OnboardingPersistedSnapshot,
  onboardingPersistedSnapshotSchema,
} from './contracts';
import {
  collectCustomDesignMediaSources,
  collectInheritedCustomDesignMedia,
  type ExistingCustomDesignMediaByLogicalId,
} from './custom-design-media';

const sanitizeCustomDesignSettings = (
  settings: CustomDesignSettings,
): CustomDesignSettings => ({
  ...structuredClone(settings),
  images: settings.images.map(image => ({
    ...structuredClone(image),
    assetId: image.id,
  })),
});

const sanitizeBuilderDocument = (
  document: SiteBuilderDocument | null,
): SiteBuilderDocument | null => document
  ? {
      ...structuredClone(document),
      pages: document.pages.map(page => ({
        ...structuredClone(page),
        sections: page.sections.map(section => section.sectionType === 'custom_design'
          ? {
              ...structuredClone(section),
              settings: sanitizeCustomDesignSettings(section.settings),
            }
          : structuredClone(section)),
      })),
      unusedSections: document.unusedSections.map(section => section.sectionType === 'custom_design'
        ? {
            ...structuredClone(section),
            settings: sanitizeCustomDesignSettings(section.settings),
          }
        : structuredClone(section)),
    }
  : null;

const mediaReference = (
  reference: OnboardingLabState['profile']['profilePhoto'],
  role: OnboardingMediaManifestItem['role'],
  order: number,
  displayMode: OnboardingMediaManifestItem['displayMode'],
): OnboardingMediaManifestItem | null => {
  if (
    !reference
    || !reference.storageId
    || !['fixture', 'indexed_db'].includes(reference.source)
  ) {
    return null;
  }
  return {
    ...(reference.altText ? { altText: reference.altText } : {}),
    ...(displayMode ? { displayMode } : {}),
    fileName: reference.fileName,
    ...(reference.source === 'fixture'
      ? { existingMediaId: reference.storageId }
      : {}),
    ...(reference.height ? { height: reference.height } : {}),
    localItemId: reference.id,
    mimeType: reference.mimeType as OnboardingMediaManifestItem['mimeType'],
    order,
    role,
    ...(reference.width ? { width: reference.width } : {}),
  };
};

/**
 * Browser-safe allowlist boundary. It deliberately excludes local storage
 * identifiers, bytes, object/data URLs, fixture state, progress UI, scroll,
 * processing state, and the local event journal.
 */
export function createPersistableOnboardingDraft(
  state: OnboardingLabState,
  palettePresetId: OnboardingPalettePresetId,
  customDesignSettings: CustomDesignSettings | null = null,
  document: SiteBuilderDocument | null = null,
  accountCustomMediaByLogicalId: ExistingCustomDesignMediaByLogicalId = new Map(),
): { media: OnboardingMediaManifestItem[]; snapshot: OnboardingPersistedSnapshot } {
  const sanitizedCustomDesignSettings = customDesignSettings
    ? sanitizeCustomDesignSettings(customDesignSettings)
    : null;
  const sanitizedBuilderDocument = sanitizeBuilderDocument(document);
  const acceptedBuilderDocument = sanitizedBuilderDocument
    ? applyOnboardingSitePresentation(sanitizedBuilderDocument, {
      aboutPreset: state.recipe.aboutPreset,
      galleryLayout: state.gallery.layout,
    })
    : null;
  const profilePhoto = mediaReference(state.profile.profilePhoto, 'profile', 0, 'cover');
  const logo = mediaReference(state.profile.logo, 'logo', 0, 'contain');
  const galleryMedia = state.gallery.images.flatMap((image, order) => {
    const item = mediaReference(image, 'gallery', order, 'cover');
    return item ? [item] : [];
  });
  const existingCustomMediaCandidates = new Map<string, string>([
    ...accountCustomMediaByLogicalId,
    ...state.canva.images.flatMap(image => (
      image.source === 'fixture' && image.storageId
        ? [[image.id, image.storageId] as const]
        : []
    )),
  ]);
  const inheritedCustomMediaByLogicalId = collectInheritedCustomDesignMedia(
    document,
    customDesignSettings,
    existingCustomMediaCandidates,
  );
  const customDesignMedia: OnboardingMediaManifestItem[] = collectCustomDesignMediaSources(
    document,
    customDesignSettings,
  ).map(({ displayMode, image }, order) => {
    const existingMediaId = inheritedCustomMediaByLogicalId.get(image.id);
    return {
      ...(image.accessibleSummary ? { accessibleSummary: image.accessibleSummary } : {}),
      altText: image.altText,
      decorative: image.decorative,
      displayMode: displayMode === 'contained'
        ? 'contain'
        : displayMode,
      ...(existingMediaId
        ? { existingMediaId }
        : {}),
      fileName: image.fileName,
      fileSize: image.fileSize,
      height: image.height,
      imageItemId: image.id,
      localItemId: image.id,
      mimeType: image.mimeType,
      order,
      role: 'custom_design',
      width: image.width,
    };
  });
  const media = onboardingMediaManifestSchema.parse(
    [profilePhoto, logo, ...galleryMedia, ...customDesignMedia]
      .filter((item): item is OnboardingMediaManifestItem => item !== null),
  );

  const snapshot = onboardingPersistedSnapshotSchema.parse({
    customDesign: {
      customDesignSectionId: state.canva.customDesignSectionId,
      displayMode: state.canva.displayMode,
      imageItemIds: sanitizedCustomDesignSettings?.images.map(image => image.id) ?? [],
      placement: state.canva.placement,
      settings: sanitizedCustomDesignSettings,
      status: state.canva.status,
    },
    gallery: {
      imageItemIds: state.gallery.source === 'mock_luster'
        ? state.gallery.images.map(image => image.id)
        : galleryMedia.map(item => item.localItemId),
      layout: state.gallery.layout,
      source: state.gallery.source,
    },
    // The accepted Final Review uses this deterministic instant for truthful
    // open/closed presentation. Persisting it keeps the account-saved and
    // Workspace previews revision-identical across process/reload boundaries.
    previewTimestamp: state.reviewOptions.previewTimestamp,
    profile: {
      about: state.profile.about,
      bookingOnlyContact: state.profile.bookingOnlyContact,
      bookingPreferences: {
        minimumNoticeMinutes: state.profile.bookingPreferences.minimumNoticeMinutes,
        newClientStatus: state.profile.bookingPreferences.newClientStatus,
        visitMode: state.profile.bookingPreferences.visitMode,
      },
      brand: state.profile.brand,
      businessName: state.profile.businessName,
      businessStructure: state.profile.businessStructure,
      clientContact: state.profile.clientContact,
      email: state.profile.email,
      hours: state.profile.hours,
      instagram: state.profile.instagram,
      location: state.profile.location,
      logoItemId: logo?.localItemId ?? null,
      ownerName: state.profile.ownerName,
      policies: state.profile.policies,
      preferredContact: state.profile.preferredContact,
      profilePhotoItemId: profilePhoto?.localItemId ?? null,
      serviceMenu: {
        ownerOverridesByServiceId: state.profile.serviceMenu.ownerOverridesByServiceId,
        reviewed: state.profile.serviceMenu.reviewed === true,
        selectedAddOnIds: state.profile.serviceMenu.selectedAddOnIds ?? [],
        selectedServiceIds: state.profile.serviceMenu.selectedServiceIds,
      },
    },
    site: {
      aboutEnabled: state.recipe.aboutEnabled,
      aboutPreset: state.recipe.aboutPreset,
      builderDocument: acceptedBuilderDocument,
      canvaEnabled: state.recipe.canvaEnabled,
      galleryEnabled: state.recipe.galleryEnabled,
      palettePresetId,
      policiesEnabled: state.recipe.policiesEnabled,
      starter: state.recipe.starter,
      stylePresetId: state.recipe.stylePreset,
    },
    version: 1,
  });

  return { media, snapshot };
}
