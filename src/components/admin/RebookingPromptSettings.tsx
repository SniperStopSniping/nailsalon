'use client';

import { ArrowLeft, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type RebookingPromptSettings as Settings,
  resolveRebookingPromptSettings,
} from '@/libs/rebookingPromptSettings';

type ResponsePayload = {
  data?: { settings?: Partial<Settings> };
  error?: { message?: string } | string;
  message?: string;
};

function messageFrom(
  payload: ResponsePayload | null,
  fallback: string,
): string {
  return typeof payload?.error === 'string'
    ? payload.error
    : payload?.error?.message || payload?.message || fallback;
}

export function RebookingPromptSettings({
  salonSlug,
  onClose,
}: {
  salonSlug: string;
  onClose?: () => void;
}) {
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const activeSalonSlug = useRef(salonSlug);
  const requestVersion = useRef(0);

  activeSalonSlug.current = salonSlug;
  const normalize = (value: Partial<Settings> | undefined) =>
    resolveRebookingPromptSettings({ rebookingPrompt: value });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setLoadError(null);
      setSaveError(null);
      setSaved(false);
      try {
        const response = await fetch(
          `/api/admin/rebooking-prompt?salonSlug=${encodeURIComponent(salonSlug)}`,
          { cache: 'no-store', signal },
        );
        const payload = (await response
          .json()
          .catch(() => null)) as ResponsePayload | null;
        if (!response.ok || !payload?.data?.settings) {
          throw new Error(
            messageFrom(payload, 'Could not load Rebooking Prompt settings.'),
          );
        }
        if (
          signal?.aborted
          || version !== requestVersion.current
          || activeSalonSlug.current !== salonSlug
        ) {
          return;
        }
        const settings = normalize(payload.data.settings);
        setSavedSettings(settings);
        setDraft(settings);
      } catch (cause) {
        if (
          !signal?.aborted
          && version === requestVersion.current
          && activeSalonSlug.current === salonSlug
        ) {
          setLoadError(
            cause instanceof Error
              ? cause.message
              : 'Could not load Rebooking Prompt settings.',
          );
        }
      } finally {
        if (
          !signal?.aborted
          && version === requestVersion.current
          && activeSalonSlug.current === salonSlug
        ) {
          setLoading(false);
        }
      }
    },
    [salonSlug],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const dirty = useMemo(
    () =>
      draft !== null
      && savedSettings !== null
      && draft.enabled !== savedSettings.enabled,
    [draft, savedSettings],
  );
  const save = useCallback(async () => {
    if (!draft || saving) {
      return;
    }
    try {
      setSaving(true);
      setSaved(false);
      setSaveError(null);
      const response = await fetch(
        `/api/admin/rebooking-prompt?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: draft.enabled }),
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as ResponsePayload | null;
      if (!response.ok || !payload?.data?.settings) {
        throw new Error(
          messageFrom(payload, 'Could not save Rebooking Prompt settings.'),
        );
      }
      if (activeSalonSlug.current !== salonSlug) {
        return;
      }
      const settings = normalize(payload.data.settings);
      setSavedSettings(settings);
      setDraft(settings);
      setSaved(true);
    } catch (cause) {
      if (activeSalonSlug.current === salonSlug) {
        setSaveError(
          cause instanceof Error
            ? cause.message
            : 'Could not save Rebooking Prompt settings.',
        );
      }
    } finally {
      if (activeSalonSlug.current === salonSlug) {
        setSaving(false);
      }
    }
  }, [draft, salonSlug, saving]);
  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center" role="status">
        <span className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent motion-reduce:animate-none" />
        <span className="sr-only">Loading Rebooking Prompt settings</span>
      </div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="space-y-3 p-4">
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {loadError || 'Could not load Rebooking Prompt settings.'}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-11 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="flex min-h-full w-full flex-col bg-[var(--owner-ground)] text-[var(--owner-ink)]">
      <div className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-[var(--owner-line)] bg-[var(--owner-ground)] px-4">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--owner-ink)]"
            aria-label="Back to Marketing & Messages"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
        )}
        <h1 className="text-[18px] font-semibold">Rebooking Prompt</h1>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-28">
        <section className="rounded-[18px] bg-[var(--owner-surface)] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold">
                Encourage the next visit
              </h2>
              <p className="mt-1 text-[14px] leading-relaxed text-[var(--owner-muted)]">
                After a completed appointment, clients can choose to book their
                next visit. This does not create a discount or send a message.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled}
              aria-label="Turn on Rebooking Prompt"
              onClick={() => {
                setDraft(current =>
                  current ? { ...current, enabled: !current.enabled } : current,
                );
                setSaved(false);
                setSaveError(null);
              }}
              className="-m-1.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--owner-focus)]"
            >
              <span
                aria-hidden="true"
                className={`relative h-8 w-14 rounded-full transition-colors motion-reduce:transition-none ${draft.enabled ? 'bg-[var(--owner-accent)]' : 'bg-[var(--owner-line-strong)]'}`}
              >
                <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${draft.enabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </span>
            </button>
          </div>
        </section>
        <section className="rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
          <h2 className="text-[15px] font-semibold">What clients see</h2>
          <p className="mt-2 text-[15px] font-medium">
            Ready to book your next visit?
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--owner-muted)]">
            Book something similar or choose a different service.
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--owner-muted)]">Next Visit Offer discounts stay separate and remain off unless you enable that feature.</p>
        </section>
        {saveError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {saveError}
          </p>
        )}
        {saved && (
          <p
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            Rebooking Prompt saved.
          </p>
        )}
      </div>
      <div className="sticky bottom-0 border-t border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="size-4" aria-hidden="true" />
          {saving ? 'Saving…' : 'Save Rebooking Prompt'}
        </button>
      </div>
    </div>
  );
}
