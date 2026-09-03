/**
 * Derives the pure `SiteLibraryContext` the plan builder and section registry
 * consume from the shared onboarding authorities. The compiler and the saved
 * preview reuse this same derivation (via their reconstructed state), so the
 * three consumers of the plan builder can never disagree about what the
 * shared data allows.
 */

import { CANONICAL_SERVICES } from '../../booking/data';
import { createEmptySiteContent } from '../../model/section-library/site-content';
import type { SiteLibraryContext } from '../../model/section-library/registry';
import type { PolicyToggleId, QuickInfoFactId } from '../../model/section-library/settings';
import { POLICY_TOGGLE_IDS } from '../../model/section-library/settings';
import type { SitePlanOptionalToggles } from '../../model/site-plan';
import type { SiteBuilderDocument } from '../../model/types';
import {
  labelForMinimumNotice,
  labelForNewClients,
  labelForVisitMode,
} from '../preview/customer-facts';
import { getPublicContactActions } from './contact';
import { getPublicWeeklyHours, hasCompleteWeeklyHours } from './hours';
import { getPublicLocationPreview } from './location';
import {
  deriveDepositsAndCancellationsSummary,
  getPublicDepositsAndCancellationsDisplayWording,
  getPublicPolicyDisplayWording,
  hasMeaningfulPublishablePolicies,
  isDepositsAndCancellationsComplete,
  isDepositsAndCancellationsVisible,
} from './policies';
import { getCustomerProfileFacts } from './profile-facts';
import type { BusinessProfileDraft, OnboardingLabState } from './types';

/**
 * Profile-parts form used by server callers (the compiler) that hold a
 * persisted snapshot rather than a live lab state. The state-based deriver
 * delegates here so every consumer shares one derivation.
 */
export const deriveSiteLibraryContextFromProfile = (input: {
  profile: BusinessProfileDraft;
  galleryImageIds: readonly string[];
  document: SiteBuilderDocument | null;
}): SiteLibraryContext => {
  const { document, galleryImageIds, profile } = input;
  const selectedServiceIds = profile.serviceMenu.selectedServiceIds;
  const featuredServiceIds = CANONICAL_SERVICES
    .filter(service => service.featured && selectedServiceIds.includes(service.id))
    .map(service => service.id);

  const contactActions = getPublicContactActions(profile);
  const publicLocation = getPublicLocationPreview(profile.location);
  const hoursConfigured = profile.hours.setupState === 'configured'
    && hasCompleteWeeklyHours(profile.hours);
  // Exactly the facts the Quick Info renderer can resolve to real content:
  // the open/closed status needs the same three conditions
  // `getWeeklyHoursPreviewStatus` checks before it returns a label.
  const availableQuickFacts: QuickInfoFactId[] = [
    ...(publicLocation.primary.trim() ? ['location' as const] : []),
    ...(labelForVisitMode(profile) ? ['visit_mode' as const] : []),
    ...(labelForNewClients(profile) ? ['new_clients' as const] : []),
    ...(labelForMinimumNotice(profile) ? ['minimum_notice' as const] : []),
    ...(hoursConfigured && profile.hours.showOnSite ? ['open_status' as const] : []),
  ];

  /*
   * Before You Book can only draw the four toggle topics, and only where the
   * owner's wording actually resolved. `policiesMeaningful` is a six-topic
   * disjunction that includes deposits and cancellations, so it answers a
   * question that section never asks.
   */
  const availablePolicyTopics: PolicyToggleId[] = POLICY_TOGGLE_IDS.filter(
    topic => getPublicPolicyDisplayWording(profile.policies, topic).trim().length > 0,
  );

  /*
   * Deposits & Cancellations picks between two wordings, and each has its own
   * emptiness rule. Both are carried so readiness can mirror the renderer's
   * own branch rather than approximate it.
   */
  const depositsSummaryPublishable = isDepositsAndCancellationsVisible(profile.policies)
    && isDepositsAndCancellationsComplete(profile.policies)
    && deriveDepositsAndCancellationsSummary(profile.policies).trim().length > 0;
  const logoIsRenderable = profile.logo?.source === 'fixture'
    || profile.logo?.source === 'indexed_db';
  const profilePhotoIsRenderable = profile.profilePhoto?.source === 'fixture'
    || profile.profilePhoto?.source === 'indexed_db';
  const logoAssetId = profile.logo?.storageId ?? profile.logo?.id;
  const profileAssetId = profile.profilePhoto?.storageId ?? profile.profilePhoto?.id;
  const normalizedOwnerName = profile.ownerName.trim().toLocaleLowerCase();
  const ownerStaffMemberId = normalizedOwnerName
    ? document?.siteContent.staff.find(
      member => member.name.trim().toLocaleLowerCase() === normalizedOwnerName,
    )?.id ?? null
    : null;

  return {
    arrivalNotes: {
      entrance: profile.location.entranceInstructions.trim().length > 0,
      parking: profile.location.parking.trim().length > 0,
      transit: profile.location.transitInformation.trim().length > 0,
    },
    availablePolicyTopics,
    bookingOnlyContact: profile.bookingOnlyContact,
    availableQuickFacts,
    depositsSummaryPublishable,
    depositsWordingPublishable: getPublicDepositsAndCancellationsDisplayWording(profile.policies)
      .trim().length > 0,
    businessStructure: profile.businessStructure,
    canonicalServiceIds: [...selectedServiceIds],
    depositMode: profile.policies.deposits.mode,
    featuredServiceIds,
    galleryImageIds: [...galleryImageIds],
    hasLogoGraphic: logoIsRenderable,
    hasProfilePhoto: profilePhotoIsRenderable
      && (!logoIsRenderable || profileAssetId !== logoAssetId),
    // Mirrors the accepted ContactSection renderer's own show/hide predicate
    // (booking-only contact does not count as publishable contact content).
    hasContactSectionContent: Boolean(
      publicLocation.primary.trim()
      || getCustomerProfileFacts(profile).some(fact => fact.id === 'service_location')
      || contactActions.some(action => action.method !== 'booking')
      || getPublicWeeklyHours(profile.hours).length > 0,
    ),
    hasPublicContact: contactActions.some(action => action.method !== 'booking'),
    publicContactMethods: contactActions.flatMap((action) => {
      if (action.method === 'instagram') return ['instagram' as const];
      if (action.method === 'call') return ['phone' as const];
      if (action.method === 'text') return ['text' as const];
      if (action.method === 'email') return ['email' as const];
      return [];
    }),
    hasPublicExactAddress: profile.location.addressVisibility === 'public'
      && profile.location.exactAddress.trim().length > 0,
    hasPublicLocation: Boolean(publicLocation.primary.trim()),
    hoursConfigured,
    hoursShownOnSite: profile.hours.showOnSite,
    ownerStaffMemberId,
    policiesMeaningful: hasMeaningfulPublishablePolicies(profile.policies),
    siteContent: document?.siteContent ?? createEmptySiteContent(),
  };
};

