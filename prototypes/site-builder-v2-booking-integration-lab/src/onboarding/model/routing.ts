import { CORE_SCREEN_ORDER, SCREEN_METADATA } from '../copy';
import { getFirstIncompleteEssentialScreen } from '../progress/essentials';
import type {
  OnboardingLabState,
  OnboardingScreenId,
  OnboardingStage,
  OptionalOnboardingItem,
} from './types';

const appendUnique = <Value extends string>(values: Value[], value: Value): Value[] =>
  values.includes(value) ? values : [...values, value];

export const isScreenAvailable = (
  screen: OnboardingScreenId,
  state: OnboardingLabState,
): boolean => screen !== 'about_design' || state.recipe.aboutEnabled;

export const getReachableCoreScreens = (
  state: OnboardingLabState,
): OnboardingScreenId[] => CORE_SCREEN_ORDER.filter((screen) =>
  isScreenAvailable(screen, state));

export const getNextScreen = (
  screen: OnboardingScreenId,
  state: OnboardingLabState,
): OnboardingScreenId | null => {
  if (screen === 'about') {
    return state.recipe.aboutEnabled ? 'about_design' : 'policies';
  }
  const screens = getReachableCoreScreens(state);
  const currentIndex = screens.indexOf(screen);
  return currentIndex < 0 ? null : screens[currentIndex + 1] ?? null;
};

export const getScreenStage = (screen: OnboardingScreenId): OnboardingStage =>
  SCREEN_METADATA[screen].stage;

export const goToScreen = (
  state: OnboardingLabState,
  screen: OnboardingScreenId,
  options: { replace?: boolean } = {},
): OnboardingLabState => {
  if (!isScreenAvailable(screen, state)) {
    return state;
  }
  const currentHistory = state.progress.screenHistory.length > 0
    ? state.progress.screenHistory
    : [state.progress.currentScreen];
  const screenHistory = options.replace
    ? [...currentHistory.slice(0, -1), screen]
    : currentHistory.at(-1) === screen
      ? currentHistory
      : [...currentHistory, screen];

  return {
    ...state,
    progress: {
      ...state.progress,
      currentScreen: screen,
      lastActiveScreen: screen,
      screenHistory,
      sessionStatus: 'active',
      visitedScreens: appendUnique(state.progress.visitedScreens, screen),
    },
  };
};

export const goForward = (
  state: OnboardingLabState,
): OnboardingLabState => {
  const next = getNextScreen(state.progress.currentScreen, state);
  return next ? goToScreen(state, next) : state;
};

export const goBack = (state: OnboardingLabState): OnboardingLabState => {
  const history = state.progress.screenHistory;
  if (history.length <= 1) {
    return state;
  }
  const screenHistory = history.slice(0, -1);
  const currentScreen = screenHistory.at(-1) ?? 'welcome';
  return {
    ...state,
    progress: {
      ...state.progress,
      currentScreen,
      lastActiveScreen: currentScreen,
      screenHistory,
      sessionStatus: 'active',
    },
  };
};

export const skipOptionalScreen = (
  state: OnboardingLabState,
  item: OptionalOnboardingItem,
): OnboardingLabState => goForward({
  ...state,
  progress: {
    ...state.progress,
    skippedOptionalItems: appendUnique(state.progress.skippedOptionalItems, item),
  },
});

export const reconcileConditionalHistory = (
  state: OnboardingLabState,
): OnboardingLabState => {
  if (state.recipe.aboutEnabled) {
    return state;
  }
  const screenHistory = state.progress.screenHistory.filter(
    (screen) => screen !== 'about_design',
  );
  const currentScreen = state.progress.currentScreen === 'about_design'
    ? 'about'
    : state.progress.currentScreen;
  const normalizedHistory = screenHistory.at(-1) === currentScreen
    ? screenHistory
    : [...screenHistory, currentScreen];
  return {
    ...state,
    progress: {
      ...state.progress,
      currentScreen,
      lastActiveScreen: currentScreen,
      screenHistory: normalizedHistory.length > 0 ? normalizedHistory : ['welcome'],
    },
  };
};

export const getResumeScreen = (
  state: OnboardingLabState,
): OnboardingScreenId => {
  const firstIncomplete = getFirstIncompleteEssentialScreen(state);
  if (state.progress.currentScreen === 'final_preview' && firstIncomplete) {
    return firstIncomplete;
  }
  if (isScreenAvailable(state.progress.lastActiveScreen, state)) {
    return state.progress.lastActiveScreen;
  }
  return firstIncomplete ?? 'welcome';
};

export const pauseOnboarding = (state: OnboardingLabState): OnboardingLabState => ({
  ...state,
  progress: {
    ...state.progress,
    lastActiveScreen: state.progress.currentScreen,
    sessionStatus: 'paused',
  },
});

export const resumeOnboarding = (state: OnboardingLabState): OnboardingLabState =>
  goToScreen(state, getResumeScreen(state), { replace: true });
