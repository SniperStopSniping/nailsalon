'use client';

/**
 * IntegrationsModal
 *
 * Focused Integrations home opened from the More workspace. Shows only
 * integrations that genuinely exist, each with a plain-language status:
 * - Google Calendar (two-way sync — reuses the existing connect/calendar APIs)
 * - Text messaging (manual native composer vs optional automatic Twilio)
 * - Email (transactional + owner/staff alerts; marketing email does not exist)
 *
 * Payments is intentionally absent: no client-payment integration exists, and
 * the Stripe billing routes are platform-subscription plumbing, not a salon
 * integration.
 */

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Mail,
  MessageSquareText,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { isNativeSmsCapableDevice, resolveAutomaticTextStatus } from '@/libs/textingStatus';

type GoogleReadiness
  = | 'not_connected'
  | 'reconnect_required'
  | 'attention_required'
  | 'setup_incomplete'
  | 'ready';

type Health = {
  availability: { google: boolean; twilio: boolean; email: boolean; photos: boolean };
  google: {
    status: string;
    readiness?: GoogleReadiness;
    blockingCalendarCount?: number;
    email?: string | null;
    lastError?: string | null;
    inboundSyncEnabled?: boolean;
    inboundSyncedAt?: string | null;
    inboundSyncError?: string | null;
  };
  twilio: {
    status: string;
    phoneNumber?: string | null;
    lastError?: string | null;
  };
  latestSmsDeliveryError?: {
    errorCode?: string | null;
    errorMessage?: string | null;
    createdAt: string;
  } | null;
};

type CalendarOption = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

type ModuleReason = 'ENABLED' | 'MODULE_DISABLED' | 'UPGRADE_REQUIRED';

export type IntegrationsView = 'home' | 'google' | 'texting' | 'email';

const GOOGLE_READINESS_LABELS: Record<GoogleReadiness, string> = {
  not_connected: 'Not connected',
  reconnect_required: 'Reconnect required',
  attention_required: 'Needs attention',
  setup_incomplete: 'Setup incomplete',
  ready: 'Ready',
};

