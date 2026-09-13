'use client';

/* eslint-disable style/max-statements-per-line */

import { Check, LoaderCircle, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';

type ReviewStatus = 'not_eligible' | 'eligible' | 'scheduled' | 'sent' | 'suppressed' | 'failed' | 'cancelled' | 'sending';
type ReviewRequest = { status: ReviewStatus; reason: string | null; scheduledFor: string | null; sentAt: string | null; message: string | null; phone: string | null; clientId: string | null };

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function ReviewRequestAction({ appointmentId, salonSlug, timeZone, appointmentStatus, className = '', actionLabel = 'Request review' }: { appointmentId?: string; actionLabel?: string; salonSlug: string; timeZone: string; appointmentStatus: string; className?: string }) {
  const [request, setRequest] = useState<ReviewRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const endpoint = `/api/appointments/${encodeURIComponent(appointmentId ?? '')}/review-request?salonSlug=${encodeURIComponent(salonSlug)}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!appointmentId) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal }); const payload = await response.json().catch(() => null); if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not check review request status.');
      } if (!signal?.aborted) {
        setRequest(payload.data); setError(null);
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not check review request status.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [appointmentId, endpoint]);
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal); return () => controller.abort();
  }, [load]);
  const isCompleted = appointmentStatus === 'completed';
  const label = useMemo(() => {
    if (!request) {
      return actionLabel;
    }
    if (request.status === 'sent') {
      return 'Review requested';
    }
    if (request.status === 'scheduled') {
      return 'Review request scheduled';
    }
    if (request.status === 'suppressed') {
      return 'Review requests off';
    }
    if (request.status === 'sending') {
      return 'Review request sending';
    }
    if (request.status === 'failed') {
      return 'Review request failed';
    }
    if (request.status === 'cancelled') {
      return 'Review request cancelled';
    }
    if (request.status === 'not_eligible') {
      return 'Review request unavailable';
    }
    return actionLabel;
  }, [actionLabel, request]);
  const canConfirm = Boolean(appointmentId) && isCompleted && (request?.status === 'eligible' || request?.status === 'scheduled');
  const disabled = loading || sending || !canConfirm;
  const description = !appointmentId ? 'Available after a completed appointment is recorded for this client.' : request?.status === 'sent' && request.sentAt ? `Sent ${formatDate(request.sentAt, timeZone)}` : request?.status === 'scheduled' && request.scheduledFor ? [request.reason, `Scheduled for ${formatDate(request.scheduledFor, timeZone)}`].filter(Boolean).join(' ') : request?.status === 'suppressed' ? 'This client has review requests turned off.' : request?.status === 'failed' ? request.reason || 'This review request could not be sent.' : request?.status === 'cancelled' ? request.reason || 'This review request was cancelled.' : !isCompleted ? 'Available after this appointment is completed.' : request?.reason;
  const openReviewSettings = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('app', 'settings');
    url.searchParams.set('view', 'review-requests');
    url.searchParams.set('salon', salonSlug);
    window.location.assign(`${url.pathname}?${url.searchParams.toString()}`);
  };
  const send = async () => {
    if (inFlight.current || !canConfirm) {
      return;
    }
    inFlight.current = true; setSending(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const payload = await response.json().catch(() => null); if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not queue the review request.');
      } setRequest(payload.data); setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not queue the review request.');
    } finally {
      inFlight.current = false; setSending(false);
    }
  };
  return (
    <>
      <div className={`rounded-2xl border border-neutral-200 p-4 ${className}`} data-testid="appointment-review-request-action">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-neutral-900">Review request</div>
            {description && <p className="mt-1 text-xs text-neutral-500">{description}</p>}
          </div>
          <button type="button" disabled={disabled} onClick={() => setConfirming(true)} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800 shadow-sm disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-50">{sending || loading ? <LoaderCircle className="size-4 animate-spin" /> : request?.status === 'sent' ? <Check className="size-4" /> : <Star className="size-4" />}</span>
            {label}
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
        {error && !loading && (
          <button
            type="button"
            onClick={() => {
              setLoading(true); void load();
            }}
            className="mt-2 min-h-11 text-xs font-semibold text-rose-800 underline"
          >
            Reload status
          </button>
        )}
        {request?.reason?.toLowerCase().includes('google review') && (
          <button type="button" onClick={openReviewSettings} className="mt-2 min-h-11 text-xs font-semibold text-rose-800 underline">Add Google review link</button>
        )}
      </div>
      <DialogShell isOpen={confirming} onClose={() => !sending && setConfirming(false)} maxWidthClassName="max-w-md" contentClassName="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" closeOnBackdrop={!sending}>
        <div role="dialog" aria-label="Send review request">
          <div className="flex size-10 items-center justify-center rounded-full bg-rose-50 text-rose-700"><Star className="size-5" /></div>
          <h2 className="mt-3 text-lg font-semibold text-neutral-900">{request?.status === 'scheduled' ? 'Send review request now?' : 'Send review request?'}</h2>
          <p className="mt-1 text-sm text-neutral-600">{request?.phone ? `We'll send this to ${request.phone}.` : 'This will be sent through your Luster SMS number.'}</p>
          {request?.message && (
            <div className="mt-4 rounded-xl bg-neutral-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Message preview</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-800">{request.message}</p>
            </div>
          )}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={sending} onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-neutral-200 px-3 text-sm font-semibold text-neutral-700">Cancel</button>
            <button type="button" disabled={sending} onClick={() => void send()} className="min-h-11 flex-1 rounded-xl bg-rose-800 px-3 text-sm font-semibold text-white disabled:opacity-50">{sending ? 'Queueing…' : request?.status === 'scheduled' ? 'Send now' : 'Send review request'}</button>
          </div>
        </div>
      </DialogShell>
    </>
  );
}
