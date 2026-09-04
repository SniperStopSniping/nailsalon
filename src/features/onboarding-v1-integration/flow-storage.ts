import {
  parseSiteBuilderDocument,
  SITE_BUILDER_STORAGE_KEY,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createSecureBrowserToken } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import {
  loadOnboardingState,
  type OnboardingStorage,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import type {
  OnboardingClaimSuccess,
  OnboardingPlanIntent,
} from './contracts';
import { resolveOnboardingCustomDesignSettings } from './custom-design-media';
import { fingerprintOnboardingPayload } from './payload-fingerprint';
import { createPersistableOnboardingDraft } from './snapshot';

export const ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY
  = 'luster:onboarding:v1:account-integration';

export const ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY
  = 'luster:onboarding:v1:account-recovery';
export const ONBOARDING_INTEGRATION_RESUME_SESSION_KEY
  = 'luster:onboarding:v1:setup-resume-session';

export type OnboardingIntegrationRecoveryRecord = {
  payloadFingerprint: string;
  siteId: string;
  verifiedRevision: number;
  version: 2;
};

export type OnboardingIntegrationPhase =
  | 'account'
  | 'conflict'
  | 'failure'
  | 'media_failure'
  | 'onboarding'
  | 'plans'
  | 'saved'
  | 'saving';

export type StoredMediaFailure = {
  assetId: string;
  fileName: string;
  message: string;
  role: 'custom_design' | 'gallery' | 'logo' | 'profile';
};

export type OnboardingIntegrationFlow = {
  authMode: 'sign-in' | 'sign-up';
  celebrationSeen: boolean;
  claimIdempotencyKey: string;
  errorMessage: string | null;
  errorCode: string | null;
  mediaComplete: boolean;
  mediaFailures: StoredMediaFailure[];
  phase: OnboardingIntegrationPhase;
  planIdempotencyKey: string;
  reauthResumePhase: Exclude<OnboardingIntegrationPhase, 'account' | 'onboarding'> | null;
  savedSite: OnboardingClaimSuccess | null;
  savedSiteOwnerId: string | null;
  selectedPlan: OnboardingPlanIntent;
  version: 1;
};

const createOpaqueIntegrationKey = (prefix: 'claim' | 'plan'): string => {
  return createSecureBrowserToken(prefix);
};

export const createOnboardingIntegrationFlow = (): OnboardingIntegrationFlow => ({
  authMode: 'sign-up',
  celebrationSeen: false,
  claimIdempotencyKey: createOpaqueIntegrationKey('claim'),
  errorMessage: null,
  errorCode: null,
  mediaComplete: true,
  mediaFailures: [],
  phase: 'onboarding',
  planIdempotencyKey: createOpaqueIntegrationKey('plan'),
  reauthResumePhase: null,
  savedSite: null,
  savedSiteOwnerId: null,
  selectedPlan: 'free',
  version: 1,
});

const isPhase = (value: unknown): value is OnboardingIntegrationPhase => [
  'account',
  'conflict',
  'failure',
  'media_failure',
  'onboarding',
  'plans',
  'saved',
  'saving',
].includes(String(value));

const isPlan = (value: unknown): value is OnboardingPlanIntent => [
  'free',
  'founding_interest',
  'monthly_interest',
].includes(String(value));

const isSavedSite = (value: unknown): value is OnboardingClaimSuccess => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<OnboardingClaimSuccess>;
  return typeof candidate.siteId === 'string'
    && typeof candidate.payloadFingerprint === 'string'
    && typeof candidate.revision === 'number'
    && typeof candidate.salonId === 'string'
    && typeof candidate.salonSlug === 'string'
    && typeof candidate.dashboardUrl === 'string';
};

