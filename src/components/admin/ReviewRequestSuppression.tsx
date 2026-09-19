'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClientReviewHistoryItem, ClientReviewOverview } from '@/libs/reviewRequestStatus';
import { DEFAULT_BOOKING_TIME_ZONE } from '@/libs/timeZone';

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function historyStatus(item: ClientReviewHistoryItem, timeZone: string) {
  if (item.status === 'delivered') {
    return 'Delivered by SMS';
  }
  if (item.status === 'sent') {
    return 'Sent to SMS provider';
  }
  if (item.status === 'reported_sent') {
    return 'Owner reported sent — delivery not verified';
  }
  if (item.status === 'scheduled' && item.scheduledFor) {
    return `Scheduled for ${formatDate(item.scheduledFor, timeZone)}`;
  }
  if (item.status === 'skipped') {
    return 'Skipped';
  }
  if (item.status === 'suppressed') {
    return 'Skipped';
  }
  if (item.status === 'failed') {
    return 'Failed';
  }
  if (item.status === 'cancelled') {
    return 'Cancelled';
  }
  if (item.status === 'unknown') {
    return 'Status unknown';
  }
  if (item.status === 'sending') {
    return 'Sending';
  }
  if (item.status === 'awaiting_trigger') {
    return 'Waiting for automatic trigger';
  }
  if (item.status === 'eligible') {
    return 'Eligible for manual send';
  }
  return 'Not eligible';
}

function sourceLabel(item: ClientReviewHistoryItem) {
  const source = item.source === 'automatic' ? 'Automatic' : item.source === 'owner_reported' ? 'Owner-reported' : 'Manual';
  const channel = item.channel === 'sms' ? 'SMS' : item.channel === 'owner_device' ? 'Owner device' : null;
  return channel ? `${source} · ${channel}` : source;
}

function recordedLabel(item: ClientReviewHistoryItem) {
  return item.status === 'scheduled' ? 'Queued' : 'Recorded';
}

function sentLabel(item: ClientReviewHistoryItem) {
  return item.status === 'reported_sent' ? 'Marked sent' : 'Sent';
}

type ReviewRequestSuppressionProps = {
  salonSlug: string;
  clientId: string;
};

function reviewOverview(value: unknown): ClientReviewOverview {
  const data = value as Partial<ClientReviewOverview> | null;
  return {
    timeZone: typeof data?.timeZone === 'string' ? data.timeZone : DEFAULT_BOOKING_TIME_ZONE,
    reviewRequestsSuppressed: data?.reviewRequestsSuppressed === true,
    history: Array.isArray(data?.history) ? data.history : [],
    hasMore: data?.hasMore === true,
  };
}

