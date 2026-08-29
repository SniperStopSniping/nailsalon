import type { FeedbackKind } from './types';

export type FeedbackCapabilityOptions = {
  reducedMotion: boolean;
  testMode: boolean;
};

export type FeedbackCapabilityPort = {
  haptic: (
    kind: FeedbackKind,
    options: FeedbackCapabilityOptions,
  ) => boolean;
};

const HAPTIC_PATTERNS: Partial<Record<FeedbackKind, number | number[]>> = {
  added: 18,
  completed: [20, 24, 24],
  milestone: [24, 28, 34],
  removed: 15,
  selection: 12,
  stage_complete: [20, 22, 28],
};

/**
 * Browser-only capability adapter for the UX Lab. Safari on iPhone currently
 * does not expose vibration, so this intentionally and safely returns false.
 * A native shell can replace this port without changing onboarding screens.
 */
export const LAB_FEEDBACK_CAPABILITY_PORT: FeedbackCapabilityPort = {
  haptic: (kind, options) => {
    if (options.reducedMotion || options.testMode) return false;
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
      return false;
    }
    const pattern = HAPTIC_PATTERNS[kind];
    if (!pattern || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return false;
    }
    // Chromium logs a console error when vibration is requested without a
    // currently active user gesture. Milestone feedback can be emitted after
    // navigation, so keep haptics strictly tied to a real press/selection.
    // Safari currently has no vibration API and continues to no-op above.
    if (navigator.userActivation?.isActive !== true) return false;
    try {
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  },
};
