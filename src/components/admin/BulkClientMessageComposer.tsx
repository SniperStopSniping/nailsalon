'use client';

import { Check, LoaderCircle, Search, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { SmsMessagePreview } from '@/components/admin/SmsMessagePreview';
import { Button } from '@/components/ui/button';
import { type BulkMessageClient, type BulkMessageDraft, type BulkMessageFilter, type BulkMessagePreview, type BulkMessageReceipt, matchesBulkMessageFilter, MAX_BULK_MESSAGE_CLIENTS } from '@/libs/bulkClientMessages';
import { hasUnfilledMessageFields, personalizeClientMessage, unsupportedMessageFields } from '@/libs/clientMessagePersonalization';
import { COMMUNICATION_TEMPLATES } from '@/libs/communicationTemplates';
import { prepareSmsBody } from '@/libs/smsSegments';
import type { SmsOperationalHealth } from '@/libs/textingStatus';

type Audience = {
  clients: BulkMessageClient[];
  sms: SmsOperationalHealth;
  asOf: string;
  timeZone: string;
  bookingUrl: string;
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  suppressed: 'Not sent',
  opted_out: 'Opted out',
  undelivered: 'Undelivered',
  cancelled: 'Cancelled',
  checking_delivery: 'Checking delivery',
  customer_disabled: 'Texts disabled',
  provider_blocked: 'Provider blocked',
};
const card = 'rounded-[20px] bg-[var(--owner-surface)] p-4 shadow-sm';

export function BulkClientMessageComposer({ salonSlug, salonName, onBack }: { salonSlug: string; salonName: string; onBack: () => void }) {
  const [audience, setAudience] = useState<Audience | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [filter, setFilter] = useState<BulkMessageFilter>({ minWeeks: null, excludeUpcoming: true });
  const [weeks, setWeeks] = useState('3');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<{ draft: BulkMessageDraft; preview: BulkMessagePreview } | null>(null);
  const [receipt, setReceipt] = useState<BulkMessageReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [previewClientId, setPreviewClientId] = useState('');
  const [includeBookedConfirmed, setIncludeBookedConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const endpoint = `/api/admin/messages/bulk?salonSlug=${encodeURIComponent(salonSlug)}`;

  useEffect(() => {
    const controller = new AbortController();
    setAudience(null);
    setLoadError(null);
    setSelected(new Set());
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload.data?.clients || !payload.data?.sms) {
          throw new Error(payload.error?.message || 'Clients could not be loaded.');
        }
        if (!controller.signal.aborted) {
          setAudience(payload.data);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setLoadError(cause instanceof Error ? cause.message : 'Clients could not be loaded.');
        }
      }
    })();
    return () => controller.abort();
  }, [endpoint, loadVersion]);

  const matching = audience?.clients.filter(client => matchesBulkMessageFilter(client, filter, new Date(audience.asOf), audience.timeZone)) ?? [];
  const query = search.trim().toLocaleLowerCase();
  const visible = matching.filter(client => !query || `${client.fullName ?? ''} ${client.phone}`.toLocaleLowerCase().includes(query));
  const eligibleVisible = visible.filter(client => client.eligible);
  const selectedClients = audience?.clients.filter(client => selected.has(client.id)) ?? [];
  const personalizedBodies = (selectedClients.length ? selectedClients : [{ fullName: null }]).map(client => COMMUNICATION_TEMPLATES.client_manual_text!.render({ salonName, message: personalizeClientMessage(message.trim(), { fullName: client.fullName, bookingUrl: audience?.bookingUrl ?? '', salonName }) }));
  const finalBody = personalizedBodies[0] ?? '';
  const creditsPerText = Math.max(...personalizedBodies.map(body => prepareSmsBody(body).segmentation.segments));
  const estimatedCredits = selected.size ? personalizedBodies.reduce((sum, body) => sum + prepareSmsBody(body).segmentation.segments, 0) : 0;
  const invalidFields = unsupportedMessageFields(message) || personalizedBodies.some(hasUnfilledMessageFields);
  const creditShortfall = audience?.sms.availableCredits !== null && audience?.sms.availableCredits !== undefined && audience.sms.availableCredits < estimatedCredits;
  const validWeeks = filter.minWeeks === null || (/^\d+$/.test(weeks) && Number(weeks) >= 1 && Number(weeks) <= 104);

  function selectFilter(next: BulkMessageFilter) {
    if (next.minWeeks !== null) {
      next = { ...next, excludeUpcoming: true };
    }
    setFilter(next);
    setError(null);
    setSelected(new Set(audience?.clients.filter(client => client.eligible && matchesBulkMessageFilter(client, next, new Date(audience.asOf), audience.timeZone)).map(client => client.id)));
  }

  async function reviewMessage() {
    if (inFlight.current || !audience) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const draft: BulkMessageDraft = { salonSlug, clientIds: [...selected], message: message.trim(), filter };
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', ...draft }) });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message || 'The message could not be reviewed.');
      }
      setReview({ draft, preview: payload.data.preview });
      setPreviewClientId(payload.data.preview.recipients[0]?.id ?? '');
      setIncludeBookedConfirmed(false);
      requestId.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The message could not be reviewed.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function send() {
    if (inFlight.current || !review) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', ...review.draft, previewFingerprint: review.preview.fingerprint, requestId: requestId.current, includeBookedConfirmed }) });
      const payload = await response.json();
      if (!response.ok) {
        setUncertain(response.status >= 500);
        setError(payload.error?.message || 'This message could not be queued.');
        return;
      }
      setReceipt(payload.data.receipt);
      setUncertain(false);
    } catch {
      setUncertain(true);
      setError('The send result could not be loaded. Check this same send below; it will not create a second batch.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function refreshReceipt() {
    if (!receipt || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}&requestId=${encodeURIComponent(receipt.requestId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message || 'Delivery status could not be loaded.');
      }
      setReceipt(payload.data.receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delivery status could not be loaded.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <div className="space-y-4" data-testid="bulk-message-receipt">
        <section className={card}>
          <div className="flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check aria-hidden="true" className="size-5" /></div>
          <h2 className="mt-3 text-xl font-semibold text-[var(--owner-ink)]">Your messages are queued</h2>
          <p role="status" className="mt-2 text-sm text-[var(--owner-muted)]">{`${receipt.queued} individual texts queued · ${receipt.totalCredits} credits estimated.`}</p>
          {receipt.skipped > 0 && <p className="mt-2 text-sm text-[var(--owner-muted)]">{`${receipt.skipped} selections were skipped because they were unavailable, no longer matched, or shared a mobile number.`}</p>}
          <p className="mt-2 text-sm text-[var(--owner-muted)]">Delivery follows quiet hours and sending limits. Credits are used as texts send. You can also find each text in the client’s SMS history.</p>
          <Button type="button" variant="brandSoft" className="mt-4 min-h-11" disabled={busy} onClick={() => void refreshReceipt()}>Refresh delivery status</Button>
          <ul className="mt-4 divide-y divide-[var(--owner-line)]">
            {receipt.messages.map(item => (
              <li key={item.id} className="py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-semibold">{item.clientName}</span>
                  <span>{STATUS_LABELS[item.status] ?? 'Checking status'}</span>
                </div>
                {item.failureReason && <p className="mt-1 text-xs text-amber-800">{item.failureReason}</p>}
              </li>
            ))}
          </ul>
        </section>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <Button type="button" variant="ghost" onClick={onBack}>Back to message options</Button>
      </div>
    );
  }

  if (review) {
    const { preview } = review;
    const previewClient = preview.recipients.find(client => client.id === previewClientId) ?? preview.recipients[0];
    const bookedClients = preview.recipients.filter(client => client.hasUpcomingAppointment);
    const insufficientCredits = audience?.sms.availableCredits !== null && audience?.sms.availableCredits !== undefined
      && audience.sms.availableCredits < preview.totalCredits;
    return (
      <div className="space-y-4" data-testid="bulk-message-review">
        <section className={card}>
          <h2 className="text-xl font-semibold text-[var(--owner-ink)]">Review your message</h2>
          <p className="mt-2 text-sm text-[var(--owner-muted)]">Each client receives a separate text.</p>
          <label className="mt-4 block text-sm font-semibold">
            Preview for
            <select value={previewClient?.id ?? ''} onChange={event => setPreviewClientId(event.target.value)} className="mt-2 block min-h-12 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-base">
              {preview.recipients.map(client => <option key={client.id} value={client.id}>{client.fullName || client.phone}</option>)}
            </select>
          </label>
          <SmsMessagePreview body={previewClient?.body ?? preview.body} className="mt-4" />
          <div className="mt-4 rounded-2xl bg-rose-50 p-4">
            <p className="text-lg font-semibold text-[var(--owner-ink)]">{`${preview.recipients.length} ${preview.recipients.length === 1 ? 'client' : 'clients'} · ${preview.totalCredits} ${preview.totalCredits === 1 ? 'credit' : 'credits'}`}</p>
            <p className="mt-1 text-sm text-[var(--owner-muted)]">{`Up to ${preview.creditsPerText} ${preview.creditsPerText === 1 ? 'credit' : 'credits'} per client. The total includes each personalized text.`}</p>
          </div>
          {preview.skipped > 0 && <p className="mt-3 text-sm text-amber-800">{`${preview.skipped} selections were skipped: unavailable clients, changed visit dates, or duplicate mobile numbers.`}</p>}
          {bookedClients.length > 0 && (
            <label className="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <input type="checkbox" className="mt-1 size-4 shrink-0" disabled={busy || uncertain} checked={includeBookedConfirmed} onChange={event => setIncludeBookedConfirmed(event.target.checked)} />
              <span>{`I want to include ${bookedClients.length} already-booked ${bookedClients.length === 1 ? 'client' : 'clients'}: ${bookedClients.map(client => client.fullName || client.phone).join(', ')}. They will receive any offer in this message.`}</span>
            </label>
          )}
          <ul aria-label="Message recipients" className="mt-4 max-h-64 divide-y divide-[var(--owner-line)] overflow-y-auto">
            {preview.recipients.map(client => (
              <li key={client.id} className="flex justify-between gap-3 py-3 text-sm">
                <span className="font-semibold">{client.fullName || 'Client'}</span>
                <span className="text-[var(--owner-muted)]">{client.phone}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-[var(--owner-muted)]">Texts join the delivery queue and may take time to arrive. Opt-outs are checked again before sending.</p>
          {insufficientCredits && <p role="status" className="mt-3 text-sm text-amber-800">Add credits or choose fewer clients before sending.</p>}
        </section>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="sticky bottom-0 grid gap-2 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3 sm:grid-cols-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-12"
            disabled={busy || uncertain}
            onClick={() => {
              setReview(null);
              setError(null);
            }}
          >
            Edit message or clients
          </Button>
          <Button type="button" className="min-h-12" disabled={busy || (!uncertain && (preview.recipients.length === 0 || insufficientCredits || (bookedClients.length > 0 && !includeBookedConfirmed)))} onClick={() => void send()}>{busy ? 'Queuing…' : uncertain ? 'Check this same send' : `Send to ${preview.recipients.length} ${preview.recipients.length === 1 ? 'client' : 'clients'} · ${preview.totalCredits} ${preview.totalCredits === 1 ? 'credit' : 'credits'}`}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="bulk-message-composer">
      <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>Back to message options</Button>
      <section className={card}>
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" className="size-5 text-[var(--owner-accent)]" />
          <h2 className="text-xl font-semibold text-[var(--owner-ink)]">Message multiple clients</h2>
        </div>
        <p className="mt-2 text-sm text-[var(--owner-muted)]">Choose everyone, find clients by their last completed visit, or pick people individually.</p>
        {!audience && !loadError && (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Loading clients…
          </p>
        )}
        {loadError && (
          <div className="mt-4">
            <p role="alert" className="text-sm text-red-800">{loadError}</p>
            <Button type="button" variant="ghost" onClick={() => setLoadVersion(value => value + 1)}>Try loading clients again</Button>
          </div>
        )}
        {audience && (
          <fieldset disabled={busy} className="mt-4 space-y-4">
            <legend className="sr-only">Choose message recipients</legend>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={filter.minWeeks === null ? 'brandSoft' : 'secondary'} aria-pressed={filter.minWeeks === null} onClick={() => selectFilter({ ...filter, minWeeks: null })}>All clients</Button>
              <Button type="button" variant={filter.minWeeks !== null ? 'brandSoft' : 'secondary'} aria-pressed={filter.minWeeks !== null} onClick={() => selectFilter({ ...filter, minWeeks: Number(weeks) || 3 })}>Last visit</Button>
            </div>
            {filter.minWeeks !== null && (
              <label className="block text-sm font-semibold">
                Last completed visit at least
                <div className="mt-2 flex items-center gap-2">
                  <input
                    aria-label="Weeks since last completed visit"
                    type="number"
                    min={1}
                    max={104}
                    value={weeks}
                    onChange={(event) => {
                      setWeeks(event.target.value);
                      if (Number.isInteger(event.target.valueAsNumber) && event.target.valueAsNumber >= 1 && event.target.valueAsNumber <= 104) {
                        selectFilter({ ...filter, minWeeks: event.target.valueAsNumber });
                      } else {
                        setSelected(new Set());
                      }
                    }}
                    className="min-h-12 w-20 rounded-xl border border-[var(--owner-line)] bg-white px-3 text-base"
                  />
                  <span className="font-normal">weeks ago</span>
                </div>
                <span className="mt-2 block text-xs font-normal text-[var(--owner-muted)]">Includes older visits. Clients with no completed visit are excluded.</span>
              </label>
            )}
            {filter.minWeeks === null
              ? (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={filter.excludeUpcoming} onChange={event => selectFilter({ ...filter, excludeUpcoming: event.target.checked })} className="size-4 accent-[var(--owner-accent)]" />
                    Exclude clients with upcoming bookings
                  </label>
                )
              : <p className="text-sm text-[var(--owner-muted)]">Clients with upcoming bookings are always excluded from a last-visit message.</p>}
            <label className="block text-sm font-semibold" htmlFor="bulk-client-search">Search clients</label>
            <div className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--owner-line)] bg-white px-3">
              <Search aria-hidden="true" className="size-4 shrink-0 text-[var(--owner-muted)]" />
              <input id="bulk-client-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or phone" className="min-w-0 flex-1 bg-transparent text-base outline-none" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p aria-live="polite" className="font-semibold">{`${selected.size} selected`}</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setSelected(new Set(eligibleVisible.map(client => client.id)))}>Select all matching</Button>
                <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto" aria-label="Clients to message">
              {visible.map(client => (
                <label key={client.id} className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border p-3 ${selected.has(client.id) ? 'border-[var(--owner-accent)] bg-rose-50' : 'border-[var(--owner-line)] bg-white'} ${client.eligible ? '' : 'opacity-60'}`}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${client.fullName || client.phone}`}
                    disabled={!client.eligible}
                    checked={selected.has(client.id)}
                    onChange={() => setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(client.id)) {
                        next.delete(client.id);
                      } else {
                        next.add(client.id);
                      }
                      return next;
                    })}
                    className="size-4 shrink-0 accent-[var(--owner-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{client.fullName || 'Client'}</span>
                    <span className="mt-0.5 block text-xs text-[var(--owner-muted)]">
                      {client.lastCompletedAt ? `Last completed visit: ${new Date(client.lastCompletedAt).toLocaleDateString('en-CA', { timeZone: audience.timeZone, month: 'short', day: 'numeric', year: 'numeric' })}` : 'No completed visit'}
                      {client.hasUpcomingAppointment ? ' · Upcoming booking' : ''}
                    </span>
                    {client.unavailableReason && <span className="mt-1 block text-xs text-amber-800">{client.unavailableReason}</span>}
                  </span>
                </label>
              ))}
              {visible.length === 0 && <p className="py-5 text-center text-sm text-[var(--owner-muted)]">No clients match these filters.</p>}
            </div>
            <p className="text-xs text-[var(--owner-muted)]">Opted-out, blocked and archived clients cannot receive this message. Shared mobile numbers receive one text.</p>
          </fieldset>
        )}
      </section>
      <section className={card}>
        <label htmlFor="bulk-custom-message" className="text-lg font-semibold text-[var(--owner-ink)]">Your message</label>
        <textarea id="bulk-custom-message" rows={5} maxLength={1000} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} placeholder="Write a message for your selected clients…" className="mt-3 w-full rounded-2xl border border-[var(--owner-line)] bg-white p-3 text-base outline-none focus:border-[var(--owner-accent)]" />
        <Button type="button" variant="ghost" disabled={busy || message.length + 15 > 1000} onClick={() => setMessage(current => `${current.trimEnd()}${current.trim() ? ' ' : ''}{{first_name}}`)}>First name</Button>
        <Button type="button" variant="ghost" disabled={busy || !audience || message.length + (audience?.bookingUrl.length ?? 0) + 1 > 1000} onClick={() => setMessage(current => `${current.trimEnd()}${current.trim() ? ' ' : ''}${audience?.bookingUrl ?? ''}`)}>Add booking link</Button>
        {invalidFields && <p role="alert" className="mt-3 text-sm text-red-800">A message field is unknown or unfinished. Use First name or Add booking link before reviewing.</p>}
        {message.trim() && !invalidFields && (
          <>
            <p className="mt-3 text-xs text-[var(--owner-muted)]">{`Preview for ${selectedClients[0]?.fullName || 'a client'}. Names and booking links are filled in for each recipient.`}</p>
            <SmsMessagePreview body={finalBody} className="mt-2" />
          </>
        )}
      </section>
      {audience && <p className="px-1 text-sm text-[var(--owner-muted)]">{audience.sms.availableCredits === null ? audience.sms.senderLabel : `${audience.sms.availableCredits} SMS credits available`}</p>}
      {audience && !audience.sms.manualAvailable && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{audience.sms.detail}</p>}
      {creditShortfall && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">This estimate exceeds your balance. Review the final recipients and credit total before sending.</p>}
      {selected.size > MAX_BULK_MESSAGE_CLIENTS && <p role="alert" className="text-sm text-red-800">Choose up to 1,000 clients per send.</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="sticky bottom-0 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3">
        <Button type="button" className="min-h-12 w-full" disabled={busy || !audience?.sms.manualAvailable || !selected.size || selected.size > MAX_BULK_MESSAGE_CLIENTS || !message.trim() || !validWeeks || invalidFields || creditsPerText > 10} onClick={() => void reviewMessage()}>{busy ? 'Preparing review…' : `Review message · ${selected.size} clients · ${estimatedCredits} credits`}</Button>
      </div>
    </div>
  );
}