export const loadOnboardingIntegrationFlow = (): OnboardingIntegrationFlow => {
  const fallback = createOnboardingIntegrationFlow();
  try {
    const value = window.localStorage.getItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY);
    if (!value) {
      return fallback;
    }
    const parsed = JSON.parse(value) as Partial<OnboardingIntegrationFlow>;
    if (parsed.version !== 1 || !isPhase(parsed.phase) || !isPlan(parsed.selectedPlan)) {
      return fallback;
    }
    return {
      ...fallback,
      ...parsed,
      authMode: parsed.authMode === 'sign-in' ? 'sign-in' : 'sign-up',
      claimIdempotencyKey: typeof parsed.claimIdempotencyKey === 'string'
        ? parsed.claimIdempotencyKey
        : fallback.claimIdempotencyKey,
      errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : null,
      errorCode: typeof parsed.errorCode === 'string' ? parsed.errorCode : null,
      celebrationSeen: parsed.celebrationSeen === true,
      mediaComplete: parsed.mediaComplete !== false,
      mediaFailures: Array.isArray(parsed.mediaFailures)
        ? parsed.mediaFailures.filter((item): item is StoredMediaFailure => (
          Boolean(item)
          && typeof item.assetId === 'string'
          && typeof item.fileName === 'string'
          && typeof item.message === 'string'
          && ['custom_design', 'gallery', 'logo', 'profile'].includes(item.role)
        ))
        : [],
      phase: parsed.phase,
      planIdempotencyKey: typeof parsed.planIdempotencyKey === 'string'
        ? parsed.planIdempotencyKey
        : fallback.planIdempotencyKey,
      reauthResumePhase: parsed.reauthResumePhase
        && isPhase(parsed.reauthResumePhase)
        && !['account', 'onboarding'].includes(parsed.reauthResumePhase)
        ? parsed.reauthResumePhase as OnboardingIntegrationFlow['reauthResumePhase']
        : null,
      savedSite: isSavedSite(parsed.savedSite) ? parsed.savedSite : null,
      savedSiteOwnerId: typeof parsed.savedSiteOwnerId === 'string' ? parsed.savedSiteOwnerId : null,
      selectedPlan: parsed.selectedPlan,
    };
  } catch {
    return fallback;
  }
};

export const saveOnboardingIntegrationFlow = (
  flow: OnboardingIntegrationFlow,
): boolean => {
  try {
    window.localStorage.setItem(
      ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY,
      JSON.stringify(flow),
    );
    return true;
  } catch {
    return false;
  }
};

export const clearOnboardingIntegrationFlow = (): void => {
  try {
    window.localStorage.removeItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY);
  } catch {
    // A successful server save remains authoritative when browser storage is unavailable.
  }
};

/** Clears only browser state owned by the account-integration handoff. */
export const clearOnboardingIntegrationBrowserState = (input: {
  sessionStorage?: OnboardingStorage;
  storage?: OnboardingStorage;
} = {}): boolean => {
  try {
    const storage = input.storage ?? window.localStorage;
    const sessionStorage = input.sessionStorage ?? window.sessionStorage;
    storage.removeItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY);
    storage.removeItem(ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY);
    sessionStorage.removeItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
};

const isRecoveryRecord = (
  value: unknown,
): value is OnboardingIntegrationRecoveryRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<OnboardingIntegrationRecoveryRecord>;
  return candidate.version === 2
    && typeof candidate.payloadFingerprint === 'string'
    && /^[a-f0-9]{16}$/u.test(candidate.payloadFingerprint)
    && typeof candidate.siteId === 'string'
    && candidate.siteId.length > 0
    && typeof candidate.verifiedRevision === 'number'
    && Number.isInteger(candidate.verifiedRevision)
    && candidate.verifiedRevision > 0;
};

/**
 * Same-browser proof that the accepted local onboarding draft corresponds to
 * one verified account-backed site revision. It deliberately carries no
 * owner, salon, media, or anonymous-draft identity.
 */
