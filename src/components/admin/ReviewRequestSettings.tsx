'use client';

import { ExternalLink, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_REVIEW_MESSAGE, isReviewUrl, REVIEW_DELAY_MINUTES, reviewSmsBody } from '@/libs/reviewRequests';
import { calculateSmsSegments } from '@/libs/smsSegments';

const DELAY_LABELS: Record<(typeof REVIEW_DELAY_MINUTES)[number], string> = { 0: 'Immediately', 30: '30 minutes', 60: '1 hour', 120: '2 hours', 240: '4 hours', 1440: '24 hours' };
const MODES = [
  { value: 'scheduled_end', title: 'After the appointment ends', description: 'Schedule after the booked end time.' },
  { value: 'marked_completed', title: 'After marked completed', description: 'Schedule only when you mark the appointment completed.' },
  { value: 'manual', title: 'Manual only', description: 'Never schedule automatically. Send a request when it is appropriate.' },
] as const;
type AutomationMode = (typeof MODES)[number]['value'];
type RepeatCooldownDays = 90 | 180 | 365 | 'never';
type Policy = { mode: AutomationMode; delayMinutes: number; repeatCooldownDays: RepeatCooldownDays };
type Readiness = { status: 'manual' | 'needs_setup' | 'configured'; reasons: string[] };
type Settings = { googleReviewUrl: string | null; automaticEnabled?: boolean; delayMinutes: number; messageTemplate: string; businessName: string; policy?: Policy; readiness?: Readiness };
type Draft = Omit<Settings, 'automaticEnabled' | 'policy' | 'readiness'> & { policy: Policy; readiness: Readiness };

function normalize(settings: Settings): Draft {
  const legacyMode: AutomationMode = settings.automaticEnabled ? 'marked_completed' : 'manual';
  return {
    ...settings,
    policy: settings.policy ?? { mode: legacyMode, delayMinutes: settings.delayMinutes, repeatCooldownDays: 'never' },
    readiness: settings.readiness ?? { status: 'needs_setup', reasons: ['Review request readiness has not been verified. Save settings to check setup.'] },
  };
}

function delayOptions(value: number) {
  const options = REVIEW_DELAY_MINUTES.map(delay => ({ value: delay, label: DELAY_LABELS[delay] }));
  return REVIEW_DELAY_MINUTES.includes(value as (typeof REVIEW_DELAY_MINUTES)[number]) ? options : [{ value, label: `Custom (${value} minutes)` }, ...options];
}

function validate(draft: Draft): string | null {
  if (draft.googleReviewUrl && !isReviewUrl(draft.googleReviewUrl)) {
    return 'Enter a valid Google review link.';
  }
  if (!draft.messageTemplate.trim()) {
    return 'Enter a review message.';
  }
  if (draft.messageTemplate.length > 1000) {
    return 'Keep the review message to 1,000 characters or fewer.';
  }
  if (!draft.messageTemplate.includes('{{reviewLink}}')) {
    return 'Include {{reviewLink}} in your message.';
  }
  if (/\{\{(?!(?:firstName|businessName|reviewLink)\}\})/.test(draft.messageTemplate)) {
    return 'Use firstName, businessName, or reviewLink placeholders.';
  }
  return null;
}

