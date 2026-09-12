'use client';

/* eslint-disable style/max-statements-per-line */

import { ExternalLink, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_REVIEW_MESSAGE,
  isReviewUrl,
  REVIEW_DELAY_MINUTES,
  reviewSmsBody,
} from '@/libs/reviewRequests';
import { calculateSmsSegments } from '@/libs/smsSegments';

const DELAY_LABELS: Record<(typeof REVIEW_DELAY_MINUTES)[number], string> = {
  0: 'Immediately',
  30: '30 minutes',
  60: '1 hour',
  120: '2 hours',
  240: '4 hours',
  1440: '24 hours',
};
const DELAYS = REVIEW_DELAY_MINUTES.map(value => ({
  value,
  label: DELAY_LABELS[value],
}));
type Settings = { googleReviewUrl: string | null; automaticEnabled: boolean; delayMinutes: number; messageTemplate: string; businessName: string };

export function ReviewRequestSettings({ salonSlug }: { salonSlug: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!signal?.aborted) {
      setLoading(true);
    }
    try {
      const response = await fetch(`/api/admin/review-requests/settings?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store', signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not load review settings.');
      }
      if (!signal?.aborted) {
        const next = payload.data as Settings;
        setSettings(next);
        setDraft(next);
        setError(null);
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not load review settings.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [salonSlug]);

  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal); return () => controller.abort();
  }, [load]);
  const preview = useMemo(() => draft ? reviewSmsBody({ template: draft.messageTemplate, clientName: 'Avery Lee', businessName: draft.businessName, reviewLink: draft.googleReviewUrl || 'https://g.page/your-salon/review' }) : '', [draft]);
  const segments = calculateSmsSegments(preview);
  const validUrl = !draft?.googleReviewUrl || isReviewUrl(draft.googleReviewUrl);

  const save = async () => {
    if (!draft || saving) {
      return;
    }
    if (!validUrl) {
      setError('Enter a valid Google review link.'); return;
    }
    setSaving(true); setError(null); setSaved(false);
    try {
      const response = await fetch(`/api/admin/review-requests/settings?salonSlug=${encodeURIComponent(salonSlug)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ googleReviewUrl: draft.googleReviewUrl || null, automaticEnabled: draft.automaticEnabled, delayMinutes: draft.delayMinutes, messageTemplate: draft.messageTemplate }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not save review settings.');
      }
      const next = { ...draft, ...(payload?.data ?? {}) };
      setSettings(next); setDraft(next); setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save review settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--owner-muted)]" role={error ? 'alert' : 'status'}>
        <p>{error || (loading ? 'Loading review settings…' : 'Review settings are unavailable.')}</p>
        {error && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 font-semibold text-[var(--owner-accent)] underline">Try again</button>}
      </div>
    );
  }
  const changed = JSON.stringify(settings) !== JSON.stringify(draft);
  return (
    <div className="space-y-6 px-4 pb-8 pt-2" data-testid="review-request-settings">
      <div>
        <p className="text-sm text-[var(--owner-muted)]">Ask clients for one Google review after a completed appointment.</p>
      </div>
      <div className="rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm">
        <label className="block text-[15px] font-semibold text-[var(--owner-ink)]" htmlFor="google-review-link">Google review link</label>
        <input id="google-review-link" value={draft.googleReviewUrl ?? ''} onChange={event => setDraft({ ...draft, googleReviewUrl: event.target.value })} placeholder="https://g.page/.../review" inputMode="url" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-sm text-[var(--owner-ink)] outline-none focus:ring-2 focus:ring-[var(--owner-focus)]" />
        {!validUrl && <p className="mt-2 text-xs text-red-700">Enter a complete web link, starting with https://.</p>}
        {draft.googleReviewUrl && validUrl && (
          <a href={draft.googleReviewUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--owner-accent)] underline">
            <ExternalLink className="size-4" />
            Test link
          </a>
        )}
      </div>
      <div className="rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-[15px] font-semibold text-[var(--owner-ink)]">Automatically request reviews</span>
            <span className="mt-1 block text-xs text-[var(--owner-muted)]">Send clients a one-time review request after a completed appointment.</span>
          </span>
          <input aria-label="Automatically request reviews" type="checkbox" checked={draft.automaticEnabled} onChange={event => setDraft({ ...draft, automaticEnabled: event.target.checked })} className="size-5 accent-[var(--owner-accent)]" />
        </label>
        {draft.automaticEnabled && (
          <label className="mt-4 block text-sm font-semibold text-[var(--owner-ink)]">
            Send after
            <select aria-label="Send after" value={draft.delayMinutes} onChange={event => setDraft({ ...draft, delayMinutes: Number(event.target.value) })} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-[var(--owner-focus)]">{DELAYS.map(delay => <option key={delay.value} value={delay.value}>{delay.label}</option>)}</select>
          </label>
        )}
      </div>
      <div className="rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="review-message" className="text-[15px] font-semibold text-[var(--owner-ink)]">Message</label>
          <button type="button" onClick={() => setDraft({ ...draft, messageTemplate: DEFAULT_REVIEW_MESSAGE })} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[var(--owner-accent)]">
            <RotateCcw className="size-3.5" />
            Restore default
          </button>
        </div>
        <textarea id="review-message" value={draft.messageTemplate} onChange={event => setDraft({ ...draft, messageTemplate: event.target.value })} rows={5} className="mt-2 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--owner-focus)]" />
        <p className="mt-2 text-xs text-[var(--owner-muted)]">
          Use
          {'{{firstName}}'}
          ,
          {'{{businessName}}'}
          , and
          {'{{reviewLink}}'}
          .
        </p>
        <div className="mt-4 rounded-xl bg-[var(--owner-blush)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">Preview</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--owner-ink)]">{preview}</p>
          <p className="mt-2 text-xs text-[var(--owner-muted)]">
            {segments.segments}
            {' '}
            SMS
            {' '}
            {segments.segments === 1 ? 'credit' : 'credits'}
            {' '}
            ·
            {' '}
            {segments.encoding.toUpperCase()}
          </p>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="button" disabled={!changed || saving} onClick={() => void save()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white disabled:opacity-50">
        <Save className="size-4" />
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save review settings'}
      </button>
    </div>
  );
}
