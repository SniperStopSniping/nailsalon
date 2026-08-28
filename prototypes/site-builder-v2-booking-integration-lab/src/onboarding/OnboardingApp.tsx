import { Download, FlaskConical, RotateCcw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useCustomDesignAssetCoordinator } from '../custom-design/integration/CustomDesignAssetProvider';
import type { SiteBuilderDocument } from '../model/types';
import { Dialog } from '../ui/Dialog';
import { ConfirmationDialog } from '../ui/EditorDialogs';
import type { LabDocumentController } from '../ui/useLabDocument';
import { OnboardingShell } from './components/OnboardingShell';
import { recordOnboardingEvent } from './events/journal';
import {
  useCanvaIntegration,
  type CanvaIntegrationResult,
} from './extras/useCanvaIntegration';
import {
  LAB_REVIEW_FIXTURES,
  applyLabReviewFixture,
  type LabReviewFixtureId,
} from './fixtures';
import { validateOnboardingLocalImage } from './model/local-images';
import {
  getNextScreen,
  getScreenStage,
  goForward,
  goToScreen,
  reconcileConditionalHistory,
} from './model/routing';
import type {
  BusinessProfileDraft,
  CanvaDisplayMode,
  CanvaPlacement,
  LocalImageReference,
  OnboardingLabState,
  OnboardingScreenId,
  PlanIntent,
  StarterId,
} from './model/types';
import { CanvaDialog, GalleryDialog } from './overlays/ExtrasDialogs';
import { PlanOfferSheet } from './overlays/PlanOfferSheet';
import { SetupPreviewOverlay } from './overlays/SetupPreviewOverlay';
import { OnboardingSitePreview } from './preview/OnboardingSitePreview';
import {
  getCompletedEssentialStages,
  getEssentialsLeft,
} from './progress/essentials';
import {
  AboutDesignScreen,
  AboutScreen,
  ExtrasScreen,
  PoliciesScreen,
  SiteStyleScreen,
  type OnboardingStateUpdater,
} from './screens/DesignScreens';
import {
  BookingPreferencesScreen,
  StartingPointScreen,
  StartingPreviewScreen,
} from './screens/BookingScreens';
import {
  BusinessScreen,
  LocationContactScreen,
  PhotoSocialScreen,
} from './screens/BasicsScreens';
import { FinalReviewScreen } from './screens/ReviewScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { useOnboardingState } from './state/useOnboardingState';

type PreviewSource = 'starting_preview' | 'site_style' | 'final_preview';

type OnboardingAppProps = {
  forceReview?: boolean;
  lab: LabDocumentController;
  onEnterBuilder: () => void;
};

