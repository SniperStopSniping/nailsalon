/**
 * Central overlap and duplication engine.
 *
 * Hard exclusivity lives in `operations.addSection` (and document validation);
 * this module owns the SOFT warnings surfaced by Add Section, the structure
 * panel, and readiness. Every warning names the specific overlapping content
 * and offers a real resolution — nothing is generic, and every soft rule has
 * an "add anyway" path.
 */

import {
  getSectionRegistryEntry,
  isLibrarySection,
  isLibrarySectionType,
  type SiteLibraryContext,
} from './section-library/registry';
import type {
  LibrarySectionType,
  PageDocument,
  SectionInstance,
  SiteBuilderDocument,
} from './types';

export type OverlapResolution = {
  id: string;
  label: string;
  kind: 'proceed' | 'navigate' | 'adjust' | 'cancel';
};

export type OverlapWarning = {
  id: string;
  title: string;
  /** Names the duplicated content and where it already appears. */
  message: string;
  resolutions: OverlapResolution[];
};

const proceed = (label: string): OverlapResolution => ({
  id: 'proceed',
  kind: 'proceed',
  label,
});

const cancel: OverlapResolution = { id: 'cancel', kind: 'cancel', label: 'Cancel' };

const visibleSectionsOfType = (
  document: SiteBuilderDocument,
  type: SectionInstance['sectionType'],
): Array<{ page: PageDocument; section: SectionInstance }> =>
  document.pages.flatMap(page =>
    page.sections
      .filter(section => section.sectionType === type && section.visible)
      .map(section => ({ page, section })));

/**
 * Warnings for adding `type` to `page`. Returns an empty list when the
 * addition is unremarkable; hard limits are not reported here (operations
 * blocks them outright).
 */
export const getAddSectionWarnings = (
  document: SiteBuilderDocument,
  pageId: string,
  type: LibrarySectionType,
  context: SiteLibraryContext,
): OverlapWarning[] => {
  const warnings: OverlapWarning[] = [];
  const entry = getSectionRegistryEntry(type);
  const page = document.pages.find(candidate => candidate.id === pageId);
  if (!page) return warnings;

  // Recommended-count warnings (soft limits only).
  if (entry.limitKind === 'soft') {
    const siteCount = visibleSectionsOfType(document, type).length;
    const pageCount = page.sections.filter(
      section => section.sectionType === type,
    ).length;
    if (entry.maxPerSite !== undefined && siteCount >= entry.maxPerSite) {
      const existing = visibleSectionsOfType(document, type)[0];
      warnings.push({
        id: `duplicate_${type}`,
        message: `${entry.label} already appears on your ${existing?.page.name ?? 'site'} page. Most sites work best with ${entry.maxPerSite === 1 ? 'one' : String(entry.maxPerSite)}.`,
        resolutions: [proceed('Add it anyway'), cancel],
        title: `${entry.label} is already on your site`,
      });
    } else if (entry.maxPerPage !== undefined && pageCount >= entry.maxPerPage) {
      warnings.push({
        id: `duplicate_${type}_page`,
        message: `${entry.label} already appears on this page.`,
        resolutions: [proceed('Add it anyway'), cancel],
        title: `${entry.label} is already on this page`,
      });
    }
  }

  // Named-content overlap rules.
  if (type === 'hours') {
    const visitUs = visibleSectionsOfType(document, 'visit_us')[0];
    if (visitUs && isLibrarySection(visitUs.section)
      && visitUs.section.sectionType === 'visit_us'
      && visitUs.section.settings.hoursSummary !== 'hide') {
      warnings.push({
        id: 'hours_inside_visit_us',
        message: `Your weekly hours already appear inside Visit Us on the ${visitUs.page.name} page.`,
        resolutions: [
          { id: 'keep_inside', kind: 'cancel', label: 'Keep hours inside Visit Us' },
          proceed('Add the separate Hours section anyway'),
          {
            id: 'move_out',
            kind: 'adjust',
            label: 'Remove hours from Visit Us and add the section',
          },
        ],
        title: 'Hours are already shown',
      });
    }
  }

  if (type === 'contact') {
    const visitUs = visibleSectionsOfType(document, 'visit_us')[0];
    if (visitUs && isLibrarySection(visitUs.section)
      && visitUs.section.sectionType === 'visit_us'
      && visitUs.section.settings.contactSummary !== 'hide') {
      warnings.push({
        id: 'contact_inside_visit_us',
        message: `Your contact details already appear inside Visit Us on the ${visitUs.page.name} page.`,
        resolutions: [
          { id: 'keep_inside', kind: 'cancel', label: 'Keep contact inside Visit Us' },
          proceed('Add the separate Contact section anyway'),
          {
            id: 'move_out',
            kind: 'adjust',
            label: 'Remove contact from Visit Us and add the section',
          },
        ],
        title: 'Contact details are already shown',
      });
    }
  }

  if (type === 'featured_services') {
    const bookingOnPage = page.sections.some(
      section => section.sectionType === 'booking' && section.visible,
    );
    if (bookingOnPage) {
      warnings.push({
        id: 'featured_beside_full_menu',
        message: 'Featured services would sit beside your full service menu on this page. They work best on a page that links to Booking.',
        resolutions: [proceed('Add it here anyway'), cancel],
        title: 'Your full menu is already here',
      });
    }
  }

  if (type === 'team' && context.businessStructure === 'solo') {
    warnings.push({
      id: 'team_on_solo_business',
      message: 'Your business is currently set up as a solo nail tech, so the Team section will stay empty until team members are added.',
      resolutions: [
        proceed('Add Team anyway'),
        { id: 'change_setup', kind: 'navigate', label: 'Change business setup' },
        cancel,
      ],
      title: 'Solo business',
    });
  }

  if (type === 'final_cta') {
    const bookingActionCount = page.sections.filter(section =>
      section.visible && (
        section.sectionType === 'final_cta'
        || section.sectionType === 'hero'
        || section.sectionType === 'booking'
        || (isLibrarySection(section)
          && section.sectionType === 'announcement_bar'
          && section.settings.action?.kind === 'booking')
      )).length;
    if (bookingActionCount >= 3) {
      warnings.push({
        id: 'cta_density',
        message: `This page already has ${bookingActionCount} booking actions. Another CTA can start to feel pushy.`,
        resolutions: [proceed('Add it anyway'), cancel],
        title: 'Plenty of booking actions already',
      });
    }
  }

  return warnings;
};

