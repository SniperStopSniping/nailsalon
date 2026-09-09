'use client';

/**
 * Usage & Billing modal — Gate C4 (§10.1/§10.2) and the §8.10 foundation.
 *
 * One primary, understandable number first ("277 SMS credits remaining"),
 * then the optional breakdown (monthly / starter / purchased / bonus) — no
 * lot or reservation vocabulary anywhere. Message history arrives already
 * masked and friendly from the usage API; this component never sees a raw
 * recipient or provider error. Buy More drives the server-authoritative
 * top-up checkout; Manage billing opens the Stripe Billing Portal. All
 * controls are reduced-motion safe (CSS only).
 */
import { X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';

type UsagePayload = {
  salonId: string;
  usage: {
    availableCredits: number;
    monthlyCredits: number;
    starterCredits: number;
    purchasedCredits: number;
    bonusCredits: number;
    monthlyAllowance: number;
    resetsAt: string | null;
    blockedMessages: number;
    pendingCredits?: number;
    plan: {
      displayName: string;
      cadence: string;
      status: string;
      paidThrough: string;
      cancelAtPeriodEnd: boolean;
    } | null;
  };
  creditPurchasesAvailable?: boolean;
  topupOffers: Array<{ key: string; credits: number; priceCents: number }>;
  history: Array<{
    id: string;
    channel: string;
    eventType: string;
    recipient: string;
    status: string;
    scheduledFor: string;
    sentAt: string | null;
    creditsUsed: number;
    reminderLeadMinutes: number | null;
    failureReason: string | null;
  }>;
  nextCursor: string | null;
};

type ReminderRule = {
  id: string;
  offsetMinutes: number;
  channels: 'sms' | 'email' | 'both';
  enabled: boolean;
};

type EventSettings = { enabled: boolean; channels: 'sms' | 'email' | 'both' };
type ClientEventKey = 'booking_confirmation' | 'appointment_reminder' | 'appointment_cancelled' | 'appointment_rescheduled';

const CLIENT_EVENT_LABELS: Record<ClientEventKey, string> = {
  booking_confirmation: 'Booking confirmations',
  appointment_reminder: 'Appointment reminders',
  appointment_cancelled: 'Cancellation notices',
  appointment_rescheduled: 'Reschedule notices',
};

const CLIENT_EVENT_KEYS = Object.keys(CLIENT_EVENT_LABELS) as ClientEventKey[];

type CommunicationsForm = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  killSwitch: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  rules: ReminderRule[];
  events: Record<string, EventSettings>;
};

type CommunicationsResponse = {
  communications?: {
    email?: { enabled?: boolean };
    sms?: { enabled?: boolean };
    killSwitch?: boolean;
    quietHours?: { enabled?: boolean; start?: string; end?: string };
    reminders?: { rules?: ReminderRule[] };
    events?: Record<string, EventSettings>;
  };
};

type HistoryCategory = 'all' | 'confirmations' | '24h' | '1h' | 'cancellations' | 'other';

type UsageBillingModalProps = {
  salonSlug: string;
  onClose: () => void;
};

const EVENT_LABELS: Record<string, string> = {
  booking_confirmation: 'Booking confirmation',
  appointment_reminder: 'Appointment reminder',
  appointment_cancelled: 'Cancellation notice',
  appointment_rescheduled: 'Reschedule notice',
  deposit_received: 'Deposit receipt',
  deposit_refunded: 'Deposit refund',
  balance_reminder: 'Balance reminder',
  manual_reminder: 'Manual reminder',
  manual_text: 'Manual text',
  booking_request_received: 'Booking request received',
  booking_request_approved: 'Booking confirmed',
  booking_request_declined: 'Booking request declined',
  booking_request_expired: 'Booking request expired',
  owner_new_booking: 'New booking alert',
  owner_appointment_cancelled: 'Cancellation alert',
  tech_new_booking: 'Technician booking alert',
  tech_appointment_cancelled: 'Technician cancellation alert',
};

const STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  queued: 'Queued',
  accepted: 'Queued',
  delivered: 'Delivered',
  undelivered: 'Undelivered',
  pending: 'Scheduled',
  claimed: 'Sending',
  sending: 'Sending',
  failed: 'Not delivered',
  canceled: 'Cancelled',
  suppressed: 'Not sent',
  expired: 'Expired',
  blocked_no_credit: 'Waiting for credits',
  send_outcome_unknown: 'Confirming delivery',
};

const CATEGORY_LABELS: Record<Exclude<HistoryCategory, 'all'>, string> = {
  'confirmations': 'Confirmations',
  '24h': '24-hour reminders',
  '1h': '1-hour reminders',
  'cancellations': 'Cancellations',
  'other': 'Other messages',
};

const DEFAULT_COMMUNICATIONS: CommunicationsForm = {
  emailEnabled: true,
  smsEnabled: false,
  killSwitch: false,
  quietHours: { enabled: true, start: '21:00', end: '09:00' },
  rules: [],
  events: {},
};

function toCommunicationsForm(response: CommunicationsResponse): CommunicationsForm {
  const communications = response.communications;
  return {
    emailEnabled: communications?.email?.enabled !== false,
    smsEnabled: communications?.sms?.enabled === true,
    killSwitch: communications?.killSwitch === true,
    quietHours: {
      enabled: communications?.quietHours?.enabled !== false,
      start: communications?.quietHours?.start ?? '21:00',
      end: communications?.quietHours?.end ?? '09:00',
    },
    rules: (communications?.reminders?.rules ?? []).map(rule => ({ ...rule })),
    events: { ...(communications?.events ?? {}) },
  };
}

function historyCategory(entry: UsagePayload['history'][number]): Exclude<HistoryCategory, 'all'> {
  if (entry.eventType === 'booking_confirmation' || entry.eventType === 'booking_request_approved') {
    return 'confirmations';
  }
  if (entry.eventType === 'appointment_reminder' && entry.reminderLeadMinutes === 1440) {
    return '24h';
  }
  if (entry.eventType === 'appointment_reminder' && entry.reminderLeadMinutes === 60) {
    return '1h';
  }
  if (entry.eventType.includes('cancelled')) {
    return 'cancellations';
  }
  return 'other';
}

function creditLabel(entry: UsagePayload['history'][number]): string {
  if (entry.channel !== 'sms') {
    return 'Email included · no SMS credits';
  }
  if (entry.creditsUsed === 0) {
    return 'No SMS credits charged';
  }
  return `${entry.creditsUsed} SMS credit${entry.creditsUsed === 1 ? '' : 's'} charged`;
}

