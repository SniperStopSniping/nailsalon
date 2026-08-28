import { createDefaultOnboardingState } from '../model/defaults';
import {
  ONBOARDING_SCHEMA_VERSION,
  type OnboardingLabState,
  type OnboardingScreenId,
} from '../model/types';

export const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';

export type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadOnboardingStateResult =
  | { status: 'empty'; state: OnboardingLabState }
  | { status: 'loaded'; state: OnboardingLabState }
  | { status: 'error'; state: OnboardingLabState; message: string };

export type SaveOnboardingStateResult =
  | { success: true; state: OnboardingLabState }
  | { success: false; message: string };

export type ClearOnboardingStateResult =
  | { success: true }
  | { success: false; message: string };

const SCREEN_IDS = new Set<OnboardingScreenId>([
  'welcome',
  'business',
  'photo_social',
  'location_contact',
  'booking_preferences',
  'starter',
  'starting_preview',
  'about',
  'about_design',
  'policies',
  'site_style',
  'extras',
  'final_preview',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScreenId = (value: unknown): value is OnboardingScreenId =>
  typeof value === 'string' && SCREEN_IDS.has(value as OnboardingScreenId);

const isOnboardingState = (value: unknown): value is OnboardingLabState => {
  if (!isRecord(value) || value.schemaVersion !== ONBOARDING_SCHEMA_VERSION) {
    return false;
  }
  if (
    !isRecord(value.profile)
    || !isRecord(value.recipe)
    || !isRecord(value.progress)
    || !isRecord(value.gallery)
    || !isRecord(value.canva)
    || !isRecord(value.planOffer)
    || !isRecord(value.reviewOptions)
    || !Array.isArray(value.eventJournal)
  ) {
    return false;
  }
  return isScreenId(value.progress.currentScreen)
    && isScreenId(value.progress.lastActiveScreen)
    && Array.isArray(value.progress.screenHistory)
    && value.progress.screenHistory.every(isScreenId)
    && Array.isArray(value.progress.visitedScreens)
    && value.progress.visitedScreens.every(isScreenId)
    && Array.isArray(value.progress.skippedOptionalItems);
};

const defaultStorage = (): OnboardingStorage => {
  if (typeof window === 'undefined') {
    throw new Error('Browser storage is not available.');
  }
  return window.localStorage;
};

const storageErrorMessage = (
  error: unknown,
  fallback: string,
): string => error instanceof Error && error.message ? error.message : fallback;

export const withLastSavedAt = (
  state: OnboardingLabState,
  timestamp: string,
): OnboardingLabState => ({
  ...state,
  progress: {
    ...state.progress,
    lastSavedAt: timestamp,
  },
});

export const serializeOnboardingState = (
  state: OnboardingLabState,
): string => JSON.stringify(state);

export const parseOnboardingState = (
  json: string,
): LoadOnboardingStateResult => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return {
      message: 'Saved onboarding progress is not valid JSON.',
      state: createDefaultOnboardingState(),
      status: 'error',
    };
  }
  if (!isOnboardingState(value)) {
    return {
      message: 'Saved onboarding progress is incomplete or uses an unsupported version.',
      state: createDefaultOnboardingState(),
      status: 'error',
    };
  }
  return { state: value, status: 'loaded' };
};

export const loadOnboardingState = (
  storage?: OnboardingStorage,
): LoadOnboardingStateResult => {
  try {
    const saved = (storage ?? defaultStorage()).getItem(ONBOARDING_STORAGE_KEY);
    return saved
      ? parseOnboardingState(saved)
      : { state: createDefaultOnboardingState(), status: 'empty' };
  } catch (error) {
    return {
      message: storageErrorMessage(error, 'Saved onboarding progress could not be read.'),
      state: createDefaultOnboardingState(),
      status: 'error',
    };
  }
};

export const saveOnboardingState = (
  state: OnboardingLabState,
  options: {
    storage?: OnboardingStorage;
    timestamp?: string;
  } = {},
): SaveOnboardingStateResult => {
  const savedState = withLastSavedAt(
    state,
    options.timestamp ?? new Date().toISOString(),
  );
  try {
    (options.storage ?? defaultStorage()).setItem(
      ONBOARDING_STORAGE_KEY,
      serializeOnboardingState(savedState),
    );
    return { state: savedState, success: true };
  } catch (error) {
    return {
      message: storageErrorMessage(error, 'Onboarding progress could not be saved in this browser.'),
      success: false,
    };
  }
};

export const clearOnboardingState = (
  storage?: OnboardingStorage,
): ClearOnboardingStateResult => {
  try {
    (storage ?? defaultStorage()).removeItem(ONBOARDING_STORAGE_KEY);
    return { success: true };
  } catch (error) {
    return {
      message: storageErrorMessage(error, 'Onboarding progress could not be cleared.'),
      success: false,
    };
  }
};
