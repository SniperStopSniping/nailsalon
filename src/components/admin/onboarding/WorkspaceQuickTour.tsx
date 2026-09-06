'use client';

import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type WorkspaceTourTarget =
  | 'today'
  | 'calendar'
  | 'clients'
  | 'services'
  | 'website';

/**
 * Five steps, each naming the destination it has just opened underneath.
 *
 * `where` exists because the tour drives the real workspace rather than a
 * mock-up: the tab really does change behind the card, and the audit asked for
 * every step to be verifiable as "this landed". Naming the destination lets
 * the owner — and a test — tie the card to what is now on screen.
 */
const TOUR_STEPS: ReadonlyArray<{
  body: string;
  target: WorkspaceTourTarget;
  title: string;
  where: string;
}> = [
  {
    body: 'See today’s appointments, what needs attention and the actions you use most.',
    target: 'today',
    title: 'Your day at a glance',
    where: 'Today tab',
  },
  {
    body: 'Your calendar is open behind this card. Manage availability, move appointments and add time off there.',
    target: 'calendar',
    title: 'Your calendar',
    where: 'Calendar tab',
  },
  {
    body: 'Client details, contact preferences and visit history live together here.',
    target: 'clients',
    title: 'Your clients',
    where: 'Clients tab',
  },
  {
    body: 'Update the service menu, prices and durations clients see when they book.',
    target: 'services',
    title: 'Your services',
    where: 'Services tab',
  },
  {
    body: 'Your booking page lives in More. Open it to change layout, style and text, and to publish.',
    target: 'website',
    title: 'Your booking page',
    where: 'More → Booking Page',
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
    return () => {
      priorFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    onTargetChange(TOUR_STEPS[stepIndex]!.target);
  }, [onTargetChange, open, stepIndex]);

  /*
    Every step opens a real workspace surface underneath, and two of them
    (Clients, Services) are AppModal sheets that place their own initial focus
    when they mount. Without this the tour lost focus to the sheet behind it
    the moment the owner pressed Next. Re-claim it after the step's surface has
    settled, but only if focus actually left the card — never yank it away from
    something the owner is using inside the tour.
  */
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const claimFocus = () => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }
      if (document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) {
        return;
      }
      dialog.focus();
    };
    claimFocus();
    const settleTimer = window.setTimeout(claimFocus, 120);
    return () => window.clearTimeout(settleTimer);
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    /*
      The tour sits above whatever surface a step opened, so while it is open
      it owns the keyboard. The shared modal focus lifecycle
      (useModalFocusLifecycle) listens for keydown on `window` in the bubble
      phase and treats the most recently mounted sheet as the topmost surface —
      which, from step 3 onward, is the sheet *behind* this card. Listening in
      the capture phase on `document` and stopping propagation once handled
      keeps Escape closing the tour and Tab cycling inside it.
    */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      event.stopPropagation();
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
      const activeElement = document.activeElement;
      const focusIsInside = activeElement instanceof HTMLElement
        && dialogRef.current.contains(activeElement);
      if (!focusIsInside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
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
      /*
        The card normally sits under the workspace header. The last step is the
        exception: the tile it is describing is the first one in the More grid,
        so a top-anchored card covers exactly what it just scrolled into view.
        On that step the card moves to the bottom, above the tab bar.
      */
      className={`fixed inset-0 z-[100] flex justify-center px-4 ${
        current.target === 'website'
          ? 'items-end pb-[calc(env(safe-area-inset-bottom,0px)+7rem)] pt-24'
          : 'items-start pb-24 pt-[calc(env(safe-area-inset-top,0px)+5rem)]'
      }`}
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
            <p
              className="mt-2 inline-flex items-center rounded-full bg-[var(--owner-blush,#f6e7ec)] px-2.5 py-1 text-[12px] font-semibold text-[var(--owner-accent-strong,#70213f)]"
              data-testid="workspace-tour-where"
            >
              Now open:
              {' '}
              {current.where}
            </p>
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