export function ReviewRequestSettings({ salonSlug }: { salonSlug: string }) {
  const [settings, setSettings] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editorSalonSlug, setEditorSalonSlug] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const savingRef = useRef(false);
  const activeSalonSlug = useRef(salonSlug);
  const renderedSalonSlug = useRef(salonSlug);
  const needsFreshSalonLoad = useRef(false);
  if (renderedSalonSlug.current !== salonSlug) {
    renderedSalonSlug.current = salonSlug;
    needsFreshSalonLoad.current = true;
  }
  activeSalonSlug.current = salonSlug;
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    if (!signal?.aborted) {
      setLoading(true);
      setSettings(null);
      setDraft(null);
      setEditorSalonSlug(null);
      setError(null);
      setSaved(false);
    }
    try {
      const response = await fetch(`/api/admin/review-requests/settings?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store', signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not load review settings.');
      }
      if (!signal?.aborted && version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        const next = normalize(payload.data as Settings);
        setSettings(next);
        setDraft(next);
        setEditorSalonSlug(salonSlug);
        needsFreshSalonLoad.current = false;
        setError(null);
        setSaved(false);
      }
    } catch (cause) {
      if (!signal?.aborted && version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        setError(cause instanceof Error ? cause.message : 'Could not load review settings.');
      }
    } finally {
      if (!signal?.aborted && version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        setLoading(false);
      }
    }
  }, [salonSlug]);
  useEffect(() => {
    savingRef.current = false;
    setSaving(false);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const preview = useMemo(() => draft ? reviewSmsBody({ template: draft.messageTemplate, clientName: 'Avery Lee', businessName: draft.businessName, reviewLink: draft.googleReviewUrl || 'https://g.page/your-salon/review' }) : '', [draft]);
  const segments = calculateSmsSegments(preview);
  const validUrl = !draft?.googleReviewUrl || isReviewUrl(draft.googleReviewUrl);
  const save = async () => {
    if (!draft || savingRef.current || editorSalonSlug !== salonSlug) {
      return;
    }
    const validationError = validate(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    const version = ++requestVersion.current;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/admin/review-requests/settings?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleReviewUrl: draft.googleReviewUrl || null, delayMinutes: draft.policy.delayMinutes, messageTemplate: draft.messageTemplate, automationMode: draft.policy.mode, repeatCooldownDays: draft.policy.repeatCooldownDays }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not save review settings.');
      }
      if (version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        const next = normalize({ ...draft, ...(payload?.data ?? {}) });
        setSettings(next);
        setDraft(next);
        setSaved(true);
      }
    } catch (cause) {
      if (version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        setError(cause instanceof Error ? cause.message : 'Could not save review settings.');
      }
    } finally {
      if (version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  if (!draft || editorSalonSlug !== salonSlug || needsFreshSalonLoad.current) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--owner-muted)]" role={error ? 'alert' : 'status'}>
        <p>{error || (loading ? 'Loading review settings…' : 'Review settings are unavailable.')}</p>
        {error && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 font-semibold text-[var(--owner-accent)] underline">Try again</button>}
      </div>
    );
  }
  const changed = JSON.stringify(settings) !== JSON.stringify(draft);
  const readinessText = changed
    ? 'Changes are not saved yet. Save settings to check review-request readiness.'
    : draft.readiness.status === 'configured'
      ? 'Ready to request Google reviews.'
      : draft.readiness.status === 'manual'
        ? 'Manual requests are selected.'
        : draft.readiness.reasons.join(' ') || 'Finish setup before automatic requests can send.';
  const setPolicy = (policy: Partial<Policy>) => setDraft({ ...draft, policy: { ...draft.policy, ...policy } });
  return (
    <div className="space-y-6 px-4 pb-8 pt-2" data-testid="review-request-settings">
      <fieldset disabled={saving} className="contents">
        <div>
          <h2 className="text-base font-semibold text-[var(--owner-ink)]">Review requests</h2>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">Ask clients for a Google review after a visit. Review rewards, internal reviews, and promotional messages are managed separately.</p>
        </div>
        <div className="rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm">
          <p className="text-[15px] font-semibold text-[var(--owner-ink)]">Automatic review requests</p>
          <div className="mt-3 space-y-2" role="radiogroup" aria-label="Automatic review requests">
            {MODES.map(mode => (
              <label key={mode.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-[var(--owner-line)] p-3 has-[:checked]:border-[var(--owner-accent)] has-[:checked]:bg-[var(--owner-blush)]">
                <input type="radio" name="review-mode" value={mode.value} checked={draft.policy.mode === mode.value} onChange={() => setPolicy({ mode: mode.value })} className="mt-0.5 size-4 accent-[var(--owner-accent)]" />
                <span>
                  <span className="block text-sm font-semibold text-[var(--owner-ink)]">{mode.title}</span>
                  <span className="mt-0.5 block text-xs text-[var(--owner-muted)]">{mode.description}</span>
                </span>
              </label>
            ))}
          </div>
          {draft.policy.mode !== 'manual' && (
            <label className="mt-4 block text-sm font-semibold text-[var(--owner-ink)]">
              Send after
              <select aria-label="Send after" value={draft.policy.delayMinutes} onChange={event => setPolicy({ delayMinutes: Number(event.target.value) })} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-[var(--owner-focus)]">{delayOptions(draft.policy.delayMinutes).map(delay => <option key={delay.value} value={delay.value}>{delay.label}</option>)}</select>
            </label>
          )}
          {draft.policy.mode === 'scheduled_end' && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">If a client cancels or does not attend, mark the appointment cancelled or no-show before this request sends.</p>}
          <button
            type="button"
            onClick={() => {
              setDraft({ ...draft, policy: { ...draft.policy, mode: 'scheduled_end', delayMinutes: 60, repeatCooldownDays: 90 } });
              setSaved(false);
            }}
            className="mt-4 min-h-11 text-sm font-semibold text-[var(--owner-accent)] underline"
          >
            Use recommended automation
          </button>
          <p className="mt-1 text-xs text-[var(--owner-muted)]">Recommended: after the appointment ends, with a 1 hour delay and a 90 day repeat-review cooldown. This is only saved when you save these settings.</p>
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
          <p className="mt-3 text-xs text-[var(--owner-muted)]">{readinessText}</p>
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
          <p className="mt-2 text-xs text-[var(--owner-muted)]">{'Use {{firstName}}, {{businessName}}, and {{reviewLink}}. Review requests are SMS only: sending requires SMS to be enabled, client consent, no STOP opt-out, and available credits.'}</p>
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
        <details className="rounded-[14px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
          <summary className="min-h-11 cursor-pointer pt-1 text-[15px] font-semibold text-[var(--owner-ink)]">Advanced</summary>
          <label className="mt-3 block text-sm font-semibold text-[var(--owner-ink)]">
            Repeat-review cooldown
            <select aria-label="Repeat-review cooldown" value={draft.policy.repeatCooldownDays} onChange={event => setPolicy({ repeatCooldownDays: event.target.value === 'never' ? 'never' : Number(event.target.value) as 90 | 180 | 365 })} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-sm font-normal">
              <option value={90}>90 days (recommended)</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
              <option value="never">Never request another review</option>
            </select>
          </label>
          <p className="mt-2 text-xs text-[var(--owner-muted)]">A client can be asked again after a later appointment once this cooldown has passed.</p>
        </details>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="button" disabled={!changed || saving} onClick={() => void save()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white disabled:opacity-50">
        <Save className="size-4" />
        {saving ? 'Saving…' : saved && !changed ? 'Saved' : 'Save review settings'}
      </button>
    </div>
  );
}
