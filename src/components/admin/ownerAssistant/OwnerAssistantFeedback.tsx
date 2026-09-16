'use client';

/**
 * Owner Assistant feedback (A1-4b) — the per-answer rating control and the
 * inline report form.
 *
 * Presentation only; `useOwnerAssistantFeedback` owns every request and every
 * state transition. Two product rules are enforced here rather than described:
 * a failure is inline and non-blocking (a small "Not sent · Retry" line, never
 * a banner and never a dialog), and the report form states exactly what leaves
 * the browser before the owner can send anything.
 */
import { Flag, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useId, useState } from 'react';

import { OWNER_ASSISTANT_FEEDBACK_LIMITS } from '@/libs/ownerAssistant/contracts';
import { cn } from '@/utils/Helpers';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import type { UiMessage } from './ownerAssistantStorage';
import type { OwnerAssistantFeedbackState, OwnerAssistantRating } from './useOwnerAssistantFeedback';

/** 44 px minimum on every target (`size-11` = 2.75rem), keyboard reachable. */
const ICON_BUTTON_CLASS_NAME
  = 'flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-muted)] transition-colors duration-200 hover:border-[var(--owner-accent)] hover:text-[var(--owner-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-60 motion-reduce:transition-none';

const SELECTED_CLASS_NAME
  = 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent)]';

const TEXT_BUTTON_CLASS_NAME
  = 'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-[var(--owner-muted)] transition-colors duration-200 hover:text-[var(--owner-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-60 motion-reduce:transition-none';

export type OwnerAssistantFeedbackControlsProps = {
  message: UiMessage;
  feedback: OwnerAssistantFeedbackState;
};

export function OwnerAssistantFeedbackControls({
  message,
  feedback,
}: OwnerAssistantFeedbackControlsProps) {
  const entry = feedback.entryFor(message.id);
  const groupId = useId();
  const noteId = useId();
  const textareaId = useId();
  const [draft, setDraft] = useState('');

  const ratingButton = (kind: OwnerAssistantRating, label: string, Icon: typeof ThumbsUp) => (
    <button
      aria-label={label}
      aria-pressed={entry.selected === kind}
      className={cn(ICON_BUTTON_CLASS_NAME, entry.selected === kind && SELECTED_CLASS_NAME)}
      data-testid={`owner-assistant-rate-${kind}`}
      onClick={() => feedback.rate(message, kind)}
      type="button"
    >
      <Icon aria-hidden="true" size={16} />
    </button>
  );

  return (
    <div className="flex w-full flex-col gap-1.5" data-testid="owner-assistant-feedback">
      <div className="flex flex-wrap items-center gap-1">
        <span className="pr-1 text-xs text-[var(--owner-muted)]" id={groupId}>
          {ownerAssistantCopy.feedbackGroupLabel}
        </span>
        <div aria-labelledby={groupId} className="flex items-center gap-1" role="group">
          {ratingButton('up', ownerAssistantCopy.feedbackUp, ThumbsUp)}
          {ratingButton('down', ownerAssistantCopy.feedbackDown, ThumbsDown)}
        </div>
        <button
          className={TEXT_BUTTON_CLASS_NAME}
          data-testid="owner-assistant-report-open"
          onClick={() => feedback.openReport(message.id)}
          type="button"
        >
          <Flag aria-hidden="true" size={14} />
          {ownerAssistantCopy.reportOpen}
        </button>
      </div>

      {entry.acknowledged && !entry.failed && (
        <p className="text-xs text-[var(--owner-muted)]" data-testid="owner-assistant-feedback-thanks" role="status">
          {ownerAssistantCopy.feedbackThanks}
        </p>
      )}

      {/*
        Silent-but-honest: the rating did not reach the server, the control says
        so where it happened, and the conversation is untouched. Retry re-sends
        the SAME feedbackId, so a double send cannot double-count.
      */}
      {entry.failed && (
        <p
          className="flex flex-wrap items-center gap-1 text-xs text-[var(--owner-muted)]"
          data-testid="owner-assistant-feedback-failed"
          role="status"
        >
          {ownerAssistantCopy.feedbackFailed}
          <button
            className={TEXT_BUTTON_CLASS_NAME}
            data-testid="owner-assistant-feedback-retry"
            onClick={() => feedback.retryRating(message)}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} />
            {ownerAssistantCopy.feedbackRetry}
          </button>
        </p>
      )}

      {entry.reportSent && !entry.reportOpen && (
        <p className="text-xs text-[var(--owner-muted)]" data-testid="owner-assistant-report-sent" role="status">
          {ownerAssistantCopy.reportSent}
        </p>
      )}

      {entry.reportOpen && (
        <form
          aria-label={ownerAssistantCopy.reportTitle}
          className="flex flex-col gap-2 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-ground)] p-3"
          data-testid="owner-assistant-report-form"
          onSubmit={(event) => {
            event.preventDefault();
            feedback.sendReport(message, draft);
          }}
        >
          <label className="text-xs font-semibold text-[var(--owner-ink)]" htmlFor={textareaId}>
            {ownerAssistantCopy.reportLabel}
          </label>
          <textarea
            aria-describedby={noteId}
            className="min-h-11 w-full resize-none rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3 py-2 text-sm text-[var(--owner-ink)] outline-none transition-colors duration-200 placeholder:text-[var(--owner-muted)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] motion-reduce:transition-none"
            id={textareaId}
            maxLength={OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Escape closes the form, not the whole sheet: it should undo the
              // smallest thing that is open, and the sheet's own Escape handler
              // would otherwise take the owner's half-written note with it.
              if (event.key === 'Escape') {
                event.stopPropagation();
                feedback.closeReport(message.id);
              }
            }}
            placeholder={ownerAssistantCopy.reportPlaceholder}
            rows={3}
            value={draft}
          />

          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-[var(--owner-muted)]" id={noteId}>
              {ownerAssistantCopy.reportNote}
            </p>
            <p
              className="shrink-0 text-xs tabular-nums text-[var(--owner-muted)]"
              data-testid="owner-assistant-report-counter"
            >
              <span className="sr-only">{`${ownerAssistantCopy.reportCounterLabel}: `}</span>
              {`${draft.length}/${OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars}`}
            </p>
          </div>

          {entry.reportFailed && (
            <p className="text-xs text-[var(--owner-muted)]" data-testid="owner-assistant-report-failed" role="status">
              {ownerAssistantCopy.reportFailed}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex min-h-11 items-center rounded-full bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[var(--owner-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-60 motion-reduce:transition-none"
              data-testid="owner-assistant-report-send"
              disabled={entry.reportSending || draft.trim().length === 0}
              type="submit"
            >
              {entry.reportFailed ? ownerAssistantCopy.feedbackRetry : ownerAssistantCopy.reportSend}
            </button>
            <button
              className={TEXT_BUTTON_CLASS_NAME}
              data-testid="owner-assistant-report-cancel"
              onClick={() => feedback.closeReport(message.id)}
              type="button"
            >
              {ownerAssistantCopy.reportCancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