export function UsageBillingModal({ salonSlug, onClose }: UsageBillingModalProps) {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [communications, setCommunications] = useState<CommunicationsForm>(DEFAULT_COMMUNICATIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [tab, setTab] = useState<'activity' | 'settings'>('activity');
  const [historyFilter, setHistoryFilter] = useState<HistoryCategory>('all');
  const [loadingMore, setLoadingMore] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const savedEventsRef = useRef<Record<string, EventSettings>>({});
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    setCommunications(DEFAULT_COMMUNICATIONS);
    setSettingsDirty(false);
    setSettingsSaving(false);
    setSettingsMessage(null);
    setLoadingMore(false);
    (async () => {
      try {
        const [usageResponse, settingsResponse] = await Promise.all([
          fetch(`/api/admin/salon/communications/usage?salonSlug=${salonSlug}`),
          fetch(`/api/admin/salon/settings?salonSlug=${salonSlug}`),
        ]);
        if (!usageResponse.ok || !settingsResponse.ok) {
          throw new Error('usage fetch failed');
        }
        const [body, settingsBody] = await Promise.all([
          usageResponse.json(),
          settingsResponse.json() as Promise<CommunicationsResponse>,
        ]);
        if (!cancelled && requestVersionRef.current === requestVersion) {
          setData(body.data);
          const form = toCommunicationsForm(settingsBody);
          setCommunications(form);
          savedEventsRef.current = form.events;
        }
      } catch {
        if (!cancelled && requestVersionRef.current === requestVersion) {
          setError('Could not load usage. Please try again.');
        }
      } finally {
        if (!cancelled && requestVersionRef.current === requestVersion) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salonSlug]);

  const loadMore = useCallback(async () => {
    if (data === null || data.nextCursor === null || loadingMore) {
      return;
    }
    const requestVersion = requestVersionRef.current;
    try {
      setLoadingMore(true);
      const query = new URLSearchParams({ salonSlug, cursor: data.nextCursor });
      const response = await fetch(`/api/admin/salon/communications/usage?${query.toString()}`);
      if (!response.ok) {
        throw new Error('history fetch failed');
      }
      const body = await response.json();
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setData(current => current === null
        ? current
        : { ...current, history: [...current.history, ...body.data.history], nextCursor: body.data.nextCursor });
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setError('Could not load more history. Please try again.');
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setLoadingMore(false);
      }
    }
  }, [data, loadingMore, salonSlug]);

  const saveSettings = useCallback(async () => {
    if (settingsSaving) {
      return;
    }
    if (communications.quietHours.start === communications.quietHours.end) {
      setSettingsMessage('Choose different start and end times for quiet hours.');
      return;
    }
    const enabledOffsets = communications.rules.filter(rule => rule.enabled).map(rule => rule.offsetMinutes);
    if (new Set(enabledOffsets).size !== enabledOffsets.length) {
      setSettingsMessage('Choose a different time for each enabled reminder.');
      return;
    }
    const requestVersion = requestVersionRef.current;
    const changedEvents = Object.fromEntries(
      CLIENT_EVENT_KEYS.filter((key) => {
        const current = communications.events[key];
        const saved = savedEventsRef.current[key];
        return current !== undefined && (saved === undefined || current.enabled !== saved.enabled || current.channels !== saved.channels);
      }).map(key => [key, communications.events[key]!]),
    );
    try {
      setSettingsSaving(true);
      setSettingsMessage(null);
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${salonSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communications: {
            sms: { enabled: communications.smsEnabled },
            email: { enabled: communications.emailEnabled },
            killSwitch: communications.killSwitch,
            quietHours: communications.quietHours,
            reminders: { rules: communications.rules },
            ...(Object.keys(changedEvents).length > 0 ? { events: changedEvents } : {}),
          },
        }),
      });
      const body = await response.json() as CommunicationsResponse;
      if (!response.ok) {
        throw new Error('settings save failed');
      }
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      const form = toCommunicationsForm(body);
      setCommunications(form);
      savedEventsRef.current = form.events;
      setSettingsDirty(false);
      setSettingsMessage('Saved');
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setSettingsMessage('Could not save settings. Please try again.');
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setSettingsSaving(false);
      }
    }
  }, [communications, salonSlug, settingsSaving]);

  const groupedHistory = useMemo(() => {
    const groups: Record<Exclude<HistoryCategory, 'all'>, UsagePayload['history']> = {
      'confirmations': [],
      '24h': [],
      '1h': [],
      'cancellations': [],
      'other': [],
    };
    data?.history.forEach((entry) => {
      groups[historyCategory(entry)].push(entry);
    });
    return groups;
  }, [data?.history]);

  const updateCommunications = (update: (current: CommunicationsForm) => CommunicationsForm) => {
    setCommunications(update);
    setSettingsDirty(true);
    setSettingsMessage(null);
  };

  const openPortal = useCallback(async () => {
    if (portalLoading) {
      return;
    }
    try {
      setPortalLoading(true);
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: undefined, salonSlug }),
      });
      const body = await response.json();
      if (body.url) {
        window.location.assign(body.url);
      }
    } finally {
      setPortalLoading(false);
    }
  }, [portalLoading, salonSlug]);

  const buyTopup = useCallback(async (topupOfferKey: string) => {
    if (buying !== null || data?.creditPurchasesAvailable !== true
      || !data.topupOffers.some(offer => offer.key === topupOfferKey)) {
      return;
    }
    try {
      setBuying(topupOfferKey);
      setBuyError(null);
      const response = await fetch('/api/billing/checkout/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: data?.salonId, topupOfferKey }),
      });
      const body = await response.json();
      if (response.ok && body.data?.url) {
        window.location.assign(body.data.url);
        return;
      }
      if (['TOPUPS_DISABLED', 'PRICE_UNCONFIGURED'].includes(body.error?.code)) {
        setData(current => current?.salonId === data.salonId
          ? { ...current, creditPurchasesAvailable: false, topupOffers: [] }
          : current);
      } else {
        setBuyError('Could not start the purchase. Please try again.');
      }
    } catch {
      setBuyError('Could not start the purchase. Please try again.');
    } finally {
      setBuying(null);
    }
  }, [buying, data]);

  const usage = data?.usage ?? null;

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      maxWidthClassName="max-w-xl"
      contentClassName="max-h-[90vh] overflow-hidden rounded-t-[20px] bg-white shadow-xl sm:rounded-[20px]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="usage-billing-title">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 id="usage-billing-title" className="text-lg font-semibold text-gray-900">Client reminders</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close client reminders"
            className="flex size-11 items-center justify-center rounded-full bg-gray-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
          >
            <X className="size-4 text-gray-600" />
          </button>
        </div>

        <div className="grid grid-cols-2 border-b border-gray-100 px-5" aria-label="Client reminders sections">
          <button type="button" aria-pressed={tab === 'activity'} onClick={() => setTab('activity')} className={`min-h-11 border-b-2 text-sm font-medium ${tab === 'activity' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}>Usage &amp; history</button>
          <button type="button" aria-pressed={tab === 'settings'} onClick={() => setTab('settings')} className={`min-h-11 border-b-2 text-sm font-medium ${tab === 'settings' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}>Settings</button>
        </div>

        <div className="max-h-[calc(90vh-114px)] space-y-6 overflow-y-auto p-5">
          {loading && (
            <p role="status" aria-live="polite" className="text-[14px] text-gray-500">
              Loading usage…
            </p>
          )}
          {error && <p className="text-[14px] text-red-600">{error}</p>}

          {usage && tab === 'activity' && (
            <>
              {/* §10.2: one primary number first. */}
              <section aria-labelledby="credits-heading" className="space-y-2">
                <h3 id="credits-heading" className="sr-only">SMS credits</h3>
                <p className="text-2xl font-semibold text-gray-900">
                  {usage.availableCredits}
                  {' '}
                  SMS credits remaining
                </p>
                <ul className="space-y-1 text-[14px] text-gray-600">
                  {usage.monthlyAllowance > 0 && (
                    <li>
                      {usage.monthlyAllowance - usage.monthlyCredits}
                      {' '}
                      of
                      {' '}
                      {usage.monthlyAllowance}
                      {' '}
                      monthly credits used
                      {usage.resetsAt !== null && ` · resets ${new Date(usage.resetsAt).toLocaleDateString()}`}
                    </li>
                  )}
                  {usage.starterCredits > 0 && (
                    <li>
                      {usage.starterCredits}
                      {' '}
                      starter credits (do not renew)
                    </li>
                  )}
                  {usage.purchasedCredits > 0 && (
                    <li>
                      {usage.purchasedCredits}
                      {' '}
                      purchased credits (never expire)
                    </li>
                  )}
                  {usage.bonusCredits > 0 && (
                    <li>
                      {usage.bonusCredits}
                      {' '}
                      bonus credits
                    </li>
                  )}
                  <li>Email confirmations and reminders are always included.</li>
                </ul>
                {usage.blockedMessages > 0 && (
                  <p className="rounded-lg bg-amber-50 p-3 text-[14px] text-amber-800">
                    {usage.blockedMessages}
                    {' '}
                    text
                    {usage.blockedMessages === 1 ? ' is' : 's are'}
                    {' '}
                    waiting for credits. Email delivery continues.
                  </p>
                )}
                {usage.pendingCredits !== undefined && usage.pendingCredits > 0 && (
                  <p className="rounded-lg bg-blue-50 p-3 text-[14px] text-blue-800">
                    {usage.pendingCredits}
                    {' '}
                    credit
                    {usage.pendingCredits === 1 ? ' is' : 's are'}
                    {' '}
                    set aside for texts being sent.
                  </p>
                )}
              </section>

              <section aria-labelledby="plan-heading" className="space-y-2">
                <h3 id="plan-heading" className="text-[15px] font-medium text-gray-900">Plan</h3>
                {usage.plan === null
                  ? <p className="text-[14px] text-gray-600">No subscription — starter and purchased credits only.</p>
                  : (
                      <p className="text-[14px] text-gray-600">
                        {usage.plan.displayName}
                        {' '}
                        (
                        {usage.plan.cadence}
                        )
                        {usage.plan.cancelAtPeriodEnd && ' · cancellation scheduled'}
                        {' · paid through '}
                        {new Date(usage.plan.paidThrough).toLocaleDateString()}
                      </p>
                    )}
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] font-medium text-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40 motion-reduce:transition-none"
                >
                  {portalLoading ? 'Opening…' : 'Manage billing'}
                </button>
              </section>

              {data!.creditPurchasesAvailable === true && data!.topupOffers.length > 0
                ? (
                    <section aria-labelledby="buymore-heading" className="space-y-2">
                      <h3 id="buymore-heading" className="text-[15px] font-medium text-gray-900">Buy more credits</h3>
                      <div className="flex flex-wrap gap-2">
                        {data!.topupOffers.map(offer => (
                          <button
                            key={offer.key}
                            type="button"
                            onClick={() => buyTopup(offer.key)}
                            disabled={buying !== null}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] font-medium text-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40 motion-reduce:transition-none"
                          >
                            {buying === offer.key ? 'Opening…' : `${offer.credits} credits — CAD $${(offer.priceCents / 100).toFixed(2)}`}
                          </button>
                        ))}
                      </div>
                      <p role="status" aria-live="polite" className="text-[13px] text-red-600">{buyError ?? ''}</p>
                      <p className="text-[13px] text-[#8E8E93]">Purchased credits never expire. Prices are in CAD.</p>
                    </section>
                  )
                : (
                    <p className="text-[14px] text-gray-600">Credit purchases are not available yet.</p>
                  )}

              <section aria-labelledby="history-heading" className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="history-heading" className="text-[15px] font-medium text-gray-900">Message history</h3>
                  <label className="sr-only" htmlFor="history-filter">Filter message history</label>
                  <select id="history-filter" value={historyFilter} onChange={event => setHistoryFilter(event.target.value as HistoryCategory)} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-[14px]">
                    <option value="all">All messages</option>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                {data!.history.length === 0 && (
                  <p className="text-[14px] text-gray-500">No messages yet.</p>
                )}
                {(Object.keys(CATEGORY_LABELS) as Array<Exclude<HistoryCategory, 'all'>>).map(category => (
                  (historyFilter === 'all' || historyFilter === category) && groupedHistory[category].length > 0
                    ? (
                        <div key={category} className="space-y-1">
                          <h4 className="text-[13px] font-medium text-gray-500">{CATEGORY_LABELS[category]}</h4>
                          <ul className="divide-y divide-gray-100">
                            {groupedHistory[category].map(entry => (
                              <li key={entry.id} className="space-y-1 py-2 text-[14px]">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-gray-900">
                                    {EVENT_LABELS[entry.eventType] ?? 'Message'}
                                    {' '}
                                    ·
                                    {' '}
                                    {entry.channel === 'sms' ? 'Text' : 'Email'}
                                  </span>
                                  <span className="shrink-0 text-gray-500">{STATUS_LABELS[entry.status] ?? entry.status}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-gray-500">
                                  <span>{entry.recipient}</span>
                                  <span className="shrink-0">{new Date(entry.scheduledFor).toLocaleString()}</span>
                                </div>
                                <p className="text-[13px] text-gray-500">{creditLabel(entry)}</p>
                                {entry.failureReason !== null && <p className="text-[13px] text-amber-700">{entry.failureReason}</p>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    : null
                ))}
                {data!.nextCursor !== null && <button type="button" onClick={loadMore} disabled={loadingMore} className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] font-medium text-gray-800 disabled:opacity-40">{loadingMore ? 'Loading…' : 'Load more'}</button>}
              </section>
            </>
          )}
          {!loading && tab === 'settings' && (
            <section aria-labelledby="reminder-settings-heading" className="space-y-5">
              <div>
                <h3 id="reminder-settings-heading" className="text-base font-medium text-gray-900">Reminder settings</h3>
                <p className="mt-1 text-[14px] text-gray-600">Email is included. Text messages use SMS credits when they are sent.</p>
              </div>
              <fieldset disabled={settingsSaving} className="space-y-2 disabled:opacity-60">
                <legend className="text-[15px] font-medium text-gray-900">Channels</legend>
                {([
                  ['Pause all communications', 'killSwitch'],
                  ['Email to clients', 'emailEnabled'],
                  ['Text messages to clients', 'smsEnabled'],
                ] as const).map(([label, key]) => (
                  <label key={key} className="flex min-h-11 items-center justify-between gap-3 text-[14px] text-gray-800">
                    {label}
                    <input type="checkbox" checked={communications[key]} onChange={event => updateCommunications(current => ({ ...current, [key]: event.target.checked }))} />
                  </label>
                ))}
              </fieldset>
              <fieldset disabled={settingsSaving} className="space-y-3 disabled:opacity-60">
                <legend className="text-[15px] font-medium text-gray-900">Appointment reminders</legend>
                {communications.rules.map((rule, index) => (
                  <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3">
                    <input type="checkbox" aria-label={`Reminder ${index + 1} enabled`} checked={rule.enabled} onChange={event => updateCommunications(current => ({ ...current, rules: current.rules.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) }))} />
                    <select aria-label={`Reminder ${index + 1} timing`} value={String(rule.offsetMinutes)} onChange={event => updateCommunications(current => ({ ...current, rules: current.rules.map(item => item.id === rule.id ? { ...item, offsetMinutes: Number(event.target.value) } : item) }))} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-[14px]">
                      <option value="60">1 hour before</option>
                      <option value="120">2 hours before</option>
                      <option value="240">4 hours before</option>
                      <option value="1440">24 hours before</option>
                      <option value="2880">2 days before</option>
                      <option value="4320">3 days before</option>
                    </select>
                    <select aria-label={`Reminder ${index + 1} channel`} value={rule.channels} onChange={event => updateCommunications(current => ({ ...current, rules: current.rules.map(item => item.id === rule.id ? { ...item, channels: event.target.value as ReminderRule['channels'] } : item) }))} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-[14px]">
                      <option value="email">Email</option>
                      <option value="sms">Text</option>
                      <option value="both">Email &amp; text</option>
                    </select>
                    <button type="button" onClick={() => updateCommunications(current => ({ ...current, rules: current.rules.filter(item => item.id !== rule.id) }))} className="ml-auto text-[14px] text-red-600">Remove</button>
                  </div>
                ))}
                {communications.rules.length < 3 && <button type="button" onClick={() => updateCommunications(current => ({ ...current, rules: [...current.rules, { id: `crule_${crypto.randomUUID()}`, offsetMinutes: [60, 120, 240, 1440, 2880, 4320].find(minutes => !current.rules.some(rule => rule.enabled && rule.offsetMinutes === minutes)) ?? 4320, channels: 'email', enabled: true }] }))} className="text-[14px] font-medium text-gray-900">+ Add reminder</button>}
              </fieldset>
              <fieldset disabled={settingsSaving} className="space-y-3 disabled:opacity-60">
                <legend className="text-[15px] font-medium text-gray-900">Quiet hours</legend>
                <label className="flex min-h-11 items-center justify-between gap-3 text-[14px] text-gray-800">
                  Hold texts overnight
                  <input type="checkbox" checked={communications.quietHours.enabled} onChange={event => updateCommunications(current => ({ ...current, quietHours: { ...current.quietHours, enabled: event.target.checked } }))} />
                </label>
                {communications.quietHours.enabled && (
                  <div className="flex gap-3">
                    <label className="text-[14px] text-gray-700">
                      From
                      <input aria-label="Quiet hours start" type="time" value={communications.quietHours.start} onChange={event => updateCommunications(current => ({ ...current, quietHours: { ...current.quietHours, start: event.target.value } }))} className="ml-1 h-9 rounded-md border border-gray-300 px-2" />
                    </label>
                    <label className="text-[14px] text-gray-700">
                      To
                      <input aria-label="Quiet hours end" type="time" value={communications.quietHours.end} onChange={event => updateCommunications(current => ({ ...current, quietHours: { ...current.quietHours, end: event.target.value } }))} className="ml-1 h-9 rounded-md border border-gray-300 px-2" />
                    </label>
                  </div>
                )}
                <p className="text-[13px] text-gray-500">Quiet hours may delay scheduled reminders until quiet hours end, using your salon’s timezone.</p>
              </fieldset>
              <fieldset disabled={settingsSaving} className="space-y-3 disabled:opacity-60">
                <legend className="text-[15px] font-medium text-gray-900">Client message types</legend>
                {CLIENT_EVENT_KEYS.map((eventKey) => {
                  const event = communications.events[eventKey];
                  if (event === undefined) {
                    return null;
                  }
                  return (
                    <div key={eventKey} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3">
                      <label className="mr-auto flex items-center gap-2 text-[14px] text-gray-800">
                        <input type="checkbox" aria-label={`${CLIENT_EVENT_LABELS[eventKey]} enabled`} checked={event.enabled} onChange={changeEvent => updateCommunications(current => ({ ...current, events: { ...current.events, [eventKey]: { ...current.events[eventKey]!, enabled: changeEvent.target.checked } } }))} />
                        {CLIENT_EVENT_LABELS[eventKey]}
                      </label>
                      <select aria-label={`${CLIENT_EVENT_LABELS[eventKey]} channel`} value={event.channels} onChange={changeEvent => updateCommunications(current => ({ ...current, events: { ...current.events, [eventKey]: { ...current.events[eventKey]!, channels: changeEvent.target.value as EventSettings['channels'] } } }))} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-[14px]">
                        <option value="email">Email</option>
                        <option value="sms">Text</option>
                        <option value="both">Email &amp; text</option>
                      </select>
                    </div>
                  );
                })}
              </fieldset>
              <div className="flex items-center gap-3">
                <button type="button" onClick={saveSettings} disabled={settingsSaving || !settingsDirty} className="rounded-lg bg-gray-900 px-4 py-2 text-[14px] font-medium text-white disabled:opacity-40">{settingsSaving ? 'Saving…' : 'Save reminder settings'}</button>
                <span role="status" className="text-[13px] text-gray-600">{settingsMessage ?? ''}</span>
              </div>
            </section>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
