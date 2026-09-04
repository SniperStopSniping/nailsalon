// @vitest-environment jsdom

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import type { OnboardingClaimSuccess } from './contracts';
import {
  authorizeVerifiedOnboardingSetupResume,
  canResumeVerifiedOnboardingSetup,
  clearOnboardingIntegrationBrowserState,
  clearOnboardingIntegrationFlow,
  createOnboardingIntegrationFlow,
  loadOnboardingIntegrationFlow,
  loadOnboardingIntegrationRecoveryRecord,
  ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY,
  ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY,
  ONBOARDING_INTEGRATION_RESUME_SESSION_KEY,
  phaseAfterOnboardingReauthentication,
  saveOnboardingIntegrationFlow,
  saveOnboardingIntegrationRecoveryRecord,
  shouldRecoverInterruptedOnboardingSave,
  shouldReturnInterruptedSaveToAccountGate,
} from './flow-storage';
import { fingerprintOnboardingPayload } from './payload-fingerprint';
import { createPersistableOnboardingDraft } from './snapshot';

const savedSite: OnboardingClaimSuccess = {
  claimId: 'claim-id',
  created: true,
  dashboardUrl: '/en/admin',
  media: { failed: 0, pending: 0, ready: 0 },
  ownerCreatedServiceIds: [],
  payloadFingerprint: '0123456789abcdef',
  revision: 4,
  revisionId: 'revision-id',
  salonId: 'salon-id',
  salonSlug: 'isla-nail-studio',
  serviceMenuApplied: true,
  serviceMappingIssues: [],
  siteId: '11111111-1111-4111-8111-111111111111',
};

