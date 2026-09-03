/**
 * The single customer-site plan builder.
 *
 * Live onboarding preview, the persist-time compiler, and the saved-site
 * read-back all derive what a customer sees from THIS function — replacing
 * the three previously duplicated selection ladders. It decides, per visible
 * page: which sections render, in what order, which legacy-era sections are
 * synthetically injected, and how neighbouring surfaces compose (tone,
 * attachment, dividers).
 */

import { hasCustomDesignArtwork } from '../custom-design/model/settings';
import type { CustomDesignSettings } from '../custom-design/model/types';
import {
  buildSiteContentPlacementPlan,
  getSiteContentAvailability,
  getSectionContentSuppressions,
  type SectionContentSuppression,
  type SiteContentPlacementPlan,
} from './content-placement';
import {
  getSectionRegistryEntry,
  isLibrarySection,
  isLibrarySectionType,
  NAVIGABLE_SECTION_TYPES,
  type SectionSurfaceTone,
  type SiteLibraryContext,
} from './section-library/registry';
import { createLibrarySectionInstance } from './starters';
import type {
  IdFactory,
  LibrarySectionType,
  SectionInstance,
  SiteBuilderDocument,
} from './types';

export type SitePlanOptionalToggles = {
  aboutEnabled: boolean;
  galleryEnabled: boolean;
  canvaEnabled: boolean;
  policiesEnabled: boolean;
};

export type SitePlanInjectableType =
  | 'about'
  | 'gallery'
  | 'contact'
  | 'policies';

export type SitePlanSection = {
  id: string;
  sectionType: SectionInstance['sectionType'];
  label: string;
  /** The real document section, or a synthetic default-settings instance for injections. */
  section: SectionInstance;
  /** True when this section does not exist in the document (legacy-era injection). */
  injected: boolean;
  surface: SectionSurfaceTone;
  /** Collapse the gap to the previous section (announcement→hero, CTA→footer, …). */
  attachedToPrevious: boolean;
};

export type SitePlanPage = {
  id: string;
  label: string;
  slug: string;
  isHome: boolean;
  order: number;
  visibleInNavigation: boolean;
  sections: SitePlanSection[];
};

export type BuildCustomerPagePlanOptions = {
  context: SiteLibraryContext;
  /** Asset-aware customer visibility for Custom Design; structural by default. */
  customDesignIsRenderable?: (settings: CustomDesignSettings) => boolean;
  toggles: SitePlanOptionalToggles;
  /** Injections are skipped entirely on surfaces that only show the document as-is. */
  includeOptionalSections?: boolean;
  /**
   * Mints ids for injected sections. The live preview uses stable
   * `onboarding-preview-*` ids; the compiler mints `${siteId}:onboarding:*`
   * so persisted injected ids never change across revisions.
   */
  injectionId?: (type: SitePlanInjectableType) => string;
  /** Id factory for the synthetic instances themselves (never persisted). */
  idFactory?: IdFactory;
  /**
   * Legacy Custom Design fallback: some accepted snapshots carry validated
   * Canva settings without a document-owned custom_design section. When set
   * (and Canva is enabled, and the document owns none), the plan renders one
   * synthetic Custom Design section at the recorded placement.
   */
  customDesignFallback?: {
    id: string;
    placement: 'before_booking' | 'after_booking';
    settings: CustomDesignSettings;
  };
};

const defaultInjectionId = (type: SitePlanInjectableType): string =>
  `onboarding-preview-${type}`;

const syntheticIdFactory: IdFactory = () => 'synthetic-section';

/**
 * Composition chrome never justifies publishing a page by itself: a page
 * whose substantive sections all gated away (empty gallery, private contact)
 * drops entirely, together with its navigation entry.
 */
const CHROME_SECTION_TYPES: ReadonlySet<string> = new Set([
  'announcement_bar',
  'section_navigation',
  'quick_info',
  'final_cta',
  'footer',
]);

/** Registry tone for library types; engine sections sit on the base surface. */
const toneFor = (section: SectionInstance): SectionSurfaceTone =>
  isLibrarySection(section)
    ? getSectionRegistryEntry(section.sectionType).surface
    : 'base';

