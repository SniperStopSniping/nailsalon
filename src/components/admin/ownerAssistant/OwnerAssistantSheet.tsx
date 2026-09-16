'use client';

/**
 * Owner Assistant chat (A1-1) — the bottom sheet.
 *
 * Presentation only: every fact on screen was produced by the server. Assistant
 * text is rendered as text with its line breaks preserved (never as markup),
 * link chips navigate to hrefs the server built from the navigation registry,
 * and the "Checked:" line repeats the tool labels the server reported for that
 * turn. See docs/OWNER_ASSISTANT_CHAT.md §3 and §7.
 */
import { useReducedMotion } from 'framer-motion';
import { RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import { OWNER_ASSISTANT_LIMITS } from '@/libs/ownerAssistant/contracts';
import { cn } from '@/utils/Helpers';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import type { UiMessage } from './ownerAssistantStorage';
import type { OwnerAssistantBanner } from './useOwnerAssistant';

const CHIP_CLASS_NAME
  = 'inline-flex min-h-11 items-center rounded-full border border-[var(--owner-line-strong)] bg-[var(--owner-surface)] px-4 py-2 text-left text-sm font-medium text-[var(--owner-ink)] transition-all duration-200 hover:border-[var(--owner-accent)] hover:text-[var(--owner-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] motion-reduce:transition-none';

export type OwnerAssistantSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  salonName: string;
  messages: UiMessage[];
  busy: boolean;
  banner: OwnerAssistantBanner | null;
  notice: string | null;
  suggestedQuestions: string[];
  /** Text handed back after a turn that could not be delivered; see the hook. */
  draftToRestore: string | null;
  onSend: (message: string) => void;
  onRetry: () => void;
  onReset: () => void;
  onDraftRestored: () => void;
};