export const deriveSiteLibraryContext = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
): SiteLibraryContext => deriveSiteLibraryContextFromProfile({
  document,
  // `data_url` and `missing` images keep their id but resolve to no URL
  // (`resolveOnboardingImage`), and storage read-back deliberately produces
  // both. Counting them would report a gallery ready that renders nothing.
  // A `loading` image is left in: that is a render-time state, and dropping
  // it would make the section flicker out while assets arrive.
  galleryImageIds: state.gallery.images
    .filter(image => image.source !== 'missing' && image.source !== 'data_url')
    .map(image => image.id),
  profile: state.profile,
});

export const deriveSitePlanToggles = (
  state: OnboardingLabState,
): SitePlanOptionalToggles => ({
  aboutEnabled: state.recipe.aboutEnabled,
  canvaEnabled: state.recipe.canvaEnabled,
  galleryEnabled: state.recipe.galleryEnabled,
  policiesEnabled: state.recipe.policiesEnabled,
});

/**
 * The Builder document becomes authoritative once an owner explicitly adds or
 * restores an optional core section. Preserve the onboarding choices as the
 * initial defaults, then let a real active document section opt its matching
 * customer responsibility back in. This keeps Add Section truthful without
 * mutating or duplicating the shared onboarding state.
 */
export const deriveBuilderSitePlanToggles = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
): SitePlanOptionalToggles => {
  const onboardingToggles = deriveSitePlanToggles(state);
  const activeSectionTypes = new Set(
    document?.pages.flatMap(page => page.sections.map(section => section.sectionType)) ?? [],
  );

  return {
    aboutEnabled: onboardingToggles.aboutEnabled
      || activeSectionTypes.has('about')
      || activeSectionTypes.has('team'),
    canvaEnabled: onboardingToggles.canvaEnabled
      || activeSectionTypes.has('custom_design'),
    galleryEnabled: onboardingToggles.galleryEnabled
      || activeSectionTypes.has('gallery'),
    policiesEnabled: onboardingToggles.policiesEnabled
      || activeSectionTypes.has('policies'),
  };
};
