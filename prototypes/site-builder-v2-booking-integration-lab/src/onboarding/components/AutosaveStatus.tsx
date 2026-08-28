import type { OnboardingSaveStatus } from '../model/types';

export type OnboardingAutosaveState = OnboardingSaveStatus;

type AutosaveStatusProps = {
  state: OnboardingAutosaveState;
};

const STATUS_COPY: Record<OnboardingAutosaveState, string> = {
  error: 'Save failed',
  idle: 'Saved in this browser',
  saved: 'Saved',
  saving: 'Saving…',
};

export function AutosaveStatus({ state }: AutosaveStatusProps) {
  return (
    <span
      aria-atomic="true"
      aria-label="Autosave status"
      aria-live="polite"
      className={`onboarding-autosave-status is-${state}`}
      role={state === 'error' ? 'alert' : 'status'}
    >
      {STATUS_COPY[state]}
    </span>
  );
}
