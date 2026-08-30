import { createHash } from 'node:crypto';

import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import {
  getSectionLabel,
  getStarterDocumentSemanticInfoBySectionId,
  type StarterDocumentSemanticInfo,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import type {
  SiteBuilderDocument,
  StarterSectionSemanticRole,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';
import { getPublicContactActions } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/contact';
import { getPublicWeeklyHours } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/hours';
import { getPublicLocationPreview } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/location';
import { hasMeaningfulPublishablePolicies } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/policies';
import { getCustomerProfileFacts } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/profile-facts';
import {
  type OnboardingCompiledSiteDocument,
  onboardingCompiledSiteDocumentSchema,
  type OnboardingPersistedSnapshot,
  onboardingPersistedSnapshotSchema,
} from './contracts';

export { createPersistableOnboardingDraft } from './snapshot';

type Primitive = string | number | boolean | null;
type CompiledSection = OnboardingCompiledSiteDocument['pages'][number]['sections'][number];
type CompiledPage = OnboardingCompiledSiteDocument['pages'][number];

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function fingerprintOnboardingValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function injectedSection(
  siteId: string,
  type: CompiledSection['type'],
  order: number,
  source: CompiledSection['source'],
  presentation: Record<string, Primitive> = {},
  customDesignSettings?: CustomDesignSettings,
): CompiledSection {
  return {
    ...(customDesignSettings ? { customDesignSettings } : {}),
    id: `${siteId}:onboarding:${type}`,
    order,
    presentation,
    source,
    type,
    visible: true,
  };
}

type SourcePage = SiteBuilderDocument['pages'][number];
type SourceSection = SourcePage['sections'][number];

type LocatedSourceSection = {
  page: SourcePage;
  semanticInfo: StarterDocumentSemanticInfo | null;
  section: SourceSection;
};

function sourceForSection(type: CompiledSection['type']): CompiledSection['source'] {
  if (type === 'services' || type === 'booking') {
    return 'service_menu';
  }
  if (type === 'policies') {
    return 'policies';
  }
  if (type === 'gallery') {
    return 'gallery';
  }
  if (type === 'custom_design') {
    return 'custom_design';
  }
  if (type === 'reviews' || type === 'content') {
    return 'starter_presentation';
  }
  return 'business_profile';
}

function presentationForSection(
  type: CompiledSection['type'],
  originalSectionType: string,
  label: string,
  snapshot: OnboardingPersistedSnapshot,
): Record<string, Primitive> {
  const common = { label, originalSectionType };
  if (type === 'hero') {
    return { ...common, starter: snapshot.site.starter };
  }
  if (type === 'about') {
    return { ...common, preset: snapshot.site.aboutPreset };
  }
  if (type === 'gallery') {
    return { ...common, layout: snapshot.gallery.layout, source: snapshot.gallery.source };
  }
  if (type === 'booking') {
    return {
      ...common,
      minimumNoticeMinutes: snapshot.profile.bookingPreferences.minimumNoticeMinutes,
    };
  }
  if (type === 'visit' || type === 'contact') {
    return {
      ...common,
      addressVisibility: snapshot.profile.location.addressVisibility,
      showHours: snapshot.profile.hours.showOnSite,
    };
  }
  if (type === 'custom_design') {
    return { ...common, displayMode: snapshot.customDesign.displayMode };
  }
  return common;
}

/** Mirrors the customer renderer using its pure public-data resolvers. */
function hasPublicContactContent(
  profile: OnboardingPersistedSnapshot['profile'],
): boolean {
  const location = getPublicLocationPreview(profile.location);
  return Boolean(
    location.primary
    || getCustomerProfileFacts(profile).some(fact => fact.id === 'service_location')
    || getPublicContactActions(profile).some(action => action.method !== 'booking')
    || getPublicWeeklyHours(profile.hours).length > 0,
  );
}

function compileAcceptedBuilderPages(
  siteId: string,
  snapshot: OnboardingPersistedSnapshot,
): CompiledPage[] {
  const document = snapshot.site.builderDocument;
  if (!document) {
    throw new Error('The accepted universal site document is required to compile the saved site.');
  }
  const starterSemanticInfo = getStarterDocumentSemanticInfoBySectionId(document);
  const visibleSourcePages = [...document.pages]
    .sort((left, right) => left.order - right.order)
    .filter(page => page.visible);
  const locatedSections: LocatedSourceSection[] = visibleSourcePages.flatMap(page => (
    [...page.sections]
      .sort((left, right) => left.order - right.order)
      .filter(section => section.visible)
      .map(section => ({
        page,
        semanticInfo: starterSemanticInfo.get(section.id) ?? null,
        section,
      }))
  ));

  const firstWithRole = (role: StarterSectionSemanticRole) => locatedSections.find(
    located => located.semanticInfo?.role === role,
  );
  const galleryHasContent = snapshot.site.galleryEnabled
    && snapshot.gallery.imageItemIds.length > 0;
  const contactHasContent = hasPublicContactContent(snapshot.profile);
  const selectedSectionIds = new Set<string>();
  const select = (located: LocatedSourceSection | undefined) => {
    if (located) {
      selectedSectionIds.add(located.section.id);
    }
  };

  select(firstWithRole('hero'));
  select(locatedSections.find(({ section }) => section.sectionType === 'booking'));
  if (snapshot.site.aboutEnabled) {
    select(firstWithRole('about'));
  }
  if (galleryHasContent) {
    select(firstWithRole('gallery'));
  }
  if (contactHasContent) {
    select(firstWithRole('contact') ?? firstWithRole('visit'));
  }
  if (snapshot.site.canvaEnabled) {
    locatedSections
      .filter(({ section }) => section.sectionType === 'custom_design')
      .forEach(select);
  }

  const pages = visibleSourcePages.map((sourcePage): CompiledPage => {
    const sections = locatedSections
      .filter(located => (
        located.page.id === sourcePage.id
        && selectedSectionIds.has(located.section.id)
      ))
      .map(({ semanticInfo, section: sourceSection }, order) => {
        const type: CompiledSection['type'] = sourceSection.sectionType === 'booking'
          ? 'booking'
          : sourceSection.sectionType === 'custom_design'
            ? 'custom_design'
            : semanticInfo?.role === 'hero'
              ? 'hero'
              : semanticInfo?.role === 'about'
                ? 'about'
                : semanticInfo?.role === 'gallery'
                  ? 'gallery'
                  : 'contact';
        const presentationLabel = semanticInfo
          && sourceSection.sectionType !== 'booking'
          && sourceSection.sectionType !== 'custom_design'
          && sourceSection.label === getSectionLabel(sourceSection.sectionType)
          ? semanticInfo.previewLabel
          : sourceSection.label;
        return {
          ...(sourceSection.sectionType === 'custom_design'
            ? { customDesignSettings: sourceSection.settings }
            : {}),
          id: sourceSection.id,
          order,
          presentation: presentationForSection(
            type,
            sourceSection.sectionType,
            presentationLabel,
            snapshot,
          ),
          source: sourceForSection(type),
          type,
          visible: sourceSection.visible,
        } satisfies CompiledSection;
      });
    return {
      id: sourcePage.id,
      isHome: sourcePage.isHome,
      label: sourcePage.name,
      order: sourcePage.order,
      sections,
      slug: sourcePage.slug,
      visible: sourcePage.visible,
      visibleInNavigation: sourcePage.visibleInNavigation,
    };
  });

  const bookingPage = pages.find(page => page.sections.some(item => item.type === 'booking'))
    ?? pages.find(page => page.isHome)
    ?? pages[0];
  if (!bookingPage) {
    throw new Error('The accepted universal site document has no visible page.');
  }
  const bookingIndex = () => bookingPage.sections.findIndex(item => item.type === 'booking');
  const insertRelativeToBooking = (
    item: CompiledSection,
    placement: 'before_booking' | 'after_booking',
  ) => {
    const index = bookingIndex();
    const target = index < 0
      ? bookingPage.sections.length
      : placement === 'before_booking' ? index : index + 1;
    bookingPage.sections.splice(target, 0, item);
  };

  const allDocumentSections = [
    ...document.pages.flatMap(page => page.sections),
    ...document.unusedSections,
  ];
  const documentHasStarterRole = (role: StarterSectionSemanticRole) => allDocumentSections.some(
    sourceSection => starterSemanticInfo.get(sourceSection.id)?.role === role,
  );
  const documentOwnsCustomDesign = allDocumentSections.some(
    sourceSection => sourceSection.sectionType === 'custom_design',
  );

  if (
    snapshot.site.aboutEnabled
    && !documentHasStarterRole('about')
    && !pages.some(page => page.sections.some(item => item.type === 'about'))
  ) {
    insertRelativeToBooking(injectedSection(siteId, 'about', 0, 'business_profile', {
      label: 'About',
      preset: snapshot.site.aboutPreset,
    }), 'before_booking');
  }
  if (
    galleryHasContent
    && !documentHasStarterRole('gallery')
    && !pages.some(page => page.sections.some(item => item.type === 'gallery'))
  ) {
    insertRelativeToBooking(injectedSection(siteId, 'gallery', 0, 'gallery', {
      label: 'Gallery',
      layout: snapshot.gallery.layout,
      source: snapshot.gallery.source,
    }), 'before_booking');
  }
  if (
    contactHasContent
    && !documentHasStarterRole('contact')
    && !documentHasStarterRole('visit')
    && !pages.some(page => page.sections.some(item => item.type === 'contact'))
  ) {
    bookingPage.sections.push(injectedSection(
      siteId,
      'contact',
      bookingPage.sections.length,
      'business_profile',
      {
        addressVisibility: snapshot.profile.location.addressVisibility,
        label: 'Contact',
        originalSectionType: 'onboarding_contact',
        showHours: snapshot.profile.hours.showOnSite,
      },
    ));
  }
  if (
    snapshot.site.policiesEnabled
    && hasMeaningfulPublishablePolicies(snapshot.profile.policies)
    && !pages.some(page => page.sections.some(item => item.type === 'policies'))
  ) {
    insertRelativeToBooking(
      injectedSection(siteId, 'policies', 0, 'policies', { label: 'Policies' }),
      'after_booking',
    );
  }
  if (
    snapshot.site.canvaEnabled
    && snapshot.customDesign.settings
    && !documentOwnsCustomDesign
    && !pages.some(page => page.sections.some(item => item.type === 'custom_design'))
  ) {
    const customSection = injectedSection(
      siteId,
      'custom_design',
      0,
      'custom_design',
      {
        displayMode: snapshot.customDesign.displayMode,
        label: 'Custom Design',
        originalSectionType: 'custom_design',
      },
      snapshot.customDesign.settings,
    );
    if (snapshot.customDesign.customDesignSectionId) {
      customSection.id = snapshot.customDesign.customDesignSectionId;
    }
    insertRelativeToBooking(customSection, snapshot.customDesign.placement);
  }

  for (const page of pages) {
    page.sections = page.sections.map((item, order) => ({ ...item, order }));
  }
  return pages
    .filter(page => page.sections.length > 0)
    .map((page, order) => ({ ...page, order }));
}

/**
 * The same deterministic compiler output is persisted and used by saved-site
 * Preview. It contains no placeholder sections and no copied business text:
 * native sections point back to the shared profile/service/policy sources.
 */
export function compileOnboardingToSiteDocument(input: {
  revision: number;
  siteId: string;
  snapshot: OnboardingPersistedSnapshot;
}): OnboardingCompiledSiteDocument {
  const { revision, siteId } = input;
  const snapshot = onboardingPersistedSnapshotSchema.parse(input.snapshot);
  const builderDocument = snapshot.site.builderDocument;
  if (!builderDocument) {
    throw new Error('The accepted universal site document is required to compile the saved site.');
  }
  const pages = compileAcceptedBuilderPages(siteId, snapshot);
  const visiblePageIds = new Set(pages.map(page => page.id));

  const document = {
    builderDocument,
    navigation: [...builderDocument.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter(item => visiblePageIds.has(item.pageId))
      .map((item, order) => ({ label: item.label, order, pageId: item.pageId })),
    navigationEnabled: builderDocument.navigation.enabled,
    pages,
    palettePresetId: snapshot.site.palettePresetId,
    revision,
    schemaVersion: 1 as const,
    serviceSelection: {
      selectedAddOnIds: snapshot.profile.serviceMenu.selectedAddOnIds,
      selectedServiceIds: snapshot.profile.serviceMenu.selectedServiceIds,
    },
    siteId,
    siteName: snapshot.profile.businessName,
    sourceSnapshotVersion: 1 as const,
    starter: snapshot.site.starter,
    stylePresetId: snapshot.site.stylePresetId,
  };
  return onboardingCompiledSiteDocumentSchema.parse(document);
}

export type ResolvedProductionServiceSelection = {
  addOnTemplateKeys: string[];
  issues: Array<{
    labServiceId: string;
    mappingKind: 'closest_template' | 'production_gap';
    productionCanonicalId: string;
  }>;
  overrides: Array<{
    durationMinutes?: number;
    priceCents?: number;
    templateKey: string;
  }>;
  serviceTemplateKeys: string[];
};

/**
 * Only exact catalogue mappings are activated automatically. Closest matches
 * and Product gaps remain in the exact site snapshot and are returned for an
 * explicit future owner-menu review; they are never silently substituted.
 */
export function resolveProductionServiceSelection(
  snapshot: OnboardingPersistedSnapshot,
): ResolvedProductionServiceSelection {
  const selectedServiceIds = new Set(snapshot.profile.serviceMenu.selectedServiceIds);
  const selectedAddOnIds = new Set(snapshot.profile.serviceMenu.selectedAddOnIds);
  const exactServiceMappings = SERVICE_MENU_PRODUCTION_MAPPINGS.filter(
    mapping => selectedServiceIds.has(mapping.labServiceId) && mapping.mappingKind === 'exact_template',
  );
  const exactAddOnMappings = ADD_ON_PRODUCTION_MAPPINGS.filter(
    mapping => selectedAddOnIds.has(mapping.labServiceId) && mapping.mappingKind === 'exact_template',
  );
  const issues = SERVICE_MENU_PRODUCTION_MAPPINGS.flatMap((mapping) => {
    if (!selectedServiceIds.has(mapping.labServiceId) || mapping.mappingKind === 'exact_template') {
      return [];
    }
    return [{
      labServiceId: mapping.labServiceId,
      mappingKind: mapping.mappingKind,
      productionCanonicalId: mapping.productionCanonicalId,
    }];
  });

  return {
    addOnTemplateKeys: [...new Set(exactAddOnMappings.map(item => item.productionCanonicalId))],
    issues,
    overrides: exactServiceMappings.flatMap((mapping) => {
      const override = snapshot.profile.serviceMenu.ownerOverridesByServiceId[mapping.labServiceId];
      return override
        ? [{
            ...(override.durationMinutes === undefined ? {} : { durationMinutes: override.durationMinutes }),
            ...(override.priceCents === undefined ? {} : { priceCents: override.priceCents }),
            templateKey: mapping.productionCanonicalId,
          }]
        : [];
    }),
    serviceTemplateKeys: [...new Set(exactServiceMappings.map(item => item.productionCanonicalId))],
  };
}
