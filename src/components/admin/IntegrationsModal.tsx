'use client';

/**
 * IntegrationsModal
 *
 * Focused Integrations home opened from the More workspace. Shows only
 * integrations that genuinely exist, each with a plain-language status:
 * - Google Calendar (two-way sync — reuses the existing connect/calendar APIs)
 * - Text messaging (Luster SMS credits and the device's native composer)
 * - Email (transactional + owner/staff alerts; marketing email does not exist)
 *
 * - Payments (Stripe Connect account setup)
 *
 * The Payments card covers ACCOUNT SETUP ONLY. It connects a salon's own Stripe
 * account so deposits can be turned on later; it takes no client payment, and no
 * client-facing payment surface exists yet. It renders only for salons with
 * binding history or in the deposits pilot, and is fed entirely from the cached
 * binding row — opening this modal never calls Stripe. The separate Stripe
 * billing routes remain platform-subscription plumbing, not a salon integration.
 */

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Mail,
  MessageSquareText,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { isNativeSmsCapableDevice, resolveAutomaticTextStatus, resolveManualTextStatus, type SmsOperationalHealth } from '@/libs/textingStatus';

type GoogleReadiness
  = | 'not_connected'
  | 'reconnect_required'
  | 'attention_required'
  | 'setup_incomplete'
  | 'ready';

type Health = {
  availability: { google: boolean; twilio: boolean; email: boolean; photos: boolean };
  sms?: SmsOperationalHealth;
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
  stripeConnect?: {
    salonId: string;
    visible: boolean;
    status: ConnectStatus;
    chargeReady: boolean;
    payoutsPending: boolean;
    requirements?: { currentlyDue?: string[]; pastDue?: string[] } | null;
    disabledReason?: string | null;
    lastSyncedAt?: string | null;
    hasBindingHistory: boolean;
  } | null;
};

type ConnectStatus
  = | 'not_connected'
  | 'onboarding_incomplete'
  | 'action_needed_soon'
  | 'charge_ready'
  | 'restricted'
  | 'blocked_needs_support'
  | 'revoked'
  | 'mode_mismatch';

/**
 * Plain-language labels. Owners never see raw Stripe vocabulary.
 */
const CONNECT_STATUS_LABELS: Record<ConnectStatus, string> = {
  not_connected: 'Not connected',
  onboarding_incomplete: 'Continue setup',
  action_needed_soon: 'Verification required',
  charge_ready: 'Ready for deposits',
  restricted: 'Action required',
  blocked_needs_support: 'Needs support',
  revoked: 'Disconnected',
  mode_mismatch: 'Unavailable',
};

