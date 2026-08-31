import { createHash } from 'node:crypto';

import {
  buildCustomerPagePlan,
  type SitePlanSection,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/site-plan';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { applyOnboardingSitePresentation } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-document-presentation';
import { deriveSiteLibraryContextFromProfile } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-library-context';
import type {
  BusinessProfileDraft,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
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

function sourceForSection(type: CompiledSection['type']): CompiledSection['source'] {
  if (type === 'services' || type === 'booking' || type === 'featured_services') {
    return 'service_menu';
  }
  if (type === 'policies' || type === 'deposits_cancellations') {
    return 'policies';
  }
  if (type === 'gallery') {
    return 'gallery';
  }
  if (type === 'custom_design') {
    return 'custom_design';
  }
  if (type === 'team' || type === 'reviews' || type === 'offers' || type === 'faq') {
    return 'site_content';
  }
  if (
    type === 'content'
    || type === 'announcement_bar'
    || type === 'section_navigation'
    || type === 'final_cta'
    || type === 'footer'
  ) {
    return 'starter_presentation';
  }
  return 'business_profile';
}

function presentationForSection(
  planSection: SitePlanSection,
  snapshot: OnboardingPersistedSnapshot,
): Record<string, Primitive> {
  const type = planSection.sectionType as CompiledSection['type'];
  const { section } = planSection;
  const originalSectionType = section.sectionType;
  const { label } = planSection;
  const common = { label, originalSectionType };
  if (type === 'hero') {
    return { ...common, starter: snapshot.site.starter };
  }
  if (type === 'about') {
    return { ...common, preset: snapshot.site.aboutPreset };
  }
  if (type === 'gallery') {
    const layout = !planSection.injected && section.sectionType === 'gallery'
      ? section.settings.preset
      : snapshot.gallery.layout;
    return { ...common, layout, source: snapshot.gallery.source };
  }
  if (type === 'booking') {
    return {
      ...common,
      minimumNoticeMinutes: snapshot.profile.bookingPreferences.minimumNoticeMinutes,
    };
  }
  if (type === 'visit' || type === 'visit_us' || type === 'contact') {
    return {
      ...common,
      addressVisibility: snapshot.profile.location.addressVisibility,
      showHours: snapshot.profile.hours.showOnSite,
    };
  }
  if (type === 'custom_design') {
    const displayMode = !planSection.injected && section.sectionType === 'custom_design'
      ? section.settings.displayMode
      : snapshot.customDesign.displayMode;
    return { ...common, displayMode };
  }
  return common;
}

/**
 * Projects the shared customer page plan into the persisted compiled-page
 * record. All selection, injection, and ordering decisions live in
 * `buildCustomerPagePlan` — the compiler adds only persistence concerns
 * (stable injected ids, per-section provenance, presentation records).
 */
function compileAcceptedBuilderPages(
  siteId: string,
  snapshot: OnboardingPersistedSnapshot,
  document: SiteBuilderDocument,
): CompiledPage[] {
  const profile: BusinessProfileDraft = {
    ...createDefaultOnboardingState().profile,
    ...snapshot.profile,
  };
  const plan = buildCustomerPagePlan(document, {
    context: deriveSiteLibraryContextFromProfile({
      document,
      galleryImageIds: snapshot.site.galleryEnabled
        ? snapshot.gallery.imageItemIds
        : [],
      profile,
    }),
    customDesignFallback: snapshot.customDesign.settings
      ? {
          id: snapshot.customDesign.customDesignSectionId
            ?? `${siteId}:onboarding:custom_design`,
          placement: snapshot.customDesign.placement,
          settings: snapshot.customDesign.settings,
        }
      : undefined,
    injectionId: type => `${siteId}:onboarding:${type}`,
    toggles: {
      aboutEnabled: snapshot.site.aboutEnabled,
      canvaEnabled: snapshot.site.canvaEnabled,
      galleryEnabled: snapshot.site.galleryEnabled,
      policiesEnabled: snapshot.site.policiesEnabled,
    },
  });

  const compileSection = (
    planSection: SitePlanSection,
    order: number,
  ): CompiledSection => {
    const type = planSection.sectionType as CompiledSection['type'];
    return {
      ...(planSection.section.sectionType === 'custom_design'
        ? { customDesignSettings: planSection.section.settings }
        : {}),
      id: planSection.id,
      order,
      presentation: presentationForSection(
        planSection,
        snapshot,
      ),
      source: sourceForSection(type),
      type,
      visible: true,
    } satisfies CompiledSection;
  };

  return plan.map((page, order): CompiledPage => ({
    id: page.id,
    isHome: page.isHome,
    label: page.label,
    order,
    sections: page.sections.map(compileSection),
    slug: page.slug,
    visible: true,
    visibleInNavigation: page.visibleInNavigation,
  }));
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
  const stampedDocument = applyOnboardingSitePresentation(builderDocument, {
    aboutPreset: snapshot.site.aboutPreset,
    galleryLayout: snapshot.gallery.layout,
  });
  const pages = compileAcceptedBuilderPages(siteId, snapshot, stampedDocument);
  const visiblePageIds = new Set(pages.map(page => page.id));

  const document = {
    builderDocument: stampedDocument,
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
