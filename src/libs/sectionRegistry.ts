import type { SectionId } from '@/libs/bookingPageConfig';
import type { SalonContent } from '@/libs/salonContent';
import { SECTION_PRESENTATION_CONTRACT } from '@/libs/sectionPresentation';

export type ContentSectionId = SectionId | 'announcement' | 'bookingFacts';
export type SectionReadiness = 'ready' | 'partial' | 'missing' | 'invalid' | 'unsupported';
export type SectionPublicOutcome = 'render' | 'render_partial' | 'omit';
export type ProtectedCapability = 'identity' | 'serviceDiscovery' | 'bookingAccess';
export type PublicSurfaceClassification = 'content' | 'systemAffordance' | 'bookingFlowControl' | 'unsupported';
export type PublicSurfaceInventoryEntry = {
  classification: PublicSurfaceClassification;
  sectionId?: ContentSectionId;
  reason: string;
};
export type SectionDecision = { id: ContentSectionId; configuredOrder: number | null; ownerHidden: boolean; readiness: SectionReadiness; publicOutcome: SectionPublicOutcome; capabilities: readonly ProtectedCapability[]; classification: 'content' | 'systemCompatibility' };
export type SectionDecisionPlan = {
  orderedIds: SectionId[];
  decisions: Record<ContentSectionId, SectionDecision>;
  unfulfilledCapabilities: ProtectedCapability[];
};
export type SectionDecisionInput = { order: readonly SectionId[]; hiddenSections: readonly SectionId[]; content: SalonContent; announcement?: string | null };
type ReadinessResolver = (input: SectionDecisionInput) => SectionReadiness;
export type SectionRegistryEntry = { id: ContentSectionId; variants: readonly string[]; capabilities: readonly ProtectedCapability[]; classification: 'content' | 'systemCompatibility'; ownerConfigurable: boolean; resolveReadiness: ReadinessResolver };

/** Closed inventory of public booking-page surfaces, including non-content chrome. */
export const PUBLIC_SURFACE_INVENTORY = {
  salonProfile: { classification: 'content', sectionId: 'salonProfile', reason: 'Public salon identity.' },
  technicianProfile: { classification: 'content', sectionId: 'technicianProfile', reason: 'Public technician story.' },
  featuredServices: { classification: 'content', sectionId: 'featuredServices', reason: 'Curated service content.' },
  serviceMenu: { classification: 'content', sectionId: 'serviceMenu', reason: 'Protected service discovery.' },
  hoursLocation: { classification: 'content', sectionId: 'hoursLocation', reason: 'Public visit context.' },
  policies: { classification: 'content', sectionId: 'policies', reason: 'Service-page policy content.' },
  socialLinks: { classification: 'content', sectionId: 'socialLinks', reason: 'Salon-authored social content.' },
  announcement: { classification: 'content', sectionId: 'announcement', reason: 'Salon-authored booking message.' },
  bookingFacts: { classification: 'content', sectionId: 'bookingFacts', reason: 'Salon-authored booking facts on service and confirmation pages.' },
  whatsIncluded: { classification: 'unsupported', sectionId: 'whatsIncluded', reason: 'No canonical inclusions data path.' },
  technicianList: { classification: 'unsupported', sectionId: 'technicianList', reason: 'Registered for compatibility; no public renderer.' },
  portfolio: { classification: 'unsupported', sectionId: 'portfolio', reason: 'No public-safe portfolio projection.' },
  reviews: { classification: 'unsupported', sectionId: 'reviews', reason: 'No featured-review projection.' },
  bookingCtaCompatibility: { classification: 'systemAffordance', sectionId: 'bookingCta', reason: 'Symbolic hard-floor ID; emits no pixels.' },
  editorialStickyBookingCta: { classification: 'systemAffordance', reason: 'Viewport-fixed booking access governed by scroll and booking state.' },
  selectedServiceContinueBar: { classification: 'systemAffordance', reason: 'Viewport-fixed booking access governed by selection state.' },
  appointmentSummaryCard: { classification: 'bookingFlowControl', reason: 'Appointment summary on technician and time steps, governed by selected booking state.' },
  bookingProgressHeader: { classification: 'bookingFlowControl', reason: 'Progress/back controls governed by booking flow.' },
  serviceSelectionControls: { classification: 'bookingFlowControl', reason: 'Search, category and selection controls inside the protected service engine.' },
  smartFitAvailabilitySection: { classification: 'bookingFlowControl', reason: 'Availability recommendation governed by time-selection state.' },
  confirmationPolicyDisclosure: { classification: 'bookingFlowControl', reason: 'Checkout acknowledgment disclosure governed by booking policy, not page ordering.' },
  depositDisclosure: { classification: 'bookingFlowControl', reason: 'System financial disclosure deliberately independent from salon booking facts.' },
} as const satisfies Record<string, PublicSurfaceInventoryEntry>;

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function resolveVisitContent(content: SalonContent): { resolvedAddress: string | null; resolvedCity: string | null; hasVisitableContent: boolean } {
  const { address, locations, entranceInstructions } = content.place;
  const primaryLocation = locations.find(location => location.isPrimary) ?? locations[0] ?? null;
  const resolvedAddress = address?.address ?? primaryLocation?.address ?? null;
  const resolvedCity = address?.city ?? primaryLocation?.city ?? null;
  return { resolvedAddress, resolvedCity, hasVisitableContent: Boolean(resolvedAddress || resolvedCity || entranceInstructions) };
}

