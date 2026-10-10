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
import { ArrowUp, ArrowUpRight, LoaderCircle, MessageSquarePlus, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import { OWNER_ASSISTANT_LIMITS } from '@/libs/ownerAssistant/contracts';
import { humanizeNavigationText } from '@/libs/ownerAssistant/navigationText';
import { cn } from '@/utils/Helpers';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import { OwnerAssistantFeedbackControls } from './OwnerAssistantFeedback';
import type { UiMessage } from './ownerAssistantStorage';
import type { OwnerAssistantBanner } from './useOwnerAssistant';
import type { OwnerAssistantFeedbackState } from './useOwnerAssistantFeedback';

const CHIP_CLASS_NAME
  = 'inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3.5 py-2.5 text-left text-sm font-medium leading-relaxed text-[var(--owner-accent)] transition-colors duration-200 hover:border-[var(--owner-accent)] hover:bg-[var(--owner-blush)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-60 motion-reduce:transition-none';

export type OwnerAssistantSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  salonName: string;
  messages: UiMessage[];
  busy: boolean;
  banner: OwnerAssistantBanner | null;
  notice: string | null;
  suggestedQuestions: string[];
  /** Rating and report state, keyed by message id (A1-4b). */
  feedback: OwnerAssistantFeedbackState;
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
  feedback,
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

  // A deferred sheet first mounts before DialogShell creates its portal. The
  // callback also scrolls when the anchor arrives, so restored history opens
  // at the newest message even when the initial effect had no DOM to scroll.
  const scrollThreadToEnd = useCallback((anchor: HTMLDivElement | null) => {
    threadEndRef.current = anchor;
    // jsdom does not implement scrollIntoView; the thread simply stays put.
    if (isOpen && anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ block: 'end', behavior: shouldReduceMotion ? 'auto' : 'smooth' });
    }
  }, [isOpen, shouldReduceMotion]);

  useEffect(() => {
    scrollThreadToEnd(threadEndRef.current);
  }, [messages, busy, scrollThreadToEnd]);

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
        'flex h-[min(48rem,calc(100dvh-0.75rem))] min-h-0 flex-col overflow-hidden rounded-t-[28px] border border-[var(--owner-line)] bg-[var(--owner-surface)] shadow-2xl transition-all duration-200 sm:h-[min(48rem,calc(100dvh-2rem))] sm:rounded-[28px] motion-reduce:transition-none',
        entered || shouldReduceMotion ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
      contentTestId="owner-assistant-sheet"
      initialFocusRef={textareaRef}
      isOpen={isOpen}
      maxWidthClassName="max-w-lg"
      onClose={onClose}
      overlayTestId="owner-assistant-overlay"
      overlayClassName="bg-[#3b192b]/30"
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex min-h-0 flex-1 flex-col"
        role="dialog"
      >
        <header className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-5 sm:px-5">
          <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-blush)] text-[var(--owner-accent)]">
            <Sparkles size={22} strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--owner-accent)]">{ownerAssistantCopy.brand}</p>
            <h2 className="owner-title text-[28px] leading-tight text-[var(--owner-ink)]" id={titleId}>
              {ownerAssistantCopy.title}
            </h2>
            <p className="truncate text-xs text-[var(--owner-muted)]" title={salonName}>{salonName}</p>
          </div>
          <button
            aria-label={ownerAssistantCopy.newConversation}
            title={ownerAssistantCopy.newConversation}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-accent)] transition-colors hover:bg-[var(--owner-blush)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-40 motion-reduce:transition-none"
            disabled={busy}
            onClick={() => {
              setDraft('');
              onReset();
            }}
            type="button"
          >
            <MessageSquarePlus aria-hidden="true" size={20} strokeWidth={1.75} />
          </button>
          <button
            aria-label={ownerAssistantCopy.close}
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-muted)] transition-colors duration-200 hover:bg-[var(--owner-blush)] hover:text-[var(--owner-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] motion-reduce:transition-none"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <p
          className="flex shrink-0 items-start gap-2 border-b border-[var(--owner-line)] px-4 pb-3 text-xs leading-relaxed text-[var(--owner-muted)] sm:px-5"
          data-testid="owner-assistant-disclosure"
          id={disclosureId}
        >
          <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--owner-accent)]" size={14} />
          <span>{ownerAssistantCopy.disclosure}</span>
        </p>

        {/*
          The thread itself is the polite live region: a separate sr-only copy of
          the latest answer made screen readers read every answer twice.
        */}
        <div
          aria-label={ownerAssistantCopy.threadLabel}
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain bg-[var(--owner-ground)] px-4 py-5 sm:px-5"
          data-testid="owner-assistant-thread"
          role="group"
        >
          {messages.length === 0 && (
            <div className="flex flex-col gap-4 py-2" data-testid="owner-assistant-empty-state">
              <div className="space-y-2">
                <h3 className="owner-title max-w-60 text-[30px] leading-[1.12] text-[var(--owner-ink)]">{ownerAssistantCopy.emptyStateTitle}</h3>
                <p className="max-w-sm text-sm leading-relaxed text-[var(--owner-muted)]">{ownerAssistantCopy.emptyStateBody}</p>
              </div>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--owner-muted)]">
                {ownerAssistantCopy.suggestedQuestionsLabel}
              </p>
              <div className="flex flex-col gap-2">
                {suggestedQuestions.map(question => (
                  <button
                    className={cn(CHIP_CLASS_NAME, 'justify-between')}
                    disabled={busy}
                    key={question}
                    onClick={() => followChip(question)}
                    type="button"
                  >
                    <span>{question}</span>
                    <ArrowUpRight aria-hidden="true" className="shrink-0" size={16} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(message => (
            <div
              className={cn('flex shrink-0 flex-col gap-2', message.role === 'owner' ? 'items-end' : 'items-start')}
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
                  'max-w-[94%] whitespace-pre-wrap break-words rounded-[22px] px-4 py-3.5 text-[15px] leading-relaxed',
                  message.role === 'owner'
                    ? 'rounded-br-md bg-[var(--owner-accent)] text-white'
                    : 'rounded-bl-md border border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-ink)] shadow-[0_2px_8px_rgb(96_41_58_/_0.03)]',
                )}
              >
                {message.role === 'assistant' ? humanizeNavigationText(message.text, message.links ?? []) : message.text}
              </p>

              {message.role === 'owner' && message.unanswered === true && (
                <p
                  className="px-1 text-xs leading-relaxed text-[var(--owner-muted)]"
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
                      <ArrowUpRight aria-hidden="true" className="shrink-0" size={14} />
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

              {message.role === 'assistant' && (
                <OwnerAssistantFeedbackControls feedback={feedback} message={message} />
              )}
            </div>
          ))}

          {busy && (
            <p
              className="flex items-center gap-2 text-sm text-[var(--owner-muted)]"
              data-testid="owner-assistant-busy"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={16} />
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

          <div ref={scrollThreadToEnd} />
        </div>

        <div
          className="shrink-0 border-t border-[var(--owner-line)] bg-[var(--owner-surface)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 sm:px-5"
          data-testid="owner-assistant-composer-bar"
        >
          <div className="flex items-end gap-2 rounded-[24px] border border-[var(--owner-line-strong)] bg-[var(--owner-ground)] p-2 transition-shadow focus-within:ring-2 focus-within:ring-[var(--owner-focus)] motion-reduce:transition-none">
            <label className="sr-only" htmlFor="owner-assistant-composer">
              {ownerAssistantCopy.composerLabel}
            </label>
            <textarea
              aria-describedby={disclosureId}
              aria-disabled={busy}
              className="min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-base leading-6 text-[var(--owner-ink)] outline-none placeholder:text-[var(--owner-muted)] aria-disabled:opacity-60"
              enterKeyHint="send"
              id="owner-assistant-composer"
              maxLength={OWNER_ASSISTANT_LIMITS.messageMaxChars}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
              <ArrowUp aria-hidden="true" size={20} />
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-end gap-3 px-1 sm:justify-between">
            <p className="hidden text-xs text-[var(--owner-muted)] sm:block">{ownerAssistantCopy.composerHint}</p>
            <p
              className="text-xs tabular-nums text-[var(--owner-muted)]"
              data-testid="owner-assistant-counter"
            >
              <span className="sr-only">{`${ownerAssistantCopy.counterLabel}: `}</span>
              {`${draft.length}/${OWNER_ASSISTANT_LIMITS.messageMaxChars}`}
            </p>
          </div>

        </div>
      </div>
    </DialogShell>
  );
}
