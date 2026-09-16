'use client';

/**
 * Owner Assistant chat (A1-1) — the launcher pill and its sheet.
 *
 * Renders nothing at all until `GET /api/admin/owner-assistant/context`
 * answers 200. A 404 (dark globally, salon not entitled) and a 403 (not a real
 * owner) are silent: no disabled control, no empty state, nothing that would
 * tell one salon that another salon has a feature it does not
 * (docs/OWNER_ASSISTANT_CHAT.md §3.1, §7).
 */
import { MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/utils/Helpers';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import { OwnerAssistantSheet } from './OwnerAssistantSheet';
import { useOwnerAssistant } from './useOwnerAssistant';
import { useOwnerAssistantFeedback } from './useOwnerAssistantFeedback';

/**
 * Where the pill sits above the bottom edge.
 *
 * `workspace` is for screens that mount `OwnerWorkspaceNav`, which is
 * `fixed inset-x-0 bottom-0` at *every* width and is never hidden: the pill has
 * to clear the whole bar (~64 px plus its safe-area padding) or it covers the
 * fifth tab. `standalone` is for owner screens without that bar — the booking
 * page editor — where the same offset would leave the pill floating.
 */
const PLACEMENT_BOTTOM_CLASS = {
  workspace: 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))]',
  standalone: 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))]',
} as const;

export type OwnerAssistantPlacement = keyof typeof PLACEMENT_BOTTOM_CLASS;

export type OwnerAssistantLauncherProps = {
  locale: 'en' | 'fr';
  salonSlug: string | null;
  /** Bottom offset preset; see `PLACEMENT_BOTTOM_CLASS`. */
  placement?: OwnerAssistantPlacement;
  /**
   * Which owner screen mounted the launcher. Presentational/telemetry only: the
   * chat request schema is `.strict()`, so this is never sent to the server.
   */
  screen?: string;
};

export default function OwnerAssistantLauncher({
  locale,
  salonSlug,
  placement = 'workspace',
  screen,
}: OwnerAssistantLauncherProps) {
  const assistant = useOwnerAssistant({ locale, salonSlug });
  // Feedback lives beside the conversation, not inside it: a rating must never
  // be able to change the thread, and a failed rating must never be able to
  // interrupt it.
  const feedback = useOwnerAssistantFeedback({
    conversation: assistant.conversation,
    salonSlug,
  });
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const closeSheet = useCallback(() => {
    setOpen(false);
    // Return focus explicitly so a keyboard-only close lands back on the pill
    // rather than on the document body.
    launcherRef.current?.focus();
  }, []);

  // A salon switch empties the thread under the owner's eyes, so the sheet must
  // not stay open onto another salon's assistant. Closing here (rather than
  // re-opening it, or focusing anything) keeps the switch itself silent.
  useEffect(() => {
    setOpen(false);
  }, [salonSlug]);

  const { context } = assistant;
  if (!context) {
    return null;
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ownerAssistantCopy.launcherAriaLabel}
        className={cn(
          'fixed right-4 z-40 flex min-h-11 items-center gap-2 rounded-full bg-[var(--owner-accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg outline-none transition-all duration-200 hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2 active:scale-[0.97] motion-reduce:transition-none sm:right-6',
          PLACEMENT_BOTTOM_CLASS[placement],
        )}
        data-owner-assistant-placement={placement}
        data-owner-assistant-screen={screen}
        data-testid="owner-assistant-launcher"
        onClick={() => setOpen(true)}
        ref={launcherRef}
        type="button"
      >
        <MessageCircle aria-hidden="true" size={18} />
        <span>{ownerAssistantCopy.launcher}</span>
      </button>

      <OwnerAssistantSheet
        banner={assistant.banner}
        busy={assistant.busy}
        draftToRestore={assistant.draftToRestore}
        feedback={feedback}
        isOpen={open}
        messages={assistant.messages}
        notice={assistant.notice}
        onClose={closeSheet}
        onDraftRestored={assistant.clearDraftToRestore}
        onReset={assistant.reset}
        onRetry={assistant.retry}
        onSend={assistant.send}
        salonName={context.salonName}
        suggestedQuestions={assistant.suggestedQuestions}
      />
    </>
  );
}