function quickFactState(content: SalonContent): SectionReadiness {
  const enabled = Object.values(content.policies.quickFacts).filter(fact => fact.enabled);
  if (enabled.length === 0) {
    return 'missing';
  }
  const meaningful = enabled.filter(fact => hasText(fact.label));
  if (meaningful.length === 0) {
    return 'invalid';
  }
  return meaningful.length < enabled.length ? 'partial' : 'ready';
}

const SECTION_DEFINITIONS: Record<ContentSectionId, SectionRegistryEntry> = {
  salonProfile: { id: 'salonProfile', variants: SECTION_PRESENTATION_CONTRACT.salonProfile.variants, capabilities: ['identity'], classification: 'content', ownerConfigurable: false, resolveReadiness: ({ content }) => hasText(content.identity.name) ? 'ready' : 'invalid' },
  technicianProfile: { id: 'technicianProfile', variants: SECTION_PRESENTATION_CONTRACT.technicianProfile.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: ({ content }) => content.people.technicians.some(t => hasText(t.bio) || hasText(t.avatarUrl)) ? 'ready' : 'missing' },
  featuredServices: { id: 'featuredServices', variants: SECTION_PRESENTATION_CONTRACT.featuredServices.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: ({ content }) => content.catalog.featuredServices.length > 0 ? 'ready' : 'missing' },
  serviceMenu: { id: 'serviceMenu', variants: SECTION_PRESENTATION_CONTRACT.serviceMenu.variants, capabilities: ['serviceDiscovery'], classification: 'content', ownerConfigurable: false, resolveReadiness: ({ content }) => content.catalog.services.length > 0 ? 'ready' : 'partial' },
  whatsIncluded: { id: 'whatsIncluded', variants: SECTION_PRESENTATION_CONTRACT.whatsIncluded.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: () => 'unsupported' },
  technicianList: { id: 'technicianList', variants: SECTION_PRESENTATION_CONTRACT.technicianList.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: () => 'unsupported' },
  portfolio: { id: 'portfolio', variants: SECTION_PRESENTATION_CONTRACT.portfolio.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: () => 'unsupported' },
  reviews: { id: 'reviews', variants: SECTION_PRESENTATION_CONTRACT.reviews.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: () => 'unsupported' },
  hoursLocation: { id: 'hoursLocation', variants: SECTION_PRESENTATION_CONTRACT.hoursLocation.variants, capabilities: ['identity'], classification: 'content', ownerConfigurable: true, resolveReadiness: ({ content }) => resolveVisitContent(content).hasVisitableContent ? 'ready' : 'missing' },
  policies: { id: 'policies', variants: SECTION_PRESENTATION_CONTRACT.policies.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: ({ content }) => {
    const policy = content.policies.policy;
    if (!policy.enabled || !policy.showOnServicePage) {
      return 'missing';
    }
    return hasText(policy.text) ? 'ready' : 'partial';
  } },
  socialLinks: { id: 'socialLinks', variants: SECTION_PRESENTATION_CONTRACT.socialLinks.variants, capabilities: [], classification: 'content', ownerConfigurable: true, resolveReadiness: ({ content }) => Object.values(content.social).some(hasText) ? 'ready' : 'missing' },
  bookingCta: { id: 'bookingCta', variants: SECTION_PRESENTATION_CONTRACT.bookingCta.variants, capabilities: ['bookingAccess'], classification: 'systemCompatibility', ownerConfigurable: false, resolveReadiness: () => 'ready' },
  announcement: { id: 'announcement', variants: ['inline'], capabilities: [], classification: 'content', ownerConfigurable: false, resolveReadiness: ({ announcement }) => hasText(announcement) ? 'ready' : 'missing' },
  bookingFacts: { id: 'bookingFacts', variants: ['badges'], capabilities: [], classification: 'content', ownerConfigurable: false, resolveReadiness: ({ content }) => quickFactState(content) },
};