const attachesToNext = (section: SectionInstance): boolean =>
  isLibrarySection(section)
    ? getSectionRegistryEntry(section.sectionType).attachesToNext === true
    : false;

/**
 * Quick Book presents branding, Profile, Instagram, and compact policy
 * disclosure in its profile header. Older Quick Book documents can still
 * contain retired standalone sections, but Visit & Contact is now a real
 * bottom-of-page responsibility and must remain renderable.
 */
const QUICK_BOOK_PROFILE_OWNED_SECTION_TYPES: ReadonlySet<LibrarySectionType> = new Set([
  'about',
  'contact',
  'deposits_cancellations',
  'hours',
  'policies',
  'team',
]);

/**
 * Should this section render for a customer right now? Booking is canonical;
 * Custom Design must own artwork before its renderer has customer content.
 * Library sections render unless their shared authority has nothing truthful
 * to show, or their onboarding-era toggle is off.
 */
const sectionRendersForCustomer = (
  section: SectionInstance,
  context: SiteLibraryContext,
  toggles: SitePlanOptionalToggles,
  includeOptionalSections: boolean,
  customDesignIsRenderable: (settings: CustomDesignSettings) => boolean,
  quickBookUsesCompactProfile: boolean,
): boolean => {
  if (section.sectionType === 'booking') return true;
  if (section.sectionType === 'custom_design') {
    return customDesignIsRenderable(section.settings)
      && (!includeOptionalSections || toggles.canvaEnabled);
  }
  if (!isLibrarySection(section)) return false; // legacy placeholders render nothing
  if (
    quickBookUsesCompactProfile
    && QUICK_BOOK_PROFILE_OWNED_SECTION_TYPES.has(section.sectionType)
  ) {
    return false;
  }
  if (
    section.sectionType === 'about'
    && includeOptionalSections
    && !toggles.aboutEnabled
  ) {
    return false;
  }
  if (
    section.sectionType === 'gallery'
    && includeOptionalSections
    && !toggles.galleryEnabled
  ) {
    return false;
  }
  if (
    (section.sectionType === 'policies'
      || section.sectionType === 'deposits_cancellations')
    && includeOptionalSections
    && !toggles.policiesEnabled
  ) {
    return false;
  }
  const entry = getSectionRegistryEntry(section.sectionType);
  const readiness = entry.readiness(
    section.settings as never,
    context,
  );
  return readiness.level !== 'empty';
};

type InjectionRule = {
  type: SitePlanInjectableType;
  wanted: (context: SiteLibraryContext, toggles: SitePlanOptionalToggles) => boolean;
  /** Types whose presence anywhere in the document satisfies the need. */
  satisfiedBy: readonly LibrarySectionType[];
  placement: 'before_booking' | 'after_booking' | 'end';
};

/**
 * Legacy-era injections: v2 starters carry the full section set, but upgraded
 * v1 documents (and Quick Book) may lack About/Gallery/Contact/Policy
 * sections the owner's onboarding answers expect to publish. Presence is
 * checked across pages AND the unused bin — a deliberately removed section
 * suppresses injection rather than reappearing.
 */
const INJECTION_RULES: readonly InjectionRule[] = [
  {
    placement: 'before_booking',
    satisfiedBy: ['about', 'team'],
    type: 'about',
    wanted: (_context, toggles) => toggles.aboutEnabled,
  },
  {
    placement: 'before_booking',
    satisfiedBy: ['gallery'],
    type: 'gallery',
    wanted: (context, toggles) =>
      toggles.galleryEnabled && context.galleryImageIds.length > 0,
  },
  {
    placement: 'after_booking',
    satisfiedBy: ['policies'],
    type: 'policies',
    wanted: (context, toggles) =>
      toggles.policiesEnabled
      && context.policiesMeaningful
      && (context.depositsSummaryPublishable
        || context.depositsWordingPublishable
        || context.availablePolicyTopics.length > 0),
  },
  {
    placement: 'end',
    satisfiedBy: ['contact', 'visit_us'],
    type: 'contact',
    wanted: (context) => context.hasContactSectionContent,
  },
];

