'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type { RebookingPromptSettings } from '@/libs/rebookingPromptSettings';

export function ConfirmationRebookingCard({ settings, onBook }: {
  settings: RebookingPromptSettings;
  onBook: () => Promise<void>;
}) {
  const t = useTranslations('BookingConfirmation');
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function book() {
    if (opening.current) {
      return;
    }
    opening.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onBook();
    } catch {
      setFailed(true);
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  return (
    <section data-public-surface="confirmationRebookingPrompt" aria-label={t('next_visit_title')} className="min-w-0 rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] p-4 text-[var(--n5-ink-main)]">
      <h2 className="font-heading break-words text-lg font-semibold">{t('next_visit_title')}</h2>
      <p className="mt-2 text-sm text-[var(--n5-ink-muted)]">
        {t(settings.intervalWeeks === 1 ? 'next_visit_interval_one' : 'next_visit_interval', { weeks: settings.intervalWeeks })}
      </p>
      {settings.message && <p className="mt-2 whitespace-pre-line break-words text-sm [overflow-wrap:anywhere]">{settings.message}</p>}
      <button type="button" disabled={busy} onClick={() => void book()} className="mt-4 min-h-11 w-full whitespace-normal rounded-xl bg-[var(--n5-accent)] px-4 py-3 text-sm font-semibold text-[var(--n5-ink-inverse)] disabled:opacity-60">
        {t(busy ? 'next_visit_opening' : 'next_visit_action')}
      </button>
      {failed && <p role="alert" className="mt-2 text-sm text-red-700">{t('next_visit_error')}</p>}
    </section>
  );
}
