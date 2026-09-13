'use client';

/* eslint-disable style/max-statements-per-line */

import { useCallback, useEffect, useState } from 'react';

export function ReviewRequestSuppression({ salonSlug, clientId }: { salonSlug: string; clientId: string }) {
  const [suppressed, setSuppressed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/admin/clients/${encodeURIComponent(clientId)}/review-requests?salonSlug=${encodeURIComponent(salonSlug)}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal }); const payload = await response.json().catch(() => null); if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not load review preferences.');
      } if (!signal?.aborted) {
        setSuppressed(payload.data.reviewRequestsSuppressed === true); setError(null);
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not load review preferences.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal); return () => controller.abort();
  }, [load]);
  const toggle = async (next: boolean) => {
    if (saving) {
      return;
    } setSaving(true); setError(null); try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewRequestsSuppressed: next }) }); const payload = await response.json().catch(() => null); if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not save review preference.');
      } setSuppressed(payload?.data?.reviewRequestsSuppressed ?? next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save review preference.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-4 rounded-2xl border border-[var(--owner-line,#dfd1d4)] bg-white p-4" data-testid="review-request-suppression">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-[15px] font-semibold text-[var(--owner-ink,#30262a)]">Do not send review requests</span>
          <span className="mt-1 block text-xs text-[var(--owner-muted,#706267)]">Luster won't automatically ask this client for a review.</span>
        </span>
        <input aria-label="Do not send review requests" type="checkbox" checked={suppressed} disabled={loading || saving} onChange={event => void toggle(event.target.checked)} className="size-5 accent-[var(--owner-accent,#8f3155)]" />
      </label>
      {suppressed && <p className="mt-2 text-xs font-medium text-[var(--owner-accent,#8f3155)]">Pending review requests are cancelled.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