type StatusTone = 'good' | 'warn' | 'muted' | 'error';

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const toneClass
    = tone === 'good'
      ? 'bg-emerald-100 text-emerald-900'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-900'
        : tone === 'error'
          ? 'bg-red-100 text-red-800'
          : 'bg-stone-100 text-stone-600';
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${toneClass}`}>
      {label}
    </span>
  );
}

function googleStatusTone(readiness: GoogleReadiness): StatusTone {
  if (readiness === 'ready') {
    return 'good';
  }
  if (readiness === 'not_connected') {
    return 'muted';
  }
  return 'warn';
}

// Manual/automatic texting status logic is shared with the Marketing surface —
// both must report identical channel truth (src/libs/textingStatus.ts).

type IntegrationsModalProps = {
  onClose: () => void;
  salonSlug: string | null;
  /** Deep-linked sub-view (e.g. returning from the Google OAuth callback). */
  initialView?: IntegrationsView;
  /** One-time notice carried by ?google= / ?twilio= callback params. */
  initialNotice?: string | null;
  /** Optional hop to the Settings app (used by the Email/Texting views). */
  onOpenSettings?: () => void;
};

export function IntegrationsModal({
  onClose,
  salonSlug,
  initialView = 'home',
  initialNotice = null,
  onOpenSettings,
}: IntegrationsModalProps) {
  const [view, setView] = useState<IntegrationsView>(initialView);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [smsModuleReason, setSmsModuleReason] = useState<ModuleReason | null>(null);
  const [message, setMessage] = useState<string | null>(initialNotice);

  // Google view state (same contracts the Luster page used)
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [destinationCalendarId, setDestinationCalendarId] = useState('primary');
  const [busyCalendarIds, setBusyCalendarIds] = useState<string[]>([]);
  const [calendarDirty, setCalendarDirty] = useState(false);
  const [working, setWorking] = useState('');
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // Twilio provisioning state
  const [areaCode, setAreaCode] = useState('416');
  const [twilioPreview, setTwilioPreview] = useState<{
    number: { phone_number: string };
    monthlyPrice: string | null;
    currency: string;
  } | null>(null);

  const [smsCapableDevice, setSmsCapableDevice] = useState(true);

  useEffect(() => {
    setSmsCapableDevice(isNativeSmsCapableDevice(navigator.userAgent));
  }, []);

  const loadHealth = useCallback(async () => {
    if (!salonSlug) {
      return;
    }
    try {
      const [healthPayload, modulesPayload] = await Promise.all([
        fetch(`/api/integrations/health?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store' })
          .then(response => (response.ok ? response.json() : Promise.reject(new Error(`health ${response.status}`)))),
        fetch(`/api/admin/settings/modules?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store' })
          .then(response => (response.ok ? response.json() : null))
          .catch(() => null),
      ]);
      setHealth(healthPayload.data ?? null);
      setHealthError(null);
      setSmsModuleReason(modulesPayload?.data?.moduleReasons?.smsReminders ?? null);
    } catch {
      setHealthError('Integration status could not be loaded. Pull to refresh or try again shortly.');
    }
  }, [salonSlug]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  // Load calendar options whenever Google is connected and the view needs them.
  useEffect(() => {
    if (view !== 'google' || !salonSlug || health?.google.status !== 'active') {
      return;
    }
    let cancelled = false;
    (async () => {
      const payload = await fetch(
        `/api/integrations/google/calendars?salonSlug=${encodeURIComponent(salonSlug)}`,
      ).then(response => response.json()).catch(() => null);
      if (cancelled || !payload) {
        return;
      }
      setCalendars(payload.data?.calendars || []);
      setDestinationCalendarId(payload.data?.selection?.destinationCalendarId || 'primary');
      setBusyCalendarIds(payload.data?.selection?.busyCalendarIds || []);
      setCalendarDirty(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [view, salonSlug, health?.google.status]);

  async function saveCalendars() {
    setWorking('calendar');
    const response = await fetch('/api/integrations/google/calendars', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug, destinationCalendarId, busyCalendarIds }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      setDestinationCalendarId(payload.data?.selection?.destinationCalendarId || destinationCalendarId);
      setBusyCalendarIds(payload.data?.selection?.busyCalendarIds || busyCalendarIds);
      setCalendarDirty(false);
      setMessage('Calendars saved. Busy Google events now prevent double-booking.');
      void loadHealth();
    } else {
      setMessage(payload?.error || 'Calendar choices could not be saved. Reconnect Google Calendar and try again.');
    }
    setWorking('');
  }

  async function disconnectGoogle() {
    setWorking('disconnect');
    const response = await fetch('/api/integrations/google/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug }),
    });
    if (response.ok) {
      setMessage('Google Calendar disconnected. Appointments no longer sync and Google events no longer block bookings.');
      setCalendars([]);
      setConfirmingDisconnect(false);
      void loadHealth();
    } else {
      const payload = await response.json().catch(() => null);
      setMessage(payload?.error || 'Google Calendar could not be disconnected. Try again.');
    }
    setWorking('');
  }

  async function previewTwilio() {
    setWorking('twilio-preview');
    const response = await fetch(
      `/api/integrations/twilio/provision?salonSlug=${encodeURIComponent(salonSlug ?? '')}&areaCode=${encodeURIComponent(areaCode)}`,
    );
    const payload = await response.json();
    if (response.ok) {
      setTwilioPreview(payload.data);
    } else {
      setMessage(payload.error || 'No number is available.');
    }
    setWorking('');
  }

  async function provisionTwilio() {
    setWorking('twilio-provision');
    const response = await fetch('/api/integrations/twilio/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        areaCode,
        confirmedMonthlyPrice: twilioPreview?.monthlyPrice || null,
      }),
    });
    const payload = await response.json();
    setMessage(
      response.ok
        ? `Automatic texts are active from ${payload.data.phoneNumber}.`
        : payload.error || 'Twilio setup failed.',
    );
    if (response.ok) {
      setTwilioPreview(null);
      void loadHealth();
    }
    setWorking('');
  }

  const googleReadiness: GoogleReadiness = health
    ? (health.availability.google === false && health.google.status === 'disconnected'
        ? 'not_connected'
        : (health.google.readiness ?? 'not_connected'))
    : 'not_connected';
  const automaticText = resolveAutomaticTextStatus(health, smsModuleReason);
  const emailReady = health?.availability.email === true;

  const card = 'rounded-2xl border border-stone-200 bg-white p-4 shadow-sm';

  const homeRows: Array<{
    id: IntegrationsView;
    icon: typeof CalendarDays;
    iconClass: string;
    name: string;
    status: string;
    tone: StatusTone;
    explanation: string;
  }> = [
    {
      id: 'google',
      icon: CalendarDays,
      iconClass: 'bg-rose-100 text-rose-800',
      name: 'Google Calendar',
      status: health ? GOOGLE_READINESS_LABELS[googleReadiness] : 'Loading…',
      tone: health ? googleStatusTone(googleReadiness) : 'muted',
      explanation: 'Appointments sync both ways and busy events block bookings.',
    },
    {
      id: 'texting',
      icon: MessageSquareText,
      iconClass: 'bg-amber-100 text-amber-800',
      name: 'Text messaging',
      // Manual texting always works without Twilio — never describe texting
      // as disconnected just because automatic sending is not set up.
      status: automaticText.label === 'Ready' ? 'Ready' : 'Manual ready',
      tone: automaticText.label === 'Ready' ? 'good' : 'good',
      explanation:
        automaticText.label === 'Ready'
          ? 'Manual texting plus automatic reminders are set up.'
          : 'Text clients from your phone. Automatic reminders are optional.',
    },
    {
      id: 'email',
      icon: Mail,
      iconClass: 'bg-stone-100 text-stone-700',
      name: 'Email',
      status: health ? (emailReady ? 'Ready' : 'Not available yet') : 'Loading…',
      tone: health ? (emailReady ? 'good' : 'muted') : 'muted',
      explanation: 'Booking confirmations, reminders, and owner alerts.',
    },
  ];

  const header = (title: string, showBack: boolean) => (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={() => {
              setView('home');
              setConfirmingDisconnect(false);
            }}
            aria-label="Back to integrations"
            className="flex size-9 items-center justify-center rounded-full text-stone-600 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 active:bg-stone-100"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 className="text-[19px] font-bold tracking-tight text-stone-950">{title}</h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close integrations"
        className="flex size-9 items-center justify-center rounded-full bg-stone-100 text-stone-600 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 active:bg-stone-200"
      >
        <X size={18} />
      </button>
    </div>
  );

  return (
    <div
      className="flex min-h-full flex-col bg-[#F8F3F0]"
      data-testid="integrations-modal"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {view === 'home' && header('Integrations', false)}
      {view === 'google' && header('Google Calendar', true)}
      {view === 'texting' && header('Text messaging', true)}
      {view === 'email' && header('Email', true)}

      <div className="mx-auto w-full max-w-2xl grow px-4 pb-10 pt-4">
        {message && (
          <div
            className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-950"
            role="status"
          >
            {message}
          </div>
        )}
        {healthError && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {healthError}
          </div>
        )}

        {view === 'home' && (
          <div className="space-y-3">
            {homeRows.map((row) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.id}
                  type="button"
                  data-testid={`integration-row-${row.id}`}
                  onClick={() => setView(row.id)}
                  className={`${card} flex w-full items-center gap-3 text-left outline-none transition-transform focus-visible:ring-2 focus-visible:ring-rose-400 active:scale-[0.99] active:bg-stone-50`}
                >
                  <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${row.iconClass}`}>
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0 grow">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] font-semibold text-stone-950">{row.name}</span>
                      <StatusPill label={row.status} tone={row.tone} />
                    </span>
                    <span className="mt-0.5 block text-[13px] text-stone-500">{row.explanation}</span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-stone-400" />
                </button>
              );
            })}
            <p className="px-1 pt-2 text-[12px] text-stone-400">
              Clients pay you in person (cash, card, or e-Transfer). Luster does not process client payments.
            </p>
          </div>
        )}

        {view === 'google' && (
          <div className="space-y-4">
            <div className={card}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-stone-600">
                  Busy events block availability. Luster appointments sync both ways when their Google event is
                  moved, resized, or deleted.
                </p>
                <StatusPill
                  label={health ? GOOGLE_READINESS_LABELS[googleReadiness] : 'Loading…'}
                  tone={health ? googleStatusTone(googleReadiness) : 'muted'}
                />
              </div>

              {health?.availability.google === false
                ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      Google Calendar is temporarily unavailable. Your Luster booking page and email confirmations
                      still work normally.
                    </div>
                  )
                : health?.google.status === 'active'
                  ? (
                      <div className="mt-4 space-y-4">
                        {health.google.email && (
                          <p className="text-sm text-stone-600">
                            Connected account:
                            {' '}
                            <span className="font-medium text-stone-900">{health.google.email}</span>
                          </p>
                        )}
                        {googleReadiness === 'setup_incomplete' && (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
                            <p className="font-semibold">One step left: choose your blocking calendars</p>
                            <p className="mt-1">
                              Select at least one calendar below under “Calendars that prevent double-booking” and
                              save. Until you do, your main Google calendar blocks bookings automatically, but Google
                              Calendar isn’t fully set up.
                            </p>
                          </div>
                        )}
                        <label className="block text-sm">
                          Appointment calendar
                          <select
                            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                            value={destinationCalendarId}
                            onChange={(event) => {
                              setDestinationCalendarId(event.target.value);
                              setCalendarDirty(true);
                            }}
                          >
                            {calendars
                              .filter(calendar => ['owner', 'writer'].includes(calendar.accessRole))
                              .map(calendar => (
                                <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>
                              ))}
                          </select>
                        </label>
                        <fieldset>
                          <legend className="text-sm font-medium">Calendars that prevent double-booking</legend>
                          <div className="mt-2 space-y-2">
                            {calendars.map(calendar => (
                              <label key={calendar.id} className="flex gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={busyCalendarIds.includes(calendar.id)}
                                  onChange={(event) => {
                                    setBusyCalendarIds(current =>
                                      event.target.checked
                                        ? [...new Set([...current, calendar.id])]
                                        : current.filter(id => id !== calendar.id),
                                    );
                                    setCalendarDirty(true);
                                  }}
                                />
                                {calendar.summary}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <button
                          type="button"
                          disabled={working === 'calendar' || !busyCalendarIds.length || !calendarDirty}
                          onClick={saveCalendars}
                          className="rounded-full bg-rose-800 px-5 py-2.5 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50"
                        >
                          {working === 'calendar' ? 'Saving…' : calendarDirty ? 'Save blocking calendars' : 'Calendars saved'}
                        </button>
                        <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-950">
                          <p className="font-semibold">
                            Two-way appointment sync is
                            {' '}
                            {health.google.inboundSyncEnabled === false ? 'off' : 'on'}
                          </p>
                          <p className="mt-1 text-xs">
                            Changes made in Google can take up to five minutes to appear in Luster. New personal
                            Google events are treated as busy time, not client appointments.
                          </p>
                          {health.google.inboundSyncedAt && (
                            <p className="mt-2 text-xs">
                              Last checked:
                              {' '}
                              {new Date(health.google.inboundSyncedAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  : (
                      <a
                        className="mt-4 inline-flex rounded-full bg-rose-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm outline-none transition-colors hover:bg-rose-900 focus-visible:ring-2 focus-visible:ring-rose-400"
                        href={`/api/integrations/google/connect?salonSlug=${encodeURIComponent(salonSlug ?? '')}`}
                      >
                        Connect Google Calendar
                      </a>
                    )}

              {health?.google.lastError && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-red-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {health.google.lastError}
                </p>
              )}
              {health?.google.inboundSyncError && (
                <p className="mt-3 text-xs text-red-700">
                  Two-way sync:
                  {' '}
                  {health.google.inboundSyncError}
                </p>
              )}
            </div>

            {health?.google.status === 'active' && (
              <div className={card}>
                <p className="text-sm font-semibold text-stone-900">Disconnect</p>
                <p className="mt-1 text-sm text-stone-600">
                  Stops two-way sync and removes Google busy-time blocking. Existing Luster appointments are not
                  deleted.
                </p>
                {confirmingDisconnect
                  ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={working === 'disconnect'}
                          onClick={disconnectGoogle}
                          data-testid="google-disconnect-confirm"
                          className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
                        >
                          {working === 'disconnect' ? 'Disconnecting…' : 'Yes, disconnect'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDisconnect(false)}
                          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                        >
                          Keep connected
                        </button>
                      </div>
                    )
                  : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDisconnect(true)}
                        data-testid="google-disconnect"
                        className="mt-3 rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-red-400 active:bg-red-50"
                      >
                        Disconnect Google Calendar
                      </button>
                    )}
              </div>
            )}
          </div>
        )}

        {view === 'texting' && (
          <div className="space-y-4">
            <div className={card} data-testid="manual-texting-section">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-stone-950">Manual texting</p>
                <StatusPill
                  label={smsCapableDevice ? 'Ready' : 'Unsupported on this device'}
                  tone={smsCapableDevice ? 'good' : 'muted'}
                />
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Opens your phone’s Messages app with the client’s number and a prewritten message you can edit.
                Nothing sends until you hit send, and Luster cannot confirm delivery. Works without any setup —
                no Twilio needed.
              </p>
              {!smsCapableDevice && (
                <p className="mt-2 text-xs text-stone-500">
                  This browser can’t open a Messages app. Open Luster on your phone to text clients.
                </p>
              )}
            </div>

            <div className={card} data-testid="automatic-texting-section">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-stone-950">Automatic texting</p>
                <StatusPill label={automaticText.label} tone={automaticText.tone} />
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Optional. Sends booking confirmations and appointment reminders automatically from a dedicated
                number in your own Twilio account. Bookings still work if texting is off.
              </p>
              {automaticText.detail && (
                <p className={`mt-2 text-sm ${automaticText.tone === 'error' ? 'text-red-700' : 'text-stone-600'}`}>
                  {automaticText.detail}
                </p>
              )}

              {health && health.availability.twilio && health.twilio.status !== 'active' && (
                health.twilio.status === 'pending'
                  ? (
                      <div className="mt-4 space-y-3">
                        <label className="block text-sm">
                          Canadian area code
                          <input
                            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                            maxLength={3}
                            value={areaCode}
                            onChange={event => setAreaCode(event.target.value.replace(/\D/g, ''))}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={previewTwilio}
                          disabled={working !== '' || areaCode.length !== 3}
                          className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50"
                        >
                          Check number and charge
                        </button>
                        {twilioPreview && (
                          <div className="rounded-2xl bg-amber-50 p-4 text-sm">
                            <p>
                              Available:
                              {' '}
                              <strong>{twilioPreview.number.phone_number}</strong>
                            </p>
                            <p className="mt-1">
                              Twilio monthly number charge:
                              {' '}
                              <strong>
                                {twilioPreview.monthlyPrice
                                  ? `${twilioPreview.monthlyPrice} ${twilioPreview.currency}`
                                  : 'shown in your Twilio account'}
                              </strong>
                              , plus message usage.
                            </p>
                            <button
                              type="button"
                              onClick={provisionTwilio}
                              disabled={working !== ''}
                              className="mt-3 rounded-full bg-red-600 px-5 py-2.5 font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
                            >
                              Confirm and provision
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  : (
                      <a
                        className="mt-4 inline-flex rounded-full bg-rose-800 px-5 py-2.5 text-sm font-semibold text-white outline-none transition-colors hover:bg-rose-900 focus-visible:ring-2 focus-visible:ring-rose-400"
                        href={`/api/integrations/twilio/connect?salonSlug=${encodeURIComponent(salonSlug ?? '')}`}
                      >
                        Authorize Twilio
                      </a>
                    )
              )}

              {health?.twilio.status === 'active' && smsModuleReason === 'MODULE_DISABLED' && onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="mt-3 text-sm font-semibold text-rose-800 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  Turn on SMS reminders in Settings
                </button>
              )}
              {health?.latestSmsDeliveryError && (
                <p className="mt-3 text-xs text-red-700">
                  Latest delivery error:
                  {' '}
                  {health.latestSmsDeliveryError.errorMessage
                  || health.latestSmsDeliveryError.errorCode
                  || 'Message delivery failed'}
                </p>
              )}
            </div>
          </div>
        )}

        {view === 'email' && (
          <div className="space-y-4">
            <div className={card}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-stone-950">Booking &amp; reminder emails</p>
                <StatusPill
                  label={health ? (emailReady ? 'Ready' : 'Not available yet') : 'Loading…'}
                  tone={health ? (emailReady ? 'good' : 'muted') : 'muted'}
                />
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Luster automatically emails booking confirmations and appointment reminders to clients who share an
                email address. No setup needed.
              </p>
            </div>

            <div className={card}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-stone-950">Owner &amp; staff alerts</p>
                <StatusPill
                  label={health ? (emailReady ? 'Ready' : 'Not available yet') : 'Loading…'}
                  tone={health ? (emailReady ? 'good' : 'muted') : 'muted'}
                />
              </div>
              <p className="mt-1 text-sm text-stone-600">
                New-booking and cancellation alerts for you and your technicians, by text or email.
              </p>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="mt-3 text-sm font-semibold text-rose-800 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  Choose alert channels in Settings
                </button>
              )}
            </div>

            <div className={card} data-testid="marketing-email-row">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-stone-950">Marketing email</p>
                <StatusPill label="Not available yet" tone="muted" />
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Email campaigns to clients are a separate capability that Luster doesn’t offer yet. Promotions and
                win-back offers are sent as texts you review and send yourself, from Marketing.
              </p>
            </div>
          </div>
        )}
        {health && view === 'home' && (
          <div className="mt-4 flex items-center gap-1.5 px-1 text-[12px] text-stone-400">
            <CheckCircle2 size={13} />
            Status updates automatically when you connect or disconnect an integration.
          </div>
        )}
      </div>
    </div>
  );
}
