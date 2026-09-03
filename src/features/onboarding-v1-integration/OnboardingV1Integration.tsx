'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CloudUpload,
  Sparkles,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  CustomDesignAssetProvider,
  useCustomDesignAssetRepository,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider';
import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import { recordOnboardingEvent } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/events/journal';
import { FeedbackProvider } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/feedback/FeedbackProvider';
import { useFeedback } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/feedback/useFeedback';
import { createAnonymousDraftId } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { goBack, goToScreen } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/routing';
import type {
  OnboardingEventInput,
  OnboardingLabState,
  PlanIntent,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import {
  getOnboardingReferencedAssetIds,
  OnboardingApp,
  type OnboardingSavePayload,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/OnboardingApp';
import { createLabPlanConfiguration } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/overlays/PlanOfferSheet';
import {
  loadOnboardingState,
  saveOnboardingState,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import { useLabDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/ui/useLabDocument';
import { PremiumAccountGate } from './account-gate/AccountGate';
import {
  getOnboardingIntegrationRoute,
  hasAccountGateQuery,
  pushAccountGateHistory,
} from './account-history';
import {
  FALLBACK_AUTH_PROVIDER_AVAILABILITY,
  type OnboardingAuthProviderAvailability,
} from './auth-providers';
import {
  claimOnboardingDraft,
  getOnboardingDraftClaimStatus,
  OnboardingIntegrationRequestError,
  saveOnboardingPlanIntent,
} from './client';
import { continuationTargetForSavedSite } from './continuation-target';
import type {
  OnboardingClaimConflict,
  OnboardingClaimSuccess,
  OnboardingDraftClaimRequest,
  OnboardingPlanIntent,
} from './contracts';
import {
  type ExistingCustomDesignMediaByLogicalId,
  resolveOnboardingCustomDesignSettings,
} from './custom-design-media';
import {
  canResumeVerifiedOnboardingSetup,
  clearOnboardingIntegrationBrowserState,
  clearOnboardingIntegrationFlow,
  loadOnboardingIntegrationFlow,
  type OnboardingIntegrationFlow,
  phaseAfterOnboardingReauthentication,
  renewClaimIdempotencyKey,
  renewPlanIdempotencyKey,
  saveOnboardingIntegrationFlow,
  saveOnboardingIntegrationRecoveryRecord,
  shouldRecoverInterruptedOnboardingSave,
  shouldReturnInterruptedSaveToAccountGate,
} from './flow-storage';
import {
  claimOnboardingMedia,
  cleanupVerifiedUnreferencedOnboardingMedia,
  collectPendingOnboardingMediaReferences,
} from './media-claim-client';
import { ResumedOnboardingAssetRepository } from './resume-assets';
import { hydrateInitialOnboardingResumeDraft } from './resume-client';
import type { InitialOnboardingResumeDraft } from './resume-draft';
import { createPersistableOnboardingDraft } from './snapshot';
import { getSavedOnboardingSitePreviewUrl } from './urls';

type IntegrationTarget = OnboardingDraftClaimRequest['target'];

type SavingStep = 'core' | 'finalizing' | 'media';

const PLAN_INTENT_BY_LAB_INTENT: Record<PlanIntent, OnboardingPlanIntent> = {
  founding: 'founding_interest',
  free: 'free',
  monthly: 'monthly_interest',
};

const LAB_INTENT_BY_PLAN_INTENT: Record<OnboardingPlanIntent, PlanIntent> = {
  founding_interest: 'founding',
  free: 'free',
  monthly_interest: 'monthly',
};

const PLAN_ACTIONS: Record<OnboardingPlanIntent, string> = {
  founding_interest: 'Reserve founding offer',
  free: 'Continue free',
  monthly_interest: 'I’m interested in monthly',
};

const getPayloadFromBrowser = (
  document: SiteBuilderDocument | null,
): OnboardingSavePayload | null => {
  const loaded = loadOnboardingState();
  return document ? { document, state: loaded.state } : null;
};

const countSavedMedia = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null = null,
  existingCustomMediaByLogicalId: ExistingCustomDesignMediaByLogicalId = new Map(),
): number => {
  try {
    return collectPendingOnboardingMediaReferences(
      state,
      document,
      existingCustomMediaByLogicalId,
    ).length;
  } catch {
    return 0;
  }
};

const recordIntegrationEvent = (
  event: OnboardingEventInput,
  once = false,
): void => {
  const loaded = loadOnboardingState();
  if (once && loaded.state.eventJournal.some(candidate => candidate.type === event.type)) {
    return;
  }
  saveOnboardingState(recordOnboardingEvent(loaded.state, event));
};

const usePersistentFlow = () => {
  const [flow, setFlowState] = useState<OnboardingIntegrationFlow>(() => {
    const loaded = loadOnboardingIntegrationFlow();
    return loaded.phase === 'saved' && loaded.celebrationSeen
      ? { ...loaded, phase: 'plans' }
      : loaded;
  });
  const setFlow = useCallback((updater: (
    current: OnboardingIntegrationFlow,
  ) => OnboardingIntegrationFlow) => {
    setFlowState((current) => {
      const next = updater(current);
      saveOnboardingIntegrationFlow(next);
      return next;
    });
  }, []);
  return [flow, setFlow] as const;
};

export function OnboardingV1Integration({
  authProviders = FALLBACK_AUTH_PROVIDER_AVAILABILITY,
  initialResumeDraft,
  locale,
}: {
  authProviders?: OnboardingAuthProviderAvailability;
  initialResumeDraft?: InitialOnboardingResumeDraft;
  locale: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  useEffect(() => {
    const result = initialResumeDraft
      ? hydrateInitialOnboardingResumeDraft(initialResumeDraft)
      : { success: true as const };
    setResumeError(result.success ? null : result.message);
    setMounted(true);
  }, [initialResumeDraft]);
  if (mounted && resumeError) {
    return (
      <main className="onboarding-integration-loading" role="alert">
        <h1>We couldn’t open website setup</h1>
        <p>{resumeError}</p>
        <p>Your account-backed website is still safe.</p>
        <a href={`/${locale}/admin`}>Return to Luster Workspace</a>
      </main>
    );
  }
  return mounted
    ? (
        <OnboardingV1Runtime
          authProviders={authProviders}
          initialResumeDraft={initialResumeDraft}
          locale={locale}
        />
      )
    : (
        <main className="onboarding-integration-loading" aria-busy="true">
          <span className="onboarding-integration-spinner" aria-hidden="true" />
          <p>Preparing your website setup…</p>
        </main>
      );
}

function OnboardingV1Runtime({
  authProviders,
  initialResumeDraft,
  locale,
}: {
  authProviders: OnboardingAuthProviderAvailability;
  initialResumeDraft?: InitialOnboardingResumeDraft;
  locale: string;
}) {
  const lab = useLabDocument();
  const resumeRepository = useMemo(() => initialResumeDraft
    ? new ResumedOnboardingAssetRepository(initialResumeDraft.media)
    : undefined, [initialResumeDraft]);
  const existingCustomMediaByLogicalId = useMemo(() => new Map(
    initialResumeDraft?.media.flatMap(item => item.role === 'custom_design'
      ? [[item.localItemId, item.assetId] as const]
      : []) ?? [],
  ), [initialResumeDraft]);
  const getLabReachableAssetIds = lab.getReachableAssetIds;
  const getReachableAssetIds = useCallback(() => {
    const reachable = new Set(getLabReachableAssetIds());
    getOnboardingReferencedAssetIds(loadOnboardingState().state)
      .forEach(assetId => reachable.add(assetId));
    return reachable;
  }, [getLabReachableAssetIds]);

  return (
    <CustomDesignAssetProvider
      getReachableAssetIds={getReachableAssetIds}
      repository={resumeRepository}
    >
      <FeedbackProvider testMode={false}>
        <OnboardingIntegrationController
          authProviders={authProviders}
          existingCustomMediaByLogicalId={existingCustomMediaByLogicalId}
          lab={lab}
          locale={locale}
        />
      </FeedbackProvider>
    </CustomDesignAssetProvider>
  );
}

function OnboardingIntegrationController({
  authProviders,
  existingCustomMediaByLogicalId,
  lab,
  locale,
}: {
  authProviders: OnboardingAuthProviderAvailability;
  existingCustomMediaByLogicalId: ExistingCustomDesignMediaByLogicalId;
  lab: ReturnType<typeof useLabDocument>;
  locale: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  // A signed-in session only unlocks account-backed work once its primary
  // email is verified — the same contract the server enforces at claim time.
  const emailVerified = user?.primaryEmailAddress?.verification?.status === 'verified';
  const authSettled = isLoaded && (!isSignedIn || userLoaded);
  const accountReady = isSignedIn === true && emailVerified;
  const repository = useCustomDesignAssetRepository();
  const [flow, setFlow] = usePersistentFlow();
  const [payload, setPayload] = useState<OnboardingSavePayload | null>(null);
  const [conflict, setConflict] = useState<OnboardingClaimConflict | null>(null);
  const [savingStep, setSavingStep] = useState<SavingStep>('core');
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>(() => {
    const queryMode = new URLSearchParams(window.location.search).get('auth');
    return queryMode === 'sign-in' ? 'sign-in' : flow.authMode;
  });
  const [planPending, setPlanPending] = useState(false);
  const [planConfirmation, setPlanConfirmation] = useState<string | null>(null);
  const payloadRef = useRef(payload);
  const claimInFlightRef = useRef(false);
  const mediaInFlightRef = useRef(false);
  const planInFlightRef = useRef(false);
  const resumeInFlightRef = useRef(false);
  const latestFlowRef = useRef(flow);
  latestFlowRef.current = flow;
  payloadRef.current = payload;
  const resumeQuery = new URLSearchParams(window.location.search);
  const resumeSiteId = resumeQuery.get('site') ?? '';
  const resumeRevision = Number(resumeQuery.get('revision'));
  const forceReview = flow.phase === 'onboarding'
    && resumeQuery.get('resume') === 'review'
    && Number.isInteger(resumeRevision)
    && canResumeVerifiedOnboardingSetup({
      siteId: resumeSiteId,
      verifiedRevision: resumeRevision,
    });

  const resolvePayload = useCallback((): OnboardingSavePayload | null =>
    payloadRef.current ?? getPayloadFromBrowser(lab.document), [lab.document]);

  const finishCoreClaim = useCallback(async (
    savedSite: OnboardingClaimSuccess,
    currentPayload: OnboardingSavePayload,
    idempotencyKey: string,
  ) => {
    setSavingStep(countSavedMedia(
      currentPayload.state,
      currentPayload.document,
      existingCustomMediaByLogicalId,
    ) > 0
      ? 'media'
      : 'finalizing');
    const mediaResult = await claimOnboardingMedia({
      document: currentPayload.document,
      draftId: currentPayload.state.anonymousDraftId,
      existingCustomMediaByLogicalId,
      idempotencyKey,
      repository,
      siteId: savedSite.siteId,
      siteRevision: savedSite.revision,
      state: currentPayload.state,
    });
    if (mediaResult.failures.length > 0) {
      recordIntegrationEvent({ type: 'media_claim_failed' });
      setFlow(current => ({
        ...current,
        celebrationSeen: false,
        errorMessage: null,
        mediaComplete: false,
        mediaFailures: mediaResult.failures.map(failure => ({
          assetId: failure.assetId,
          fileName: failure.fileName,
          message: failure.message,
          role: failure.role,
        })),
        phase: 'media_failure',
        savedSite: { ...savedSite, revision: mediaResult.verifiedRevision },
      }));
      return;
    }
    const cleanup = await cleanupVerifiedUnreferencedOnboardingMedia(
      repository,
      currentPayload.state,
      currentPayload.document,
    );
    if (cleanup.removedAssetIds.length > 0) {
      const removed = new Set(cleanup.removedAssetIds);
      const cleanedState = {
        ...currentPayload.state,
        canva: {
          ...currentPayload.state.canva,
          ownedAssetIds: currentPayload.state.canva.ownedAssetIds
            .filter(assetId => !removed.has(assetId)),
        },
      };
      const saved = saveOnboardingState(cleanedState);
      const cleanedPayload = {
        document: currentPayload.document,
        state: saved.success ? saved.state : cleanedState,
      };
      payloadRef.current = cleanedPayload;
      setPayload(cleanedPayload);
    }
    setSavingStep('finalizing');
    setFlow(current => ({
      ...current,
      celebrationSeen: false,
      errorMessage: null,
      mediaComplete: true,
      mediaFailures: [],
      phase: 'saved',
      savedSite: { ...savedSite, revision: mediaResult.verifiedRevision },
    }));
  }, [existingCustomMediaByLogicalId, repository, setFlow]);

  const claim = useCallback(async (
    target?: IntegrationTarget,
    explicitIdempotencyKey?: string,
  ) => {
    if (claimInFlightRef.current) {
      return;
    }
    const currentPayload = resolvePayload();
    if (!currentPayload) {
      setFlow(current => ({
        ...current,
        errorMessage: 'Your website preview is still being prepared. Return to Review and try again.',
        phase: 'failure',
      }));
      return;
    }
    claimInFlightRef.current = true;
    const idempotencyKey = explicitIdempotencyKey
      ?? latestFlowRef.current.claimIdempotencyKey;
    setSavingStep('core');
    setFlow(current => ({
      ...current,
      claimIdempotencyKey: idempotencyKey,
      errorMessage: null,
      phase: 'saving',
    }));
    let coreSavedSite: OnboardingClaimSuccess | null = null;
    try {
      recordIntegrationEvent({ type: 'draft_claim_started' });
      const customDesignSettings = resolveOnboardingCustomDesignSettings(
        currentPayload.document,
        currentPayload.state.canva.customDesignSectionId,
      );
      const persisted = createPersistableOnboardingDraft(
        currentPayload.state,
        currentPayload.state.recipe.palettePreset,
        customDesignSettings,
        currentPayload.document,
        existingCustomMediaByLogicalId,
      );
      const resolvedTarget = target
        ?? continuationTargetForSavedSite(latestFlowRef.current.savedSite);
      const result = await claimOnboardingDraft({
        anonymousDraftToken: currentPayload.state.anonymousDraftId,
        idempotencyKey,
        media: persisted.media,
        snapshot: persisted.snapshot,
        ...(resolvedTarget ? { target: resolvedTarget } : {}),
      });
      if (result.status === 'conflict') {
        setConflict(result.conflict);
        setFlow(current => ({ ...current, phase: 'conflict' }));
        return;
      }
      recordIntegrationEvent({ type: 'draft_claim_completed' });
      recordIntegrationEvent({ type: 'site_saved' }, true);
      coreSavedSite = result.value;
      await finishCoreClaim(result.value, currentPayload, idempotencyKey);
    } catch (error) {
      recordIntegrationEvent({ type: 'draft_claim_failed' });
      if (
        error instanceof OnboardingIntegrationRequestError
        && error.code === 'EMAIL_NOT_VERIFIED'
        && !coreSavedSite
      ) {
        // The server refused an unverified identity. Refresh the client's
        // view of the email and return to the account gate's verification
        // step instead of a dead-end failure screen.
        void user?.reload().catch(() => undefined);
        setFlow(current => ({
          ...current,
          errorMessage: 'Verify your email to finish saving your site.',
          phase: 'account',
        }));
        return;
      }
      setFlow(current => ({
        ...current,
        errorMessage: error instanceof Error && error.message.trim()
          ? error.message
          : 'We couldn’t finish saving your site. Your work is still safe on this device.',
        mediaComplete: coreSavedSite ? false : current.mediaComplete,
        phase: coreSavedSite ? 'media_failure' : 'failure',
        savedSite: coreSavedSite ?? current.savedSite,
      }));
    } finally {
      claimInFlightRef.current = false;
    }
  }, [existingCustomMediaByLogicalId, finishCoreClaim, resolvePayload, setFlow, user]);

  useEffect(() => {
    if (!authSettled || !accountReady || flow.phase !== 'account') {
      return;
    }
    const resumePhase = phaseAfterOnboardingReauthentication(flow);
    if (resumePhase) {
      setFlow(current => ({
        ...current,
        errorMessage: null,
        phase: resumePhase,
        reauthResumePhase: null,
      }));
      return;
    }
    recordIntegrationEvent({
      type: authMode === 'sign-in' ? 'sign_in_completed' : 'sign_up_completed',
    }, true);
    void claim();
  }, [accountReady, authMode, authSettled, claim, flow, setFlow]);

  useEffect(() => {
    if (!shouldReturnInterruptedSaveToAccountGate({
      isLoaded: authSettled,
      isSignedIn: accountReady,
      phase: flow.phase,
    })) {
      return;
    }
    setAuthMode('sign-in');
    setFlow(current => ({
      ...current,
      authMode: 'sign-in',
      errorMessage: isSignedIn
        ? 'Verify your email to finish saving your site. Your work is still safe on this device.'
        : 'Sign in again to finish saving your site. Your work is still safe on this device.',
      phase: 'account',
      reauthResumePhase: current.phase === 'account' || current.phase === 'onboarding'
        ? null
        : current.phase,
    }));
    pushAccountGateHistory(locale);
  }, [accountReady, authSettled, flow.phase, isSignedIn, locale, setFlow]);

  useEffect(() => {
    if (
      !authSettled
      || !accountReady
      || flow.phase !== 'conflict'
      || conflict
      || claimInFlightRef.current
    ) {
      return;
    }
    void claim(undefined, flow.claimIdempotencyKey);
  }, [accountReady, authSettled, claim, conflict, flow.claimIdempotencyKey, flow.phase]);

  useEffect(() => {
    if (authMode === flow.authMode) {
      return;
    }
    setFlow(current => ({ ...current, authMode }));
  }, [authMode, flow.authMode, setFlow]);

  useEffect(() => {
    if (!shouldRecoverInterruptedOnboardingSave({
      claimInFlight: claimInFlightRef.current,
      isLoaded: authSettled,
      isSignedIn: accountReady,
      phase: flow.phase,
      recoveryInFlight: resumeInFlightRef.current,
    })) {
      return undefined;
    }
    const currentPayload = resolvePayload();
    if (!currentPayload) {
      setFlow(current => ({
        ...current,
        errorMessage: 'Return to Review so Luster can prepare your website again.',
        phase: 'failure',
      }));
      return undefined;
    }
    const controller = new AbortController();
    resumeInFlightRef.current = true;
    void (async () => {
      try {
        const status = await getOnboardingDraftClaimStatus(
          currentPayload.state.anonymousDraftId,
          { signal: controller.signal },
        );
        if (status.claim) {
          recordIntegrationEvent({ type: 'draft_claim_completed' }, true);
          recordIntegrationEvent({ type: 'site_saved' }, true);
          await finishCoreClaim(
            status.claim,
            currentPayload,
            flow.claimIdempotencyKey,
          );
          return;
        }
        await claim(undefined, flow.claimIdempotencyKey);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setFlow(current => ({
          ...current,
          errorMessage: error instanceof Error && error.message.trim()
            ? error.message
            : 'We couldn’t confirm the saved website yet. Your work is still safe on this device.',
          phase: 'failure',
        }));
      } finally {
        resumeInFlightRef.current = false;
      }
    })();
    return () => controller.abort();
  }, [
    accountReady,
    authSettled,
    claim,
    finishCoreClaim,
    flow.claimIdempotencyKey,
    flow.phase,
    resolvePayload,
    setFlow,
  ]);

  useEffect(() => {
    if (flow.phase !== 'account') {
      return;
    }
    recordIntegrationEvent({ type: 'account_gate_viewed' }, true);
    if (authMode === 'sign-up') {
      recordIntegrationEvent({ type: 'sign_up_started' }, true);
    }
  }, [authMode, flow.phase]);

  useEffect(() => {
    if (flow.phase !== 'saved' || flow.celebrationSeen) {
      return;
    }
    setFlow(current => ({ ...current, celebrationSeen: true }));
  }, [flow.celebrationSeen, flow.phase, setFlow]);

  useEffect(() => {
    if (flow.phase !== 'account') {
      return undefined;
    }
    const handlePopState = () => {
      if (hasAccountGateQuery(window.location.search)) {
        return;
      }
      setFlow(current => ({ ...current, errorMessage: null, phase: 'onboarding' }));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [flow.phase, setFlow]);

  const startSave = useCallback((nextPayload: OnboardingSavePayload) => {
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    if (nextPayload.state.progress.currentScreen === 'final_preview') {
      recordIntegrationEvent({ type: 'final_review_completed' }, true);
    }
    recordIntegrationEvent({ type: 'save_site_started' });
    if (authSettled && accountReady) {
      void claim(undefined, latestFlowRef.current.claimIdempotencyKey);
      return;
    }
    recordIntegrationEvent({ type: 'account_gate_viewed' }, true);
    if (!isSignedIn) {
      recordIntegrationEvent({ type: 'sign_up_started' }, true);
    }
    setFlow(current => ({
      ...current,
      authMode: 'sign-up',
      errorMessage: null,
      phase: 'account',
    }));
    pushAccountGateHistory(locale);
  }, [accountReady, authSettled, claim, isSignedIn, locale, setFlow]);

  const returnToReview = useCallback(() => {
    setConflict(null);
    const loaded = loadOnboardingState();
    if (loaded.state.progress.currentScreen === 'save_progress') {
      saveOnboardingState(goBack(loaded.state));
    }
    setFlow(current => ({ ...current, errorMessage: null, phase: 'onboarding' }));
    window.history.replaceState({}, '', getOnboardingIntegrationRoute(locale));
  }, [locale, setFlow]);

  const continueAfterEarlySave = useCallback(() => {
    const loaded = loadOnboardingState();
    const nextState = {
      ...goToScreen(loaded.state, 'booking_preferences'),
      // The first token is permanently bound to the exact early-save
      // fingerprint. A fresh opaque token creates the next revision of the
      // same server-owned draft after Services, About, layouts and Policies.
      anonymousDraftId: createAnonymousDraftId(),
    };
    const saved = saveOnboardingState(nextState);
    if (saved.success && payloadRef.current) {
      const nextPayload = { ...payloadRef.current, state: saved.state };
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
    }
    setFlow(current => ({
      ...current,
      celebrationSeen: true,
      claimIdempotencyKey: renewClaimIdempotencyKey(),
      phase: 'onboarding',
    }));
    window.history.replaceState({}, '', getOnboardingIntegrationRoute(locale));
  }, [locale, setFlow]);

  const retryCoreSave = useCallback(() => {
    const nextKey = renewClaimIdempotencyKey();
    void claim(undefined, nextKey);
  }, [claim]);

  const retryMedia = useCallback(async () => {
    if (mediaInFlightRef.current || !flow.savedSite) {
      return;
    }
    const currentPayload = resolvePayload();
    if (!currentPayload) {
      return;
    }
    mediaInFlightRef.current = true;
    setSavingStep('media');
    setFlow(current => ({ ...current, phase: 'saving' }));
    try {
      await finishCoreClaim(
        flow.savedSite,
        currentPayload,
        flow.claimIdempotencyKey,
      );
    } catch (error) {
      recordIntegrationEvent({ type: 'media_claim_failed' });
      setFlow(current => ({
        ...current,
        errorMessage: error instanceof Error
          ? error.message
          : 'Those photos still could not be saved. Your local copies are safe.',
        phase: 'media_failure',
      }));
    } finally {
      mediaInFlightRef.current = false;
    }
  }, [finishCoreClaim, flow.claimIdempotencyKey, flow.savedSite, resolvePayload, setFlow]);

  const chooseConflictTarget = useCallback((target: IntegrationTarget) => {
    const nextKey = renewClaimIdempotencyKey();
    void claim(target, nextKey);
  }, [claim]);

  const choosePlan = useCallback(async (intent: OnboardingPlanIntent) => {
    if (planInFlightRef.current || !flow.savedSite) {
      return;
    }
    planInFlightRef.current = true;
    setPlanPending(true);
    setPlanConfirmation(null);
    setFlow(current => ({ ...current, selectedPlan: intent }));
    try {
      const result = await saveOnboardingPlanIntent({
        idempotencyKey: flow.planIdempotencyKey,
        intent,
        siteId: flow.savedSite.siteId,
      });
      recordIntegrationEvent({
        intent: LAB_INTENT_BY_PLAN_INTENT[result.intent],
        type: 'plan_selected',
      });
      recordIntegrationEvent({ type: 'dashboard_entered' }, true);
      const localDraft = loadOnboardingState();
      if (localDraft.status === 'loaded') {
        const rotatedDraft = saveOnboardingState({
          ...localDraft.state,
          anonymousDraftId: createAnonymousDraftId(),
        });
        if (rotatedDraft.success) {
          saveOnboardingIntegrationRecoveryRecord({
            payloadFingerprint: flow.savedSite.payloadFingerprint,
            siteId: result.siteId,
            verifiedRevision: flow.savedSite.revision,
          });
        }
      }
      clearOnboardingIntegrationFlow();
      const dashboardUrl = new URL(`/${locale}/admin`, window.location.origin);
      dashboardUrl.searchParams.set('onboarding', 'complete');
      dashboardUrl.searchParams.set('salon', flow.savedSite.salonSlug);
      dashboardUrl.searchParams.set('site', result.siteId);
      dashboardUrl.searchParams.set('planIntent', result.intent);
      window.location.assign(`${dashboardUrl.pathname}${dashboardUrl.search}`);
    } catch (error) {
      setPlanConfirmation(error instanceof Error
        ? error.message
        : 'Your plan choice could not be saved. Nothing was charged.');
      setPlanPending(false);
      planInFlightRef.current = false;
    }
  }, [flow.planIdempotencyKey, flow.savedSite, locale, setFlow]);

  const currentPayload = resolvePayload();

  switch (flow.phase) {
    case 'account':
      return currentPayload
        ? (
            <PremiumAccountGate
              authMode={authMode}
              document={currentPayload.document}
              errorMessage={flow.errorMessage}
              locale={locale}
              needsSessionEmailVerification={isSignedIn === true && userLoaded && !emailVerified}
              onCancel={returnToReview}
              providers={authProviders}
              state={currentPayload.state}
            />
          )
        : <IntegrationFailure message="Return to Review so Luster can prepare your site." onReturn={returnToReview} onRetry={returnToReview} />;
    case 'conflict':
      return conflict
        ? (
            <ConflictScreen
              conflict={conflict}
              onCancel={returnToReview}
              onChoose={chooseConflictTarget}
            />
          )
        : <SavingScreen mediaCount={0} salonName="your website" step="core" />;
    case 'failure':
      return (
        <IntegrationFailure
          message={flow.errorMessage ?? 'We couldn’t finish saving your site. Your work is still safe on this device.'}
          onReturn={returnToReview}
          onRetry={retryCoreSave}
        />
      );
    case 'media_failure':
      return flow.savedSite
        ? (
            <MediaFailureScreen
              failures={flow.mediaFailures}
              onContinue={() => setFlow(current => ({
                ...current,
                celebrationSeen: false,
                mediaComplete: false,
                phase: 'saved',
              }))}
              onRetry={() => {
                void retryMedia();
              }}
            />
          )
        : <IntegrationFailure message="Your photos could not be verified yet." onReturn={returnToReview} onRetry={retryCoreSave} />;
    case 'plans':
      return flow.savedSite
        ? (
            <PlanSelection
              confirmation={planConfirmation}
              onChoose={choosePlan}
              onSelect={intent => setFlow(current => intent === current.selectedPlan
                ? current
                : {
                    ...current,
                    planIdempotencyKey: renewPlanIdempotencyKey(),
                    selectedPlan: intent,
                  })}
              pending={planPending}
              selectedIntent={flow.selectedPlan}
            />
          )
        : <IntegrationFailure message="Save your site before choosing how to start." onReturn={returnToReview} onRetry={returnToReview} />;
    case 'saved':
      return flow.savedSite && currentPayload
        ? (
            <SavedCelebration
              earlySave={currentPayload.state.progress.currentScreen === 'save_progress'}
              locale={locale}
              mediaComplete={flow.mediaComplete}
              onContinue={currentPayload.state.progress.currentScreen === 'save_progress'
                ? continueAfterEarlySave
                : () => setFlow(current => ({ ...current, phase: 'plans' }))}
              savedSite={flow.savedSite}
              state={currentPayload.state}
            />
          )
        : <IntegrationFailure message="Your saved website could not be loaded." onReturn={returnToReview} onRetry={returnToReview} />;
    case 'saving':
      return (
        <SavingScreen
          mediaCount={currentPayload
            ? countSavedMedia(
              currentPayload.state,
              currentPayload.document,
              existingCustomMediaByLogicalId,
            )
            : 0}
          salonName={currentPayload?.state.profile.businessName.trim() || 'your website'}
          step={savingStep}
        />
      );
    case 'onboarding':
    default:
      return (
        <OnboardingApp
          forceReview={forceReview}
          integration={{
            hasSavedSite: flow.savedSite !== null,
            onSaveSite: startSave,
            onStartOver: () => {
              clearOnboardingIntegrationBrowserState();
            },
          }}
          lab={lab}
        />
      );
  }
}

function OwnerSurface({ children, modifier = '' }: {
  children: ReactNode;
  modifier?: string;
}) {
  return (
    <main className={`onboarding-integration-owner${modifier ? ` ${modifier}` : ''}`}>
      <div className="onboarding-integration-owner__brand" aria-label="Luster">
        <Sparkles aria-hidden="true" size={20} />
        <span>Luster</span>
      </div>
      {children}
    </main>
  );
}

function SavingScreen({ mediaCount, salonName, step }: {
  mediaCount: number;
  salonName: string;
  step: SavingStep;
}) {
  const message = step === 'core'
    ? 'Saving your site…'
    : step === 'media' && mediaCount > 0
      ? `Uploading ${mediaCount} ${mediaCount === 1 ? 'photo' : 'photos'}…`
      : `Finalizing ${salonName}…`;
  return (
    <OwnerSurface modifier="is-centred">
      <section className="onboarding-integration-state-card" aria-busy="true" aria-live="polite">
        <span className="onboarding-integration-spinner is-large" aria-hidden="true" />
        <p className="onboarding-integration-eyebrow">Saving to your account</p>
        <h1>{message}</h1>
        <p>Your work remains safe on this device until Luster confirms every step.</p>
        <div className="onboarding-saving-steps" aria-hidden="true">
          <span className={step === 'core' ? 'is-current' : 'is-complete'}>Website</span>
          <span className={step === 'media' ? 'is-current' : step === 'finalizing' ? 'is-complete' : ''}>Photos</span>
          <span className={step === 'finalizing' ? 'is-current' : ''}>Final details</span>
        </div>
      </section>
    </OwnerSurface>
  );
}

function IntegrationFailure({
  message,
  onReturn,
  onRetry,
}: {
  message: string;
  onReturn: () => void;
  onRetry: () => void;
}) {
  return (
    <OwnerSurface modifier="is-centred">
      <section className="onboarding-integration-state-card" role="alert">
        <span className="onboarding-integration-state-icon is-attention" aria-hidden="true">
          <CircleAlert size={28} />
        </span>
        <p className="onboarding-integration-eyebrow">Your work is safe</p>
        <h1>We couldn’t finish saving your site</h1>
        <p>{message}</p>
        <div className="onboarding-integration-action-stack">
          <button className="onboarding-integration-primary" type="button" onClick={onRetry}>
            Try again
          </button>
          <button className="onboarding-integration-secondary" type="button" onClick={onReturn}>
            Return to Review
          </button>
        </div>
      </section>
    </OwnerSurface>
  );
}

function MediaFailureScreen({
  failures,
  onContinue,
  onRetry,
}: {
  failures: OnboardingIntegrationFlow['mediaFailures'];
  onContinue: () => void;
  onRetry: () => void;
}) {
  return (
    <OwnerSurface modifier="is-centred">
      <section className="onboarding-integration-state-card">
        <span className="onboarding-integration-state-icon is-attention" aria-hidden="true">
          <CloudUpload size={28} />
        </span>
        <p className="onboarding-integration-eyebrow">Website saved</p>
        <h1>Some photos still need attention</h1>
        <p>Your website details are saved. These local photos have not been confirmed for other devices yet.</p>
        <ul className="onboarding-media-failures" aria-label="Photos that still need attention">
          {failures.map(failure => (
            <li key={`${failure.role}:${failure.assetId}`}>
              <strong>{failure.fileName}</strong>
              <span>{failure.message}</span>
            </li>
          ))}
        </ul>
        <div className="onboarding-integration-action-stack">
          <button className="onboarding-integration-primary" type="button" onClick={onRetry}>
            Retry photos
          </button>
          <button className="onboarding-integration-secondary" type="button" onClick={onContinue}>
            Continue with my site saved
          </button>
        </div>
      </section>
    </OwnerSurface>
  );
}

function ConflictScreen({
  conflict,
  onCancel,
  onChoose,
}: {
  conflict: OnboardingClaimConflict;
  onCancel: () => void;
  onChoose: (target: IntegrationTarget) => void;
}) {
  if (conflict.code === 'BUSINESS_TARGET_REQUIRED') {
    return (
      <OwnerSurface modifier="is-centred">
        <section className="onboarding-integration-state-card is-wide">
          <p className="onboarding-integration-eyebrow">Choose a workspace</p>
          <h1>Where should we save this site?</h1>
          <p>Choose an existing nail business, or create a new one. Nothing will be overwritten.</p>
          <div className="onboarding-conflict-options" role="group" aria-label="Business for this website">
            {conflict.businesses.map(business => (
              <button
                key={business.id}
                type="button"
                onClick={() => onChoose({ mode: 'existing_business', salonId: business.id })}
              >
                <strong>{business.name}</strong>
                <span>{business.hasSite ? 'Website already exists · review next' : 'Save to this business'}</span>
              </button>
            ))}
            <button type="button" onClick={() => onChoose({ mode: 'create_business' })}>
              <strong>Create a new business</strong>
              <span>Keep this website separate</span>
            </button>
          </div>
          <button className="onboarding-integration-text-action" type="button" onClick={onCancel}>
            Cancel and return to Review
          </button>
        </section>
      </OwnerSurface>
    );
  }
  return (
    <OwnerSurface modifier="is-centred">
      <section className="onboarding-integration-state-card is-wide">
        <p className="onboarding-integration-eyebrow">Protecting your website</p>
        <h1>This business already has a website</h1>
        <p>Choose how to keep both versions. A published website is never replaced here.</p>
        <div className="onboarding-conflict-options" role="group" aria-label="Website save choice">
          <button
            type="button"
            onClick={() => onChoose({
              existingSiteStrategy: 'new_draft',
              mode: 'existing_business',
              salonId: conflict.business.id,
            })}
          >
            <strong>Save as a new draft</strong>
            <span>Keep the existing website unchanged</span>
          </button>
          {conflict.canReplaceDraft && conflict.existingSite.status === 'draft'
            ? (
                <button
                  type="button"
                  onClick={() => onChoose({
                    existingSiteStrategy: 'replace_draft',
                    expectedRevision: conflict.existingSite.revision,
                    expectedSiteId: conflict.existingSite.id,
                    mode: 'existing_business',
                    salonId: conflict.business.id,
                  })}
                >
                  <strong>Replace the existing draft</strong>
                  <span>The current unpublished draft will be replaced</span>
                </button>
              )
            : null}
        </div>
        <button className="onboarding-integration-text-action" type="button" onClick={onCancel}>
          Cancel and return to Review
        </button>
      </section>
    </OwnerSurface>
  );
}

function SavedCelebration({
  earlySave,
  locale,
  mediaComplete,
  onContinue,
  savedSite,
  state,
}: {
  earlySave: boolean;
  locale: string;
  mediaComplete: boolean;
  onContinue: () => void;
  savedSite: OnboardingClaimSuccess;
  state: OnboardingLabState;
}) {
  const feedback = useFeedback();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const salonName = state.profile.businessName.trim() || 'Your nail studio';
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    feedback.send({
      kind: 'milestone',
      message: earlySave ? 'Your progress is saved.' : 'Your Luster site is saved.',
      onceKey: `account-site-saved:${savedSite.siteId}:${savedSite.revision}`,
      replaceVisual: true,
    });
  }, [earlySave, feedback, savedSite.revision, savedSite.siteId]);
  return (
    <OwnerSurface modifier="is-saved">
      <section className="onboarding-saved-card" aria-labelledby="onboarding-saved-title">
        <div className="onboarding-saved-copy">
          <div className="onboarding-save-check" aria-hidden="true">
            <CheckCircle2 size={42} />
            <i />
            <i />
            <i />
          </div>
          <p className="onboarding-integration-eyebrow">Saved to your account</p>
          <h1 id="onboarding-saved-title" ref={headingRef} tabIndex={-1}>{earlySave ? 'Your progress is saved' : 'Your Luster site is saved'}</h1>
          <p>
            {earlySave
              ? 'Your site is now saved to your Luster account.'
              : `${salonName} is now connected to your account. Your website, booking settings and services will be waiting whenever you return.`}
          </p>
          {!mediaComplete
            ? (
                <p className="onboarding-saved-media-note">
                  Your website details are saved. The photos listed earlier remain only on this device until you retry them.
                </p>
              )
            : null}
          <div className="onboarding-integration-action-stack">
            <button className="onboarding-integration-primary" type="button" onClick={onContinue}>
              {earlySave ? 'Continue setting up' : 'Choose how to start'}
            </button>
            <a
              className="onboarding-integration-secondary"
              href={getSavedOnboardingSitePreviewUrl({ locale, siteId: savedSite.siteId })}
            >
              Preview my saved site
            </a>
          </div>
        </div>
        <div className="onboarding-saved-preview" aria-label={`Saved preview of ${salonName}`}>
          {/* eslint-disable-next-line react-dom/no-missing-iframe-sandbox -- This trusted same-origin read-only route needs cookies and client hydration; adding both same-origin and scripts would create a misleading sandbox boundary. */}
          <iframe
            aria-hidden="true"
            loading="eager"
            // This is a trusted, same-origin, read-only customer route. The
            // owner shell keeps it pointer-inert and outside the tab order;
            // deliberately avoid a same-origin + scripts sandbox combination,
            // which does not provide a meaningful security boundary.
            src={getSavedOnboardingSitePreviewUrl({
              embedded: true,
              locale,
              siteId: savedSite.siteId,
            })}
            tabIndex={-1}
            title={`Saved preview of ${salonName}`}
          />
          <span>
            <Check aria-hidden="true" size={14} />
            {' '}
            Saved to Luster
          </span>
        </div>
      </section>
    </OwnerSurface>
  );
}

function PlanSelection({
  confirmation,
  onChoose,
  onSelect,
  pending,
  selectedIntent,
}: {
  confirmation: string | null;
  onChoose: (intent: OnboardingPlanIntent) => void;
  onSelect: (intent: OnboardingPlanIntent) => void;
  pending: boolean;
  selectedIntent: OnboardingPlanIntent;
}) {
  const feedback = useFeedback();
  const radioName = useId();
  const configuration = useMemo(() => createLabPlanConfiguration('free_beta'), []);
  const selectedLabIntent = LAB_INTENT_BY_PLAN_INTENT[selectedIntent];
  return (
    <OwnerSurface modifier="is-plans">
      <section className="onboarding-account-plans">
        <header>
          <p className="onboarding-integration-eyebrow">Your site is safely saved</p>
          <h1>Choose how you want to start</h1>
          <p className="onboarding-integration-lede">
            Start free today, or tell us which upcoming Luster plan interests you. You can change this later.
          </p>
        </header>
        <fieldset className="onboarding-account-plan-grid" disabled={pending}>
          <legend className="visually-hidden">Choose how you want to start</legend>
          {configuration.options.map((option) => {
            const integrationIntent = PLAN_INTENT_BY_LAB_INTENT[option.planIntent];
            const selected = option.planIntent === selectedLabIntent;
            return (
              <label className={selected ? 'is-selected' : ''} key={option.id}>
                <input
                  checked={selected}
                  name={radioName}
                  type="radio"
                  value={integrationIntent}
                  onChange={() => {
                    onSelect(integrationIntent);
                    feedback.send({
                      kind: 'selection',
                      message: `${option.title} selected.`,
                      replaceVisual: true,
                    });
                  }}
                />
                <span className="onboarding-account-plan-radio" aria-hidden="true">
                  {selected ? <Check size={15} /> : null}
                </span>
                <span className="onboarding-account-plan-heading">
                  <strong>{option.title}</strong>
                  {option.badge ? <small>{option.badge}</small> : null}
                </span>
                <b>{option.priceLabel}</b>
                <p>{option.description}</p>
                <ul>
                  {option.features.map(feature => (
                    <li key={feature}>
                      <Check aria-hidden="true" size={15} />
                      {' '}
                      {feature}
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </fieldset>
        {configuration.showPlanComparison
          ? (
              <details className="onboarding-account-plan-comparison">
                <summary>
                  Compare options
                  <ChevronDown aria-hidden="true" size={18} />
                </summary>
                <div>
                  <section>
                    <h2>Included now</h2>
                    <ul>
                      {configuration.comparisonRows
                        .filter(row => row.group === 'included_now')
                        .map(row => (
                          <li key={row.feature}>
                            <Check aria-hidden="true" size={14} />
                            {' '}
                            {row.feature}
                          </li>
                        ))}
                    </ul>
                  </section>
                  <section>
                    <h2>Planned for paid options</h2>
                    <ul>
                      {configuration.comparisonRows
                        .filter(row => row.group === 'planned_paid')
                        .map(row => (
                          <li key={row.feature}>
                            <Check aria-hidden="true" size={14} />
                            {' '}
                            {row.feature}
                          </li>
                        ))}
                    </ul>
                  </section>
                </div>
              </details>
            )
          : null}
        <p className="onboarding-plan-truth-note">
          Final paid-plan pricing and features are still being confirmed. No payment is collected here.
        </p>
        {confirmation ? <p className="onboarding-plan-confirmation" role="status">{confirmation}</p> : null}
      </section>
      <footer className="onboarding-account-plan-footer">
        <button
          className="onboarding-integration-primary"
          disabled={pending}
          type="button"
          onClick={() => onChoose(selectedIntent)}
        >
          {pending ? 'Saving your choice…' : PLAN_ACTIONS[selectedIntent]}
        </button>
        <p>Nothing is charged today.</p>
      </footer>
    </OwnerSurface>
  );
}
