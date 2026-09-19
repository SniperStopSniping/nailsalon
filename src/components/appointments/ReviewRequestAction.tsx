'use client';

import { Check, LoaderCircle, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import type { ReviewRequestDisplay } from '@/libs/reviewRequestStatus';

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function sourceLabel(source: ReviewRequestDisplay['source']) {
  if (source === 'automatic') {
    return 'Automatic request';
  }
  if (source === 'owner_reported') {
    return 'Owner-reported request';
  }
  return 'Manual request';
}

function statusLabel(request: ReviewRequestDisplay | null) {
  if (!request) {
    return 'Request review';
  }
  if (request.status === 'sent') {
    return 'Review request sent';
  }
  if (request.status === 'delivered') {
    return 'Review request delivered';
  }
  if (request.status === 'reported_sent') {
    return 'Review request reported sent';
  }
  if (request.status === 'scheduled') {
    return 'Send now';
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
    return request.canSendManually ? 'Request review' : 'Review request cancelled';
  }
  if (request.status === 'skipped') {
    return 'Review request skipped';
  }
  if (request.status === 'unknown') {
    return 'Review request status unknown';
  }
  if (request.status === 'not_eligible') {
    return 'Review request unavailable';
  }
  if (request.status === 'awaiting_trigger') {
    return 'Review request pending';
  }
  return 'Request review';
}

function statusDescription(request: ReviewRequestDisplay, timeZone: string) {
  const reason = request.reason ? ` ${request.reason}` : '';
  if (request.status === 'scheduled' && request.scheduledFor) {
    return `Scheduled for ${formatDate(request.scheduledFor, timeZone)}.${reason}`;
  }
  if (request.status === 'delivered' && request.sentAt) {
    return `Delivery confirmed by SMS provider. Sent ${formatDate(request.sentAt, timeZone)}.${reason}`;
  }
  if (request.status === 'sent' && request.sentAt) {
    return `Sent to the SMS provider ${formatDate(request.sentAt, timeZone)}.${reason}`;
  }
  if (request.status === 'reported_sent' && request.sentAt) {
    return `Marked sent by the owner ${formatDate(request.sentAt, timeZone)}. Delivery was not verified.${reason}`;
  }
  if (request.status === 'eligible') {
    return `Eligible — send manually.${reason}`;
  }
  if (request.status === 'awaiting_trigger') {
    return `Waiting for the automatic trigger.${reason}`;
  }
  if (request.status === 'skipped') {
    return `Skipped — ${request.reason || 'this request was not eligible to send.'}`;
  }
  if (request.status === 'unknown') {
    return `Status unknown — ${request.reason || 'reload before taking action.'}`;
  }
  if (request.status === 'suppressed') {
    return `Skipped — ${request.reason || 'this client does not receive review requests.'}`;
  }
  return request.reason;
}

type ReviewRequestActionProps = {
  appointmentId: string;
  salonSlug: string;
  timeZone: string;
  appointmentStatus: string;
  className?: string;
};

export function ReviewRequestAction({ appointmentId, salonSlug, timeZone, appointmentStatus, className = '' }: ReviewRequestActionProps) {
  // Keep manual sending closed while a visible appointment changes state. A
  // cancellation or no-show may happen without this sheet being remounted.
  const identity = `${salonSlug}:${appointmentId}:${appointmentStatus}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [requestState, setRequestState] = useState<{ identity: string; value: ReviewRequestDisplay } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorState, setErrorState] = useState<{ identity: string; message: string } | null>(null);
  const inFlight = useRef<string | null>(null);
  const endpoint = `/api/appointments/${encodeURIComponent(appointmentId)}/review-request?salonSlug=${encodeURIComponent(salonSlug)}`;
  const request = requestState?.identity === identity ? requestState.value : null;
  const error = errorState?.identity === identity ? errorState.message : null;
  const load = useCallback(async (signal?: AbortSignal) => {
    const loadIdentity = identity;
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not check review request status.');
      }
      if (!signal?.aborted && identityRef.current === loadIdentity) {
        setRequestState({ identity: loadIdentity, value: payload.data as ReviewRequestDisplay });
        setErrorState(null);
      }
    } catch (cause) {
      if (!signal?.aborted && identityRef.current === loadIdentity) {
        setErrorState({ identity: loadIdentity, message: cause instanceof Error ? cause.message : 'Could not check review request status.' });
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
    setSending(false);
    setConfirming(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const label = useMemo(() => statusLabel(request), [request]);
  const canConfirm = request?.canSendManually === true && !error && !loading;
  const disabled = loading || sending || !canConfirm;
  const description = request ? statusDescription(request, timeZone) : null;
  const canOpenSettings = request?.reason?.toLowerCase().includes('google review') === true;
  const isScheduledEnd = request?.status === 'scheduled' && request.automationMode === 'scheduled_end';
  const openReviewSettings = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('app', 'marketing');
    url.searchParams.set('view', 'reviews');
    url.searchParams.set('salon', salonSlug);
    window.location.assign(`${url.pathname}?${url.searchParams.toString()}`);
  };
  const send = async () => {
    if (inFlight.current || disabled) {
      return;
    }
    const sendIdentity = identity;
    inFlight.current = sendIdentity;
    setSending(true);
    setErrorState(null);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Could not queue the review request.');
      }
      if (identityRef.current === sendIdentity) {
        setRequestState({ identity: sendIdentity, value: payload.data as ReviewRequestDisplay });
        setConfirming(false);
      }
    } catch (cause) {
      if (identityRef.current === sendIdentity) {
        setErrorState({ identity: sendIdentity, message: cause instanceof Error ? cause.message : 'Could not queue the review request.' });
        setConfirming(false);
      }
    } finally {
      if (inFlight.current === sendIdentity) {
        inFlight.current = null;
      }
      if (identityRef.current === sendIdentity) {
        setSending(false);
      }
    }
  };
  return (
    <>
      <div className={`rounded-2xl border border-neutral-200 p-4 ${className}`} data-testid="appointment-review-request-action">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-neutral-900">Review request</div>
            {request?.source && (
              <p className="mt-1 text-xs text-neutral-500">
                {sourceLabel(request.source)}
                {request.channel === 'sms' ? ' · SMS' : ''}
              </p>
            )}
            {description && <p className="mt-1 text-xs text-neutral-500">{description}</p>}
          </div>
          <button type="button" disabled={disabled} onClick={() => setConfirming(true)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800 shadow-sm disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400">
            <span className="flex size-7 items-center justify-center rounded-full bg-rose-50">{sending || loading ? <LoaderCircle className="size-4 animate-spin" /> : ['sent', 'delivered', 'reported_sent'].includes(request?.status ?? '') ? <Check className="size-4" /> : <Star className="size-4" />}</span>
            {label}
          </button>
        </div>
        {isScheduledEnd && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">If this appointment is cancelled or a no-show, mark it before this request sends.</p>}
        {request?.status === 'scheduled' && canConfirm && <p className="mt-2 text-xs text-neutral-500">Send now queues one request and prevents another automatic request for this appointment.</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
        {error && !loading && (
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="mt-2 min-h-11 text-xs font-semibold text-rose-800 underline"
          >
            Reload status
          </button>
        )}
        {canOpenSettings && <button type="button" onClick={openReviewSettings} className="mt-2 min-h-11 text-xs font-semibold text-rose-800 underline">Add Google review link</button>}
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
          <p className="mt-3 text-xs text-neutral-500">This queues one request and prevents another automatic request for this appointment. Quiet hours and eligibility checks still apply.</p>
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={sending} onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-neutral-200 px-3 text-sm font-semibold text-neutral-700">Cancel</button>
            <button type="button" disabled={disabled} onClick={() => void send()} className="min-h-11 flex-1 rounded-xl bg-rose-800 px-3 text-sm font-semibold text-white disabled:opacity-50">{sending ? 'Queueing…' : request?.status === 'scheduled' ? 'Send now' : 'Send review request'}</button>
          </div>
        </div>
      </DialogShell>
    </>
  );
}