/**
 * An anchor menu needs at least two places to go; with fewer, the renderer
 * draws nothing. Only the plan can count them — the count has to be taken
 * after injections and after readiness gating, which is more than a single
 * section's readiness rule can see — so the menu is dropped here rather than
 * left to report itself ready and then render blank.
 */
const dropUnanchorableNavigation = (
  sections: readonly SitePlanSection[],
): SitePlanSection[] => {
  const targets = sections.filter(
    section => NAVIGABLE_SECTION_TYPES.has(section.sectionType),
  ).length;
  return targets >= 2
    ? [...sections]
    : sections.filter(section => section.sectionType !== 'section_navigation');
};

/**
 * Composes neighbouring surfaces: attached chrome collapses its gap, repeated
 * tint neighbours alternate back to base so backgrounds never seam, and
 * consecutive contrast sections merge into one continuous band.
 */
const resolveAdjacency = (
  sections: readonly SitePlanSection[],
): SitePlanSection[] => {
  // Each decision reads the RESOLVED previous section, not the raw one, so a
  // tint that fell back to base cannot make its neighbour fall back too.
  const resolved: SitePlanSection[] = [];
  for (const section of sections) {
    const previous = resolved.at(-1);
    const surface = previous?.surface === 'tint' && section.surface === 'tint'
      ? 'base'
      : section.surface;
    const attachedToPrevious = previous !== undefined && (
      attachesToNext(previous.section)
      || (surface === 'contrast' && previous.surface === 'contrast')
    );
    resolved.push({ ...section, attachedToPrevious, surface });
  }
  return resolved;
};

/** Re-plans a persisted page plan after a runtime-only visibility check. */
export const filterCustomerPagePlanSections = (
  pages: readonly SitePlanPage[],
  include: (section: SitePlanSection) => boolean,
): SitePlanPage[] => pages.flatMap((page) => {
  const filtered = page.sections.filter(include);
  if (filtered.length === page.sections.length) return [page];
  const sections = resolveAdjacency(dropUnanchorableNavigation(filtered));
  return sections.some(section => !CHROME_SECTION_TYPES.has(section.sectionType))
    ? [{ ...page, sections }]
    : [];
});

/**
 * Why a section the owner can see in the Builder is not on the customer's
 * site. The editor can ask readiness directly, but readiness cannot answer
 * for the reasons that only the plan knows — a page that publishes nothing,
 * or an anchor menu with too few places to go — and a section that silently
 * disappears while its editor says nothing is the worst of both.
 */
export type SectionPlanExclusion =
  | 'content_owned_elsewhere'
  | 'dropped'
  | 'hidden'
  | 'not_enough_navigation_targets'
  | 'not_ready'
  | 'page_dropped';

export const getSectionPlanExclusion = (
  document: SiteBuilderDocument,
  sectionId: string,
  options: BuildCustomerPagePlanOptions,
): SectionPlanExclusion | null => {
  const page = document.pages.find(
    candidate => candidate.sections.some(section => section.id === sectionId),
  );
  const section = page?.sections.find(candidate => candidate.id === sectionId);
  if (!page || !section) return null;
  if (section.visible === false) return 'hidden';

  const plan = buildCustomerPagePlan(document, options);
  const planned = plan.flatMap(planPage => planPage.sections);
  if (planned.some(candidate => candidate.id === sectionId)) return null;

  if (getSectionContentPlacementSuppressions(document, sectionId, options)
    .some(notice => notice.suppressEntireSection)) {
    return 'content_owned_elsewhere';
  }

  if (isLibrarySection(section)) {
    const entry = getSectionRegistryEntry(section.sectionType);
    if (entry.readiness(section.settings as never, options.context).level === 'empty') {
      return 'not_ready';
    }
  }
  if (
    section.sectionType === 'custom_design'
    && !(options.customDesignIsRenderable ?? hasCustomDesignArtwork)(section.settings)
  ) {
    return 'not_ready';
  }
  if (!plan.some(planPage => planPage.id === page.id)) return 'page_dropped';
  if (section.sectionType === 'section_navigation') {
    return 'not_enough_navigation_targets';
  }
  return 'dropped';
};