export const loadOnboardingIntegrationRecoveryRecord = (
  storage?: OnboardingStorage,
): OnboardingIntegrationRecoveryRecord | null => {
  try {
    const value = (storage ?? window.localStorage).getItem(
      ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY,
    );
    if (!value) {
      return null;
    }
    const parsed: unknown = JSON.parse(value);
    return isRecoveryRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const saveOnboardingIntegrationRecoveryRecord = (
  record: Omit<OnboardingIntegrationRecoveryRecord, 'version'>,
  storage?: OnboardingStorage,
): boolean => {
  try {
    (storage ?? window.localStorage).setItem(
      ONBOARDING_INTEGRATION_RECOVERY_STORAGE_KEY,
      JSON.stringify({ ...record, version: 2 }),
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * The account-backed setup fallback is offered only when this browser holds
 * both the matching server verification proof and a parseable accepted local
 * state/document pair. A site id in a URL is never enough on its own.
 */
export const canResumeVerifiedOnboardingSetup = (input: {
  sessionStorage?: OnboardingStorage;
  siteId: string;
  storage?: OnboardingStorage;
  verifiedRevision: number;
}): boolean => {
  const storage = input.storage ?? window.localStorage;
  const recovery = loadOnboardingIntegrationRecoveryRecord(storage);
  const loaded = loadOnboardingState(storage);
  if (
    recovery?.siteId !== input.siteId
    || recovery.verifiedRevision !== input.verifiedRevision
    || loaded.status !== 'loaded'
  ) {
    return false;
  }
  try {
    const rawDocument = storage.getItem(SITE_BUILDER_STORAGE_KEY);
    if (!rawDocument) {
      return false;
    }
    const parsedDocument = parseSiteBuilderDocument(rawDocument);
    if (!parsedDocument.success) {
      return false;
    }
    const resumeStorage = input.sessionStorage ?? window.sessionStorage;
    const resumeSession = resumeStorage.getItem(ONBOARDING_INTEGRATION_RESUME_SESSION_KEY);
    if (resumeSession) {
      const parsed = JSON.parse(resumeSession) as Partial<OnboardingIntegrationRecoveryRecord>;
      if (
        parsed.siteId === input.siteId
        && parsed.verifiedRevision === input.verifiedRevision
        && parsed.payloadFingerprint === recovery.payloadFingerprint
      ) {
        return true;
      }
    }
    const customDesign = resolveOnboardingCustomDesignSettings(
      parsedDocument.document,
      loaded.state.canva.customDesignSectionId,
    );
    const { snapshot } = createPersistableOnboardingDraft(
      loaded.state,
      loaded.state.recipe.palettePreset,
      customDesign,
      parsedDocument.document,
    );
    return fingerprintOnboardingPayload(snapshot) === recovery.payloadFingerprint;
  } catch {
    return false;
  }
};

export const authorizeVerifiedOnboardingSetupResume = (input: {
  sessionStorage?: OnboardingStorage;
  siteId: string;
  storage?: OnboardingStorage;
  verifiedRevision: number;
}): boolean => {
  const recovery = loadOnboardingIntegrationRecoveryRecord(input.storage);
  if (
    recovery?.siteId !== input.siteId
    || recovery.verifiedRevision !== input.verifiedRevision
  ) {
    return false;
  }
  try {
    (input.sessionStorage ?? window.sessionStorage).setItem(
      ONBOARDING_INTEGRATION_RESUME_SESSION_KEY,
      JSON.stringify(recovery),
    );
    return true;
  } catch {
    return false;
  }
};

export const renewClaimIdempotencyKey = (): string =>
  createOpaqueIntegrationKey('claim');

export const renewPlanIdempotencyKey = (): string =>
  createOpaqueIntegrationKey('plan');

export const shouldRecoverInterruptedOnboardingSave = (input: {
  claimInFlight: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  phase: OnboardingIntegrationPhase;
  recoveryInFlight: boolean;
}): boolean => input.isLoaded
  && input.isSignedIn
  && input.phase === 'saving'
  && !input.claimInFlight
  && !input.recoveryInFlight;

const ACCOUNT_BACKED_PHASES = new Set<OnboardingIntegrationPhase>([
  'conflict',
  'failure',
  'media_failure',
  'plans',
  'saved',
  'saving',
]);

/**
 * A Clerk session can expire while a persisted save flow is in progress. The
 * local draft and idempotency keys remain intact; the owner must re-establish
 * identity before any account-backed work resumes.
 */
export const shouldReturnInterruptedSaveToAccountGate = (input: {
  isLoaded: boolean;
  isSignedIn: boolean;
  phase: OnboardingIntegrationPhase;
}): boolean => input.isLoaded
  && !input.isSignedIn
  && ACCOUNT_BACKED_PHASES.has(input.phase);

export const phaseAfterOnboardingReauthentication = (
  flow: Pick<OnboardingIntegrationFlow, 'celebrationSeen' | 'reauthResumePhase' | 'savedSite'>,
  options: { earlySave?: boolean } = {},
): OnboardingIntegrationPhase | null => {
  if (!flow.reauthResumePhase) {
    return null;
  }
  if (flow.reauthResumePhase === 'saved' && flow.celebrationSeen && !options.earlySave) {
    return 'plans';
  }
  if (
    ['media_failure', 'plans', 'saved'].includes(flow.reauthResumePhase)
    && !flow.savedSite
  ) {
    return 'saving';
  }
  return flow.reauthResumePhase;
};
