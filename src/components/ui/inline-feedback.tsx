'use client';

/**
 * InlineFeedback — the Workspace's single answer to "did that work?".
 *
 * The audit found the same defect in three places: a refused write reports
 * itself somewhere the owner is not looking (AG-w2-calendar-writes-04), a
 * failure is wiped by the refresh that follows it (AG-w2-more-tools-02), and a
 * success is announced before the server has agreed (the "success appears only
 * after confirmation" rule). This primitive fixes the placement contract once:
 *
 * - it renders **where the owner acted** (put it next to the action, typically
 *   in the sticky footer beside the button),
 * - an error is `role="alert"`, is scrolled into view and takes focus, and
 *   stays until it is dismissed or replaced,
 * - a success/info is `role="status"` (polite) and never steals focus,
 * - `useActionFeedback()` only shows success once the promise it ran resolved.
 *
 * Visual system: the Workspace's Luster palette (plum family for info, warm
 * neutrals), compact enough for daily work — one line of chrome, not a card.
 */

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { cn } from '@/utils/Helpers';

export type InlineFeedbackTone = 'success' | 'error' | 'info';

export type InlineFeedbackProps = {
  'tone': InlineFeedbackTone;
  /** The sentence the owner reads. Say what happened, in their words. */
  'message': string;
  /** Optional second line — e.g. "Attempted time: Wed, Sep 9, 1:00 PM". */
  'detail'?: ReactNode;
  /** Optional recovery control (a "Try again" button, a link). */
  'action'?: ReactNode;
  /** When provided the notice can be dismissed by the owner. */
  'onDismiss'?: () => void;
  'dismissLabel'?: string;
  'className'?: string;
  'data-testid'?: string;
};

const toneClasses: Record<InlineFeedbackTone, string> = {
  // Semantic red for refusals (matches the appointment sheet and the rest of
  // the Workspace); never the iOS system palette.
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  // Luster plum family (--owner-blush / --owner-accent-strong).
  info: 'border-[#e6ccd6] bg-[#f9e9ed] text-[#70233f]',
};

const dismissToneClasses: Record<InlineFeedbackTone, string> = {
  error: 'text-red-700 hover:bg-red-100',
  success: 'text-emerald-800 hover:bg-emerald-100',
  info: 'text-[#70233f] hover:bg-[#f2dbe3]',
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function InlineFeedback({
  tone,
  message,
  detail,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  'data-testid': dataTestId,
}: InlineFeedbackProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  // A refusal is only feedback if the owner can see it: bring it into view and
  // put the caret on it, so keyboard and screen-reader users land on the
  // reason instead of a form that looks like it saved.
  useEffect(() => {
    if (tone !== 'error') {
      return;
    }
    const node = nodeRef.current;
    if (!node) {
      return;
    }
    node.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
    node.focus?.({ preventScroll: true });
  }, [tone, message, detail]);

  const isError = tone === 'error';

  return (
    <div
      ref={nodeRef}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? undefined : 'polite'}
      tabIndex={isError ? -1 : undefined}
      data-testid={dataTestId ?? 'inline-feedback'}
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-3 py-2.5 text-[13px] leading-5 outline-none',
        toneClasses[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>
        {detail ? <div className="mt-0.5 opacity-90">{detail}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      {onDismiss
        ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={dismissLabel}
              data-testid={`${dataTestId ?? 'inline-feedback'}-dismiss`}
              className={cn(
                '-my-1.5 -mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors',
                dismissToneClasses[tone],
              )}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )
        : null}
    </div>
  );
}