const buildStructuralCustomerPagePlan = (
  document: SiteBuilderDocument,
  options: BuildCustomerPagePlanOptions,
): SitePlanPage[] => {
  const {
    context,
    customDesignFallback,
    customDesignIsRenderable = hasCustomDesignArtwork,
    includeOptionalSections = true,
    injectionId = defaultInjectionId,
    toggles,
  } = options;

  const visiblePages = [...document.pages]
    .filter(page => page.visible)
    .sort((left, right) => left.order - right.order);

  const allSections = [
    ...document.pages.flatMap(page => page.sections),
    ...document.unusedSections,
  ];
  const quickBookUsesCompactProfile = document.originStarter === 'quick_book'
    && visiblePages.some(page => page.sections.some(
      section => section.visible && section.sectionType === 'hero',
    ))
    && visiblePages.some(page => page.sections.some(
      section => section.visible && section.sectionType === 'booking',
    ));
  const hasType = (types: readonly LibrarySectionType[]): boolean =>
    allSections.some(section =>
      isLibrarySectionType(section.sectionType)
      && (types as readonly string[]).includes(section.sectionType));

  const makeSynthetic = (type: SitePlanInjectableType): SitePlanSection => {
    const instance = createLibrarySectionInstance(type, syntheticIdFactory);
    const entry = getSectionRegistryEntry(type);
    return {
      attachedToPrevious: false,
      id: injectionId(type),
      injected: true,
      label: entry.label,
      section: { ...instance, id: injectionId(type) } as SectionInstance,
      sectionType: type,
      surface: entry.surface,
    };
  };

  const injections = includeOptionalSections
    ? INJECTION_RULES.filter(rule =>
        // Quick Book's compact profile owns shared identity, About, and policy
        // presentation. Visit & Contact is a real recipe section after Booking
        // (and optional Gallery); legacy injections may not recreate retired
        // About/Contact/Policies duplicates.
        !(document.originStarter === 'quick_book'
          && (rule.type === 'about' || rule.type === 'contact' || rule.type === 'policies'))
        && rule.wanted(context, toggles)
        && !hasType(rule.satisfiedBy))
    : [];

  const canonicalBooking = visiblePages.flatMap(page => [...page.sections]
    .filter(section => section.visible)
    .sort((left, right) => left.order - right.order))
    .find(section => section.sectionType === 'booking');
  const bookingPage = visiblePages.find(page =>
    page.sections.some(section => section.id === canonicalBooking?.id))
    ?? visiblePages.find(page => page.isHome)
    ?? visiblePages[0];

  const planPages: SitePlanPage[] = visiblePages.map((page) => {
    const rendered: SitePlanSection[] = [...page.sections]
      .filter(section => section.visible)
      .sort((left, right) => left.order - right.order)
      .filter(section => (
        section.sectionType !== 'booking' || section.id === canonicalBooking?.id
      ))
      .filter(section => sectionRendersForCustomer(
        section,
        context,
        toggles,
        includeOptionalSections,
        customDesignIsRenderable,
        quickBookUsesCompactProfile,
      ))
      .map(section => ({
        attachedToPrevious: false,
        id: section.id,
        injected: false,
        label: section.label,
        section,
        sectionType: section.sectionType,
        surface: toneFor(section),
      }));

    if (page.id === bookingPage?.id) {
      const bookingIndex = rendered.findIndex(
        entry => entry.sectionType === 'booking',
      );
      const before = injections
        .filter(rule => rule.placement === 'before_booking')
        .map(rule => makeSynthetic(rule.type));
      const after = injections
        .filter(rule => rule.placement === 'after_booking')
        .map(rule => makeSynthetic(rule.type));
      if (
        customDesignFallback
        && includeOptionalSections
        && toggles.canvaEnabled
        && customDesignIsRenderable(customDesignFallback.settings)
        && !allSections.some(section => section.sectionType === 'custom_design')
      ) {
        const fallbackSection: SitePlanSection = {
          attachedToPrevious: false,
          id: customDesignFallback.id,
          injected: true,
          label: 'Custom Design',
          section: {
            id: customDesignFallback.id,
            label: 'Custom Design',
            order: 0,
            sectionType: 'custom_design',
            settings: customDesignFallback.settings,
            visible: true,
          },
          sectionType: 'custom_design',
          surface: 'base',
        };
        if (customDesignFallback.placement === 'before_booking') {
          before.push(fallbackSection);
        } else {
          after.unshift(fallbackSection);
        }
      }
      const end = injections
        .filter(rule => rule.placement === 'end')
        .map(rule => makeSynthetic(rule.type));
      if (bookingIndex >= 0) {
        rendered.splice(bookingIndex, 0, ...before);
        const afterIndex = rendered.findIndex(
          entry => entry.sectionType === 'booking',
        ) + 1;
        rendered.splice(afterIndex, 0, ...after);
      } else {
        rendered.push(...before, ...after);
      }
      // End-of-page injections land before trailing chrome (final CTA/footer).
      const chromeIndex = rendered.findIndex(entry =>
        entry.sectionType === 'final_cta' || entry.sectionType === 'footer');
      if (chromeIndex >= 0) {
        rendered.splice(chromeIndex, 0, ...end);
      } else {
        rendered.push(...end);
      }
    }

    return {
      id: page.id,
      isHome: page.isHome,
      label: page.name,
      order: page.order,
      sections: resolveAdjacency(dropUnanchorableNavigation(rendered)),
      slug: page.slug,
      visibleInNavigation: page.visibleInNavigation,
    };
  });

  return planPages.filter(page => page.sections.some(
    section => !CHROME_SECTION_TYPES.has(section.sectionType),
  ));
};