function connectStatusTone(status: ConnectStatus): StatusTone {
  if (status === 'charge_ready') {
    return 'good';
  }
  if (status === 'not_connected') {
    return 'muted';
  }
  if (status === 'restricted' || status === 'blocked_needs_support' || status === 'mode_mismatch') {
    return 'error';
  }
  return 'warn';
}

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
          : 'bg-[var(--owner-ground)] text-[var(--owner-muted)]';
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

  const [smsCapableDevice, setSmsCapableDevice] = useState(true);
  const [paymentsBusy, setPaymentsBusy] = useState(false);

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

  const googleReadiness: GoogleReadiness = health
    ? (health.availability.google === false && health.google.status === 'disconnected'
        ? 'not_connected'
        : (health.google.readiness ?? 'not_connected'))
    : 'not_connected';
  const automaticText = resolveAutomaticTextStatus(health, smsModuleReason);
  const manualText = resolveManualTextStatus(health);
  const emailReady = health?.availability.email === true;
  /**
   * PROVIDER ABSENCE IS NOT A DISCONNECTION. When Luster has no Google
   * credentials at all there is nothing for the owner to connect, so saying
   * "Not connected" invites them to look for a Connect button that cannot
   * exist. Report it as a prerequisite Luster owes them instead.
   */
  const googleUnavailable = health !== null && health.availability.google === false;

  const card = 'rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm';

  const connect = health?.stripeConnect ?? null;
  const showPaymentsCard = connect?.visible === true;

  /**
   * Starts or resumes Stripe-hosted onboarding. The server mints a single-use
   * Account Link and we navigate straight to it — the URL is never stored.
   */
  const startPaymentsSetup = async () => {
    if (!connect || paymentsBusy) {
      return;
    }
    setPaymentsBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/integrations/stripe-connect/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: connect.salonId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.url) {
        setMessage('Payment setup could not be started. Try again shortly.');
        setPaymentsBusy(false);
        return;
      }
      window.location.href = payload.url;
    } catch {
      setMessage('Payment setup could not be started. Try again shortly.');
      setPaymentsBusy(false);
    }
  };

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
      iconClass: 'bg-[var(--owner-blush)] text-[var(--owner-accent)]',
      name: 'Google Calendar',
      status: health
        ? (googleUnavailable ? 'Not available yet' : GOOGLE_READINESS_LABELS[googleReadiness])
        : 'Loading…',
      tone: health ? (googleUnavailable ? 'muted' : googleStatusTone(googleReadiness)) : 'muted',
      explanation: googleUnavailable
        ? 'Calendar sync is not switched on for your Luster account yet.'
        : 'Appointments sync both ways and busy events block bookings.',
    },
    {
      id: 'texting',
      icon: MessageSquareText,
      iconClass: 'bg-amber-100 text-amber-800',
      name: 'Text messaging',
      status: health ? automaticText.label : 'Loading…',
      tone: automaticText.tone,
      explanation: health?.sms?.manualAvailable
        ? 'Text clients from Luster and track appointment messages.'
        : 'Check your texting identity, delivery status, reminders and credits.',
    },
    {
      id: 'email',
      icon: Mail,
      iconClass: 'bg-[var(--owner-ground)] text-[var(--owner-muted)]',
      name: 'Email',
      status: health ? (emailReady ? 'Ready' : 'Not available yet') : 'Loading…',
      tone: health ? (emailReady ? 'good' : 'muted') : 'muted',
      explanation: health && !emailReady
        ? 'No confirmation or reminder emails are being sent.'
        : 'Booking confirmations, reminders, and owner alerts.',
    },
  ];

  const header = (title: string, showBack: boolean) => (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--owner-line)] bg-[var(--owner-surface)] px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={() => {
              setView('home');
              setConfirmingDisconnect(false);
            }}
            aria-label="Back to integrations"
            className="flex size-9 items-center justify-center rounded-full text-[var(--owner-muted)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 active:bg-[var(--owner-ground)]"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 className="text-[19px] font-bold tracking-tight text-[var(--owner-ink)]">{title}</h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close integrations"
        className="flex size-9 items-center justify-center rounded-full bg-[var(--owner-ground)] text-[var(--owner-muted)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 active:bg-stone-200"
      >
        <X size={18} />
      </button>
    </div>
  );

  return (
    <div
      className="flex min-h-full flex-col bg-[var(--owner-ground)]"
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
            className="mb-4 rounded-2xl border border-[var(--owner-line-strong)] bg-[var(--owner-blush)] p-4 text-sm font-medium text-rose-950"
            role="status"
          >
            {message}
          </div>
        )}
        {healthError && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {healthError}
            <button type="button" onClick={() => void loadHealth()} className="ml-3 underline">Try again</button>
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
                  className={`${card} flex w-full items-center gap-3 text-left outline-none transition-transform focus-visible:ring-2 focus-visible:ring-rose-400 active:scale-[0.99] active:bg-[var(--owner-ground)]`}
                >
                  <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${row.iconClass}`}>
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0 grow">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] font-semibold text-[var(--owner-ink)]">{row.name}</span>
                      <StatusPill label={row.status} tone={row.tone} />
                    </span>
                    <span className="mt-0.5 block text-[13px] text-[var(--owner-muted)]">{row.explanation}</span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-[var(--owner-line-strong)]" />
                </button>
              );
            })}
            {showPaymentsCard && connect && (
              <div className={card} data-testid="integration-card-payments">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                    <CreditCard size={22} />
                  </span>
                  <span className="min-w-0 grow">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] font-semibold text-[var(--owner-ink)]">Payments</span>
                      <StatusPill
                        label={CONNECT_STATUS_LABELS[connect.status]}
                        tone={connectStatusTone(connect.status)}
                      />
                    </span>
                    <span className="mt-0.5 block text-[13px] text-[var(--owner-muted)]">
                      Connect your own Stripe account so you can take deposits later.
                    </span>
                  </span>
                </div>

                {connect.status === 'charge_ready' && connect.payoutsPending && (
                  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">
                    Payouts are not switched on yet. Stripe is still reviewing your
                    bank details.
                  </p>
                )}

                {(connect.status === 'restricted'
                  || connect.status === 'action_needed_soon'
                  || connect.status === 'onboarding_incomplete') && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-[var(--owner-muted)]">
                    {(connect.requirements?.pastDue ?? [])
                      .concat(connect.requirements?.currentlyDue ?? [])
                      .slice(0, 5)
                      .map(item => <li key={item}>{item.replaceAll('_', ' ').replaceAll('.', ' → ')}</li>)}
                  </ul>
                )}

                {connect.status === 'mode_mismatch' && (
                  <p className="mt-3 rounded-xl bg-red-50 p-3 text-[13px] text-red-800">
                    Payments are unavailable in this environment. Contact support.
                  </p>
                )}

                {/* `blocked_needs_support` is a DEAD END: everything was submitted
                    and nothing is outstanding, so "Resume onboarding" would loop. */}
                {connect.status === 'blocked_needs_support' && (
                  <p className="mt-3 rounded-xl bg-red-50 p-3 text-[13px] text-red-800">
                    Stripe cannot finish verifying this account automatically.
                    Contact support and we will take it from here.
                  </p>
                )}

                {(connect.status === 'not_connected'
                  || connect.status === 'onboarding_incomplete'
                  || connect.status === 'action_needed_soon'
                  || connect.status === 'restricted'
                  || connect.status === 'revoked') && (
                  <button
                    type="button"
                    data-testid="payments-setup-button"
                    onClick={() => void startPaymentsSetup()}
                    disabled={paymentsBusy}
                    className="mt-3 w-full rounded-xl bg-stone-900 px-4 py-2.5 text-[14px] font-semibold text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 active:bg-stone-800 disabled:opacity-60"
                  >
                    {connect.status === 'not_connected'
                      ? 'Set up payments'
                      : connect.status === 'revoked'
                        ? 'Reconnect'
                        : 'Resume onboarding'}
                  </button>
                )}

                {connect.lastSyncedAt === null && connect.hasBindingHistory && (
                  <p className="mt-2 text-[12px] text-[var(--owner-line-strong)]">
                    Status not confirmed yet.
                  </p>
                )}
              </div>
            )}

            {!showPaymentsCard && (
              <p className="px-1 pt-2 text-[12px] text-[var(--owner-line-strong)]">
                Clients pay you in person (cash, card, or e-Transfer). Luster does not process client payments.
              </p>
            )}
          </div>
        )}

        {view === 'google' && (
          <div className="space-y-4">
            {googleReadiness === 'reconnect_required' && (
              <div
                data-testid="google-reconnect-banner"
                className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" />
                  <div>
                    <p className="text-sm font-semibold text-red-900">
                      Online booking is paused — Google Calendar needs reconnecting
                    </p>
                    <p className="mt-1 text-xs leading-5 text-red-800">
                      We can no longer read your calendar, so we have stopped taking online bookings rather than
                      risk double-booking you. Existing appointments are unaffected and you can still add clients
                      manually.
                    </p>
                    {health?.google.lastError && (
                      <p className="mt-2 text-xs text-red-700">{health.google.lastError}</p>
                    )}
                    <a
                      className="mt-3 inline-flex rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm outline-none transition-colors hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-400"
                      href={`/api/integrations/google/connect?salonSlug=${encodeURIComponent(salonSlug ?? '')}`}
                    >
                      Reconnect Google Calendar
                    </a>
                  </div>
                </div>
              </div>
            )}
            <div className={card}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-[var(--owner-muted)]">
                  Busy events block availability. Luster appointments sync both ways when their Google event is
                  moved, resized, or deleted.
                </p>
                <StatusPill
                  label={health
                    ? (googleUnavailable ? 'Not available yet' : GOOGLE_READINESS_LABELS[googleReadiness])
                    : 'Loading…'}
                  tone={health ? (googleUnavailable ? 'muted' : googleStatusTone(googleReadiness)) : 'muted'}
                />
              </div>

              {googleUnavailable
                ? (
                    <div
                      data-testid="google-unavailable"
                      className="mt-4 space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
                    >
                      <p className="font-semibold">
                        Calendar sync is not switched on for your Luster account yet
                      </p>
                      <p>
                        Connecting a Google account needs Luster&rsquo;s calendar
                        integration enabled first, so there is nothing here for
                        you to connect or fix. Ask Luster support to turn on
                        Google Calendar for your salon and this page will show a
                        Connect button.
                      </p>
                      <p>
                        Nothing is broken in the meantime: your booking page,
                        confirmations and every appointment keep working. Only
                        two-way syncing with Google is missing, so Luster cannot
                        see events you create in Google Calendar &mdash; keep
                        blocking that time in your Luster calendar.
                      </p>
                    </div>
                  )
                : health?.google.status === 'active'
                  ? (
                      <div className="mt-4 space-y-4">
                        {health.google.email && (
                          <p className="text-sm text-[var(--owner-muted)]">
                            Connected account:
                            {' '}
                            <span className="font-medium text-[var(--owner-ink)]">{health.google.email}</span>
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
                            className="mt-1 w-full rounded-xl border border-[var(--owner-line-strong)] px-3 py-2"
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
                          className="rounded-full bg-[var(--owner-accent)] px-5 py-2.5 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50"
                        >
                          {working === 'calendar' ? 'Saving…' : calendarDirty ? 'Save blocking calendars' : 'Calendars saved'}
                        </button>
                        <div className="rounded-2xl bg-[var(--owner-blush)] p-4 text-sm text-rose-950">
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
                        className="mt-4 inline-flex rounded-full bg-[var(--owner-accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-rose-400"
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
                <p className="text-sm font-semibold text-[var(--owner-ink)]">Disconnect</p>
                <p className="mt-1 text-sm text-[var(--owner-muted)]">
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
                          className="rounded-full border border-[var(--owner-line-strong)] px-4 py-2 text-sm font-semibold text-[var(--owner-muted)] outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
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
                <p className="text-[15px] font-semibold text-[var(--owner-ink)]">Text from Luster</p>
                <StatusPill
                  label={manualText.label}
                  tone={manualText.tone}
                />
              </div>
              <p className="mt-1 text-sm text-[var(--owner-muted)]">
                Send a client a text from their client profile or appointment. Messages use your salon’s
                Luster texting identity and SMS credits, and appear in communication history with their delivery status.
              </p>
              {manualText.detail && <p className="mt-2 text-sm text-[var(--owner-muted)]">{manualText.detail}</p>}
            </div>

            <div className={card} data-testid="native-texting-section">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-[var(--owner-ink)]">Text from your phone</p>
                <StatusPill label={smsCapableDevice ? 'Available on this device' : 'Use your phone'} tone="muted" />
              </div>
              <p className="mt-1 text-sm text-[var(--owner-muted)]">
                You can also open your phone’s Messages app from a client profile. These texts use your
                own mobile number and mobile plan. They do not use Luster SMS credits, and Luster cannot confirm their delivery.
              </p>
            </div>

            <div className={card} data-testid="automatic-texting-section">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-[var(--owner-ink)]">Automatic texting</p>
                <StatusPill label={automaticText.label} tone={automaticText.tone} />
              </div>
              <p className="mt-1 text-sm text-[var(--owner-muted)]">
                Sends booking updates and scheduled appointment reminders using the texting identity below.
                Bookings still work if texting is off.
              </p>
              {automaticText.detail && (
                <p className={`mt-2 text-sm ${automaticText.tone === 'error' ? 'text-red-700' : 'text-[var(--owner-muted)]'}`}>
                  {automaticText.detail}
                </p>
              )}

              {health?.sms && (
                <dl className="mt-4 space-y-2 text-sm text-[var(--owner-muted)]">
                  <div>
                    <dt className="font-medium text-[var(--owner-ink)]">Texting identity</dt>
                    <dd>{health.sms.senderLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--owner-ink)]">Automatic texts</dt>
                    <dd>{health.sms.smsEnabled ? 'Enabled in Settings' : 'Off in Settings'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--owner-ink)]">Text reminders</dt>
                    <dd>{health.sms.remindersEnabled ? 'Enabled' : 'Not sending'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--owner-ink)]">SMS credits</dt>
                    <dd>{health.sms.availableCredits === null ? 'Luster SMS credit balance is unavailable. Contact support.' : `${health.sms.availableCredits} available. See Usage for balance and purchase availability.`}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--owner-ink)]">Quiet hours</dt>
                    <dd>{health.sms.quietHours.enabled ? `${health.sms.quietHours.start}–${health.sms.quietHours.end}, salon local time. Scheduled and manual texts wait until quiet hours end.` : 'Off'}</dd>
                  </div>
                </dl>
              )}

              {health && onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="mt-3 text-sm font-semibold text-[var(--owner-accent)] underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  Manage texts and reminders in Settings
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
                <p className="text-[15px] font-semibold text-[var(--owner-ink)]">Booking &amp; reminder emails</p>
                <StatusPill
                  label={health ? (emailReady ? 'Ready' : 'Not available yet') : 'Loading…'}
                  tone={health ? (emailReady ? 'good' : 'muted') : 'muted'}
                />
              </div>
              <p className="mt-1 text-sm text-[var(--owner-muted)]">
                Luster emails booking confirmations and appointment reminders to clients who share an email address.
                There is nothing for you to set up or connect.
              </p>
              {health && !emailReady && (
                <p
                  data-testid="email-unavailable"
                  className="mt-3 rounded-xl bg-amber-50 p-3 text-[13px] leading-6 text-amber-900"
                >
                  Right now no confirmation or reminder emails are going out:
                  Luster&rsquo;s email sending is not switched on for this
                  account yet. That is ours to enable, not yours to configure
                  &mdash; ask support to turn it on. Until then, confirm
                  bookings with a text from Clients or Marketing so nobody is
                  left without a confirmation.
                </p>
              )}
            </div>

            <div className={card}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-[var(--owner-ink)]">Owner &amp; staff alerts</p>
                <StatusPill
                  label={health ? (emailReady ? 'Ready' : 'Not available yet') : 'Loading…'}
                  tone={health ? (emailReady ? 'good' : 'muted') : 'muted'}
                />
              </div>
              <p className="mt-1 text-sm text-[var(--owner-muted)]">
                New-booking and cancellation alerts for you and your technicians, by text or email.
              </p>
              {health && !emailReady && (
                <p className="mt-3 text-[13px] leading-6 text-[var(--owner-muted)]">
                  Email alerts stay off until Luster&rsquo;s email sending is
                  enabled; text alerts need automatic texting, which is set up
                  under Text messaging. Your choice of channels is saved either
                  way and starts working the moment one of them is available.
                </p>
              )}
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="mt-3 text-sm font-semibold text-[var(--owner-accent)] underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  Choose alert channels in Settings
                </button>
              )}
            </div>

            <div className={card} data-testid="marketing-email-row">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold text-[var(--owner-ink)]">Marketing email</p>
                <StatusPill label="Not available yet" tone="muted" />
              </div>
              <p className="mt-1 text-sm text-[var(--owner-muted)]">
                Email campaigns to clients are a separate capability that Luster doesn’t offer yet. Promotions and
                win-back offers are sent as texts you review and send yourself, from Marketing.
              </p>
            </div>
          </div>
        )}
        {health && view === 'home' && (
          <div className="mt-4 space-y-2 px-1">
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--owner-line-strong)]">
              <CheckCircle2 size={13} />
              Status updates automatically when you connect or disconnect an integration.
            </div>
            {/*
              CONNECTION HEALTH vs PREFERENCES. This app answers "is the
              channel working"; Settings answers "when does it send". Saying so
              here stops an owner hunting for reminder timing among connection
              cards, and vice versa.
            */}
            <p className="text-[12px] leading-5 text-[var(--owner-muted)]" data-testid="integrations-scope-note">
              This app shows whether each channel is connected and working.
              What gets sent and when — reminders, confirmations, alert
              channels — is set in Settings.
            </p>
            {onOpenSettings && (
              <button
                type="button"
                data-testid="integrations-open-settings"
                onClick={onOpenSettings}
                className="min-h-11 text-[13px] font-semibold text-[var(--owner-accent)] underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                Open reminder and alert settings
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
