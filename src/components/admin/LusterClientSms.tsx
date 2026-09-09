'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { COMMUNICATION_TEMPLATES } from '@/libs/communicationTemplates';
import { RETENTION_DATA_CHANGED_EVENT } from '@/libs/dashboardEvents';
import { calculateSmsSegments } from '@/libs/smsSegments';
import type { SmsOperationalHealth } from '@/libs/textingStatus';

type Message = {
  id: string;
  appointmentId: string | null;
  eventType: string;
  status: string;
  message: string | null;
  recipient: string;
  createdAt: string;
  updatedAt: string;
  scheduledFor: string;
  failureReason: string | null;
  canRetry: boolean;
};

const LABELS: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  undelivered: 'Undelivered',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  checking_delivery: 'Checking delivery',
};
const EVENTS: Record<string, string> = {
  manual_text: 'Client text',
  manual_reminder: 'Manual reminder',
  booking_confirmation: 'Booking confirmation',
  booking_request_received: 'Booking request',
  booking_request_approved: 'Request approved',
  booking_request_declined: 'Request declined',
  booking_request_expired: 'Request expired',
  appointment_reminder: 'Appointment reminder',
  appointment_rescheduled: 'Appointment rescheduled',
  appointment_cancelled: 'Appointment cancelled',
};