export type CustomerSiteComposition = {
  contentPlacement: SiteContentPlacementPlan;
  pages: SitePlanPage[];
};

/**
 * The structural page plan and the shared-content placement plan are resolved
 * together. Entire sections with no unique customer content are removed here,
 * so every Preview/compiler consumer receives the same blank-band-free pages.
 */
export const buildCustomerSiteComposition = (
  document: SiteBuilderDocument,
  options: BuildCustomerPagePlanOptions,
): CustomerSiteComposition => {
  const structuralPages = buildStructuralCustomerPagePlan(document, options);
  const quickBookProfileSectionId = document.originStarter === 'quick_book'
    ? structuralPages.flatMap(page => page.sections).find(
        section => section.sectionType === 'hero',
      )?.id ?? null
    : null;
  const contentPlacement = buildSiteContentPlacementPlan(
    structuralPages,
    getSiteContentAvailability(options.context),
    {
      ownerStaffMemberId: options.context.ownerStaffMemberId,
      quickBookProfileSectionId,
    },
  );
  const pages = filterCustomerPagePlanSections(structuralPages, section => (
    !getSectionContentSuppressions(contentPlacement, section.id)
      .some(notice => notice.suppressEntireSection)
  ));
  return { contentPlacement, pages };
};

export const buildCustomerPagePlan = (
  document: SiteBuilderDocument,
  options: BuildCustomerPagePlanOptions,
): SitePlanPage[] => buildCustomerSiteComposition(document, options).pages;

/** Owner-facing detail for content the plan suppresses without deleting. */
export const getSectionContentPlacementSuppressions = (
  document: SiteBuilderDocument,
  sectionId: string,
  options: BuildCustomerPagePlanOptions,
): readonly SectionContentSuppression[] => {
  const structuralPages = buildStructuralCustomerPagePlan(document, options);
  const quickBookProfileSectionId = document.originStarter === 'quick_book'
    ? structuralPages.flatMap(page => page.sections).find(
        section => section.sectionType === 'hero',
      )?.id ?? null
    : null;
  return getSectionContentSuppressions(
    buildSiteContentPlacementPlan(
      structuralPages,
      getSiteContentAvailability(options.context),
      {
        ownerStaffMemberId: options.context.ownerStaffMemberId,
        quickBookProfileSectionId,
      },
    ),
    sectionId,
  );
};
