import { useId, type ReactNode } from 'react';

import { STAGE_METADATA } from '../copy';
import type { OnboardingStage } from '../model/types';
import {
  AutosaveStatus,
  type OnboardingAutosaveState,
} from './AutosaveStatus';
import { EssentialsCounter } from './EssentialsCounter';
import { OnboardingStageProgress } from './OnboardingStageProgress';

type OnboardingShellProps = {
  actions?: ReactNode;
  autosaveState: OnboardingAutosaveState;
  children: ReactNode;
  completedStages: readonly OnboardingStage[];
  currentStage: OnboardingStage;
  essentialsRemaining: number;
  onLabOptions?: () => void;
  onRestart?: () => void;
  onSaveForLater?: () => void;
};

export function OnboardingShell({
  actions,
  autosaveState,
  children,
  completedStages,
  currentStage,
  essentialsRemaining,
  onLabOptions,
  onRestart,
  onSaveForLater,
}: OnboardingShellProps) {
  const contentId = useId();
  const hasMoreActions = Boolean(onSaveForLater || onRestart || onLabOptions);

  return (
    <div className="onboarding-shell" data-onboarding-stage={currentStage}>
      <header className="onboarding-shell__header">
        <a aria-label="Luster onboarding" className="onboarding-shell__brand" href={`#${contentId}`}>
          <span aria-hidden="true">L</span>
          <strong>Luster</strong>
        </a>
        <p aria-live="polite" className="onboarding-shell__current-stage">
          <span className="visually-hidden">Current stage: </span>
          {STAGE_METADATA[currentStage].label}
        </p>
        <AutosaveStatus state={autosaveState} />
        {hasMoreActions ? (
          <details className="onboarding-shell__more">
            <summary aria-label="More onboarding options">More</summary>
            <div className="onboarding-shell__more-menu">
              {onSaveForLater ? (
                <button type="button" onClick={onSaveForLater}>
                  Save and finish later
                </button>
              ) : null}
              {onRestart ? (
                <button type="button" onClick={onRestart}>
                  Restart onboarding
                </button>
              ) : null}
              {onLabOptions ? (
                <button type="button" onClick={onLabOptions}>
                  Lab review options
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
      </header>
      <div className="onboarding-shell__progress">
        <OnboardingStageProgress completedStages={completedStages} currentStage={currentStage} />
        <EssentialsCounter remaining={essentialsRemaining} />
      </div>
      <main className="onboarding-shell__content" id={contentId} tabIndex={-1}>
        {children}
      </main>
      {actions}
    </div>
  );
}
