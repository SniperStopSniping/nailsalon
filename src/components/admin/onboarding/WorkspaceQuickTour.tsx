'use client';

import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type WorkspaceTourTarget =
  | 'today'
  | 'calendar'
  | 'clients'
  | 'services'
  | 'website';

const TOUR_STEPS: ReadonlyArray<{
  body: string;
  target: WorkspaceTourTarget;
  title: string;
}> = [
  {
    body: 'See today’s appointments, reminders and the actions you use most.',
    target: 'today',
    title: 'Your day at a glance',
  },
  {
    body: 'Open your real calendar to manage availability and appointments.',
    target: 'calendar',
    title: 'Your calendar',
  },
  {
    body: 'Keep client details and visit history together in your workspace.',
    target: 'clients',
    title: 'Your clients',
  },
  {
    body: 'Update the service menu that clients see when they book.',
    target: 'services',
    title: 'Your services',
  },
  {
    body: 'Preview the saved website or return to setup without opening a placeholder editor.',
    target: 'website',
    title: 'Your website and booking page',
  },
];

export function WorkspaceQuickTour({
  onClose,
  onComplete,
  onTargetChange,
  open,
}: {
  onClose: () => void;
  onComplete: () => void;
  onTargetChange: (target: WorkspaceTourTarget) => void;
  open: boolean;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    priorFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setStepIndex(0);
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      priorFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    onTargetChange(TOUR_STEPS[stepIndex]!.target);
  }, [onTargetChange, open, stepIndex]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const current = TOUR_STEPS[stepIndex]!;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const closeTour = () => {
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pb-24 pt-[calc(env(safe-area-inset-top,0px)+5rem)]"
      data-testid="workspace-quick-tour"
    >
      <button
        aria-label="Close tour"
        className="absolute inset-0 size-full cursor-default bg-stone-950/20 backdrop-blur-[1px]"
        onClick={closeTour}
        type="button"
      />
      <div
        ref={dialogRef}
        aria-describedby="workspace-tour-description"
        aria-labelledby="workspace-tour-title"
        aria-modal="true"
        className="owner-surface relative w-full max-w-sm rounded-[28px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 text-[var(--owner-ink)] shadow-2xl motion-safe:animate-[fadeIn_180ms_ease-out]"
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--owner-accent)]">
              Quick tour ·
              {' '}
              {stepIndex + 1}
              {' '}
              of
              {' '}
              {TOUR_STEPS.length}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight" id="workspace-tour-title">
              {current.title}
            </h2>
          </div>
          <button
            aria-label="Skip tour"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-muted)] transition-colors hover:bg-[var(--owner-ground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
            onClick={closeTour}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <p className="mt-3 text-[15px] leading-6 text-[var(--owner-muted)]" id="workspace-tour-description">
          {current.body}
        </p>

        <div aria-label="Tour progress" className="mt-5 flex gap-2">
          {TOUR_STEPS.map((step, index) => (
            <span
              key={step.target}
              aria-current={index === stepIndex ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? 'bg-[var(--owner-accent)]' : 'bg-[var(--owner-line)]'}`}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          {stepIndex > 0
            ? (
                <button
                  className="flex min-h-11 items-center justify-center gap-1 rounded-full border border-[var(--owner-line)] px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                  onClick={() => setStepIndex(index => Math.max(0, index - 1))}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={17} />
                  Back
                </button>
              )
            : (
                <button
                  className="min-h-11 px-2 text-sm font-semibold text-[var(--owner-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                  onClick={closeTour}
                  type="button"
                >
                  Skip tour
                </button>
              )}
          <button
            className="ml-auto flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--owner-accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2"
            onClick={() => {
              if (isLast) {
                onComplete();
                return;
              }
              setStepIndex(index => Math.min(TOUR_STEPS.length - 1, index + 1));
            }}
            type="button"
          >
            {isLast
              ? (
                  <>
                    <Check aria-hidden="true" size={17} />
                    {' '}
                    Done
                  </>
                )
              : (
                  <>
                    Next
                    <ChevronRight aria-hidden="true" size={17} />
                  </>
                )}
          </button>
        </div>
      </div>
    </div>
  );
}
