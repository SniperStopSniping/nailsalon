import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import type {
  CustomDesignSectionInstance,
  SiteBuilderDocument,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';

export type CustomDesignMediaSource = {
  displayMode: CustomDesignSettings['displayMode'];
  image: CustomDesignSettings['images'][number];
};

export type ExistingCustomDesignMediaByLogicalId = ReadonlyMap<string, string>;

const collectCustomDesignSections = (
  document: SiteBuilderDocument,
): CustomDesignSectionInstance[] => [
  ...document.pages.flatMap(page => page.sections),
  ...document.unusedSections,
].filter(
  (section): section is CustomDesignSectionInstance =>
    section.sectionType === 'custom_design',
);

/**
 * Resolves the onboarding-owned Custom Design from the complete recoverable
 * document. Removed sections remain editable/restorable data, so account save
 * and resume must not lose the selected settings merely because the section
 * currently lives in `unusedSections`.
 */
export const resolveOnboardingCustomDesignSettings = (
  document: SiteBuilderDocument,
  selectedSectionId: string | null = null,
): CustomDesignSettings | null => {
  const sections = collectCustomDesignSections(document);
  const selected = selectedSectionId
    ? sections.find(section => section.id === selectedSectionId)
    : sections[0];
  return selected?.settings ?? null;
};

/**
 * Returns every logical Custom Design image in deterministic document order.
 * Active pages, removed/restorable sections, and the onboarding-selected
 * settings all use this one collector so the claim manifest and byte upload
 * phase cannot disagree about a second Custom Design section.
 */
export const collectCustomDesignMediaSources = (
  document: SiteBuilderDocument | null,
  selectedSettings: CustomDesignSettings | null = null,
): CustomDesignMediaSource[] => {
  const settings = [
    ...(document?.pages.flatMap(page => page.sections.flatMap(section => (
      section.sectionType === 'custom_design' ? [section.settings] : []
    ))) ?? []),
    ...(document?.unusedSections.flatMap(section => (
      section.sectionType === 'custom_design' ? [section.settings] : []
    )) ?? []),
    ...(selectedSettings ? [selectedSettings] : []),
  ];
  const byLogicalId = new Map<string, CustomDesignMediaSource>();

  for (const customSettings of settings) {
    for (const image of customSettings.images) {
      if (!byLogicalId.has(image.id)) {
        byLogicalId.set(image.id, {
          displayMode: customSettings.displayMode,
          image,
        });
      }
    }
  }

  return [...byLogicalId.values()];
};

/**
 * Narrows account-backed carry-forward candidates to images that still point
 * at the inherited logical/server asset. Replacing an image preserves its
 * logical item ID but changes `assetId`; that replacement must upload instead
 * of accidentally inheriting the previous bytes.
 */
export const collectInheritedCustomDesignMedia = (
  document: SiteBuilderDocument | null,
  selectedSettings: CustomDesignSettings | null,
  candidates: ExistingCustomDesignMediaByLogicalId,
): Map<string, string> => {
  const inherited = new Map<string, string>();
  for (const { image } of collectCustomDesignMediaSources(document, selectedSettings)) {
    const existingMediaId = candidates.get(image.id);
    if (
      existingMediaId
      && (image.assetId === image.id || image.assetId === existingMediaId)
    ) {
      inherited.set(image.id, existingMediaId);
    }
  }
  return inherited;
};