const readLocalImage = (file: File, kind: 'logo' | 'profile'): Promise<LocalImageReference> =>
  new Promise((resolve, reject) => {
    try {
      validateOnboardingLocalImage(file);
    } catch (error) {
      reject(error);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The selected image could not be read.'));
    reader.onload = () => resolve({
      altText: kind === 'profile' ? 'Business owner portrait' : 'Business logo',
      fileName: file.name,
      id: `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mimeType: file.type,
      previewUrl: String(reader.result),
      source: 'data_url',
    });
    reader.readAsDataURL(file);
  });

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
): string[] => [...new Set(state.canva.images.flatMap((image) =>
  image.storageId ? [image.storageId] : []))];

export const applyCanvaIntegrationResult = (
  current: OnboardingLabState,
  result: CanvaIntegrationResult,
  displayMode: CanvaDisplayMode,
  placement: CanvaPlacement,
): OnboardingLabState => {
  const acceptedImages = result.addedImages.map((image) => ({
    fileName: image.fileName,
    id: image.id,
    mimeType: image.mimeType,
    source: 'indexed_db' as const,
    storageId: image.assetId,
  }));
  const imagesByStorageId = new Map(
    [...current.canva.images, ...acceptedImages].map((image) => [
      image.storageId ?? image.id,
      image,
    ]),
  );
  const hasAcceptedImages = acceptedImages.length > 0;
  const status = result.status === 'committed'
    ? 'ready' as const
    : result.status === 'partial'
      ? 'invalid' as const
      : current.canva.images.length > 0
        ? current.canva.status
        : 'invalid' as const;

  return {
    ...current,
    canva: {
      ...current.canva,
      customDesignSectionId: result.sectionId,
      displayMode,
      errorMessage: result.failures.map((failure) => failure.message).join(' '),
      images: hasAcceptedImages
        ? [...imagesByStorageId.values()]
        : current.canva.images,
      placement,
      status,
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
          {LAB_REVIEW_FIXTURES.map((fixture) => (
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
            <Download aria-hidden="true" size={16} /> Export event log ({eventCount})
          </button>
          <button className="is-primary" type="button" onClick={onClose}>Done</button>
        </footer>
      </div>
    </Dialog>
  );
}

function PausedState({ onResume }: { onResume: () => void }) {
  return (
    <main className="onboarding-paused-state">
      <section className="onboarding-paused-card" aria-labelledby="paused-heading">
        <span aria-hidden="true">L</span>
        <p className="onboarding-screen-kicker">Saved in this browser</p>
        <h1 id="paused-heading">Setup saved</h1>
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
    label={label}
    state={state}
  />
);

export function OnboardingApp({ forceReview = false, lab, onEnterBuilder }: OnboardingAppProps) {
  const onboarding = useOnboardingState();
  const coordinator = useCustomDesignAssetCoordinator();
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [labOptionsOpen, setLabOptionsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [error, setError] = useState('');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const forceReviewAppliedRef = useRef(false);
  const browserEntriesRef = useRef(0);
  const handlingBrowserBackRef = useRef(false);
  const screen = onboarding.state.progress.currentScreen;

  const updateState: OnboardingStateUpdater = useCallback((update) => {
    onboarding.updateState((current) => withObservableRecipeEvents(current, update(current)));
  }, [onboarding]);

  const canva = useCanvaIntegration({
    lab,
    onSectionIdChange: (customDesignSectionId) => onboarding.updateState((current) => ({
      ...current,
      canva: { ...current.canva, customDesignSectionId },
    })),
  });

  const modalOpen = Boolean(
    previewSource
    || galleryOpen
    || canvaOpen
    || planOpen
    || labOptionsOpen
    || resetOpen,
  );

  useEffect(() => {
    if (surfaceRef.current) surfaceRef.current.inert = modalOpen;
    document.documentElement.classList.toggle('onboarding-modal-open', modalOpen);
    return () => {
      document.documentElement.classList.remove('onboarding-modal-open');
    };
  }, [modalOpen]);

  useEffect(() => {
    if (forceReview && !forceReviewAppliedRef.current) {
      forceReviewAppliedRef.current = true;
      onboarding.viewScreen('final_preview');
    }
  }, [forceReview, onboarding]);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (onboarding.state.progress.sessionStatus === 'builder' && !forceReview) {
      onEnterBuilder();
      return;
    }
    if (
      onboarding.state.progress.sessionStatus === 'active'
      && onboarding.state.progress.lastSavedAt
      && onboarding.state.progress.currentScreen !== 'welcome'
    ) {
      onboarding.resume(true);
    }
  }, [forceReview, onEnterBuilder, onboarding]);

  useEffect(() => {
    const currentState = window.history.state as Record<string, unknown> | null;
    if (handlingBrowserBackRef.current) {
      handlingBrowserBackRef.current = false;
      window.history.replaceState({ lusterOnboarding: true, lusterOnboardingGuard: true, screen }, '');
      return;
    }
    if (!currentState?.lusterOnboardingGuard) {
      window.history.replaceState({ ...currentState, lusterOnboarding: true, screen }, '');
      window.history.pushState({ lusterOnboarding: true, lusterOnboardingGuard: true, screen }, '');
      browserEntriesRef.current = 1;
      return;
    }
    if (currentState.screen !== screen) {
      window.history.pushState({ lusterOnboarding: true, lusterOnboardingGuard: true, screen }, '');
      browserEntriesRef.current += 1;
    }
  }, [screen]);

  useEffect(() => {
    const handlePopState = () => {
      if (onboarding.state.progress.screenHistory.length <= 1) {
        window.history.pushState({
          lusterOnboarding: true,
          lusterOnboardingGuard: true,
          screen: onboarding.state.progress.currentScreen,
        }, '');
        browserEntriesRef.current = 1;
        return;
      }
      handlingBrowserBackRef.current = true;
      browserEntriesRef.current = Math.max(0, browserEntriesRef.current - 1);
      onboarding.back();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onboarding]);

  const goBack = () => {
    if (browserEntriesRef.current > 0) {
      window.history.back();
      return;
    }
    onboarding.back();
  };

  const openPreview = (source: PreviewSource) => {
    onboarding.recordEvent({ source, type: 'preview_opened' });
    setPreviewSource(source);
  };
  const closePreview = () => {
    if (previewSource) onboarding.recordEvent({ source: previewSource, type: 'preview_closed' });
    setPreviewSource(null);
  };

  const updateProfile = (patch: Partial<BusinessProfileDraft>) => onboarding.updateProfile(patch);
  const selectImage = async (file: File, kind: 'logo' | 'profile') => {
    try {
      const image = await readLocalImage(file, kind);
      onboarding.updateProfile(kind === 'profile' ? { profilePhoto: image } : { logo: image });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected image could not be read.');
    }
  };

  const selectStarter = (starter: StarterId) => {
    if (lab.document) {
      if (onboarding.state.recipe.starter === starter) {
        onboarding.continueFlow();
      } else {
        setError('A starting site already exists. Restart onboarding to choose a different starting point.');
      }
      return;
    }
    const result = lab.createStarterOnce(starter, {
      siteName: onboarding.state.profile.businessName,
    });
    if (!result.success) {
      setError(result.message);
      return;
    }
    onboarding.updateState((current) => continueFrom(recordOnboardingEvent({
      ...current,
      recipe: {
        ...current.recipe,
        starter,
        starterDocumentSiteId: result.document.siteId,
      },
    }, { starter, type: 'starter_selected' })));
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
      const onboardingAssetIds = getOnboardingAssetIds(onboarding.state);
      if (!lab.resetLab()) {
        setError('Finish the current image upload before loading a Lab fixture.');
        return;
      }
      const cleanupErrors = await coordinator?.deleteAssetsIfUnreferenced(
        onboardingAssetIds,
      ) ?? [];
      let state = applyLabReviewFixture(id);
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
      setError(cleanupErrors.map((cleanupError) => cleanupError.message).join(' '));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The fixture could not be loaded.');
    }
  };

  const confirmReset = async () => {
    try {
      const onboardingAssetIds = getOnboardingAssetIds(onboarding.state);
      if (!lab.resetLab()) {
        setError('Finish the current image upload before restarting onboarding.');
        return;
      }
      const cleanupErrors = await coordinator?.deleteAssetsIfUnreferenced(
        onboardingAssetIds,
      ) ?? [];
      if (!onboarding.reset()) {
        setError('Onboarding browser storage could not be cleared.');
        return;
      }
      setPreviewSource(null);
      setGalleryOpen(false);
      setCanvaOpen(false);
      setPlanOpen(false);
      setLabOptionsOpen(false);
      setResetOpen(false);
      setError(cleanupErrors.map((cleanupError) => cleanupError.message).join(' '));
      window.history.replaceState({ lusterOnboarding: true, screen: 'welcome' }, '');
      window.history.pushState({ lusterOnboarding: true, lusterOnboardingGuard: true, screen: 'welcome' }, '');
      browserEntriesRef.current = 1;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Lab could not be reset safely.');
    }
  };

  const syncBuilderSiteName = () => {
    if (!lab.document) return true;
    const synced = lab.syncSiteName(onboarding.state.profile.businessName);
    if (!synced) {
      setError('Finish the current image upload before updating the Builder site name.');
    }
    return synced;
  };

  const openBuilder = () => {
    if (!syncBuilderSiteName()) return;
    if (onboarding.requestBuilderHandoff()) setPlanOpen(true);
  };
  const choosePlan = (intent: PlanIntent) => {
    const saved = onboarding.choosePlan(intent);
    if (saved && !saved.success) {
      setError(saved.message);
      return;
    }
    setPlanOpen(false);
    onEnterBuilder();
  };

  const renderScreen = (): ReactNode => {
    switch (screen) {
      case 'welcome':
        return (
          <WelcomeScreen
            onBuildWebsite={onboarding.continueFlow}
            onCanvaIntent={() => {
              onboarding.updateState((current) => continueFrom({
                ...current,
                recipe: { ...current.recipe, wantsCanvaFromWelcome: true },
              }));
            }}
          />
        );
      case 'business':
        return (
          <BusinessScreen
            onBack={goBack}
            onContinue={() => {
              if (syncBuilderSiteName()) onboarding.continueFlow();
            }}
            onProfileChange={updateProfile}
            onValidationFailure={(fieldIds) => onboarding.recordEvent({ fieldIds, screen, type: 'validation_failure' })}
            profile={onboarding.state.profile}
          />
        );
      case 'photo_social':
        return (
          <PhotoSocialScreen
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onLogoSelected={(file) => { void selectImage(file, 'logo'); }}
            onProfileChange={updateProfile}
            onProfilePhotoSelected={(file) => { void selectImage(file, 'profile'); }}
            onSkipPhoto={() => onboarding.skip('photo')}
            profile={onboarding.state.profile}
          />
        );
      case 'location_contact':
        return (
          <LocationContactScreen
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onProfileChange={updateProfile}
            onSkipHours={() => onboarding.updateProfile({
              hours: { ...onboarding.state.profile.hours, skipped: true },
            })}
            onValidationFailure={(fieldIds) => onboarding.recordEvent({ fieldIds, screen, type: 'validation_failure' })}
            profile={onboarding.state.profile}
          />
        );
      case 'booking_preferences':
        return (
          <BookingPreferencesScreen
            onBack={goBack}
            onBookingPreferencesChange={(patch) => onboarding.updateProfile({
              bookingPreferences: { ...onboarding.state.profile.bookingPreferences, ...patch },
            })}
            onContinue={onboarding.continueFlow}
            onValidationFailure={(fieldIds) => onboarding.recordEvent({ fieldIds, screen, type: 'validation_failure' })}
            profile={onboarding.state.profile}
          />
        );
      case 'starter':
        return (
          <StartingPointScreen
            businessName={onboarding.state.profile.businessName}
            onBack={goBack}
            onChooseStarter={selectStarter}
            portraitUrl={onboarding.state.profile.profilePhoto?.previewUrl}
            reducedMotion={onboarding.state.reviewOptions.reducedMotion}
            selectedStarter={onboarding.state.recipe.starter}
          />
        );
      case 'starting_preview':
        return onboarding.state.recipe.starter ? (
          <StartingPreviewScreen
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onOpenPreview={() => openPreview('starting_preview')}
            preview={previewFor(onboarding.state, lab.document, 'Personalized starting site preview')}
            profile={onboarding.state.profile}
            starter={onboarding.state.recipe.starter}
          />
        ) : null;
      case 'about':
        return <AboutScreen onBack={goBack} onContinue={onboarding.continueFlow} onUpdate={updateState} state={onboarding.state} />;
      case 'about_design':
        return <AboutDesignScreen document={lab.document} onBack={goBack} onContinue={onboarding.continueFlow} onUpdate={updateState} state={onboarding.state} />;
      case 'policies':
        return (
          <PoliciesScreen
            onBack={goBack}
            onContinue={onboarding.continueFlow}
            onSkip={() => {
              updateState((current) => ({
                ...current,
                recipe: { ...current.recipe, policiesEnabled: false },
              }));
              onboarding.skip('policies');
            }}
            onUpdate={updateState}
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
            document={lab.document}
            onBack={goBack}
            onEdit={(target) => onboarding.viewScreen(target)}
            onOpenBuilder={openBuilder}
            state={onboarding.state}
          />
        );
    }
  };

  if (onboarding.state.progress.sessionStatus === 'paused') {
    return <PausedState onResume={() => onboarding.resume(false)} />;
  }

  const content = renderScreen();
  const reducedMotionClass = onboarding.state.reviewOptions.reducedMotion ? ' is-reduced-motion' : '';
  const smallPhoneClass = onboarding.state.reviewOptions.viewportFixture === 'small_phone' ? ' is-small-phone-fixture' : '';

  return (
    <div className={`onboarding-app${reducedMotionClass}${smallPhoneClass}`} data-onboarding-screen={screen}>
      <div className="onboarding-app__surface" ref={surfaceRef}>
        {error || onboarding.storageIssue || lab.loadIssues.length > 0 ? (
          <div className="onboarding-error-banner" role="alert">
            <span>{error || onboarding.storageIssue || lab.loadIssues.join(' ')}</span>
            {error ? <button type="button" onClick={() => setError('')}>Dismiss</button> : null}
          </div>
        ) : null}
        {screen === 'welcome' ? content : (
          <OnboardingShell
            autosaveState={onboarding.saveStatus}
            completedStages={getCompletedEssentialStages(onboarding.state)}
            currentStage={getScreenStage(screen)}
            essentialsRemaining={getEssentialsLeft(onboarding.state)}
            onLabOptions={() => setLabOptionsOpen(true)}
            onRestart={() => setResetOpen(true)}
            onSaveForLater={() => {
              const result = onboarding.pause();
              if (!result.success) setError(result.message);
            }}
          >
            {content}
          </OnboardingShell>
        )}
      </div>

      <SetupPreviewOverlay
        document={lab.document}
        onClose={closePreview}
        onContinue={() => {
          const source = previewSource;
          closePreview();
          if (source === 'starting_preview') onboarding.continueFlow();
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
        onAdd={addCanva}
        onClose={() => setCanvaOpen(false)}
        open={canvaOpen}
        state={onboarding.state}
      />
      <PlanOfferSheet
        offer={onboarding.state.planOffer}
        onChoose={choosePlan}
        onClose={() => setPlanOpen(false)}
        open={planOpen}
      />
      <LabReviewOptions
        appliedFixtureId={onboarding.state.reviewOptions.appliedFixtureId}
        eventCount={onboarding.state.eventJournal.length}
        onApply={(id) => { void applyFixture(id); }}
        onClose={() => setLabOptionsOpen(false)}
        onExport={() => downloadEventJournal(onboarding.eventLogJson())}
        open={labOptionsOpen}
      />
      <ConfirmationDialog
        confirmLabel="Restart onboarding"
        danger
        description="This clears only the onboarding draft, its event log, the Lab starter document, and onboarding-specific image assets in this browser."
        onClose={() => setResetOpen(false)}
        onConfirm={() => { void confirmReset(); }}
        open={resetOpen}
        title="Restart onboarding?"
      />
    </div>
  );
}