/**
 * Standing document-level advisories (shown in structure/readiness surfaces):
 * duplicated policy summaries, empty-but-visible bound sections, and the
 * solo-business Team case.
 */
export const getDocumentOverlapAdvisories = (
  document: SiteBuilderDocument,
  context: SiteLibraryContext,
): OverlapWarning[] => {
  const advisories: OverlapWarning[] = [];

  const aboutSections = visibleSectionsOfType(document, 'about');
  const policySections = [
    ...visibleSectionsOfType(document, 'deposits_cancellations'),
    ...visibleSectionsOfType(document, 'policies'),
  ];
  const aboutShowsPolicySummary = aboutSections.some(({ section }) =>
    isLibrarySection(section)
    && section.sectionType === 'about'
    && section.settings.preset === 'about_before_you_book');
  if (aboutShowsPolicySummary && policySections.length > 0) {
    advisories.push({
      id: 'about_policy_summary_duplicate',
      message: `About uses the “Before you book” design, which repeats a policy summary that ${policySections[0]?.page.name ?? 'another page'} already shows in full.`,
      resolutions: [
        { id: 'keep', kind: 'cancel', label: 'Keep the compact summary' },
        { id: 'switch_preset', kind: 'adjust', label: 'Switch About to a design without policies' },
      ],
      title: 'Policy details appear twice',
    });
  }

  const teamSections = visibleSectionsOfType(document, 'team');
  if (teamSections.length > 0 && context.businessStructure === 'solo') {
    advisories.push({
      id: 'team_on_solo_business',
      message: 'Team is on your site, but your business is set up as a solo nail tech.',
      resolutions: [
        { id: 'keep', kind: 'cancel', label: 'Keep Team' },
        { id: 'change_setup', kind: 'navigate', label: 'Change business setup' },
      ],
      title: 'Solo business with a Team section',
    });
  }

  return advisories;
};

/** True when the type may not be added to the page at all (hard exclusivity). */
export const isAddBlocked = (
  document: SiteBuilderDocument,
  pageId: string,
  type: SectionInstance['sectionType'],
): boolean => {
  if (type === 'booking') {
    return document.pages.some(page =>
      page.sections.some(section => section.sectionType === 'booking'));
  }
  if (!isLibrarySectionType(type)) return false;
  const entry = getSectionRegistryEntry(type);
  if (entry.limitKind !== 'hard' || entry.maxPerPage === undefined) return false;
  const page = document.pages.find(candidate => candidate.id === pageId);
  if (!page) return false;
  return page.sections.filter(section => section.sectionType === type).length
    >= entry.maxPerPage;
};
