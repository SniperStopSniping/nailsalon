import { createHash } from 'node:crypto';

import type { CustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';
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

function section(
  siteId: string,
  pageSlug: string,
  type: CompiledSection['type'],
  order: number,
  source: CompiledSection['source'],
  presentation: Record<string, Primitive> = {},
  customDesignSettings?: CustomDesignSettings,
): CompiledSection {
  return {
    ...(customDesignSettings ? { customDesignSettings } : {}),
    id: `${siteId}:${pageSlug}:${type}`,
    order,
    presentation,
    source,
    type,
    visible: true,
  };
}

function semanticSectionType(
  sectionType: string,
  label: string,
): CompiledSection['type'] {
  if (sectionType === 'booking') {
    return 'booking';
  }
  if (sectionType === 'custom_design') {
    return 'custom_design';
  }
  const normalized = label.trim().toLowerCase();
  if (normalized.includes('welcome') || normalized.includes('salon intro')) {
    return 'hero';
  }
  if (normalized.includes('services')) {
    return 'services';
  }
  if (normalized.includes('featured work') || normalized.includes('gallery')) {
    return 'gallery';
  }
  if (normalized.includes('about')) {
    return 'about';
  }
  if (normalized.includes('review')) {
    return 'reviews';
  }
  if (normalized.includes('visit')) {
    return 'visit';
  }
  if (normalized.includes('contact')) {
    return 'contact';
  }
  return 'content';
}

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

function shouldIncludeSection(
  type: CompiledSection['type'],
  snapshot: OnboardingPersistedSnapshot,
): boolean {
  if (type === 'about') {
    return snapshot.site.aboutEnabled;
  }
  if (type === 'gallery') {
    return snapshot.site.galleryEnabled;
  }
  if (type === 'policies') {
    return snapshot.site.policiesEnabled;
  }
  if (type === 'custom_design') {
    return snapshot.site.canvaEnabled;
  }
  return true;
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

function compileAcceptedBuilderPages(
  siteId: string,
  snapshot: OnboardingPersistedSnapshot,
): CompiledPage[] {
  const document = snapshot.site.builderDocument;
  if (!document) {
    throw new Error('The accepted universal site document is required to compile the saved site.');
  }

  const pages = [...document.pages]
    .sort((left, right) => left.order - right.order)
    .filter(page => page.visible)
    .map((sourcePage): CompiledPage => {
      const sections = [...sourcePage.sections]
        .sort((left, right) => left.order - right.order)
        .flatMap((sourceSection) => {
          const type = semanticSectionType(sourceSection.sectionType, sourceSection.label);
          if (!sourceSection.visible || !shouldIncludeSection(type, snapshot)) {
            return [];
          }
          return [{
            ...(sourceSection.sectionType === 'custom_design'
              ? { customDesignSettings: sourceSection.settings }
              : {}),
            id: sourceSection.id,
            order: sourceSection.order,
            presentation: presentationForSection(
              type,
              sourceSection.sectionType,
              sourceSection.label,
              snapshot,
            ),
            source: sourceForSection(type),
            type,
            visible: sourceSection.visible,
          } satisfies CompiledSection];
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

  if (snapshot.site.aboutEnabled && !pages.some(page => page.sections.some(item => item.type === 'about'))) {
    insertRelativeToBooking(section(siteId, bookingPage.slug, 'about', 0, 'business_profile', {
      preset: snapshot.site.aboutPreset,
    }), 'before_booking');
  }
  if (snapshot.site.galleryEnabled && !pages.some(page => page.sections.some(item => item.type === 'gallery'))) {
    insertRelativeToBooking(section(siteId, bookingPage.slug, 'gallery', 0, 'gallery', {
      layout: snapshot.gallery.layout,
      source: snapshot.gallery.source,
    }), 'before_booking');
  }
  if (snapshot.site.policiesEnabled && !pages.some(page => page.sections.some(item => item.type === 'policies'))) {
    insertRelativeToBooking(
      section(siteId, bookingPage.slug, 'policies', 0, 'policies'),
      'after_booking',
    );
  }
  if (
    snapshot.site.canvaEnabled
    && snapshot.customDesign.settings
    && !pages.some(page => page.sections.some(item => item.type === 'custom_design'))
  ) {
    const customSection = section(
      siteId,
      bookingPage.slug,
      'custom_design',
      0,
      'custom_design',
      { displayMode: snapshot.customDesign.displayMode },
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
  return pages.filter(page => page.sections.length > 0);
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
