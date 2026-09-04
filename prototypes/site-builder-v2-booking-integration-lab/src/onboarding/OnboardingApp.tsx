import { Download, FlaskConical } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  useCustomDesignAssetCoordinator,
  useCustomDesignAssetMap,
  useCustomDesignAssetRepository,
} from '../custom-design/integration/CustomDesignAssetProvider';
import { formatCustomDesignUploadSummary } from '../custom-design/integration/upload-summary';
import type { SiteBuilderDocument } from '../model/types';
import { reconcileV1StarterDocument } from '../model/v1-starter-recipes';
import { Dialog } from '../ui/Dialog';
import { ConfirmationDialog } from '../ui/EditorDialogs';
import type { LabDocumentController } from '../ui/useLabDocument';
import { OnboardingShell } from './components/OnboardingShell';
import { CORE_SCREEN_ORDER } from './copy';
import { recordOnboardingEvent } from './events/journal';
import {
  type CanvaIntegrationResult,
  useCanvaIntegration,
} from './extras/useCanvaIntegration';
import { useFeedback } from './feedback/useFeedback';
import {
  applyLabReviewFixture,
  LAB_REVIEW_FIXTURES,
  type LabReviewFixtureId,
} from './fixtures';
import {
  onboardingMediaPort,
  resolveOnboardingImageUrl,
} from './integrations/adapters/media';
import { ONBOARDING_MEDIA_STORAGE_UNAVAILABLE_MESSAGE } from './integrations/contracts/media';
import {
  getNextScreen,
  getScreenStage,
  goForward,
  reconcileConditionalHistory,
} from './model/routing';
import { applyOnboardingSitePresentation } from './model/site-document-presentation';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from './model/site-library-context';
import type {
  BusinessProfileDraft,
  CanvaDisplayMode,
  CanvaPlacement,
  OnboardingLabState,
  OnboardingScreenId,
  PlanIntent,
  StarterId,
} from './model/types';
import { CanvaDialog, GalleryDialog } from './overlays/ExtrasDialogs';
import { createLabPlanConfiguration, PlanOfferSheet } from './overlays/PlanOfferSheet';
import { SetupPreviewOverlay } from './overlays/SetupPreviewOverlay';
import { OnboardingSitePreview } from './preview/OnboardingSitePreview';
import {
  getCompletedEssentialStages,
  getEssentialsLeft,
} from './progress/essentials';
import { BrandBasicsScreen } from './screens/BasicsScreens';
import { BookingLayoutScreen } from './screens/BookingLayoutScreen';
import {
  BookingPreferencesScreen,
  StartingPointScreen,
  StartingPreviewScreen,
} from './screens/BookingScreens';
import {
  AboutDesignScreen,
  AboutScreen,
  ExtrasScreen,
  type OnboardingStateUpdater,
  PoliciesScreen,
  QuickBookLayoutScreen,
  SiteStyleScreen,
} from './screens/DesignScreens';
import { HoursScreen } from './screens/HoursScreen';
import { LocationContactScreen } from './screens/LocationContactScreen';
import {
  BUILDER_HANDOFF_TRIGGER_ID,
  FinalReviewScreen,
} from './screens/ReviewScreen';
import { SaveProgressScreen } from './screens/SaveProgressScreen';
import { switchOnboardingStarter } from './state/switchStarter';
import { useOnboardingState } from './state/useOnboardingState';

type PreviewSource =
  | 'starting_preview'
  | 'about'
  | 'about_design'
  | 'booking_layout'
  | 'site_style'
  | 'final_preview';

type OnboardingBrowserOverlay =
  | { kind: 'preview'; source: PreviewSource }
  | { kind: 'plan' };

type OnboardingBrowserHistoryState = {
  lusterOnboarding: true;
  onboardingCursor: number;
  onboardingSession: number;
  overlay?: OnboardingBrowserOverlay;
  screen: OnboardingScreenId;
};

const isOnboardingBrowserHistoryState = (
  value: unknown,
): value is OnboardingBrowserHistoryState => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<OnboardingBrowserHistoryState>;
  const validOverlay = candidate.overlay === undefined
    || candidate.overlay?.kind === 'plan'
    || (candidate.overlay?.kind === 'preview'
      && ['starting_preview', 'about', 'about_design', 'booking_layout', 'site_style', 'final_preview']
        .includes(candidate.overlay.source));
  return candidate.lusterOnboarding === true
    && typeof candidate.onboardingCursor === 'number'
    && typeof candidate.onboardingSession === 'number'
    && CORE_SCREEN_ORDER.includes(candidate.screen as OnboardingScreenId)
    && validOverlay;
};

type OnboardingAppProps = {
  auditMode?: boolean;
  forceReview?: boolean;
  lab: LabDocumentController;
  integration?: {
    hasSavedSite?: boolean;
    onSaveSite: (payload: OnboardingSavePayload) => void;
    onStartOver?: () => void;
  };
  onEnterBuilder?: () => void;
  onEnterDashboard?: () => void;
};

export type OnboardingSavePayload = {
  document: SiteBuilderDocument;
  state: OnboardingLabState;
};

function AccountGateBridge({ onOpen }: { onOpen: () => void }) {
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) {
      return;
    }
    openedRef.current = true;
    onOpen();
  }, [onOpen]);
  return (
    <main className="onboarding-account-bridge" aria-busy="true" aria-live="polite">
      <span aria-hidden="true" />
      <h1>Preparing your secure account options…</h1>
      <p>Your site choices are safe on this device.</p>
    </main>
  );
}

const STARTER_LABELS: Record<StarterId, string> = {
  multi_page: 'Multi-page website',
  one_page: 'One-page website',
  quick_book: 'Quick Book',
};

const continueFrom = (state: OnboardingLabState): OnboardingLabState => {
  const screen = state.progress.currentScreen;
  const nextScreen = getNextScreen(screen, state);
  let next = goForward(state);
  next = recordOnboardingEvent(next, { nextScreen, screen, type: 'continue' });
  return nextScreen
    ? recordOnboardingEvent(next, { screen: nextScreen, type: 'screen_viewed' })
    : next;
};

export const getOnboardingAssetIds = (
  state: OnboardingLabState,
): string[] => [...new Set([
  ...[state.profile.profilePhoto, state.profile.logo]
    .flatMap(image => image?.storageId ? [image.storageId] : []),
  ...state.gallery.images.flatMap(image => image.storageId ? [image.storageId] : []),
  ...state.canva.ownedAssetIds,
  ...state.canva.images.flatMap(image => image.storageId ? [image.storageId] : []),
])];

export const isOnboardingResetBlocked = (
  documentTransactionPending: boolean,
  profileMediaOperationCount: number,
): boolean => documentTransactionPending || profileMediaOperationCount > 0;

/** Current display references only; excludes the retained cleanup-retry list. */
export const getOnboardingReferencedAssetIds = (
  state: OnboardingLabState,
): string[] => [...new Set([
  ...[state.profile.profilePhoto, state.profile.logo]
    .flatMap(image => image?.storageId ? [image.storageId] : []),
  ...state.gallery.images.flatMap(image => image.storageId ? [image.storageId] : []),
  ...state.canva.images.flatMap(image => image.storageId ? [image.storageId] : []),
])];

