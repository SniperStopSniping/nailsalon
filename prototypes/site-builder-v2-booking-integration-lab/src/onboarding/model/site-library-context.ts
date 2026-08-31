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
import type { QuickInfoFactId } from '../../model/section-library/settings';
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
import { hasMeaningfulPublishablePolicies } from './policies';
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

  return {
    availableQuickFacts,
    businessStructure: profile.businessStructure,
    canonicalServiceIds: [...selectedServiceIds],
    depositMode: profile.policies.deposits.mode,
    featuredServiceIds,
    galleryImageIds: [...galleryImageIds],
    // Mirrors the accepted ContactSection renderer's own show/hide predicate
    // (booking-only contact does not count as publishable contact content).
    hasContactSectionContent: Boolean(
      publicLocation.primary.trim()
      || getCustomerProfileFacts(profile).some(fact => fact.id === 'service_location')
      || contactActions.some(action => action.method !== 'booking')
      || getPublicWeeklyHours(profile.hours).length > 0,
    ),
    hasPublicContact: contactActions.some(action => action.method !== 'booking'),
    hasPublicLocation: Boolean(publicLocation.primary.trim()),
    hoursConfigured,
    hoursShownOnSite: profile.hours.showOnSite,
    policiesMeaningful: hasMeaningfulPublishablePolicies(profile.policies),
    siteContent: document?.siteContent ?? createEmptySiteContent(),
  };
};

export const deriveSiteLibraryContext = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
): SiteLibraryContext => deriveSiteLibraryContextFromProfile({
  document,
  galleryImageIds: state.gallery.images.map(image => image.id),
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