export function LusterClientSms({
  salonSlug,
  salonName,
  clientId,
  appointmentId,
  historyAppointmentId,
  composerOpen,
  onClose,
  showHistory = true,
}: {
  salonSlug: string;
  salonName: string;
  clientId: string;
  appointmentId?: string;
  historyAppointmentId?: string;
  composerOpen: boolean;
  onClose: () => void;
  showHistory?: boolean;
}) {
  const [history, setHistory] = useState<Message[]>([]);
  const [sms, setSms] = useState<SmsOperationalHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const endpoint = `/api/admin/clients/${encodeURIComponent(clientId)}/messages`;
  const query = `salonSlug=${encodeURIComponent(salonSlug)}${historyAppointmentId ? `&appointmentId=${encodeURIComponent(historyAppointmentId)}` : ''}`;
  const segments = calculateSmsSegments(COMMUNICATION_TEMPLATES.client_manual_text!.render({ salonName, message: draft.trim() })).segments;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store', signal });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'SMS history could not be loaded.');
      }
      if (!signal?.aborted) {
        setHistory(Array.isArray(payload?.data?.history) ? payload.data.history : []);
        setSms(payload?.data?.sms ?? null);
        setLoadError(null);
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setLoadError(cause instanceof Error ? cause.message : 'SMS history could not be loaded.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [endpoint, query]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => void load(controller.signal);
    window.addEventListener(RETENTION_DATA_CHANGED_EVENT, refresh);
    return () => {
      controller.abort();
      window.removeEventListener(RETENTION_DATA_CHANGED_EVENT, refresh);
    };
  }, [load]);

  const hasPending = history.some(item => ['queued', 'sending', 'checking_delivery'].includes(item.status));
  useEffect(() => {
    if (!hasPending) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => void load(controller.signal), 10000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [hasPending, load]);

  async function send(retryId?: string) {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSending(true);
    setError(null);
    setNotice(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(endpoint, {
        method: retryId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryId
          ? { salonSlug, intentId: retryId }
          : { salonSlug, message: draft.trim(), requestId: requestId.current, ...(appointmentId ? { appointmentId } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (!retryId && response.status >= 500) {
          setUncertain(true);
        }
        setError(payload?.error?.message || 'This message could not be queued.');
        return;
      }
      setHistory(Array.isArray(payload?.data?.history)
        ? payload.data.history.filter((item: Message) => !historyAppointmentId || item.appointmentId === historyAppointmentId)
        : []);
      setSms(payload?.data?.sms ?? null);
      setNotice(payload.data.created === false
        ? 'This text was already recorded. Current delivery status appears below.'
        : 'Text queued. Delivery updates appear below.');
      if (!retryId) {
        setDraft('');
        requestId.current = null;
        setUncertain(false);
      }
      await load();
    } catch {
      if (!retryId) {
        setUncertain(true);
      }
      setError('The send result could not be loaded. Retry this same request to check it safely without creating a second text.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <section className="mt-3 space-y-3 text-left" aria-label="Luster SMS" data-testid="luster-client-sms">
      {composerOpen && (
        <div className="rounded-2xl border border-rose-100 bg-white p-4" role="region" aria-label="Text client through Luster">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-stone-900">Text through Luster</h3>
            <Button type="button" variant="ghost" disabled={sending} onClick={onClose}>Close</Button>
          </div>
          <p className="mt-1 text-xs text-stone-600">{loading ? 'Checking texting availability…' : sms?.senderLabel ?? 'Texting status unavailable'}</p>
          {sms && !sms.manualAvailable && <p className="mt-2 text-sm text-amber-800" role="status">{sms.detail}</p>}
          <label className="mt-3 block text-sm font-medium text-stone-800" htmlFor={`sms-${clientId}`}>Message</label>
          <textarea
            id={`sms-${clientId}`}
            value={draft}
            maxLength={1000}
            rows={4}
            onChange={(event) => {
              setDraft(event.target.value);
              requestId.current = null;
            }}
            disabled={sending || uncertain}
            className="mt-1 w-full rounded-xl border border-stone-300 bg-white p-3 text-base text-stone-900 focus:border-rose-500 focus:outline-none disabled:opacity-70"
            placeholder="Write an appointment-related message…"
          />
          <p className="mt-1 text-xs text-stone-500">
            {segments}
            {' '}
            SMS
            {' '}
            {segments === 1 ? 'segment' : 'segments'}
            {' '}
            · Salon name and STOP instructions included.
            {sms?.senderMode === 'shared_luster' ? ' Each segment uses one SMS credit.' : ''}
          </p>
          <p className="mt-2 text-xs text-stone-500">Texts respect consent and quiet hours. Replies are not an inbox; clients should use their appointment link or call the salon for changes.</p>
          <Button type="button" className="mt-3 min-h-11" disabled={sending || loading || (!sms?.manualAvailable && !uncertain) || !draft.trim() || segments > 10} onClick={() => void send()}>
            {sending ? 'Sending…' : uncertain ? 'Retry same request' : 'Send text'}
          </Button>
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{notice}</p>}
      {showHistory && (
        <details className="rounded-2xl border border-stone-200 bg-stone-50 p-3" open>
          <summary className="min-h-8 cursor-pointer text-sm font-semibold text-stone-800">SMS history</summary>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => void load()}>Refresh delivery status</Button>
          {loading && <p className="text-xs text-stone-500" role="status">Loading messages…</p>}
          {loadError && <p className="text-sm text-red-800" role="alert">{loadError}</p>}
          {!loading && !loadError && history.length === 0 && <p className="text-xs text-stone-500">No Luster texts for this client yet.</p>}
          <ol className="mt-2 space-y-2">
            {history.map(item => (
              <li key={item.id} className="rounded-xl bg-white p-3">
                <div className="flex items-start justify-between gap-3 text-xs font-semibold text-stone-800">
                  <span>{EVENTS[item.eventType] ?? 'Appointment text'}</span>
                  <span role="status">{LABELS[item.status] ?? item.status}</span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {item.recipient}
                  {' '}
                  ·
                  {' '}
                  {new Date(item.createdAt).toLocaleString('en-CA')}
                </p>
                {item.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-stone-700">{item.message}</p>}
                {item.status === 'queued' && (
                  <p className="mt-2 text-xs text-stone-500">
                    Scheduled for
                    {' '}
                    {new Date(item.scheduledFor).toLocaleString('en-CA')}
                  </p>
                )}
                {item.failureReason && <p className="mt-2 text-xs text-amber-800">{item.failureReason}</p>}
                {item.status === 'checking_delivery' && <p className="mt-2 text-xs text-amber-800">The provider result is being checked. A second text will not be sent automatically.</p>}
                {item.canRetry && <Button type="button" variant="secondary" className="mt-2 min-h-11" disabled={sending} onClick={() => void send(item.id)}>Retry text</Button>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