export const applyCanvaIntegrationResult = (
  current: OnboardingLabState,
  result: CanvaIntegrationResult,
  displayMode: CanvaDisplayMode,
  placement: CanvaPlacement,
): OnboardingLabState => {
  const acceptedImages = result.addedImages.map(image => ({
    fileName: image.fileName,
    id: image.id,
    mimeType: image.mimeType,
    source: 'indexed_db' as const,
    storageId: image.assetId,
  }));
  const imagesByStorageId = new Map(
    [...current.canva.images, ...acceptedImages].map(image => [
      image.storageId ?? image.id,
      image,
    ]),
  );
  const hasAcceptedImages = acceptedImages.length > 0;
  const uploadFailures = result.failures.map(failure => ({
    ...(failure.code ? { code: failure.code } : {}),
    fileName: failure.fileName ?? 'Upload',
    message: failure.code === 'too_many_images'
      ? 'Skipped because the section is full.'
      : failure.message,
  }));
  const uploadSummary = uploadFailures.length > 0
    ? formatCustomDesignUploadSummary(
      result.addedCount,
      uploadFailures.map(failure => ({ code: failure.code ?? 'processing_failed' })),
    )
    : '';
  const status = result.status === 'committed' || (result.status === 'partial' && hasAcceptedImages)
    ? 'ready' as const
    : current.canva.images.length > 0
      ? current.canva.status
      : 'invalid' as const;

  return {
    ...current,
    canva: {
      ...current.canva,
      customDesignSectionId: result.sectionId,
      displayMode,
      errorMessage: uploadSummary,
      images: hasAcceptedImages
        ? [...imagesByStorageId.values()]
        : current.canva.images,
      ownedAssetIds: [...new Set([
        ...current.canva.ownedAssetIds,
        ...acceptedImages.flatMap(image => image.storageId ? [image.storageId] : []),
      ])],
      placement,
      status,
      uploadResult: uploadFailures.length > 0
        ? {
            addedCount: result.addedCount,
            failures: uploadFailures,
            summary: uploadSummary,
          }
        : null,
    },
    recipe: {
      ...current.recipe,
      canvaEnabled: hasAcceptedImages || current.recipe.canvaEnabled,
    },
  };
};

const withObservableRecipeEvents = (
  current: OnboardingLabState,
  nextValue: OnboardingLabState,
): OnboardingLabState => {
  let next = reconcileConditionalHistory(nextValue);
  if (current.recipe.aboutEnabled !== next.recipe.aboutEnabled) {
    next = recordOnboardingEvent(next, {
      enabled: next.recipe.aboutEnabled,
      type: 'about_toggled',
    });
  }
  if (current.recipe.policiesEnabled !== next.recipe.policiesEnabled) {
    next = recordOnboardingEvent(next, {
      enabled: next.recipe.policiesEnabled,
      type: 'policies_toggled',
    });
  }
  if (current.recipe.aboutPreset !== next.recipe.aboutPreset) {
    next = recordOnboardingEvent(next, {
      presetId: next.recipe.aboutPreset,
      presetKind: 'about',
      type: 'preset_changed',
    });
  }
  if (current.recipe.stylePreset !== next.recipe.stylePreset) {
    next = recordOnboardingEvent(next, {
      presetId: next.recipe.stylePreset,
      presetKind: 'style',
      type: 'preset_changed',
    });
  }
  if (current.recipe.palettePreset !== next.recipe.palettePreset) {
    next = recordOnboardingEvent(next, {
      presetId: next.recipe.palettePreset,
      presetKind: 'palette',
      type: 'preset_changed',
    });
    next = recordOnboardingEvent(next, {
      presetId: next.recipe.palettePreset,
      type: 'palette_selected',
    });
  }
  const currentExtras = [
    current.recipe.galleryEnabled ? 'gallery' as const : null,
    current.recipe.canvaEnabled ? 'canva' as const : null,
  ].filter((value): value is 'gallery' | 'canva' => value !== null);
  const nextExtras = [
    next.recipe.galleryEnabled ? 'gallery' as const : null,
    next.recipe.canvaEnabled ? 'canva' as const : null,
  ].filter((value): value is 'gallery' | 'canva' => value !== null);
  if (currentExtras.join('|') !== nextExtras.join('|')) {
    next = recordOnboardingEvent(next, {
      extras: nextExtras,
      type: 'extras_selected',
    });
  }
  return next;
};

