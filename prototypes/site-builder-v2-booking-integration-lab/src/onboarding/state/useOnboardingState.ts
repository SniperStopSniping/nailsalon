import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { exportOnboardingEventJournal, recordOnboardingEvent } from '../events/journal';
import { applyLabReviewFixture, type LabReviewFixtureId } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  getNextScreen,
  goBack,
  goForward,
  goToBrowserHistoryScreen,
  goToScreen,
  pauseOnboarding,
  reconcileConditionalHistory,
  resumeOnboarding,
  skipOptionalScreen,
} from '../model/routing';
import type {
  AboutPresetId,
  BusinessProfileDraft,
  CanvaDraft,
  GalleryDraft,
  OnboardingEventInput,
  OnboardingLabState,
  OnboardingSaveStatus,
  OnboardingScreenId,
  OnboardingSiteRecipe,
  OptionalOnboardingItem,
  PlanIntent,
  PlanOfferDraft,
  SiteStylePresetId,
  StarterId,
} from '../model/types';
import {
  canOpenBuilder,
  getFirstIncompleteEssentialScreen,
} from '../progress/essentials';
import {
  clearOnboardingState,
  loadOnboardingState,
  type OnboardingStorage,
  saveOnboardingState,
  type SaveOnboardingStateResult,
} from '../storage/storage';

export type OnboardingStateUpdate<Value> =
  | Partial<Value>
  | ((current: Value) => Value);

export type UseOnboardingStateOptions = {
  debounceMs?: number;
  initialState?: OnboardingLabState;
  storage?: OnboardingStorage;
};

const applyUpdate = <Value extends object>(
  current: Value,
  update: OnboardingStateUpdate<Value>,
): Value => typeof update === 'function'
  ? update(current)
  : { ...current, ...update };