describe('onboarding account-flow persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('preserves an interrupted save for reload recovery with the same idempotency key', () => {
    const flow = {
      ...createOnboardingIntegrationFlow(),
      phase: 'saving' as const,
      savedSite,
    };
    saveOnboardingIntegrationFlow(flow);

    expect(loadOnboardingIntegrationFlow()).toMatchObject({
      claimIdempotencyKey: flow.claimIdempotencyKey,
      phase: 'saving',
      savedSite,
    });
    expect(shouldRecoverInterruptedOnboardingSave({
      claimInFlight: false,
      isLoaded: true,
      isSignedIn: true,
      phase: 'saving',
      recoveryInFlight: false,
    })).toBe(true);
    expect(shouldRecoverInterruptedOnboardingSave({
      claimInFlight: false,
      isLoaded: true,
      isSignedIn: false,
      phase: 'saving',
      recoveryInFlight: false,
    })).toBe(false);
  });

  it('returns account-backed phases to sign-in when the Clerk session is absent', () => {
    for (const phase of [
      'conflict',
      'failure',
      'media_failure',
      'plans',
      'saved',
      'saving',
    ] as const) {
      expect(shouldReturnInterruptedSaveToAccountGate({
        isLoaded: true,
        isSignedIn: false,
        phase,
      })).toBe(true);
    }

    expect(shouldReturnInterruptedSaveToAccountGate({
      isLoaded: true,
      isSignedIn: false,
      phase: 'onboarding',
    })).toBe(false);
    expect(shouldReturnInterruptedSaveToAccountGate({
      isLoaded: false,
      isSignedIn: false,
      phase: 'saving',
    })).toBe(false);
  });

  it('restores new recovery metadata without treating legacy storage as verified ownership', () => {
    const flow = { ...createOnboardingIntegrationFlow(), savedSite };
    const { savedSiteOwnerId: _ownerId, errorCode: _errorCode, ...legacy } = flow;
    window.localStorage.setItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, JSON.stringify(legacy));

    expect(loadOnboardingIntegrationFlow()).toMatchObject({ savedSite, savedSiteOwnerId: null, errorCode: null });

    saveOnboardingIntegrationFlow({ ...flow, savedSiteOwnerId: 'current-owner', errorCode: 'SITE_SLUG_UNAVAILABLE' });

    expect(loadOnboardingIntegrationFlow()).toMatchObject({
      savedSite,
      savedSiteOwnerId: 'current-owner',
      errorCode: 'SITE_SLUG_UNAVAILABLE',
    });
  });

  it('resumes the pre-auth phase without replaying a completed save celebration', () => {
    expect(phaseAfterOnboardingReauthentication({
      celebrationSeen: true,
      reauthResumePhase: 'saved',
      savedSite,
    })).toBe('plans');
    expect(phaseAfterOnboardingReauthentication({
      celebrationSeen: true,
      reauthResumePhase: 'saved',
      savedSite,
    }, { earlySave: true })).toBe('saved');
    expect(phaseAfterOnboardingReauthentication({
      celebrationSeen: false,
      reauthResumePhase: 'saving',
      savedSite: null,
    })).toBe('saving');
    expect(phaseAfterOnboardingReauthentication({
      celebrationSeen: false,
      reauthResumePhase: null,
      savedSite,
    })).toBeNull();
  });

  it('keeps only non-sensitive same-device recovery proof after transient flow cleanup', () => {
    saveOnboardingIntegrationFlow(createOnboardingIntegrationFlow());

    expect(saveOnboardingIntegrationRecoveryRecord({
      payloadFingerprint: savedSite.payloadFingerprint,
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision,
    })).toBe(true);

    clearOnboardingIntegrationFlow();

    expect(window.localStorage.getItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY)).toBeNull();
    expect(loadOnboardingIntegrationRecoveryRecord()).toEqual({
      siteId: savedSite.siteId,
      payloadFingerprint: savedSite.payloadFingerprint,
      verifiedRevision: 4,
      version: 2,
    });
    expect(window.localStorage.getItem(ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY))
      .not.toContain('draft');
  });

  it('clears every integration-owned Start over key and preserves unrelated storage', () => {
    window.localStorage.setItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, 'flow');
    window.localStorage.setItem(ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY, 'recovery');
    window.localStorage.setItem('unrelated-sentinel', 'keep-me');
    window.sessionStorage.setItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY, 'resume');
    window.sessionStorage.setItem('unrelated-session', 'keep-me-too');

    expect(clearOnboardingIntegrationBrowserState()).toBe(true);

    expect(window.localStorage.getItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY)).toBeNull();
    expect(window.localStorage.getItem('unrelated-sentinel')).toBe('keep-me');
    expect(window.sessionStorage.getItem('unrelated-session')).toBe('keep-me-too');
  });

  it('rejects malformed recovery records', () => {
    window.localStorage.setItem(
      ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY,
      JSON.stringify({ siteId: 'site', verifiedRevision: 0, version: 1 }),
    );

    expect(loadOnboardingIntegrationRecoveryRecord()).toBeNull();
  });

  it('allows setup fallback only with matching proof and a valid local state/document pair', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Isla Nail Studio';
    state.profile.businessStructure = 'solo';
    state.profile.ownerName = 'Daniela';
    state.recipe.starter = 'one_page';

    expect(saveOnboardingState(state).success).toBe(true);

    const document = initializeStarter('one_page', {
      siteId: 'local-site',
      siteName: 'Isla Nail Studio',
    });
    window.localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(document));
    const payloadFingerprint = fingerprintOnboardingPayload(
      createPersistableOnboardingDraft(state, 'luster_berry', null, document).snapshot,
    );
    saveOnboardingIntegrationRecoveryRecord({
      payloadFingerprint,
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision,
    });

    expect(canResumeVerifiedOnboardingSetup({
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision,
    })).toBe(true);
    expect(canResumeVerifiedOnboardingSetup({
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision + 1,
    })).toBe(false);

    expect(authorizeVerifiedOnboardingSetupResume({
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision,
    })).toBe(true);

    state.profile.businessName = 'Edited after opening setup';

    expect(saveOnboardingState(state).success).toBe(true);
    expect(canResumeVerifiedOnboardingSetup({
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision,
    })).toBe(true);

    window.sessionStorage.clear();

    expect(canResumeVerifiedOnboardingSetup({
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision,
    })).toBe(false);

    window.localStorage.setItem(SITE_BUILDER_STORAGE_KEY, '{broken');

    expect(canResumeVerifiedOnboardingSetup({
      siteId: savedSite.siteId,
      verifiedRevision: savedSite.revision,
    })).toBe(false);
  });
});