export function OwnerAssistantSheet({
  isOpen,
  onClose,
  salonName,
  messages,
  busy,
  banner,
  notice,
  suggestedQuestions,
  draftToRestore,
  onSend,
  onRetry,
  onReset,
  onDraftRestored,
}: OwnerAssistantSheetProps) {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const titleId = useId();
  const disclosureId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [entered, setEntered] = useState(false);
  const wasBusyRef = useRef(false);

  // The repo's mount-transition pattern (docs/AI_RULES.md §3.5): the first
  // commit paints the sheet low and transparent, the effect commit slides it in.
  useEffect(() => {
    setEntered(isOpen);
  }, [isOpen]);

  useEffect(() => {
    const anchor = threadEndRef.current;
    // jsdom does not implement scrollIntoView; the thread simply stays put.
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ block: 'end', behavior: shouldReduceMotion ? 'auto' : 'smooth' });
    }
  }, [messages, busy, shouldReduceMotion]);

  // The composer stays focusable for the whole turn (it goes read-only, never
  // disabled), but the Send button does get disabled and the browser drops focus
  // off a disabled control. Put the caret back where the owner left it as soon
  // as the turn ends.
  useEffect(() => {
    const wasBusy = wasBusyRef.current;
    wasBusyRef.current = busy;
    if (wasBusy && !busy && isOpen) {
      textareaRef.current?.focus();
    }
  }, [busy, isOpen]);

  // A turn that could not be delivered gives the owner their text back rather
  // than losing it with the refused conversation.
  useEffect(() => {
    if (draftToRestore === null) {
      return;
    }
    setDraft(draftToRestore);
    onDraftRestored();
    textareaRef.current?.focus();
  }, [draftToRestore, onDraftRestored]);

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || busy) {
        return;
      }
      setDraft('');
      onSend(trimmed);
    },
    [busy, onSend],
  );

  const followChip = useCallback(
    (text: string) => {
      // Follow-ups and suggestions fill the composer and send in one action, so
      // the owner can see what was asked on their behalf.
      setDraft(text);
      submit(text);
    },
    [submit],
  );

  const openLink = useCallback(
    (href: string) => {
      // Defence in depth: the server builds hrefs from the navigation
      // registry, but the sheet still refuses anything that is not a
      // same-origin relative path (no protocol, no protocol-relative form).
      if (!href.startsWith('/') || href.startsWith('//')) {
        return;
      }
      // Close first so focus is returned to the launcher before the route
      // changes: navigating out of an open dialog leaves focus on a node that
      // is about to be unmounted.
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  return (
    <DialogShell
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      contentClassName={cn(
        'flex max-h-[calc(100dvh-1rem-env(safe-area-inset-bottom,0px))] min-h-0 flex-col overflow-hidden rounded-t-2xl bg-[var(--owner-surface)] shadow-2xl transition-all duration-200 sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl motion-reduce:transition-none',
        entered || shouldReduceMotion ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
      contentTestId="owner-assistant-sheet"
      initialFocusRef={textareaRef}
      isOpen={isOpen}
      maxWidthClassName="max-w-lg"
      onClose={onClose}
      overlayTestId="owner-assistant-overlay"
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex min-h-0 flex-1 flex-col"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--owner-line)] px-4 pb-3 pt-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="owner-title text-lg font-semibold text-[var(--owner-ink)]" id={titleId}>
              {ownerAssistantCopy.title}
            </h2>
            <p className="truncate text-sm text-[var(--owner-muted)]">{salonName}</p>
          </div>
          <button
            aria-label={ownerAssistantCopy.close}
            className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-muted)] transition-colors duration-200 hover:text-[var(--owner-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] motion-reduce:transition-none"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <p
          className="border-b border-[var(--owner-line)] px-4 py-2 text-xs text-[var(--owner-muted)] sm:px-5"
          data-testid="owner-assistant-disclosure"
          id={disclosureId}
        >
          {ownerAssistantCopy.disclosure}
        </p>

        {/*
          The thread itself is the polite live region: a separate sr-only copy of
          the latest answer made screen readers read every answer twice.
        */}
        <div
          aria-label={ownerAssistantCopy.threadLabel}
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:px-5"
          data-testid="owner-assistant-thread"
          role="group"
        >
          {messages.length === 0 && (
            <div className="flex flex-col gap-3" data-testid="owner-assistant-empty-state">
              <div className="flex items-center gap-2 text-[var(--owner-accent)]">
                <Sparkles aria-hidden="true" size={18} />
                <p className="text-sm font-semibold">{ownerAssistantCopy.emptyStateTitle}</p>
              </div>
              <p className="text-sm text-[var(--owner-muted)]">{ownerAssistantCopy.emptyStateBody}</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                {ownerAssistantCopy.suggestedQuestionsLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestedQuestions.map(question => (
                  <button
                    className={CHIP_CLASS_NAME}
                    disabled={busy}
                    key={question}
                    onClick={() => followChip(question)}
                    type="button"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(message => (
            <div
              className={cn('flex flex-col gap-2', message.role === 'owner' ? 'items-end' : 'items-start')}
              data-role={message.role}
              data-testid="owner-assistant-message"
              key={message.id}
            >
              <p className="sr-only">
                {message.role === 'owner'
                  ? ownerAssistantCopy.ownerMessageLabel
                  : ownerAssistantCopy.assistantMessageLabel}
              </p>
              <p
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
                  message.role === 'owner'
                    ? 'bg-[var(--owner-accent)] text-white'
                    : 'border border-[var(--owner-line)] bg-[var(--owner-ground)] text-[var(--owner-ink)]',
                )}
              >
                {message.text}
              </p>

              {message.role === 'owner' && message.unanswered === true && (
                <p
                  className="text-xs text-[var(--owner-muted)]"
                  data-testid="owner-assistant-unanswered"
                >
                  {ownerAssistantCopy.notAnswered}
                </p>
              )}

              {message.role === 'assistant' && message.checked && message.checked.length > 0 && (
                <p
                  className="text-xs text-[var(--owner-muted)]"
                  data-testid="owner-assistant-checked"
                >
                  {`${ownerAssistantCopy.checkedPrefix} ${message.checked.map(item => item.label).join(', ')}`}
                </p>
              )}

              {message.role === 'assistant' && message.links && message.links.length > 0 && (
                <div className="flex flex-wrap gap-2" data-testid="owner-assistant-links">
                  {message.links.map(link => (
                    <button
                      className={CHIP_CLASS_NAME}
                      key={link.key}
                      onClick={() => openLink(link.href)}
                      type="button"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              )}

              {message.role === 'assistant' && message.followUps && message.followUps.length > 0 && (
                <div className="flex flex-col gap-2" data-testid="owner-assistant-follow-ups">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                    {ownerAssistantCopy.followUpsLabel}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {message.followUps.map(followUp => (
                      <button
                        className={CHIP_CLASS_NAME}
                        disabled={busy}
                        key={followUp}
                        onClick={() => followChip(followUp)}
                        type="button"
                      >
                        {followUp}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {busy && (
            <p
              className="text-sm text-[var(--owner-muted)]"
              data-testid="owner-assistant-busy"
              role="status"
            >
              {ownerAssistantCopy.busy}
            </p>
          )}

          {notice && (
            <p
              className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-ground)] px-3 py-2 text-sm text-[var(--owner-ink)]"
              data-testid="owner-assistant-notice"
              role="status"
            >
              {notice}
            </p>
          )}

          {banner && (
            <div
              className="flex flex-col gap-2 rounded-xl border border-[var(--owner-line-strong)] bg-[var(--owner-blush)] px-3 py-2.5"
              data-testid="owner-assistant-banner"
              role="status"
            >
              <p className="text-sm text-[var(--owner-ink)]">{banner.message}</p>
              {banner.retryable && (
                <div>
                  <Button
                    className="min-h-11 px-4"
                    disabled={busy}
                    onClick={onRetry}
                    type="button"
                    variant="ownerSecondary"
                  >
                    <RotateCcw aria-hidden="true" className="mr-2" size={16} />
                    {ownerAssistantCopy.retry}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div ref={threadEndRef} />
        </div>

        <div
          className="border-t border-[var(--owner-line)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 sm:px-5"
          data-testid="owner-assistant-composer-bar"
        >
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="owner-assistant-composer">
              {ownerAssistantCopy.composerLabel}
            </label>
            <textarea
              aria-describedby={disclosureId}
              aria-disabled={busy}
              className="min-h-11 w-full flex-1 resize-none rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-ground)] px-3 py-2.5 text-sm text-[var(--owner-ink)] outline-none transition-colors duration-200 placeholder:text-[var(--owner-muted)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] aria-disabled:opacity-60 motion-reduce:transition-none"
              enterKeyHint="send"
              id="owner-assistant-composer"
              maxLength={OWNER_ASSISTANT_LIMITS.messageMaxChars}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              placeholder={ownerAssistantCopy.composerPlaceholder}
              readOnly={busy}
              ref={textareaRef}
              rows={2}
              value={draft}
            />
            <Button
              aria-label={ownerAssistantCopy.send}
              className="size-11 shrink-0 p-0"
              disabled={busy || draft.trim().length === 0}
              onClick={() => submit(draft)}
              type="button"
              variant="ownerPrimary"
            >
              <Send aria-hidden="true" size={18} />
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--owner-muted)]">{ownerAssistantCopy.composerHint}</p>
            <p
              className="text-xs tabular-nums text-[var(--owner-muted)]"
              data-testid="owner-assistant-counter"
            >
              <span className="sr-only">{`${ownerAssistantCopy.counterLabel}: `}</span>
              {`${draft.length}/${OWNER_ASSISTANT_LIMITS.messageMaxChars}`}
            </p>
          </div>

          <div className="mt-2">
            <button
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-[var(--owner-accent)] transition-colors duration-200 hover:text-[var(--owner-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-60 motion-reduce:transition-none"
              disabled={busy}
              onClick={() => {
                setDraft('');
                onReset();
              }}
              type="button"
            >
              {ownerAssistantCopy.newConversation}
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