export function useOnboardingState(
  options: UseOnboardingStateOptions = {},
) {
  const initialRef = useRef<ReturnType<typeof loadOnboardingState> | null>(null);
  const storageRef = useRef<OnboardingStorage | undefined>(options.storage);
  if (initialRef.current === null) {
    initialRef.current = options.initialState
      ? { state: structuredClone(options.initialState), status: 'empty' }
      : loadOnboardingState(storageRef.current);
  }

  const initial = initialRef.current;
  const [state, setState] = useState<OnboardingLabState>(initial.state);
  const stateRef = useRef(state);
  const [saveStatus, setSaveStatus] = useState<OnboardingSaveStatus>(
    initial.status === 'error' ? 'error' : initial.status === 'loaded' ? 'saved' : 'idle',
  );
  const [storageIssue, setStorageIssue] = useState(
    initial.status === 'error' ? initial.message : null,
  );
  const mountedRef = useRef(false);
  const initialWelcomeViewRecordedRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const skipNextSaveRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const debounceMs = options.debounceMs ?? 220;

  const replaceState = useCallback((next: OnboardingLabState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const updateState = useCallback((
    update: (current: OnboardingLabState) => OnboardingLabState,
  ) => {
    pendingSaveRef.current = true;
    setSaveStatus('saving');
    setState((current) => {
      const next = update(current);
      stateRef.current = next;
      return next;
    });
  }, []);

  const persistSnapshot = useCallback((
    snapshot: OnboardingLabState,
  ): SaveOnboardingStateResult => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setSaveStatus('saving');
    const result = saveOnboardingState(snapshot, { storage: storageRef.current });
    if (!result.success) {
      setSaveStatus('error');
      setStorageIssue(result.message);
      return result;
    }
    pendingSaveRef.current = false;
    skipNextSaveRef.current = true;
    replaceState(result.state);
    setStorageIssue(null);
    setSaveStatus('saved');
    return result;
  }, [replaceState]);

  useEffect(() => {
    const flushPendingState = () => {
      if (!pendingSaveRef.current) {
        return;
      }
      persistSnapshot(stateRef.current);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingState();
      }
    };

    window.addEventListener('pagehide', flushPendingState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushPendingState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [persistSnapshot]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return undefined;
    }
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return undefined;
    }
    setSaveStatus('saving');
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      persistSnapshot(stateRef.current);
    }, debounceMs);
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [debounceMs, persistSnapshot, state]);

  useEffect(() => {
    if (initialWelcomeViewRecordedRef.current) {
      return;
    }
    initialWelcomeViewRecordedRef.current = true;
    const current = stateRef.current;
    if (
      current.progress.currentScreen === 'starter'
      && !current.eventJournal.some(event =>
        event.type === 'screen_viewed' && event.screen === 'starter')
    ) {
      updateState(value => recordOnboardingEvent(value, {
        screen: 'starter',
        type: 'screen_viewed',
      }));
    }
  }, [updateState]);

  const recordEvent = useCallback((event: OnboardingEventInput) => {
    updateState(current => recordOnboardingEvent(current, event));
  }, [updateState]);

  const viewScreen = useCallback((screen: OnboardingScreenId) => {
    updateState(current => recordOnboardingEvent(
      goToScreen(current, screen),
      { screen, type: 'screen_viewed' },
    ));
  }, [updateState]);

  const continueFlow = useCallback(() => {
    updateState((current) => {
      const screen = current.progress.currentScreen;
      const nextScreen = getNextScreen(screen, current);
      let next = goForward(current);
      next = recordOnboardingEvent(next, {
        nextScreen,
        screen,
        type: 'continue',
      });
      return nextScreen
        ? recordOnboardingEvent(next, { screen: nextScreen, type: 'screen_viewed' })
        : next;
    });
  }, [updateState]);

  const back = useCallback(() => {
    updateState((current) => {
      const screen = current.progress.currentScreen;
      const next = goBack(current);
      if (next === current) {
        return current;
      }
      const withBackEvent = recordOnboardingEvent(next, {
        nextScreen: next.progress.currentScreen,
        screen,
        type: 'back',
      });
      return recordOnboardingEvent(withBackEvent, {
        screen: next.progress.currentScreen,
        type: 'screen_viewed',
      });
    });
  }, [updateState]);

  const navigateFromBrowser = useCallback((
    screen: OnboardingScreenId,
    direction: 'back' | 'forward',
  ) => {
    updateState((current) => {
      const next = goToBrowserHistoryScreen(current, screen, direction);
      if (next === current) {
        return current;
      }
      const withNavigationEvent = direction === 'back'
        ? recordOnboardingEvent(next, {
          nextScreen: screen,
          screen: current.progress.currentScreen,
          type: 'back',
        })
        : next;
      return recordOnboardingEvent(withNavigationEvent, {
        screen,
        type: 'screen_viewed',
      });
    });
  }, [updateState]);

  const skip = useCallback((item: OptionalOnboardingItem) => {
    updateState((current) => {
      const screen = current.progress.currentScreen;
      const next = skipOptionalScreen(current, item);
      const withSkipEvent = recordOnboardingEvent(next, {
        item,
        screen,
        type: 'skip',
      });
      return recordOnboardingEvent(withSkipEvent, {
        screen: next.progress.currentScreen,
        type: 'screen_viewed',
      });
    });
  }, [updateState]);

  const updateProfile = useCallback((
    update: OnboardingStateUpdate<BusinessProfileDraft>,
  ) => {
    updateState(current => ({
      ...current,
      profile: applyUpdate(current.profile, update),
    }));
  }, [updateState]);

  const updateRecipe = useCallback((
    update: OnboardingStateUpdate<OnboardingSiteRecipe>,
  ) => {
    updateState(current => reconcileConditionalHistory({
      ...current,
      recipe: applyUpdate(current.recipe, update),
    }));
  }, [updateState]);

  const updateGallery = useCallback((update: OnboardingStateUpdate<GalleryDraft>) => {
    updateState(current => ({
      ...current,
      gallery: applyUpdate(current.gallery, update),
    }));
  }, [updateState]);

  const updateCanva = useCallback((update: OnboardingStateUpdate<CanvaDraft>) => {
    updateState(current => ({
      ...current,
      canva: applyUpdate(current.canva, update),
    }));
  }, [updateState]);

  const updatePlanOffer = useCallback((
    update: OnboardingStateUpdate<PlanOfferDraft>,
  ) => {
    updateState(current => ({
      ...current,
      planOffer: applyUpdate(current.planOffer, update),
    }));
  }, [updateState]);

  const setAboutEnabled = useCallback((enabled: boolean) => {
    updateState(current => recordOnboardingEvent(
      reconcileConditionalHistory({
        ...current,
        recipe: { ...current.recipe, aboutEnabled: enabled },
      }),
      { enabled, type: 'about_toggled' },
    ));
  }, [updateState]);

  const setPoliciesEnabled = useCallback((enabled: boolean) => {
    updateState(current => recordOnboardingEvent({
      ...current,
      recipe: { ...current.recipe, policiesEnabled: enabled },
    }, { enabled, type: 'policies_toggled' }));
  }, [updateState]);

  const setAboutPreset = useCallback((aboutPreset: AboutPresetId) => {
    updateState(current => recordOnboardingEvent({
      ...current,
      recipe: { ...current.recipe, aboutPreset },
    }, {
      presetId: aboutPreset,
      presetKind: 'about',
      type: 'preset_changed',
    }));
  }, [updateState]);

  const setStylePreset = useCallback((
    stylePreset: SiteStylePresetId,
    confirmed = false,
  ) => {
    updateState(current => recordOnboardingEvent({
      ...current,
      recipe: {
        ...current.recipe,
        paletteConfirmed: confirmed ? true : current.recipe.paletteConfirmed,
        styleConfirmed: confirmed,
        stylePreset,
      },
    }, {
      presetId: stylePreset,
      presetKind: 'style',
      type: 'preset_changed',
    }));
  }, [updateState]);

  const recordStarterCreated = useCallback((
    starter: StarterId,
    starterDocumentSiteId: string,
  ) => {
    updateState(current => recordOnboardingEvent({
      ...current,
      recipe: { ...current.recipe, starter, starterDocumentSiteId },
    }, { starter, type: 'starter_selected' }));
  }, [updateState]);

  const recordExtrasSelected = useCallback((extras: Array<'gallery' | 'canva'>) => {
    updateState(current => recordOnboardingEvent({
      ...current,
      recipe: {
        ...current.recipe,
        canvaEnabled: extras.includes('canva'),
        galleryEnabled: extras.includes('gallery'),
      },
    }, { extras, type: 'extras_selected' }));
  }, [updateState]);

  const choosePlan = useCallback((intent: PlanIntent): SaveOnboardingStateResult => {
    const current = stateRef.current;
    const next = recordOnboardingEvent({
      ...current,
      planOffer: { ...current.planOffer, planIntent: intent },
      progress: { ...current.progress, sessionStatus: 'dashboard' },
    }, { intent, type: 'offer_choice' });
    return persistSnapshot(next);
  }, [persistSnapshot]);

  const requestBuilderHandoff = useCallback((): boolean => {
    const current = stateRef.current;
    if (!canOpenBuilder(current)) {
      const target = getFirstIncompleteEssentialScreen(current);
      if (target) {
        updateState(value => goToScreen(value, target));
      }
      return false;
    }
    updateState(value => recordOnboardingEvent(value, { type: 'open_builder' }));
    return true;
  }, [updateState]);

  const pause = useCallback((): SaveOnboardingStateResult => {
    const current = stateRef.current;
    const next = recordOnboardingEvent(pauseOnboarding(current), {
      screen: current.progress.currentScreen,
      type: 'paused',
    });
    return persistSnapshot(next);
  }, [persistSnapshot]);

  const resume = useCallback((afterReload = false) => {
    updateState((current) => {
      const next = resumeOnboarding(current);
      return afterReload || current.progress.sessionStatus === 'paused'
        ? recordOnboardingEvent(next, {
          screen: next.progress.currentScreen,
          type: 'resume_after_reload',
        })
        : next;
    });
  }, [updateState]);

  const applyFixture = useCallback((id: LabReviewFixtureId) => {
    updateState(() => applyLabReviewFixture(id));
  }, [updateState]);

  const saveNow = useCallback((): SaveOnboardingStateResult =>
    persistSnapshot(stateRef.current), [persistSnapshot]);

  const restoreSnapshot = useCallback((snapshot: OnboardingLabState): SaveOnboardingStateResult => {
    pendingSaveRef.current = true;
    replaceState(structuredClone(snapshot));
    return persistSnapshot(snapshot);
  }, [persistSnapshot, replaceState]);

  const reset = useCallback((): boolean => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Restart is deliberately destructive for this Lab journal. Observers can
    // export the pre-reset audit from More; retaining a reset event would break
    // the product requirement that restart clears the onboarding event log.
    const cleared = clearOnboardingState(storageRef.current);
    if (!cleared.success) {
      setSaveStatus('error');
      setStorageIssue(cleared.message);
      return false;
    }
    pendingSaveRef.current = false;
    skipNextSaveRef.current = true;
    replaceState(createDefaultOnboardingState());
    setSaveStatus('idle');
    setStorageIssue(null);
    return true;
  }, [replaceState]);

  return {
    applyFixture,
    back,
    choosePlan,
    continueFlow,
    eventLogJson: () => exportOnboardingEventJournal(stateRef.current.eventJournal),
    navigateFromBrowser,
    pause,
    recordEvent,
    recordExtrasSelected,
    recordStarterCreated,
    requestBuilderHandoff,
    reset,
    restoreSnapshot,
    resume,
    saveNow,
    saveStatus,
    setAboutEnabled,
    setAboutPreset,
    setPoliciesEnabled,
    setStylePreset,
    skip,
    state,
    storageIssue,
    updateCanva,
    updateGallery,
    updatePlanOffer,
    updateProfile,
    updateRecipe,
    updateState,
    viewScreen,
  };
}
