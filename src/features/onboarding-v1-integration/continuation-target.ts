import type {
  OnboardingClaimSuccess,
  OnboardingDraftClaimRequest,
} from './contracts';

type IntegrationTarget = OnboardingDraftClaimRequest['target'];

/**
 * After the early account gate, later onboarding answers append a revision to
 * the exact draft the owner already saved. This prevents a second business or
 * site while retaining the server's revision/ownership conflict protection.
 */
export const continuationTargetForSavedSite = (
  savedSite: OnboardingClaimSuccess | null,
): IntegrationTarget => savedSite
  ? {
      continuationClaimId: savedSite.claimId,
      existingSiteStrategy: 'continue_onboarding_draft',
      expectedRevision: savedSite.revision,
      expectedSiteId: savedSite.siteId,
      mode: 'existing_business',
      salonId: savedSite.salonId,
    }
  : undefined;
