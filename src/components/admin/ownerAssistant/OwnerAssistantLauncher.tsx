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
import { useCallback, useRef, useState } from 'react';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import { OwnerAssistantSheet } from './OwnerAssistantSheet';
import { useOwnerAssistant } from './useOwnerAssistant';

export type OwnerAssistantLauncherProps = {
  locale: 'en' | 'fr';
  salonSlug: string | null;
  /**
   * Which owner screen mounted the launcher. Presentational/telemetry only: the
   * chat request schema is `.strict()`, so this is never sent to the server.
   */
  screen?: string;
};

export default function OwnerAssistantLauncher({
  locale,
  salonSlug,
  screen,
}: OwnerAssistantLauncherProps) {
  const assistant = useOwnerAssistant({ locale, salonSlug });
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const closeSheet = useCallback(() => {
    setOpen(false);
    // Return focus explicitly so a keyboard-only close lands back on the pill
    // rather than on the document body.
    launcherRef.current?.focus();
  }, []);

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
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex min-h-11 items-center gap-2 rounded-full bg-[var(--owner-accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg outline-none transition-all duration-200 hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2 active:scale-[0.97] motion-reduce:transition-none sm:bottom-6 sm:right-6"
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
        isOpen={open}
        messages={assistant.messages}
        notice={assistant.notice}
        onClose={closeSheet}
        onReset={assistant.reset}
        onRetry={assistant.retry}
        onSend={assistant.send}
        salonName={context.salonName}
        suggestedQuestions={assistant.suggestedQuestions}
      />
    </>
  );
}
