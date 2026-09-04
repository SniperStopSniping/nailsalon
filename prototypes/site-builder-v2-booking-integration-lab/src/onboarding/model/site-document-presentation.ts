import { normalizeGalleryPresentationOwnership } from '../../model/normalize';
import type { SiteBuilderDocument } from '../../model/types';
import type { AboutPresetId, GalleryLayout } from './types';

export type OnboardingSitePresentation = {
  aboutPreset: AboutPresetId;
  galleryLayout: GalleryLayout;
};

/**
 * Applies the presentation choices owned by onboarding to their native
 * section settings. The helper is deliberately browser-safe and immutable so
 * Final Review, the Builder handoff, account persistence, and resume all use
 * the same semantic document.
 */
export const applyOnboardingSitePresentation = (
  document: SiteBuilderDocument,
  presentation: OnboardingSitePresentation,
): SiteBuilderDocument => {
  const normalizedDocument = normalizeGalleryPresentationOwnership(document);
  const applyToSection = <
    TSection extends SiteBuilderDocument['pages'][number]['sections'][number],
  >(
    section: TSection,
  ): TSection => {
    if (section.sectionType === 'about') {
      return section.settings.preset === presentation.aboutPreset
        ? section
        : {
            ...section,
            settings: { ...section.settings, preset: presentation.aboutPreset },
          } as TSection;
    }
    if (
      section.sectionType === 'gallery'
      && section.galleryPresentationOwner === 'onboarding'
      && section.settings.preset !== presentation.galleryLayout
    ) {
      // The dedicated Gallery module follows the latest onboarding choice,
      // including after a resumed owner changes an earlier accepted choice.
      // Supporting/recipe Galleries keep their own authored presentation.
      return {
        ...section,
        settings: { ...section.settings, preset: presentation.galleryLayout },
      } as TSection;
    }
    return section;
  };
  const applyToPage = (page: SiteBuilderDocument['pages'][number]) => {
    const sections = page.sections.map(applyToSection);
    return sections.some((section, index) => section !== page.sections[index])
      ? { ...page, sections }
      : page;
  };
  const pages = normalizedDocument.pages.map(applyToPage);
  const unusedSections = normalizedDocument.unusedSections
    .map(section => applyToSection(section));
  const changed = normalizedDocument !== document
    || pages.some((page, index) => page !== normalizedDocument.pages[index])
    || unusedSections.some(
      (section, index) => section !== normalizedDocument.unusedSections[index],
    );

  return changed
    ? { ...normalizedDocument, pages, unusedSections }
    : document;
};
