import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

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
  routeKey?: string;
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
  routeKey,
}: OnboardingShellProps) {
  const contentId = useId();
  const moreMenuId = useId();
  const hasMoreActions = Boolean(onSaveForLater || onRestart || onLabOptions);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const moreTriggerRef = useRef<HTMLElement>(null);

  const closeMore = useCallback((restoreFocus = false) => {
    setMoreOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => moreTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [routeKey]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) closeMore();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMore(true);
    };
    window.document.addEventListener('pointerdown', handlePointerDown);
    window.document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.document.removeEventListener('pointerdown', handlePointerDown);
      window.document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [closeMore, moreOpen]);

  const runMoreAction = useCallback((action: () => void) => {
    closeMore();
    action();
  }, [closeMore]);

  const handleMoreKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setMoreOpen((open) => !open);
  }, []);

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
          <details
            ref={moreRef}
            className="onboarding-shell__more"
            open={moreOpen}
            onToggle={(event) => setMoreOpen(event.currentTarget.open)}
          >
            <summary
              ref={moreTriggerRef}
              aria-controls={moreMenuId}
              aria-expanded={moreOpen}
              aria-label="More onboarding options"
              onKeyDown={handleMoreKeyDown}
              role="button"
            >
              More
            </summary>
            <div className="onboarding-shell__more-menu" id={moreMenuId}>
              {onSaveForLater ? (
                <button type="button" onClick={() => runMoreAction(onSaveForLater)}>
                  Save and finish later
                </button>
              ) : null}
              {onRestart ? (
                <button type="button" onClick={() => runMoreAction(onRestart)}>
                  Restart onboarding
                </button>
              ) : null}
              {onLabOptions ? (
                <button type="button" onClick={() => runMoreAction(onLabOptions)}>
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
