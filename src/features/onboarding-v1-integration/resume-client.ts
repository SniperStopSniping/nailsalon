import {
  exportSiteBuilderDocument,
  SITE_BUILDER_STORAGE_KEY,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createAnonymousDraftId } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import type { OnboardingLabState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import {
  ONBOARDING_STORAGE_KEY,
  type OnboardingStorage,
  saveOnboardingState,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import { resolveOnboardingCustomDesignSettings } from './custom-design-media';
import {
  authorizeVerifiedOnboardingSetupResume,
  canResumeVerifiedOnboardingSetup,
  ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY,
  ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY,
  ONBOARDING_INTEGRATION_RESUME_SESSION_KEY,
  saveOnboardingIntegrationRecoveryRecord,
} from './flow-storage';
import { fingerprintOnboardingPayload } from './payload-fingerprint';
import type { InitialOnboardingResumeDraft } from './resume-draft';
import { createPersistableOnboardingDraft } from './snapshot';

type ResumeHydrationResult =
  | { success: true }
  | { message: string; success: false };

const restoreStorageValue = (
  storage: OnboardingStorage,
  key: string,
  value: string | null,
): void => {
  if (value === null) {
    storage.removeItem(key);
  } else {
    storage.setItem(key, value);
  }
};

/**
 * Atomically installs one server-authorized persisted revision before any Lab
 * hook reads browser storage. A fresh anonymous ID creates an append-only
 * replacement claim; the recovery record remains non-authoritative CAS proof.
 */
export const hydrateInitialOnboardingResumeDraft = (
  draft: InitialOnboardingResumeDraft,
  input: {
    createDraftId?: () => string;
    sessionStorage?: OnboardingStorage;
    storage?: OnboardingStorage;
  } = {},
): ResumeHydrationResult => {
  const storage = input.storage ?? window.localStorage;
  const sessionStorage = input.sessionStorage ?? window.sessionStorage;
  const prior = {
    document: storage.getItem(SITE_BUILDER_STORAGE_KEY),
    flow: storage.getItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY),
    onboarding: storage.getItem(ONBOARDING_STORAGE_KEY),
    recovery: storage.getItem(ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY),
    resume: sessionStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY),
  };
  const hydratedState: OnboardingLabState = {
    ...structuredClone(draft.state),
    anonymousDraftId: (input.createDraftId ?? createAnonymousDraftId)(),
    progress: {
      ...structuredClone(draft.state.progress),
      currentScreen: 'final_preview',
      lastActiveScreen: 'final_preview',
      screenHistory: ['final_preview'],
      sessionStatus: 'active',
      visitedScreens: [...new Set([
        ...draft.state.progress.visitedScreens,
        'final_preview' as const,
      ])],
    },
  };

  try {
    const persisted = createPersistableOnboardingDraft(
      hydratedState,
      hydratedState.recipe.palettePreset,
      resolveOnboardingCustomDesignSettings(
        draft.document,
        hydratedState.canva.customDesignSectionId,
      ),
      draft.document,
      new Map(draft.media.flatMap(item => item.role === 'custom_design'
        ? [[item.localItemId, item.assetId] as const]
        : [])),
    );
    if (fingerprintOnboardingPayload(persisted.snapshot) !== draft.payloadFingerprint) {
      return {
        message: 'This saved website changed before setup could open. Return to the latest Preview and try again.',
        success: false,
      };
    }

    storage.removeItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY);
    const saved = saveOnboardingState(hydratedState, { storage });
    if (!saved.success) {
      throw new Error(saved.message);
    }
    storage.setItem(SITE_BUILDER_STORAGE_KEY, exportSiteBuilderDocument(draft.document));
    if (!saveOnboardingIntegrationRecoveryRecord({
      payloadFingerprint: draft.payloadFingerprint,
      siteId: draft.siteId,
      verifiedRevision: draft.verifiedRevision,
    }, storage)) {
      throw new Error('Browser recovery storage is unavailable.');
    }
    if (!authorizeVerifiedOnboardingSetupResume({
      sessionStorage,
      siteId: draft.siteId,
      storage,
      verifiedRevision: draft.verifiedRevision,
    }) || !canResumeVerifiedOnboardingSetup({
      sessionStorage,
      siteId: draft.siteId,
      storage,
      verifiedRevision: draft.verifiedRevision,
    })) {
      throw new Error('The saved website could not be verified in this browser.');
    }
    return { success: true };
  } catch (error) {
    try {
      restoreStorageValue(storage, SITE_BUILDER_STORAGE_KEY, prior.document);
      restoreStorageValue(storage, ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, prior.flow);
      restoreStorageValue(storage, ONBOARDING_STORAGE_KEY, prior.onboarding);
      restoreStorageValue(storage, ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY, prior.recovery);
      restoreStorageValue(sessionStorage, ONBOARDING_INTEGRATION_RESUME_SESSION_KEY, prior.resume);
    } catch {
      // The server-backed site remains authoritative even when local rollback is unavailable.
    }
    return {
      message: error instanceof Error && error.message
        ? error.message
        : 'This browser could not prepare the saved website for editing.',
      success: false,
    };
  }
};
