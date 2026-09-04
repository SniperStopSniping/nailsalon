import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { STAGE_METADATA } from '../copy';
import type { OnboardingStage } from '../model/types';
import {
  AutosaveStatus,
  type OnboardingAutosaveState,
} from './AutosaveStatus';
import { EssentialsCounter } from './EssentialsCounter';
import { OnboardingStageProgress } from './OnboardingStageProgress';
import { useOnboardingKeyboard } from './useOnboardingKeyboard';

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
  const shellRef = useRef<HTMLDivElement>(null);
  const keyboardOpen = useOnboardingKeyboard(shellRef);
  const contentId = useId();
  const moreMenuId = useId();
  const moreTriggerId = useId();
  const hasMoreActions = Boolean(onSaveForLater || onRestart || onLabOptions);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLElement>(null);
  const menuEntryFocusRef = useRef<'first' | 'last'>('first');

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
    if (!moreOpen) {
      return undefined;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      const menuItems = moreMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      );
      const target = menuEntryFocusRef.current === 'last'
        ? menuItems?.item((menuItems?.length ?? 1) - 1)
        : menuItems?.item(0);
      menuItems?.forEach((item) => {
        item.tabIndex = item === target ? 0 : -1;
      });
      target?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        closeMore();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        closeMore();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeMore(true);
    };
    window.document.addEventListener('pointerdown', handlePointerDown);
    window.document.addEventListener('focusin', handleFocusIn);
    window.document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.document.removeEventListener('pointerdown', handlePointerDown);
      window.document.removeEventListener('focusin', handleFocusIn);
      window.document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [closeMore, moreOpen]);

  const runMoreAction = useCallback((action: () => void) => {
    closeMore();
    moreTriggerRef.current?.focus({ preventScroll: true });
    action();
  }, [closeMore]);

  const handleMoreKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    menuEntryFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
    setMoreOpen(open => event.key === 'Enter' || event.key === ' ' ? !open : true);
  }, []);

  const handleMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      window.requestAnimationFrame(() => {
        if (!moreMenuRef.current?.contains(document.activeElement)) {
          closeMore();
        }
      });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const menuItems = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    )];
    if (menuItems.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? menuItems.length - 1
        : event.key === 'ArrowUp'
          ? (currentIndex <= 0 ? menuItems.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % menuItems.length;
    menuItems.forEach((item, index) => {
      item.tabIndex = index === nextIndex ? 0 : -1;
    });
    menuItems[nextIndex]?.focus();
  }, [closeMore]);

  return (
    <div ref={shellRef} className="onboarding-shell" data-keyboard-open={keyboardOpen} data-onboarding-stage={currentStage}>
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
        {hasMoreActions
          ? (
              <details
                ref={moreRef}
                className="onboarding-shell__more"
                open={moreOpen}
                onToggle={event => setMoreOpen(event.currentTarget.open)}
              >
                <summary
                  ref={moreTriggerRef}
                  aria-controls={moreMenuId}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  aria-label="More onboarding options"
                  id={moreTriggerId}
                  onKeyDown={handleMoreKeyDown}
                  role="button"
                  tabIndex={0}
                >
                  More
                </summary>
                <div
                  ref={moreMenuRef}
                  aria-labelledby={moreTriggerId}
                  className="onboarding-shell__more-menu"
                  id={moreMenuId}
                  onKeyDown={handleMenuKeyDown}
                  role="menu"
                  tabIndex={-1}
                >
                  {onSaveForLater
                    ? (
                        <button role="menuitem" tabIndex={0} type="button" onClick={() => runMoreAction(onSaveForLater)}>
                          Save and finish later
                        </button>
                      )
                    : null}
                  {onRestart
                    ? (
                        <button role="menuitem" tabIndex={onSaveForLater ? -1 : 0} type="button" onClick={() => runMoreAction(onRestart)}>
                          Start over
                        </button>
                      )
                    : null}
                  {onLabOptions
                    ? (
                        <button role="menuitem" tabIndex={onSaveForLater || onRestart ? -1 : 0} type="button" onClick={() => runMoreAction(onLabOptions)}>
                          Lab review options
                        </button>
                      )
                    : null}
                </div>
              </details>
            )
          : null}
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