const downloadEventJournal = (json: string) => {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.download = `luster-onboarding-session-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
};

function LabReviewOptions({
  appliedFixtureId,
  eventCount,
  onApply,
  onClose,
  onExport,
  open,
}: {
  appliedFixtureId: string | null;
  eventCount: number;
  onApply: (id: LabReviewFixtureId) => void;
  onClose: () => void;
  onExport: () => void;
  open: boolean;
}) {
  return (
    <Dialog
      description="These fixtures affect only this browser-local onboarding Lab."
      onClose={onClose}
      open={open}
      title="Lab review options"
      variant="sheet"
    >
      <div className="onboarding-lab-options">
        <div className="onboarding-lab-options__intro">
          <FlaskConical aria-hidden="true" size={22} />
          <p>Load a deterministic review state. A fixture with a starter rebuilds the exact existing universal starter document.</p>
        </div>
        <div className="onboarding-fixture-grid">
          {LAB_REVIEW_FIXTURES.map(fixture => (
            <button
              aria-pressed={appliedFixtureId === fixture.id}
              className="onboarding-fixture-card"
              key={fixture.id}
              type="button"
              onClick={() => onApply(fixture.id)}
            >
              {fixture.label}
            </button>
          ))}
        </div>
        <footer className="onboarding-overlay-actions">
          <button type="button" onClick={onExport}>
            <Download aria-hidden="true" size={16} />
            {' '}
            Export event log (
            {eventCount}
            )
          </button>
          <button className="is-primary" type="button" onClick={onClose}>Done</button>
        </footer>
      </div>
    </Dialog>
  );
}

function PausedState({ onResume }: { onResume: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="onboarding-paused-state">
      <section className="onboarding-paused-card" aria-labelledby="paused-heading">
        <span aria-hidden="true">L</span>
        <p className="onboarding-screen-kicker">Saved in this browser</p>
        <h1 id="paused-heading" ref={headingRef} tabIndex={-1}>Setup saved</h1>
        <p aria-live="polite" className="visually-hidden" role="status">Your setup is saved.</p>
        <p>Your profile, starter, optional choices, and current place are ready when you return.</p>
        <button className="onboarding-primary-action" type="button" onClick={onResume}>Resume setup</button>
      </section>
    </main>
  );
}

const previewFor = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
  label: string,
): ReactNode => (
  <OnboardingSitePreview
    document={document}
    includeOptionalSections={false}
    interactionMode="scrollable"
    label={label}
    quickBookPhase="identity"
    state={state}
  />
);

export function OnboardingApp({
  auditMode = false,
  forceReview = false,
  integration,
  lab,
  onEnterBuilder,
  onEnterDashboard,
}: OnboardingAppProps) {
  const onboarding = useOnboardingState();
  // onEnterBuilder is retained only as a test/backward-compatible callback
  // name. The product handoff now always targets the dashboard port.
  const enterDashboard = onEnterDashboard ?? onEnterBuilder ?? (() => {});
  const coordinator = useCustomDesignAssetCoordinator();
  const assetRepository = useCustomDesignAssetRepository();
  const starterLogoAssetIds = onboarding.state.profile.logo?.storageId
    ? [onboarding.state.profile.logo.storageId]
    : [];
  const starterLogoAssets = useCustomDesignAssetMap(starterLogoAssetIds);
  const starterLogoUrl = resolveOnboardingImageUrl(
    onboarding.state.profile.logo,
    starterLogoAssets,
  );
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [writingHelperOpen, setWritingHelperOpen] = useState(false);
  const [labOptionsOpen, setLabOptionsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [pendingStarter, setPendingStarter] = useState<StarterId | null>(null);
  const [startingSiteRevealActive, setStartingSiteRevealActive] = useState(false);
  const [error, setError] = useState('');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const forceReviewAppliedRef = useRef(false);
  const browserCursorRef = useRef(0);
  const browserEntriesRef = useRef(new Map<number, {
    overlay?: OnboardingBrowserOverlay;
    screen: OnboardingScreenId;
  }>());
  const browserOverlayRef = useRef<OnboardingBrowserOverlay | null>(null);
  const browserScreenRef = useRef<OnboardingScreenId | null>(null);
  const historySessionRef = useRef(Date.now());
  const historyInitializedRef = useRef(false);
  const applyingPopStateRef = useRef(false);
  const continueAfterPreviewCloseRef = useRef(false);
  const cleanupRetrySignatureRef = useRef('');
  const recipeSyncSignatureRef = useRef('');
  const profileMediaOperationsRef = useRef(0);
  const feedbackInitializedRef = useRef(false);
  const previousCompletedStagesRef = useRef(new Set(
    getCompletedEssentialStages(onboarding.state),
  ));
  const previousEssentialsRemainingRef = useRef(getEssentialsLeft(onboarding.state));
  const feedback = useFeedback();
  const screen = onboarding.state.progress.currentScreen;
  const previousFeedbackScreenRef = useRef(screen);
  const aboutEnabled = onboarding.state.recipe.aboutEnabled;
  const selectedStarter = onboarding.state.recipe.starter;
  const builderHasBeenEntered = onboarding.state.planOffer.planIntent !== null
    || onboarding.state.progress.sessionStatus === 'builder'
    || onboarding.state.progress.sessionStatus === 'dashboard';
  const completedStages = getCompletedEssentialStages(onboarding.state);
  const essentialsRemaining = getEssentialsLeft(onboarding.state);

  useEffect(() => {
    if (!startingSiteRevealActive) {
      return undefined;
    }
    const timer = window.setTimeout(() => setStartingSiteRevealActive(false), 760);
    return () => window.clearTimeout(timer);
  }, [startingSiteRevealActive]);

  useEffect(() => {
    feedback.configure({
      reducedMotion: onboarding.state.reviewOptions.reducedMotion,
    });
  }, [feedback, onboarding.state.reviewOptions.reducedMotion]);

  useEffect(() => {
    if (!feedbackInitializedRef.current) {
      feedbackInitializedRef.current = true;
      previousCompletedStagesRef.current = new Set(completedStages);
      previousEssentialsRemainingRef.current = essentialsRemaining;
      return;
    }
    const milestoneIds = onboarding.state.reviewOptions.feedbackMilestones ?? [];
    const milestonesToRemember: string[] = [];
    const reachedAllRequired = previousEssentialsRemainingRef.current > 0
      && essentialsRemaining === 0;
    const stageMessages = {
      basics: 'Basics complete',
      booking: 'Booking is ready',
      design: 'Your website design is set',
    } as const;
    for (const stage of completedStages) {
      if (stage === 'review') {
        continue;
      }
      const milestoneId = `stage_${stage}`;
      if (
        previousCompletedStagesRef.current.has(stage)
        || milestoneIds.includes(milestoneId)
      ) {
        continue;
      }
      // Stage completion can land in the same commit as a navigation (the
      // design stage always does); preserve the toast across that one
      // transition so the moment is actually seen.
      feedback.send({
        kind: 'stage_complete',
        message: stageMessages[stage],
        onceKey: milestoneId,
        preserveOnNavigation: true,
      });
      milestonesToRemember.push(milestoneId);
    }
    if (reachedAllRequired && !milestoneIds.includes('all_required_complete')) {
      feedback.send({
        kind: 'milestone',
        message: 'Everything you need is ready',
        onceKey: 'all_required_complete',
        preserveOnNavigation: true,
      });
      milestonesToRemember.push('all_required_complete');
    }
    previousCompletedStagesRef.current = new Set(completedStages);
    previousEssentialsRemainingRef.current = essentialsRemaining;
    if (milestonesToRemember.length > 0) {
      onboarding.updateState(current => ({
        ...current,
        reviewOptions: {
          ...current.reviewOptions,
          feedbackMilestones: [...new Set([
            ...(current.reviewOptions.feedbackMilestones ?? []),
            ...milestonesToRemember,
          ])],
        },
      }));
    }
  }, [
    completedStages.join('|'),
    essentialsRemaining,
    feedback,
    onboarding.state.reviewOptions.feedbackMilestones?.join('|'),
    onboarding.updateState,
  ]);

  useEffect(() => {
    if (previousFeedbackScreenRef.current === screen) {
      return;
    }
    previousFeedbackScreenRef.current = screen;
    feedback.clearQueuedVisuals();
  }, [feedback, screen]);

  const updateState: OnboardingStateUpdater = useCallback((update) => {
    onboarding.updateState(current => withObservableRecipeEvents(current, update(current)));
  }, [onboarding.updateState]);

  const canva = useCanvaIntegration({
    lab,
    onSectionIdChange: customDesignSectionId => onboarding.updateState(current => ({
      ...current,
      canva: { ...current.canva, customDesignSectionId },
    })),
  });

  useEffect(() => {
    const pendingAssetIds = onboarding.state.canva.ownedAssetIds;
    if (
      !coordinator
      || lab.document
      || screen !== 'starter'
      || pendingAssetIds.length === 0
    ) {
      return undefined;
    }
    const signature = [...pendingAssetIds].sort().join('|');
    if (cleanupRetrySignatureRef.current === signature) {
      return undefined;
    }
    cleanupRetrySignatureRef.current = signature;
    let cancelled = false;
    void coordinator.deleteAssetsIfUnreferenced(pendingAssetIds).then((cleanupErrors) => {
      if (cancelled) {
        return;
      }
      if (cleanupErrors.length > 0) {
        setError(
          'Setup is clear, but this browser still couldn’t remove every uploaded setup image. The cleanup list remains saved and will be retried safely after reload.',
        );
        return;
      }
      onboarding.updateState(current => ({
        ...current,
        canva: { ...current.canva, ownedAssetIds: [] },
      }));
      setError('');
    });
    return () => {
      cancelled = true;
    };
  }, [coordinator, lab.document, onboarding.state.canva.ownedAssetIds, onboarding.updateState, screen]);

  const modalOpen = Boolean(
    previewSource
    || galleryOpen
    || canvaOpen
    || planOpen
    || writingHelperOpen
    || labOptionsOpen
    || resetOpen
    || pendingStarter,
  );

  useEffect(() => {
    feedback.setVisualSuppressed(modalOpen || screen === 'final_preview');
    if (surfaceRef.current) {
      surfaceRef.current.inert = modalOpen;
    }
    document.documentElement.classList.toggle('onboarding-modal-open', modalOpen);
    return () => {
      document.documentElement.classList.remove('onboarding-modal-open');
      feedback.setVisualSuppressed(false);
    };
  }, [feedback, modalOpen, screen]);

  useEffect(() => () => {
    feedback.clear();
  }, [feedback]);

  useEffect(() => {
    if (onboarding.state.progress.sessionStatus !== 'active') {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const heading = surfaceRef.current?.querySelector<HTMLHeadingElement>('h1');
      if (!heading) {
        return;
      }
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = 0;
      }
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onboarding.state.progress.sessionStatus, screen]);

  useEffect(() => {
    if (forceReview && !forceReviewAppliedRef.current) {
      forceReviewAppliedRef.current = true;
      onboarding.viewScreen('final_preview');
    }
  }, [forceReview, onboarding.viewScreen]);

  useEffect(() => {
    if (mountedRef.current) {
      return;
    }
    mountedRef.current = true;
    if (
      (onboarding.state.progress.sessionStatus === 'builder'
        || onboarding.state.progress.sessionStatus === 'dashboard')
        && !forceReview
    ) {
      enterDashboard();
      return;
    }
    if (
      onboarding.state.progress.sessionStatus === 'active'
      && onboarding.state.progress.lastSavedAt
      && onboarding.state.progress.currentScreen !== 'starter'
    ) {
      onboarding.resume(true);
    }
  }, [
    forceReview,
    enterDashboard,
    onboarding.resume,
    onboarding.state.progress.currentScreen,
    onboarding.state.progress.lastSavedAt,
    onboarding.state.progress.sessionStatus,
  ]);

  useEffect(() => {
    if (!historyInitializedRef.current) {
      historyInitializedRef.current = true;
      const existing = window.history.state;
      const restoredEntry = isOnboardingBrowserHistoryState(existing)
        && existing.screen === screen
        ? existing
        : null;
      browserCursorRef.current = restoredEntry?.onboardingCursor ?? 0;
      const restoredOverlay = restoredEntry?.overlay ?? null;
      browserOverlayRef.current = restoredOverlay;
      browserScreenRef.current = screen;
      historySessionRef.current = restoredEntry?.onboardingSession ?? Date.now();
      browserEntriesRef.current.set(browserCursorRef.current, {
        ...(restoredOverlay ? { overlay: restoredOverlay } : {}),
        screen,
      });
      setPreviewSource(restoredOverlay?.kind === 'preview' ? restoredOverlay.source : null);
      setPlanOpen(restoredOverlay?.kind === 'plan');
      window.history.replaceState({
        lusterOnboarding: true,
        onboardingCursor: browserCursorRef.current,
        onboardingSession: historySessionRef.current,
        ...(restoredOverlay ? { overlay: restoredOverlay } : {}),
        screen,
      } satisfies OnboardingBrowserHistoryState, '');
      return;
    }

    if (applyingPopStateRef.current) {
      applyingPopStateRef.current = false;
      browserScreenRef.current = screen;
      return;
    }

    if (browserScreenRef.current === screen) {
      return;
    }
    const onboardingCursor = browserCursorRef.current + 1;
    browserCursorRef.current = onboardingCursor;
    browserOverlayRef.current = null;
    browserScreenRef.current = screen;
    browserEntriesRef.current.set(onboardingCursor, { screen });
    window.history.pushState({
      lusterOnboarding: true,
      onboardingCursor,
      onboardingSession: historySessionRef.current,
      screen,
    } satisfies OnboardingBrowserHistoryState, '');
  }, [screen]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!isOnboardingBrowserHistoryState(event.state)) {
        return;
      }
      if (event.state.onboardingSession !== historySessionRef.current) {
        window.history.forward();
        return;
      }
      const direction = event.state.onboardingCursor < browserCursorRef.current
        ? 'back'
        : event.state.onboardingCursor > browserCursorRef.current
          ? 'forward'
          : null;
      if (!direction) {
        return;
      }
      if (event.state.screen === 'about_design'
        && !aboutEnabled
        && selectedStarter !== 'quick_book') {
        if (direction === 'back') {
          window.history.back();
        } else {
          window.history.forward();
        }
        return;
      }

      const targetOverlay = event.state.overlay ?? null;
      browserEntriesRef.current.set(event.state.onboardingCursor, {
        ...(targetOverlay ? { overlay: targetOverlay } : {}),
        screen: event.state.screen,
      });
      if (event.state.screen === browserScreenRef.current) {
        const previousOverlay = browserOverlayRef.current;
        browserCursorRef.current = event.state.onboardingCursor;
        browserOverlayRef.current = targetOverlay;
        if (targetOverlay?.kind === 'preview') {
          setPlanOpen(false);
          setPreviewSource(targetOverlay.source);
          if (previousOverlay?.kind !== 'preview') {
            onboarding.recordEvent({ source: targetOverlay.source, type: 'preview_opened' });
          }
        } else if (targetOverlay?.kind === 'plan') {
          setPreviewSource(null);
          setPlanOpen(true);
        } else {
          setPreviewSource(null);
          setPlanOpen(false);
          if (previousOverlay?.kind === 'plan') {
            window.requestAnimationFrame(() => {
              document.getElementById(BUILDER_HANDOFF_TRIGGER_ID)?.focus({
                preventScroll: true,
              });
            });
          }
          if (previousOverlay?.kind === 'preview') {
            onboarding.recordEvent({ source: previousOverlay.source, type: 'preview_closed' });
          }
          if (previousOverlay?.kind === 'preview' && continueAfterPreviewCloseRef.current) {
            continueAfterPreviewCloseRef.current = false;
            onboarding.continueFlow();
          }
        }
        return;
      }

      setPreviewSource(null);
      setGalleryOpen(false);
      setCanvaOpen(false);
      setPlanOpen(false);
      setLabOptionsOpen(false);
      setResetOpen(false);
      setPendingStarter(null);
      applyingPopStateRef.current = true;
      browserCursorRef.current = event.state.onboardingCursor;
      browserOverlayRef.current = targetOverlay;
      browserScreenRef.current = event.state.screen;
      onboarding.navigateFromBrowser(event.state.screen, direction);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    aboutEnabled,
    onboarding.continueFlow,
    onboarding.navigateFromBrowser,
    onboarding.recordEvent,
    selectedStarter,
  ]);

  const goBack = () => {
    const previousProductScreen = onboarding.state.progress.screenHistory.at(-2);
    const previousBrowserEntry = browserEntriesRef.current.get(
      browserCursorRef.current - 1,
    );
    if (
      browserCursorRef.current > 0
      && previousProductScreen
      && (
        previousBrowserEntry === undefined
        || (
          previousBrowserEntry.screen === previousProductScreen
          && !previousBrowserEntry.overlay
        )
      )
    ) {
      window.history.back();
      return;
    }
    onboarding.back();
  };

  const openPreview = (source: PreviewSource) => {
    onboarding.recordEvent({ source, type: 'preview_opened' });
    const onboardingCursor = browserCursorRef.current + 1;
    browserCursorRef.current = onboardingCursor;
    const overlay = { kind: 'preview', source } as const;
    browserOverlayRef.current = overlay;
    browserEntriesRef.current.set(onboardingCursor, { overlay, screen });
    window.history.pushState({
      lusterOnboarding: true,
      onboardingCursor,
      onboardingSession: historySessionRef.current,
      overlay,
      screen,
    } satisfies OnboardingBrowserHistoryState, '');
    setPreviewSource(source);
  };
  const dismissPreview = (continueSetup = false) => {
    continueAfterPreviewCloseRef.current = continueSetup;
    if (browserOverlayRef.current?.kind === 'preview' && browserCursorRef.current > 0) {
      window.history.back();
      return;
    }
    if (previewSource) {
      onboarding.recordEvent({ source: previewSource, type: 'preview_closed' });
    }
    browserOverlayRef.current = null;
    setPreviewSource(null);
    if (continueSetup) {
      continueAfterPreviewCloseRef.current = false;
      onboarding.continueFlow();
    }
  };

  const openPlan = () => {
    const overlay = { kind: 'plan' } as const;
    const onboardingCursor = browserCursorRef.current + 1;
    browserCursorRef.current = onboardingCursor;
    browserOverlayRef.current = overlay;
    browserEntriesRef.current.set(onboardingCursor, { overlay, screen });
    window.history.pushState({
      lusterOnboarding: true,
      onboardingCursor,
      onboardingSession: historySessionRef.current,
      overlay,
      screen,
    } satisfies OnboardingBrowserHistoryState, '');
    setPlanOpen(true);
  };

  const dismissPlan = () => {
    if (browserOverlayRef.current?.kind === 'plan' && browserCursorRef.current > 0) {
      window.history.back();
      return;
    }
    browserOverlayRef.current = null;
    setPlanOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById(BUILDER_HANDOFF_TRIGGER_ID)?.focus({
        preventScroll: true,
      });
    });
  };

  const updateProfile = (patch: Partial<BusinessProfileDraft>) => onboarding.updateProfile(patch);
  const updatePhotoProfile = (patch: Partial<BusinessProfileDraft>) => {
    const removed = [
      ...('profilePhoto' in patch && !patch.profilePhoto && onboarding.state.profile.profilePhoto
        ? [onboarding.state.profile.profilePhoto]
        : []),
      ...('logo' in patch && !patch.logo && onboarding.state.profile.logo
        ? [onboarding.state.profile.logo]
        : []),
    ];
    onboarding.updateProfile(patch);
    if (assetRepository && removed.length > 0) {
      void onboardingMediaPort.deleteOwned(assetRepository, removed).then((cleanupErrors) => {
        if (cleanupErrors.length > 0) {
          const cleanupIds = removed.flatMap(image => image.storageId ? [image.storageId] : []);
          onboarding.updateState(current => ({
            ...current,
            canva: {
              ...current.canva,
              ownedAssetIds: [...new Set([
                ...current.canva.ownedAssetIds,
                ...cleanupIds,
              ])],
            },
          }));
          setError('Your image was removed from the site, but this browser still needs to finish cleaning up its earlier copy.');
        }
      });
    }
  };
  const selectImage = async (file: File, kind: 'logo' | 'profile') => {
    setError('');
    profileMediaOperationsRef.current += 1;
    try {
      if (!assetRepository) {
        throw new Error(ONBOARDING_MEDIA_STORAGE_UNAVAILABLE_MESSAGE);
      }
      const previous = kind === 'profile'
        ? onboarding.state.profile.profilePhoto
        : onboarding.state.profile.logo;
      const image = await onboardingMediaPort.storeOne(assetRepository, file, kind);
      onboarding.updateProfile(kind === 'profile' ? { profilePhoto: image } : { logo: image });
      if (previous) {
        void onboardingMediaPort.deleteOwned(assetRepository, [previous]).then((cleanupErrors) => {
          if (cleanupErrors.length === 0 || !previous.storageId) {
            return;
          }
          onboarding.updateState(current => ({
            ...current,
            canva: {
              ...current.canva,
              ownedAssetIds: [...new Set([
                ...current.canva.ownedAssetIds,
                previous.storageId as string,
              ])],
            },
          }));
          setError('Your new image is saved, but this browser still needs to finish cleaning up its earlier copy.');
        });
      }
      setError('');
    } catch (cause) {
      const message = cause instanceof Error
        ? cause.message
        : 'This photo couldn’t be saved. Try selecting it again or choose another copy.';
      throw new Error(message, { cause });
    } finally {
      profileMediaOperationsRef.current = Math.max(
        0,
        profileMediaOperationsRef.current - 1,
      );
    }
  };

  const selectStarter = (starter: StarterId) => {
    if (lab.document) {
      if (lab.document.originStarter === starter) {
        onboarding.continueFlow();
      } else {
        setPendingStarter(starter);
        setError('');
      }
      return;
    }
    // The starter is chosen before the business name exists; an empty string
    // would bypass the model's site-name default.
    const result = lab.createStarterOnce(starter, {
      siteName: onboarding.state.profile.businessName.trim() || 'Your nail studio',
    });
    if (!result.success) {
      setError(result.message);
      return;
    }
    onboarding.updateState(current => continueFrom(recordOnboardingEvent({
      ...current,
      recipe: {
        ...current.recipe,
        starter,
        starterDocumentSiteId: result.document.siteId,
      },
      reviewOptions: {
        ...current.reviewOptions,
        feedbackMilestones: [...new Set([
          ...(current.reviewOptions.feedbackMilestones ?? []),
          'starting_site_ready',
        ])],
      },
    }, { starter, type: 'starter_selected' })));
    feedback.send({
      kind: 'milestone',
      message: 'Your starting site is ready',
      onceKey: 'starting_site_ready',
      preserveOnNavigation: true,
      replaceVisual: true,
    });
    setStartingSiteRevealActive(true);
    setError('');
  };

  const confirmStarterChange = () => {
    if (!pendingStarter) {
      return;
    }
    const result = switchOnboardingStarter(
      lab,
      onboarding.state,
      pendingStarter,
      { allowBuilderReset: builderHasBeenEntered },
    );
    if (!result.success) {
      setError(result.message);
      setPendingStarter(null);
      return;
    }

    onboarding.updateState(current => continueFrom(recordOnboardingEvent({
      ...current,
      canva: {
        ...current.canva,
        customDesignSectionId: result.customDesignSectionId,
      },
      recipe: {
        ...current.recipe,
        starter: pendingStarter,
        starterDocumentSiteId: result.document.siteId,
      },
    }, { starter: pendingStarter, type: 'starter_selected' })));
    setPendingStarter(null);
    setError('');
  };

  const addCanva = async (
    files: readonly File[],
    displayMode: CanvaDisplayMode,
    placement: CanvaPlacement,
  ) => {
    const result = await canva.addCanvaDesign({
      confirmed: true,
      displayMode,
      files,
      placement,
      sectionId: onboarding.state.canva.customDesignSectionId,
    });
    onboarding.updateState((current) => {
      const next = applyCanvaIntegrationResult(
        current,
        result,
        displayMode,
        placement,
      );
      return withObservableRecipeEvents(current, next);
    });
    return result;
  };

  const applyFixture = async (id: LabReviewFixtureId) => {
    try {
      if (profileMediaOperationsRef.current > 0) {
        setError('Finish the current image upload before loading a Lab fixture.');
        return;
      }
      const onboardingAssetIds = getOnboardingAssetIds(onboarding.state);
      if (!lab.resetLab()) {
        setError('Finish the current image upload before loading a Lab fixture.');
        return;
      }
      const cleanupErrors = await coordinator?.deleteAssetsIfUnreferenced(
        onboardingAssetIds,
      ) ?? [];
      let state = applyLabReviewFixture(id);
      if (cleanupErrors.length > 0) {
        state = {
          ...state,
          canva: {
            ...state.canva,
            ownedAssetIds: [...new Set([
              ...state.canva.ownedAssetIds,
              ...onboardingAssetIds,
            ])],
          },
        };
      }
      if (state.recipe.starter) {
        const result = lab.createStarterOnce(state.recipe.starter, {
          siteName: state.profile.businessName,
        });
        if (!result.success) {
          setError(result.message);
          return;
        }
        state = {
          ...state,
          recipe: { ...state.recipe, starterDocumentSiteId: result.document.siteId },
        };
      }
      state = recordOnboardingEvent(state, {
        screen: state.progress.currentScreen,
        type: 'screen_viewed',
      });
      onboarding.updateState(() => state);
      setLabOptionsOpen(false);
      setError(cleanupErrors.length > 0
        ? 'The fixture is ready, but some earlier uploaded setup images still need browser cleanup. Their cleanup list is saved for the next restart.'
        : '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The fixture could not be loaded.');
    }
  };

  const confirmReset = async () => {
    if (resetPending) {
      return;
    }
    if (isOnboardingResetBlocked(
      lab.transactionPending,
      profileMediaOperationsRef.current,
    )) {
      setError('Finish the current image upload before starting over.');
      return;
    }
    setResetPending(true);
    try {
      const onboardingAssetIds = getOnboardingAssetIds(onboarding.state);
      const previousState = structuredClone(onboarding.state);
      if (!onboarding.reset()) {
        setError('Onboarding browser storage could not be cleared.');
        return;
      }
      if (!lab.resetLab()) {
        const restored = onboarding.restoreSnapshot(previousState);
        setError(restored.success
          ? 'Setup could not be restarted safely. Your setup was restored.'
          : 'The saved site could not be cleared, and your setup answers could not be resaved. They remain open on this screen; try again before closing it.');
        return;
      }
      const cleanupErrors = await coordinator?.deleteAssetsIfUnreferenced(
        onboardingAssetIds,
      ) ?? [];
      if (cleanupErrors.length > 0) {
        onboarding.updateState(current => ({
          ...current,
          canva: {
            ...current.canva,
            ownedAssetIds: [...new Set(onboardingAssetIds)],
          },
        }));
      }
      feedback.resetSession();
      setPreviewSource(null);
      setGalleryOpen(false);
      setCanvaOpen(false);
      setPlanOpen(false);
      setLabOptionsOpen(false);
      setResetOpen(false);
      setError(cleanupErrors.length > 0
        ? 'Setup was restarted. Some uploaded setup images still need browser cleanup, so their cleanup list was kept for a safe retry.'
        : '');
      browserCursorRef.current = 0;
      browserEntriesRef.current.clear();
      browserEntriesRef.current.set(0, { screen: 'starter' });
      browserOverlayRef.current = null;
      browserScreenRef.current = 'starter';
      applyingPopStateRef.current = false;
      historySessionRef.current += 1;
      window.history.replaceState({
        lusterOnboarding: true,
        onboardingCursor: 0,
        onboardingSession: historySessionRef.current,
        screen: 'starter',
      } satisfies OnboardingBrowserHistoryState, '');
      integration?.onStartOver?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Setup could not be restarted safely.');
    } finally {
      setResetPending(false);
    }
  };

  const syncBuilderSiteName = () => {
    if (!lab.document) {
      return true;
    }
    const synced = lab.syncSiteName(onboarding.state.profile.businessName);
    if (!synced) {
      setError('Finish the current image upload before updating the Builder site name.');
    }
    return synced;
  };

  const recipeContext = lab.document
    ? {
        context: deriveSiteLibraryContext(onboarding.state, lab.document),
        toggles: deriveSitePlanToggles(onboarding.state),
      }
    : null;
  const acceptedBuilderDocument = lab.document && recipeContext
    ? reconcileV1StarterDocument(
      applyOnboardingSitePresentation(lab.document, {
        aboutPreset: onboarding.state.recipe.aboutPreset,
        galleryLayout: onboarding.state.gallery.layout,
      }),
      recipeContext,
    ).document
    : null;
  const recipeSyncSignature = lab.document && recipeContext
    ? JSON.stringify({
      aboutEnabled: recipeContext.toggles.aboutEnabled,
      aboutPreset: onboarding.state.recipe.aboutPreset,
      businessStructure: recipeContext.context.businessStructure,
      galleryEnabled: recipeContext.toggles.galleryEnabled,
      galleryImageIds: recipeContext.context.galleryImageIds,
      galleryLayout: onboarding.state.gallery.layout,
      policiesEnabled: recipeContext.toggles.policiesEnabled,
      policiesMeaningful: recipeContext.context.policiesMeaningful,
      reviewIds: recipeContext.context.siteContent.reviews
        .filter(review => review.visible)
        .map(review => review.id),
      siteId: lab.document.siteId,
      siteName: onboarding.state.profile.businessName,
    })
    : '';

  useEffect(() => {
    if (
      !lab.document
      || !recipeContext
      || recipeSyncSignature === ''
      || recipeSyncSignatureRef.current === recipeSyncSignature
    ) {
      return;
    }
    const accepted = lab.acceptOnboardingPresentation(
      onboarding.state.profile.businessName,
      {
        aboutPreset: onboarding.state.recipe.aboutPreset,
        galleryLayout: onboarding.state.gallery.layout,
      },
      recipeContext,
    );
    if (accepted) {
      recipeSyncSignatureRef.current = recipeSyncSignature;
    }
  }, [
    lab,
    onboarding.state.gallery.layout,
    onboarding.state.profile.businessName,
    onboarding.state.recipe.aboutPreset,
    recipeContext,
    recipeSyncSignature,
  ]);

  const openBuilder = () => {
    const accepted = lab.acceptOnboardingPresentation(
      onboarding.state.profile.businessName,
      {
        aboutPreset: onboarding.state.recipe.aboutPreset,
        galleryLayout: onboarding.state.gallery.layout,
      },
      recipeContext ?? undefined,
    );
    if (!accepted) {
      setError('Finish the current image upload before updating the Builder site.');
      return;
    }
    if (integration) {
      integration.onSaveSite({
        document: structuredClone(accepted),
        state: structuredClone(onboarding.state),
      });
      return;
    }
    if (onboarding.requestBuilderHandoff()) {
      openPlan();
    }
  };
  const choosePlan = (intent: PlanIntent) => {
    const saved = onboarding.choosePlan(intent);
    if (saved && !saved.success) {
      setError(saved.message);
      return;
    }
    browserOverlayRef.current = null;
    browserEntriesRef.current.set(browserCursorRef.current, { screen: 'final_preview' });
    window.history.replaceState({
      lusterOnboarding: true,
      onboardingCursor: browserCursorRef.current,
      onboardingSession: historySessionRef.current,
      screen: 'final_preview',
    } satisfies OnboardingBrowserHistoryState, '');
    setPlanOpen(false);
    enterDashboard();
  };

  const renderScreen = (): ReactNode => {
    const finalSiteAlreadySaved = integration?.hasSavedSite === true;
    switch (screen) {
      case 'business':
        return (
          <BrandBasicsScreen
            onBack={goBack}
            onContinue={() => {
              if (!syncBuilderSiteName()) {
                return;
              }
              setStartingSiteRevealActive(true);
              onboarding.continueFlow();
            }}
            onLogoSelected={file => selectImage(file, 'logo')}
            onProfileChange={updatePhotoProfile}
            onProfilePhotoSelected={file => selectImage(file, 'profile')}
            onQuickBookProfileChange={patch => updateState(current => ({
              ...current,
              recipe: {
                ...current.recipe,
                quickBookProfile: { ...current.recipe.quickBookProfile, ...patch },
              },
            }))}
            onValidationFailure={fieldIds => onboarding.recordEvent({ fieldIds, screen, type: 'validation_failure' })}
            profile={onboarding.state.profile}
            reveal={startingSiteRevealActive}
            starter={lab.document?.originStarter ?? onboarding.state.recipe.starter}
          />
        );
      case 'location_contact':
        return (
          <LocationContactScreen
            contactSetupConfirmed={onboarding.state.progress.contactSetupConfirmed}
            onBack={goBack}
            onContactConfirmed={() => onboarding.updateState(current => ({
              ...current,
              progress: { ...current.progress, contactSetupConfirmed: true },
            }))}
            onContinue={onboarding.continueFlow}
            onProfileChange={updateProfile}
            onValidationFailure={fieldIds => onboarding.recordEvent({ fieldIds, screen, type: 'validation_failure' })}
            profile={onboarding.state.profile}
          />
        );
      case 'hours':
        return (
          <HoursScreen
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onProfileChange={updateProfile}
            onSkipHours={() => onboarding.recordEvent({ item: 'hours', screen, type: 'skip' })}
            profile={onboarding.state.profile}
          />
        );
      case 'booking_preferences':
        return (
          <BookingPreferencesScreen
            onBack={goBack}
            onBookingPreferencesChange={patch => onboarding.updateProfile({
              bookingPreferences: { ...onboarding.state.profile.bookingPreferences, ...patch },
            })}
            onContinue={onboarding.continueFlow}
            onDepositChange={deposits => onboarding.updateProfile({
              policies: {
                ...onboarding.state.profile.policies,
                deposits,
              },
            })}
            onServiceMenuChange={serviceMenu => onboarding.updateProfile({ serviceMenu })}
            onValidationFailure={fieldIds => onboarding.recordEvent({ fieldIds, screen, type: 'validation_failure' })}
            previewTimestamp={onboarding.state.reviewOptions.previewTimestamp}
            profile={onboarding.state.profile}
          />
        );
      case 'starter':
        return (
          <StartingPointScreen
            businessName={onboarding.state.profile.businessName}
            canGoBack={onboarding.state.progress.screenHistory.length > 1}
            canvaIntentNoted={onboarding.state.recipe.wantsCanvaFromWelcome}
            location={onboarding.state.profile.location}
            logoUrl={starterLogoUrl ?? undefined}
            onBack={goBack}
            onCanvaIntent={() => {
              onboarding.updateState(current => ({
                ...current,
                recipe: {
                  ...current.recipe,
                  wantsCanvaFromWelcome: !current.recipe.wantsCanvaFromWelcome,
                },
              }));
            }}
            onChooseStarter={selectStarter}
            ownerName={onboarding.state.profile.ownerName}
            reducedMotion={onboarding.state.reviewOptions.reducedMotion}
            selectedStarter={lab.document?.originStarter ?? onboarding.state.recipe.starter}
          />
        );
      case 'starting_preview':
        return onboarding.state.recipe.starter
          ? (
              <StartingPreviewScreen
                onBack={goBack}
                onContinue={onboarding.continueFlow}
                onOpenPreview={() => openPreview('starting_preview')}
                preview={previewFor(onboarding.state, lab.document, 'Personalized starting site preview')}
                profile={onboarding.state.profile}
                reveal={startingSiteRevealActive}
                starter={onboarding.state.recipe.starter}
              />
            )
          : null;
      case 'about':
        return (
          <AboutScreen
            document={lab.document}
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onEditProfile={() => onboarding.viewScreen('business')}
            onFullPreview={() => openPreview('about')}
            onUpdate={updateState}
            onWritingHelperOpenChange={setWritingHelperOpen}
            state={onboarding.state}
          />
        );
      case 'about_design':
        return onboarding.state.recipe.starter === 'quick_book'
          ? <QuickBookLayoutScreen document={lab.document} onBack={goBack} onContinue={onboarding.continueFlow} onFullPreview={() => openPreview('about_design')} onUpdate={updateState} state={onboarding.state} />
          : <AboutDesignScreen document={lab.document} onBack={goBack} onContinue={onboarding.continueFlow} onFullPreview={() => openPreview('about_design')} onUpdate={updateState} state={onboarding.state} />;
      case 'policies':
        return (
          <PoliciesScreen
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onEditBooking={() => onboarding.viewScreen('booking_preferences')}
            onSkip={() => {
              updateState(current => ({
                ...current,
                recipe: { ...current.recipe, policiesEnabled: false },
              }));
              onboarding.skip('policies');
            }}
            onUpdate={updateState}
            state={onboarding.state}
          />
        );
      case 'booking_layout':
        return (
          <BookingLayoutScreen
            document={acceptedBuilderDocument}
            onBack={goBack}
            onChange={(sectionId, settings) => {
              const result = lab.runCommand({
                sectionId,
                settings,
                type: 'update_booking_presentation',
              });
              if (!result.success) {
                setError(result.message);
              }
            }}
            onContinue={onboarding.continueFlow}
            onFullPreview={() => openPreview('booking_layout')}
            state={onboarding.state}
          />
        );
      case 'site_style':
        return (
          <SiteStyleScreen
            document={lab.document}
            onBack={goBack}
            onContinue={() => {
              onboarding.setStylePreset(onboarding.state.recipe.stylePreset, true);
              onboarding.continueFlow();
            }}
            onFullPreview={() => openPreview('site_style')}
            onKeepCurrent={() => {
              onboarding.setStylePreset(onboarding.state.recipe.stylePreset, true);
              onboarding.continueFlow();
            }}
            onUpdate={updateState}
            state={onboarding.state}
          />
        );
      case 'save_progress':
        if (integration && acceptedBuilderDocument) {
          return (
            <AccountGateBridge
              onOpen={() => {
                // Opening the account gate replaces this onboarding tree. Flush
                // the current draft before that unmount so Clerk redirects,
                // development-browser handshakes, and ordinary reloads can all
                // reconstruct the exact site the owner just previewed.
                const saved = onboarding.saveNow();
                if (!saved.success) {
                  setError(saved.message);
                  return;
                }
                integration.onSaveSite({
                  document: structuredClone(acceptedBuilderDocument),
                  state: structuredClone(saved.state),
                });
              }}
            />
          );
        }
        return (
          <SaveProgressScreen
            document={acceptedBuilderDocument ?? lab.document}
            onBack={goBack}
            onUnavailable={() => setError('Open the connected Luster onboarding route to create or sign in to an account. Your local site preview is still safe.')}
            state={onboarding.state}
          />
        );
      case 'extras':
        return (
          <ExtrasScreen
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onOpenCanva={() => setCanvaOpen(true)}
            onOpenGallery={() => setGalleryOpen(true)}
            onSkip={() => onboarding.skip('extras')}
            state={onboarding.state}
          />
        );
      case 'final_preview':
        return (
          <FinalReviewScreen
            document={acceptedBuilderDocument}
            onBack={goBack}
            onEdit={target => onboarding.viewScreen(target)}
            onEditCanva={() => {
              onboarding.viewScreen('extras');
              setCanvaOpen(true);
            }}
            onOpenBuilder={openBuilder}
            onOpenPreview={() => openPreview('final_preview')}
            primaryActionLabel={integration
              ? finalSiteAlreadySaved ? 'Finish setup' : 'Save my site'
              : undefined}
            primarySupportingCopy={integration
              ? finalSiteAlreadySaved
                ? 'Review the site your clients will see. Finish setup to save these final choices and choose how you want to start.'
                : 'Your website is ready. Save it to your Luster account before choosing how you want to start.'
              : undefined}
            state={onboarding.state}
          />
        );
      // Legacy ids (welcome, photo_social) cannot be current: storage
      // migration remaps them before any render.
      default:
        return null;
    }
  };

  if (onboarding.state.progress.sessionStatus === 'paused') {
    return <PausedState onResume={() => onboarding.resume(false)} />;
  }

  const content = renderScreen();
  const reducedMotionClass = onboarding.state.reviewOptions.reducedMotion ? ' is-reduced-motion' : '';
  const smallPhoneClass = onboarding.state.reviewOptions.viewportFixture === 'small_phone' ? ' is-small-phone-fixture' : '';
  const currentStarter = lab.document?.originStarter ?? onboarding.state.recipe.starter;
  const currentStarterLabel = currentStarter
    ? STARTER_LABELS[currentStarter]
    : 'your current starting point';
  const pendingStarterLabel = pendingStarter
    ? STARTER_LABELS[pendingStarter]
    : 'the new starting point';

  return (
    <div className={`onboarding-app${reducedMotionClass}${smallPhoneClass}`} data-onboarding-screen={screen}>
      <div className="onboarding-app__surface" ref={surfaceRef}>
        {error || onboarding.storageIssue || lab.loadIssues.length > 0
          ? (
              <div className="onboarding-error-banner" role="alert">
                <span>{error || onboarding.storageIssue || lab.loadIssues.join(' ')}</span>
                {error ? <button type="button" onClick={() => setError('')}>Dismiss</button> : null}
              </div>
            )
          : null}
        {screen === 'starter'
          ? content
          : (
              <OnboardingShell
                autosaveState={onboarding.saveStatus}
                completedStages={completedStages}
                currentStage={getScreenStage(screen)}
                essentialsRemaining={essentialsRemaining}
                onLabOptions={auditMode ? () => setLabOptionsOpen(true) : undefined}
                onRestart={() => setResetOpen(true)}
                onSaveForLater={() => {
                  const result = onboarding.pause();
                  if (!result.success) {
                    setError(result.message);
                  }
                }}
                routeKey={screen}
              >
                {content}
              </OnboardingShell>
            )}
      </div>

      <SetupPreviewOverlay
        document={lab.document}
        onClose={() => dismissPreview(false)}
        onContinue={() => {
          dismissPreview(previewSource === 'starting_preview');
        }}
        open={previewSource !== null}
        source={previewSource ?? 'starting_preview'}
        state={onboarding.state}
      />
      <GalleryDialog
        onClose={() => setGalleryOpen(false)}
        onUpdate={updateState}
        open={galleryOpen}
        state={onboarding.state}
      />
      <CanvaDialog
        available={canva.available}
        controller={canva}
        document={lab.document}
        onAdd={addCanva}
        onClose={() => setCanvaOpen(false)}
        onUpdate={updateState}
        open={canvaOpen}
        state={onboarding.state}
      />
      <PlanOfferSheet
        configuration={createLabPlanConfiguration(onboarding.state.planOffer.foundingMode)}
        offer={onboarding.state.planOffer}
        onChoose={choosePlan}
        onClose={dismissPlan}
        open={planOpen}
      />
      {auditMode
        ? (
            <LabReviewOptions
              appliedFixtureId={onboarding.state.reviewOptions.appliedFixtureId}
              eventCount={onboarding.state.eventJournal.length}
              onApply={(id) => {
                void applyFixture(id);
              }}
              onClose={() => setLabOptionsOpen(false)}
              onExport={() => downloadEventJournal(onboarding.eventLogJson())}
              open={labOptionsOpen}
            />
          )
        : null}
      <ConfirmationDialog
        cancelLabel="Keep current"
        confirmLabel={builderHasBeenEntered
          ? `Replace with ${pendingStarterLabel}`
          : `Switch to ${pendingStarterLabel}`}
        danger={builderHasBeenEntered}
        description={builderHasBeenEntered
          ? `You’ve already opened the Builder. Replacing ${currentStarterLabel} with ${pendingStarterLabel} may replace manual page and section changes made there. Your business profile, onboarding choices, Gallery draft, and uploaded Canva assets stay saved.`
          : `Switching to ${pendingStarterLabel} keeps your business information, About details, policies, style choices, photos, Gallery draft, Canva design, and onboarding progress saved. We’ll replace only the starting page structure.`}
        onClose={() => setPendingStarter(null)}
        onConfirm={confirmStarterChange}
        open={pendingStarter !== null}
        title={builderHasBeenEntered
          ? `Replace with ${pendingStarterLabel}?`
          : `Switch to ${pendingStarterLabel}?`}
      />
      <ConfirmationDialog
        cancelLabel="Keep my setup"
        confirmLabel="Start over"
        danger
        description="This clears your onboarding answers, uploaded setup images and starting website from this device. Other saved Builder work stays untouched."
        onClose={() => {
          if (!resetPending) {
            setResetOpen(false);
          }
        }}
        onConfirm={() => {
          void confirmReset();
        }}
        open={resetOpen}
        pending={resetPending}
        title="Start over?"
      />
    </div>
  );
}