function publicOutcome(id: ContentSectionId, readiness: SectionReadiness, ownerHidden: boolean): SectionPublicOutcome {
  if (ownerHidden || readiness === 'missing' || readiness === 'invalid' || readiness === 'unsupported') {
    return 'omit';
  }
  if (readiness === 'partial') {
    return id === 'serviceMenu' || id === 'bookingFacts' ? 'render_partial' : 'omit';
  }
  return 'render';
}

export const SECTION_REGISTRY = Object.fromEntries(
  Object.values(SECTION_DEFINITIONS).map(entry => [entry.id, {
    ...entry,
    /** @deprecated Production visibility must use resolveSectionDecisionPlan. */
    canRender: (content: SalonContent) => publicOutcome(entry.id, entry.resolveReadiness({ order: [], hiddenSections: [], content }), false) !== 'omit',
  }]),
) as Record<ContentSectionId, SectionRegistryEntry & { canRender: (content: SalonContent) => boolean }>;

/** The sole public content visibility/readiness owner. Pure, DB-free and tenant-neutral. */
export function resolveSectionDecisionPlan(input: SectionDecisionInput): SectionDecisionPlan {
  const hidden = new Set(input.hiddenSections);
  const orderIndex = new Map(input.order.map((id, index) => [id, index]));
  const decisions = {} as Record<ContentSectionId, SectionDecision>;
  for (const entry of Object.values(SECTION_REGISTRY)) {
    const configuredOrder = orderIndex.get(entry.id as SectionId) ?? null;
    const ownerHidden = entry.ownerConfigurable && hidden.has(entry.id as SectionId);
    const readiness = entry.resolveReadiness(input);
    decisions[entry.id] = { id: entry.id, configuredOrder, ownerHidden, readiness, publicOutcome: publicOutcome(entry.id, readiness, ownerHidden), capabilities: entry.capabilities, classification: entry.classification };
  }
  const orderedIds = input.order.filter(id => Boolean(decisions[id]) && decisions[id].publicOutcome !== 'omit');
  const providedCapabilities = new Set(
    orderedIds.flatMap(id => decisions[id].capabilities),
  );
  const unfulfilledCapabilities = (['identity', 'serviceDiscovery', 'bookingAccess'] as ProtectedCapability[])
    .filter(capability => !providedCapabilities.has(capability));
  return { orderedIds, decisions, unfulfilledCapabilities };
}

export function shouldRenderSection(plan: SectionDecisionPlan, id: ContentSectionId): boolean {
  return plan.decisions[id].publicOutcome !== 'omit';
}
export const REGISTERED_SECTION_IDS: readonly ContentSectionId[] = Object.keys(SECTION_REGISTRY) as ContentSectionId[];

/** @deprecated Compatibility seam for tests/older callers; delegates to the canonical plan. */
export function resolveVisibleSectionOrder(order: readonly SectionId[], hiddenSections: readonly SectionId[], content: SalonContent): SectionId[] {
  return resolveSectionDecisionPlan({ order, hiddenSections, content }).orderedIds;
}