export function ReviewRequestSuppression({ salonSlug, clientId }: ReviewRequestSuppressionProps) {
  const identity = `${salonSlug}:${clientId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [overviewState, setOverviewState] = useState<{ identity: string; value: ClientReviewOverview } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorState, setErrorState] = useState<{ identity: string; message: string } | null>(null);
  const inFlight = useRef<string | null>(null);
  const endpoint = `/api/admin/clients/${encodeURIComponent(clientId)}/review-requests?salonSlug=${encodeURIComponent(salonSlug)}`;
  const overview = overviewState?.identity === identity ? overviewState.value : null;
  const error = errorState?.identity === identity ? errorState.message : null;
  const suppressed = overview?.reviewRequestsSuppressed === true;
  const timeZone = overview?.timeZone ?? DEFAULT_BOOKING_TIME_ZONE;
  const load = useCallback(async (signal?: AbortSignal) => {
    const loadIdentity = identity;
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not load review preferences.');
      }
      if (!signal?.aborted && identityRef.current === loadIdentity) {
        setOverviewState({ identity: loadIdentity, value: reviewOverview(payload.data) });
        setErrorState(null);
      }
    } catch (cause) {
      if (!signal?.aborted && identityRef.current === loadIdentity) {
        setErrorState({ identity: loadIdentity, message: cause instanceof Error ? cause.message : 'Could not load review preferences.' });
      }
    } finally {
      if (!signal?.aborted && identityRef.current === loadIdentity) {
        setLoading(false);
      }
    }
  }, [endpoint, identity]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSaving(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const toggle = async (next: boolean) => {
    if (inFlight.current || !overview || error) {
      return;
    }
    const saveIdentity = identity;
    inFlight.current = saveIdentity;
    setSaving(true);
    setErrorState(null);
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewRequestsSuppressed: next }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not save review preference.');
      }
      if (identityRef.current === saveIdentity) {
        setOverviewState({
          identity: saveIdentity,
          value: reviewOverview(payload.data),
        });
      }
    } catch (cause) {
      if (identityRef.current === saveIdentity) {
        setErrorState({ identity: saveIdentity, message: cause instanceof Error ? cause.message : 'Could not save review preference.' });
      }
    } finally {
      if (inFlight.current === saveIdentity) {
        inFlight.current = null;
      }
      if (identityRef.current === saveIdentity) {
        setSaving(false);
      }
    }
  };
  const history = useMemo(() => {
    if (!overview) {
      return [];
    }
    return [...overview.history].sort((first, second) => new Date(second.occurredAt).getTime() - new Date(first.occurredAt).getTime());
  }, [overview]);
  return (
    <div className="mt-4 rounded-2xl border border-[var(--owner-line,#dfd1d4)] bg-white p-4" data-testid="review-request-suppression">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-[var(--owner-ink,#30262a)]">Do not send review requests</span>
          <span className="mt-1 block text-xs text-[var(--owner-muted,#706267)]">Blocks new automatic and manual review requests for this client.</span>
        </span>
        <input aria-label="Do not send review requests" type="checkbox" checked={suppressed} disabled={loading || saving || !overview || !!error} onChange={event => void toggle(event.target.checked)} className="size-5 shrink-0 accent-[var(--owner-accent,#8f3155)]" />
      </label>
      {suppressed && <p className="mt-2 text-xs font-medium text-[var(--owner-accent,#8f3155)]">Future requests are skipped. A request already sending may still arrive.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      {error && !loading && (
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="mt-2 min-h-11 text-xs font-semibold text-[var(--owner-accent,#8f3155)] underline"
        >
          Reload review history
        </button>
      )}
      {!loading && !error && (
        <section className="mt-5 border-t border-[var(--owner-line,#dfd1d4)] pt-4" aria-labelledby="review-request-history-heading">
          <h3 id="review-request-history-heading" className="text-sm font-semibold text-[var(--owner-ink,#30262a)]">Review request history</h3>
          {history.length === 0
            ? <p className="mt-2 text-xs text-[var(--owner-muted,#706267)]">No review requests yet.</p>
            : (
                <ol className="mt-3 space-y-3" data-testid="review-request-history">
                  {history.map(item => (
                    <li key={item.id} className="rounded-xl bg-[var(--owner-soft,#faf5f6)] p-3 text-xs text-[var(--owner-muted,#706267)]">
                      <div className="break-words font-semibold text-[var(--owner-ink,#30262a)]">{historyStatus(item, timeZone)}</div>
                      <div className="mt-1">
                        {sourceLabel(item)}
                      </div>
                      <div className="mt-1">
                        {recordedLabel(item)}
                        {' '}
                        {formatDate(item.occurredAt, timeZone)}
                      </div>
                      {item.sentAt && (
                        <div className="mt-1">
                          {sentLabel(item)}
                          {' '}
                          {formatDate(item.sentAt, timeZone)}
                        </div>
                      )}
                      {item.reason && <div className="mt-1 break-words">{item.reason}</div>}
                    </li>
                  ))}
                </ol>
              )}
          {overview?.hasMore && <p className="mt-3 text-xs text-[var(--owner-muted,#706267)]">Showing the most recent review requests.</p>}
        </section>
      )}
    </div>
  );
}
