'use client';

import {
  AlertCircle,
  BellRing,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Gift,
  Link2,
  Lock,
  MailWarning,
  RefreshCw,
  Settings2,
  Sparkles,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GoogleEventReviewQueue } from '@/components/admin/GoogleEventReviewQueue';
import { QuickActionsWidget } from '@/components/admin/QuickActionsWidget';
import { appointmentStatusChipClasses, formatAppointmentStatus } from '@/libs/appointmentStatusDisplay';
import {
  APPOINTMENT_DATA_CHANGED_EVENT,
  RETENTION_DATA_CHANGED_EVENT,
} from '@/libs/dashboardEvents';
import type { ReportingProvenance } from '@/libs/financialReporting';
import { formatMoney } from '@/libs/formatMoney';
import type { OwnerFinancialSummary } from '@/types/ownerFinancialSummary';
import type { RetentionStage } from '@/types/retention';

type AppointmentGlance = {
  total: number;
  completed: number;
  noShows: number;
  upcoming: number;
};

type TodayData = {
  date: string;
  timeZone: string;
  appointments: Array<{
    id: string;
    clientName: string | null;
    startTime: string;
    endTime: string;
    status: string;
    totalPrice: number;
    totalDurationMinutes: number;
    technicianName: string | null;
    services: string[];
    clientSensitivities?: string | null;
  }>;
  dueClients: Array<{
    id: string;
    fullName: string | null;
    nextRebookDueAt: string | null;
    rebookIntervalDays: number | null;
  }>;
  failedConfirmations: Array<{
    appointmentId: string | null;
    errorCode: string | null;
  }>;
  googleEventsNeedingReview: number;
  integrationHealth: {
    google: {
      status: string;
      readiness?: string;
      reconnectRequired?: boolean;
      inboundSyncError?: string | null;
    };
    calendarOutbox: { pending: number; failed: number };
  };
  links?: { publicUrl: string; bookingUrl: string; findBookingUrl: string };
};

type RetentionQueueData = {
  retention: Array<{
    clientId: string;
    clientName: string | null;
    phone: string | null;
    stage: RetentionStage;
    dueAt: string;
    lastVisitAt: string;
    rebookIntervalDays: number | null;
  }>;
  appointmentReminders: Array<{
    appointmentId: string;
    clientId: string;
    clientName: string | null;
    phone: string | null;
    startTime: string;
    endTime: string;
    dueAt: string;
  }>;
};

const RETENTION_STAGE_PRIORITY: Record<RetentionStage, number> = {
  rebook: 1,
  promo_6w: 2,
  promo_8w: 3,
};

/**
 * One money vocabulary across the Workspace: when an amount cannot be resolved
 * from the finalized record it is "Under review", in neutral grey, never a
 * money colour and never a fabricated $0.00. Mirrors
 * `SPEND_UNDER_REVIEW_LABEL` in ClientsModal.tsx — same words, same meaning.
 */
const UNDER_REVIEW_LABEL = 'Under review';

/**
 * Detail rows that only exist for a salon that actually takes deposits or
 * charges tax. When the whole family is zero it is not a fact about today, it
 * is a feature the salon does not use, so it is not shown (OP-009).
 */
const DEPOSIT_METRIC_LABELS = new Set<string>([
  'Deposits collected',
  'Deposit refunds',
  'Deposits applied',
  'Deposits forfeited (gross)',
  'Forfeiture tax estimate',
  'Forfeiture net estimate',
  'Forfeiture refund reversals',
  'Forfeiture tax reversals',
  'Forfeiture net reversals',
]);
const TAX_METRIC_LABELS = new Set<string>([
  'Tax today',
  'Taxable subtotal today',
]);

const INCOMPLETE_HISTORY_EXPLANATION
  = 'Some historical appointments could not be included because their financial details are unavailable.';
const ESTIMATED_HISTORY_EXPLANATION
  = 'Some historical totals use booked values because finalized checkout details are unavailable.';

function outstandingBalanceExplanation(count: number): string {
  return count === 1
    ? 'One completed appointment could not be reconciled against its payment records, so it is left out of Completed outstanding. Every completed appointment is counted in the revenue totals.'
    : `${count} completed appointments could not be reconciled against their payment records, so they are left out of Completed outstanding. Every completed appointment is counted in the revenue totals.`;
}

type FinancialHistoryNotice = {
  label: 'Incomplete history' | 'Estimated history' | 'Balances under review';
  explanation: string;
  /**
   * Which figures the caveat is actually about. Only a `revenue` caveat may
   * put "Under review" beside the Revenue headline.
   */
  scope: 'revenue' | 'balances';
};

/**
 * Say which numbers are uncertain, and never blame the ones that are exact.
 *
 * Revenue and outstanding balances are two projections of the same
 * appointments and they can disagree: a completed, fully finalized appointment
 * is exact revenue, yet its balance stays unresolved while no payment record
 * reconciles against it. The card used to fold `balances.completed` into the
 * same test as the three revenue periods, so a balance-only gap printed
 * "Incomplete history — Some historical appointments could not be included"
 * over revenue figures that were complete and exact — the owner could not tell
 * whether the salon earned nothing or the total was broken
 * (AG-w2-appointments-02). The revenue periods are judged on their own now,
 * and a balance-only gap says so, with the number of appointments involved.
 */
function getFinancialHistoryNotice(
  summary: OwnerFinancialSummary,
): FinancialHistoryNotice | null {
  const revenueProvenances: ReportingProvenance[] = [
    summary.currentPeriods.today.provenance,
    summary.currentPeriods.weekToDate.provenance,
    summary.currentPeriods.monthToDate.provenance,
  ];

  if (revenueProvenances.some(item => item.unresolvedAppointmentCount > 0)) {
    return {
      label: 'Incomplete history',
      explanation: INCOMPLETE_HISTORY_EXPLANATION,
      scope: 'revenue',
    };
  }

  if (revenueProvenances.some(item => item.legacyAppointmentCount > 0)) {
    return {
      label: 'Estimated history',
      explanation: ESTIMATED_HISTORY_EXPLANATION,
      scope: 'revenue',
    };
  }

  const unresolvedBalances = summary.balances.completed.unresolvedAppointmentCount;
  if (unresolvedBalances > 0) {
    return {
      label: 'Balances under review',
      explanation: outstandingBalanceExplanation(unresolvedBalances),
      scope: 'balances',
    };
  }

  return null;
}

/**
 * ONE honest line about the state of the money, never two that argue.
 *
 * The audit found "No completed financial activity yet." rendered directly
 * above "Incomplete history — Some historical appointments could not be
 * included…", which reads as a contradiction (AG-today-calendar-08). There is
 * exactly one sentence now: an empty day that also has unresolved history says
 * both facts in one breath; a day with figures keeps the precise provenance
 * wording.
 */
function revenueStatusLine(
  isEmpty: boolean,
  historyNotice: ReturnType<typeof getFinancialHistoryNotice>,
): string | null {
  if (isEmpty) {
    if (historyNotice?.label === 'Incomplete history') {
      return 'No completed revenue yet today, and some earlier appointments are under review — those are not counted here.';
    }
    if (historyNotice?.label === 'Estimated history') {
      return 'No completed revenue yet today, and some earlier totals are estimated from booked values.';
    }
    if (historyNotice?.label === 'Balances under review') {
      return `No completed financial activity yet. ${historyNotice.explanation}`;
    }
    return 'No completed financial activity yet.';
  }
  if (historyNotice) {
    return `${historyNotice.label} — ${historyNotice.explanation}`;
  }
  return null;
}

function retentionPresentation(stage: RetentionStage) {
  if (stage === 'promo_8w') {
    return {
      action: 'Win back',
      title: '8-week win-back',
      className:
        'border-fuchsia-200 bg-gradient-to-r from-rose-100 via-fuchsia-50 to-amber-50 text-rose-950 shadow-sm',
      iconClassName: 'bg-rose-800 text-white',
    };
  }
  if (stage === 'promo_6w') {
    return {
      action: 'Send offer',
      title: '6-week win-back',
      className: 'border-rose-200 bg-rose-50 text-rose-950',
      iconClassName: 'bg-rose-100 text-rose-700',
    };
  }
  return {
    action: 'Rebook',
    title: 'Due for rebooking',
    className: 'border-amber-200 bg-amber-50 text-amber-950',
    iconClassName: 'bg-amber-100 text-amber-700',
  };
}

export function OwnerTodayWorkspace({
  salonSlug,
  appointments,
  analyticsTitle,
  analyticsMessage,
  onRefreshAnalytics,
  onQuickAction,
  onOpenBookings,
  onOpenCalendar,
  onOpenIntegrations,
  onOpenAppointment,
  onOpenClient,
}: {
  salonSlug: string;
  appointments: AppointmentGlance;
  analyticsTitle?: string | null;
  analyticsMessage?: string | null;
  onRefreshAnalytics?: () => void;
  onQuickAction: (action: string) => void;
  onOpenBookings: () => void;
  onOpenCalendar: () => void;
  onOpenIntegrations: () => void;
  onOpenAppointment: (appointmentId: string) => void;
  onOpenClient: (clientId: string) => void;
}) {
  const [today, setToday] = useState<TodayData | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [retention, setRetention] = useState<RetentionQueueData | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [financialSummaryState, setFinancialSummaryState] = useState<{
    salonSlug: string;
    data: OwnerFinancialSummary;
  } | null>(null);
  const [financialSummaryLoading, setFinancialSummaryLoading] = useState(true);
  const [financialSummaryError, setFinancialSummaryError]
    = useState<string | null>(null);
  // Revenue is owner-only on the server (403 OWNER_REQUIRED). A collaborator
  // is not looking at a broken card, so remember which salon answered that way
  // and say so in words instead of retrying every minute behind an error.
  const [financialSummaryOwnerOnlySlug, setFinancialSummaryOwnerOnlySlug]
    = useState<string | null>(null);
  // Revenue detail is a disclosure, closed on arrival: the owner's first fold
  // belongs to what needs a decision, not to a wall of $0.00 (OP-009).
  const [revenueBreakdownOpen, setRevenueBreakdownOpen] = useState(false);
  const financialSummaryCacheRef = useRef<
    Record<string, OwnerFinancialSummary>
  >({});
  const latestFinancialRequestRef = useRef(0);
  const financialSummaryOwnerOnlyRef = useRef<string | null>(null);

  const financialSummary
    = financialSummaryState?.salonSlug === salonSlug
      ? financialSummaryState.data
      : null;
  const financialSummaryOwnerOnly
    = Boolean(salonSlug) && financialSummaryOwnerOnlySlug === salonSlug;

  const loadToday = useCallback(async () => {
    if (!salonSlug) {
      setToday(null);
      setTodayLoading(false);
      return;
    }
    setTodayLoading(true);
    setTodayError(null);
    try {
      const response = await fetch(
        `/api/admin/today?salonSlug=${encodeURIComponent(salonSlug)}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message || 'Today could not be loaded.',
        );
      }
      setToday(payload.data);
    } catch (error) {
      setTodayError(
        error instanceof Error ? error.message : 'Today could not be loaded.',
      );
    } finally {
      setTodayLoading(false);
    }
  }, [salonSlug]);

  const loadRetention = useCallback(async () => {
    if (!salonSlug) {
      setRetention(null);
      setRetentionLoading(false);
      setRetentionError(null);
      return;
    }
    setRetentionLoading(true);
    setRetentionError(null);
    try {
      const response = await fetch(
        `/api/admin/retention?salonSlug=${encodeURIComponent(salonSlug)}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message
          || payload?.error
          || 'Client follow-ups could not be loaded.',
        );
      }
      const data = payload?.data;
      setRetention({
        retention: Array.isArray(data?.retention) ? data.retention : [],
        appointmentReminders: Array.isArray(data?.appointmentReminders)
          ? data.appointmentReminders
          : [],
      });
    } catch (error) {
      setRetentionError(
        error instanceof Error
          ? error.message
          : 'Client follow-ups could not be loaded.',
      );
    } finally {
      setRetentionLoading(false);
    }
  }, [salonSlug]);

  const loadFinancialSummary = useCallback(async () => {
    const requestId = latestFinancialRequestRef.current + 1;
    latestFinancialRequestRef.current = requestId;

    if (!salonSlug) {
      setFinancialSummaryState(null);
      setFinancialSummaryLoading(false);
      setFinancialSummaryError(null);
      return;
    }

    // Already told this salon is owner-only: nothing to poll for.
    if (financialSummaryOwnerOnlyRef.current === salonSlug) {
      setFinancialSummaryLoading(false);
      return;
    }

    const cached = financialSummaryCacheRef.current[salonSlug];
    setFinancialSummaryState(current =>
      current?.salonSlug === salonSlug
        ? current
        : cached
          ? { salonSlug, data: cached }
          : null,
    );
    setFinancialSummaryLoading(true);
    setFinancialSummaryError(null);

    try {
      const response = await fetch(
        `/api/admin/financial-summary?salonSlug=${encodeURIComponent(salonSlug)}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null) as {
        data?: OwnerFinancialSummary;
        error?: { code?: string; message?: string } | string;
      } | null;

      if (
        response.status === 403
        && typeof payload?.error === 'object'
        && payload.error?.code === 'OWNER_REQUIRED'
      ) {
        if (latestFinancialRequestRef.current !== requestId) {
          return;
        }
        delete financialSummaryCacheRef.current[salonSlug];
        financialSummaryOwnerOnlyRef.current = salonSlug;
        setFinancialSummaryOwnerOnlySlug(salonSlug);
        setFinancialSummaryState(null);
        setFinancialSummaryError(null);
        return;
      }

      if (!response.ok || !payload?.data) {
        const message
          = typeof payload?.error === 'string'
            ? payload.error
            : payload?.error?.message;
        throw new Error(message || 'Revenue summary could not be loaded.');
      }

      if (latestFinancialRequestRef.current !== requestId) {
        return;
      }

      financialSummaryCacheRef.current[salonSlug] = payload.data;
      setFinancialSummaryState({ salonSlug, data: payload.data });
    } catch (error) {
      if (latestFinancialRequestRef.current !== requestId) {
        return;
      }
      setFinancialSummaryError(
        error instanceof Error
          ? error.message
          : 'Revenue summary could not be loaded.',
      );
    } finally {
      if (latestFinancialRequestRef.current === requestId) {
        setFinancialSummaryLoading(false);
      }
    }
  }, [salonSlug]);

  useEffect(() => {
    void loadToday();
    const timer = window.setInterval(() => void loadToday(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadToday]);

  useEffect(() => {
    void loadRetention();
    const timer = window.setInterval(() => void loadRetention(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadRetention]);

  useEffect(() => {
    void loadFinancialSummary();
    const timer = window.setInterval(
      () => void loadFinancialSummary(),
      60_000,
    );
    return () => {
      latestFinancialRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [loadFinancialSummary]);

  useEffect(() => {
    const refreshToday = () => {
      void loadToday();
      void loadFinancialSummary();
    };
    const refreshRetention = () => void loadRetention();

    window.addEventListener(APPOINTMENT_DATA_CHANGED_EVENT, refreshToday);
    window.addEventListener(RETENTION_DATA_CHANGED_EVENT, refreshRetention);

    return () => {
      window.removeEventListener(APPOINTMENT_DATA_CHANGED_EVENT, refreshToday);
      window.removeEventListener(RETENTION_DATA_CHANGED_EVENT, refreshRetention);
    };
  }, [loadFinancialSummary, loadRetention, loadToday]);

  const retentionItems = useMemo(() => {
    const oneStagePerClient = new Map<
      string,
      RetentionQueueData['retention'][number]
    >();
    for (const item of retention?.retention ?? []) {
      const existing = oneStagePerClient.get(item.clientId);
      if (
        !existing
        || RETENTION_STAGE_PRIORITY[item.stage]
        > RETENTION_STAGE_PRIORITY[existing.stage]
      ) {
        oneStagePerClient.set(item.clientId, item);
      }
    }
    return [...oneStagePerClient.values()].sort(
      (left, right) =>
        new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
    );
  }, [retention]);

  const appointmentReminders = retention?.appointmentReminders ?? [];
  const legacyDueClients
    = !retention && retentionError ? (today?.dueClients ?? []) : [];

  const nextAppointmentId = useMemo(
    () =>
      today?.appointments.find(
        appointment => new Date(appointment.endTime).getTime() >= Date.now(),
      )?.id ?? null,
    [today],
  );
  /**
   * The bookings the owner still has to answer. `/api/admin/today` already
   * scopes to the salon day, so every 'pending' row here starts today. This is
   * the one thing on Today that cannot wait, so it leads the attention list
   * (AG-today-calendar-02).
   */
  const pendingAppointments = useMemo(
    () =>
      (today?.appointments ?? []).filter(
        appointment => appointment.status === 'pending',
      ),
    [today],
  );

  const integrationNeedsAttention = Boolean(
    today?.integrationHealth.google.reconnectRequired
    || today?.integrationHealth.google.readiness === 'setup_incomplete'
    || today?.integrationHealth.google.inboundSyncError
    || today?.integrationHealth.calendarOutbox.failed,
  );
  /**
   * Only claim "not connected" once Today has answered; before that we do not
   * know, and offering a connect flow for a calendar that is already syncing
   * would be a lie in the other direction (AG-today-calendar-06).
   */
  const googleNotConnected = Boolean(
    today
    && (today.integrationHealth.google.readiness === 'not_connected'
      || today.integrationHealth.google.status === 'disconnected'),
  );

  const revenueHistoryNotice = financialSummary
    ? getFinancialHistoryNotice(financialSummary)
    : null;

  const todayTotal = today?.appointments.length ?? appointments.total;
  const todayUpcoming
    = today?.appointments.filter(
      appointment =>
        ['pending', 'confirmed', 'in_progress', 'awaiting_payment'].includes(appointment.status)
        && new Date(appointment.endTime).getTime() >= Date.now(),
    ).length ?? appointments.upcoming;

  const todayCountHeadline = todayTotal === 1
    ? '1 appointment today'
    : `${todayTotal} appointments today`;
  const todayCountDetail = todayTotal === 0
    ? 'Your schedule is clear'
    : todayUpcoming === 0
      ? 'All done for today'
      : `${todayUpcoming} still to come`;

  const formatTime = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: today?.timeZone || 'America/Toronto',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));

  const formatVisitDate = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: today?.timeZone || 'America/Toronto',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));

  const formatReminderTime = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: today?.timeZone || 'America/Toronto',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));

  const publicUrl
    = today?.links?.publicUrl || `/${encodeURIComponent(salonSlug)}`;
  const bookingUrl = today?.links?.bookingUrl || `${publicUrl}/book`;
  const findBookingUrl
    = today?.links?.findBookingUrl || `${publicUrl}/find-booking`;

  const shareLink = async (url: string, title: string) => {
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  };

  /**
   * "Needs attention" is the first card on Today, above the schedule, and a
   * booking still waiting for an answer is its first row. Before this the only
   * trace of an unconfirmed booking was a grey chip inside an agenda row
   * (AG-today-calendar-02), and the section itself sat below Revenue (OP-009).
   */
  const attentionSection
    = pendingAppointments.length
    || today?.failedConfirmations.length
    || legacyDueClients.length
    || today?.googleEventsNeedingReview
    || integrationNeedsAttention
      ? (
          <section
            className="rounded-3xl border border-amber-100 bg-white p-4 shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
            data-testid="owner-needs-attention"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="text-amber-600" />
              <h2 className="text-[15px] font-semibold text-stone-950">
                Needs attention
              </h2>
            </div>
            <div className="mt-3 space-y-2">
              {pendingAppointments.length > 0 && (
                <p
                  className="text-sm font-semibold text-stone-900"
                  data-testid="owner-needs-attention-pending-count"
                >
                  {pendingAppointments.length === 1
                    ? '1 booking needs confirming'
                    : `${pendingAppointments.length} bookings need confirming`}
                </p>
              )}
              {pendingAppointments.slice(0, 3).map(appointment => (
                <button
                  key={appointment.id}
                  type="button"
                  onClick={() => onOpenAppointment(appointment.id)}
                  data-testid="owner-needs-attention-pending"
                  aria-label={`Confirm ${appointment.clientName || 'guest'} at ${formatTime(appointment.startTime)}`}
                  className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-3 text-left text-sm text-amber-950"
                >
                  <CalendarCheck size={18} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {appointment.clientName || 'Guest client'}
                    </span>
                    <span className="mt-0.5 block text-xs opacity-80">
                      {formatTime(appointment.startTime)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold">Confirm</span>
                  <ChevronRight size={15} className="shrink-0" />
                </button>
              ))}
              {pendingAppointments.length > 3 && (
                <button
                  type="button"
                  onClick={onOpenBookings}
                  className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-xs font-semibold text-rose-800"
                >
                  {`View all ${pendingAppointments.length} unconfirmed bookings`}
                  <ChevronRight size={14} />
                </button>
              )}
              {Boolean(today?.failedConfirmations.length) && (
                <button
                  type="button"
                  onClick={() =>
                    today?.failedConfirmations[0]?.appointmentId
                    && onOpenAppointment(today.failedConfirmations[0].appointmentId)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-red-50 p-3 text-left text-sm text-red-900"
                >
                  <MailWarning size={18} />
                  <span className="flex-1">
                    {today!.failedConfirmations.length}
                    {' '}
                    confirmation email
                    {today!.failedConfirmations.length === 1 ? '' : 's'}
                    {' '}
                    need
                    resending
                  </span>
                  <ChevronRight size={15} />
                </button>
              )}
              {legacyDueClients.map(client => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => onOpenClient(client.id)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-3 text-left text-sm text-amber-900"
                >
                  <UserRound size={18} />
                  <span className="flex-1">
                    {client.fullName || 'Client'}
                    {' '}
                    is due for rebooking
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {Boolean(today?.googleEventsNeedingReview) && (
                <button
                  type="button"
                  onClick={onOpenCalendar}
                  className="flex w-full items-center gap-3 rounded-2xl bg-blue-50 p-3 text-left text-sm text-blue-900"
                >
                  <Clock3 size={18} />
                  <span className="flex-1">
                    {today!.googleEventsNeedingReview}
                    {' '}
                    Google event
                    {today!.googleEventsNeedingReview === 1 ? '' : 's'}
                    {' '}
                    need
                    review
                  </span>
                  <ChevronRight size={15} />
                </button>
              )}
              {integrationNeedsAttention && (
                <button
                  type="button"
                  onClick={onOpenIntegrations}
                  className="flex w-full items-center gap-3 rounded-2xl bg-stone-100 p-3 text-left text-sm text-stone-800"
                >
                  <Settings2 size={18} />
                  <span className="flex-1">
                    {today?.integrationHealth.google.readiness === 'setup_incomplete'
                      ? 'Finish Google Calendar setup — pick your blocking calendars'
                      : 'Google Calendar needs attention'}
                  </span>
                  <ChevronRight size={15} />
                </button>
              )}
            </div>
          </section>
        )
      : null;

  return (
    <main
      className="mx-auto max-w-2xl space-y-4 px-5 pb-28 pt-3"
      data-testid="owner-today-workspace"
    >
      {/* Slim brand banner: the schedule is the hero, not the marketing. */}
      <section className="flex items-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-[#4C1D2E] via-[#8B1538] to-[#D6A34A] px-4 py-2.5 text-white">
        <Sparkles className="shrink-0 text-amber-200" size={16} />
        <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-rose-50">
          Luster · Your day, polished
        </p>
      </section>
      {/*
        ONE count tile, not two showing the same number under near-identical
        labels (AG-today-calendar-07). The total and what is left of it are one
        fact about the day, read in one line.
      */}
      <section>
        <button
          type="button"
          onClick={onOpenCalendar}
          data-testid="owner-today-count-tile"
          className="flex w-full items-center gap-3.5 rounded-3xl border border-rose-100/80 bg-white px-4 py-3.5 text-left shadow-[0_10px_30px_rgba(76,29,46,0.05)] transition-colors hover:bg-[var(--owner-blush,#f6e7ec)]"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-800">
            <CalendarDays size={21} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold leading-tight text-stone-950">
              {todayCountHeadline}
            </span>
            <span className="mt-0.5 block text-sm text-stone-500">
              {todayCountDetail}
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-stone-300" />
        </button>
      </section>

      {attentionSection}

      <section
        className="overflow-hidden rounded-owner-card border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] shadow-owner-card"
        data-testid="owner-today-agenda"
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-stone-950">
              Today&apos;s schedule
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Appointments in your salon timezone
            </p>
          </div>
          <button
            type="button"
            onClick={() => void Promise.all([
              loadToday(),
              loadRetention(),
              loadFinancialSummary(),
            ])}
            disabled={
              todayLoading || retentionLoading || financialSummaryLoading
            }
            aria-label="Refresh dashboard"
            className="flex size-11 items-center justify-center rounded-full text-[var(--owner-accent,#8f3155)] outline-none transition-colors hover:bg-[var(--owner-blush,#f6e7ec)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] disabled:opacity-40"
          >
            <RefreshCw
              size={17}
              className={
                todayLoading || retentionLoading || financialSummaryLoading
                  ? 'animate-spin'
                  : ''
              }
            />
          </button>
        </div>
        {todayLoading && !today
          ? (
              <div className="space-y-3 p-5">
                <div className="h-14 animate-pulse rounded-2xl bg-stone-100" />
                <div className="h-14 animate-pulse rounded-2xl bg-stone-100" />
              </div>
            )
          : todayError
            ? (
                <div className="m-5 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                  {todayError}
                </div>
              )
            : today?.appointments.length
              ? (
                  <div className="divide-y divide-stone-100">
                    {today.appointments.map(appointment => (
                      <button
                        key={appointment.id}
                        type="button"
                        onClick={() => onOpenAppointment(appointment.id)}
                        /*
                          ONE row background. "Next" is carried by its label
                          chip, not by an amber wash that the owner would
                          otherwise learn to read as a status and be wrong
                          (AG-cohesion-08). Finished rows are dimmed, which is
                          a real state and is also said in words by the chip.
                        */
                        className={`flex min-h-[64px] w-full items-center gap-3 bg-[var(--owner-surface,#fffdfb)] px-5 py-4 text-left outline-none transition-colors hover:bg-[var(--owner-blush,#f6e7ec)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus,#b85075)] ${['completed', 'cancelled', 'no_show'].includes(appointment.status) ? 'opacity-55' : ''}`}
                      >
                        <div className="w-16 shrink-0">
                          <p className="text-sm font-semibold text-[var(--owner-accent-strong,#70213f)]">
                            {formatTime(appointment.startTime)}
                          </p>
                          <p className="text-[12px] text-[var(--owner-muted,#706267)]">
                            {appointment.totalDurationMinutes}
                            {' '}
                            min
                          </p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-stone-950">
                            {appointment.clientName || 'Guest client'}
                            {appointment.id === nextAppointmentId && (
                              <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 align-middle text-[11px] font-bold uppercase tracking-wide text-white">
                                Next
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-stone-500">
                            {appointment.services.join(', ')}
                            {appointment.technicianName
                              ? ` · ${appointment.technicianName}`
                              : ''}
                          </p>
                          {appointment.clientSensitivities && (
                            <p className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-800">
                              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                              <span className="line-clamp-2">
                                {appointment.clientSensitivities}
                              </span>
                            </p>
                          )}
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${appointmentStatusChipClasses(appointment.status)}`}>
                          {formatAppointmentStatus(appointment.status)}
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-stone-300" />
                      </button>
                    ))}
                  </div>
                )
              : (
                  <div className="flex flex-col items-center px-5 py-9 text-center">
                    <CalendarDays size={28} className="text-stone-300" />
                    <p className="mt-3 text-sm font-semibold text-stone-700">
                      No appointments today
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      Your schedule is clear.
                    </p>
                  </div>
                )}
        <button
          type="button"
          onClick={onOpenBookings}
          className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-[var(--owner-line,#dfd1d4)] px-4 py-3 text-sm font-semibold text-[var(--owner-accent,#8f3155)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus,#b85075)]"
        >
          Open appointment calendar
          <ChevronRight size={15} />
        </button>
      </section>

      <section
        className="overflow-hidden rounded-owner-card border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] shadow-owner-card"
        data-testid="owner-revenue-summary"
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--owner-blush,#f6e7ec)] text-[var(--owner-accent,#8f3155)]">
              <CircleDollarSign size={20} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-stone-950">Revenue</h2>
                {/*
                  The caveats used to be two amber banners at the bottom of the
                  card. One neutral chip beside the headline says the same
                  thing in the Workspace's shared money vocabulary, and the
                  sentence underneath explains it (AG-cohesion-05).
                */}
                {revenueHistoryNotice?.scope === 'revenue' && (
                  <span
                    className="rounded-full border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-blush,#f6e7ec)] px-2 py-0.5 text-[11px] font-semibold text-[var(--owner-accent-strong,#70213f)]"
                    data-testid="owner-revenue-under-review-chip"
                  >
                    {UNDER_REVIEW_LABEL}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-stone-500">
                {financialSummaryOwnerOnly
                  ? 'Owner only'
                  : 'Completed appointments · tax and tips separate'}
              </p>
            </div>
          </div>
          {financialSummary && (
            <button
              type="button"
              onClick={() => void loadFinancialSummary()}
              disabled={financialSummaryLoading}
              aria-label="Refresh revenue summary"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-accent,#8f3155)] outline-none transition-colors hover:bg-[var(--owner-blush,#f6e7ec)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] disabled:opacity-40"
            >
              <RefreshCw
                size={17}
                className={financialSummaryLoading ? 'animate-spin' : ''}
              />
            </button>
          )}
        </div>

        {financialSummaryOwnerOnly
          ? (
              <div
                className="m-4 flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700"
                data-testid="owner-revenue-summary-owner-only"
              >
                <Lock aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-stone-500" />
                <p className="min-w-0 flex-1">
                  Revenue is visible to the salon owner. Your appointments,
                  clients and services are unchanged.
                </p>
              </div>
            )
          : financialSummaryLoading && !financialSummary
            ? (
                <div
                  className="space-y-3 p-4"
                  data-testid="owner-revenue-summary-loading"
                >
                  <div className="h-28 animate-pulse rounded-2xl bg-stone-100" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
                    <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {Array.from({ length: 5 }, (_, index) => (
                      <div
                        key={index}
                        className="h-12 animate-pulse rounded-xl bg-stone-100"
                      />
                    ))}
                  </div>
                </div>
              )
            : !financialSummary
                ? (
                    <div
                      role="alert"
                      className="m-4 flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800"
                    >
                      <AlertCircle size={18} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        Revenue summary is temporarily unavailable.
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadFinancialSummary()}
                        className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm"
                      >
                        Try again
                      </button>
                    </div>
                  )
                : (() => {
                    const todayPeriod = financialSummary.currentPeriods.today;
                    const forfeitureGrossCents
                    = todayPeriod.depositForfeitedCents ?? 0;
                    const forfeitureRefundReversalCents
                    = todayPeriod.depositForfeitureRefundReversalCents ?? 0;
                    const secondaryMetrics = [
                      ['Collected today', todayPeriod.cashCollectedCents],
                      [
                        'Remaining-balance payments',
                        todayPeriod.remainingBalancePaymentsCollectedCents
                        ?? todayPeriod.appointmentPaymentsCollectedCents
                        ?? 0,
                      ],
                      ['Deposits collected', todayPeriod.depositCollectedCents ?? 0],
                      ['Deposit refunds', todayPeriod.depositRefundedCents ?? 0],
                      ['Deposits applied', todayPeriod.depositAppliedCents ?? 0],
                      ...(forfeitureGrossCents > 0
                        ? [
                            ['Deposits forfeited (gross)', forfeitureGrossCents],
                            [
                              'Forfeiture tax estimate',
                              todayPeriod.depositForfeitureEstimatedTaxCents ?? 0,
                            ],
                            [
                              'Forfeiture net estimate',
                              todayPeriod.depositForfeitureEstimatedNetCents ?? 0,
                            ],
                          ] as const
                        : []),
                      ...(forfeitureRefundReversalCents > 0
                        ? [
                            ['Forfeiture refund reversals', forfeitureRefundReversalCents],
                            [
                              'Forfeiture tax reversals',
                              todayPeriod.depositForfeitureTaxReversalCents ?? 0,
                            ],
                            [
                              'Forfeiture net reversals',
                              todayPeriod.depositForfeitureNetReversalCents ?? 0,
                            ],
                          ] as const
                        : []),
                      [
                        'Completed outstanding',
                        financialSummary.balances.completedOutstandingCents,
                      ],
                      ['Tips today', todayPeriod.tipsCents],
                      ['Tax today', todayPeriod.taxCents],
                      ['Taxable subtotal today', todayPeriod.taxableSubtotalCents ?? 0],
                      ['Discounts today', todayPeriod.discountsCents],
                    ] as const;
                    const allDisplayedValues = [
                      todayPeriod.completedAppointmentRevenueCents,
                      financialSummary.currentPeriods.weekToDate
                        .completedAppointmentRevenueCents,
                      financialSummary.currentPeriods.monthToDate
                        .completedAppointmentRevenueCents,
                      ...secondaryMetrics.map(([, cents]) => cents),
                    ];
                    const isEmpty = allDisplayedValues.every(cents => cents === 0);
                    const historyNotice
                    = getFinancialHistoryNotice(financialSummary);
                    const statusLine = revenueStatusLine(isEmpty, historyNotice);
                    // A salon that takes no deposits and charges no tax should
                    // not read nine $0.00 rows about deposits and tax
                    // (OP-009). A family appears the moment it carries a
                    // number; it is never hidden while it has one.
                    const depositsInUse = secondaryMetrics.some(
                      ([label, cents]) =>
                        DEPOSIT_METRIC_LABELS.has(label) && cents !== 0,
                    );
                    const taxInUse = secondaryMetrics.some(
                      ([label, cents]) => TAX_METRIC_LABELS.has(label) && cents !== 0,
                    );
                    const visibleSecondaryMetrics = secondaryMetrics.filter(
                      ([label]) =>
                        (DEPOSIT_METRIC_LABELS.has(label) ? depositsInUse : true)
                        && (TAX_METRIC_LABELS.has(label) ? taxInUse : true),
                    );
                    const depositReportingIncomplete = (
                      (todayPeriod.unattributedPaymentEventCount ?? 0)
                      + (todayPeriod.unattributedDepositEventCount ?? 0)
                      + (todayPeriod.unresolvedDepositEventCount ?? 0)
                      + (todayPeriod.unresolvedDepositApplicationCount ?? 0)
                    ) > 0;
                    const currencyReportingIncomplete = (
                      (todayPeriod.unknownCurrencyAppointmentCount ?? 0)
                      + (todayPeriod.excludedForeignCurrencyAppointmentCount ?? 0)
                      + (todayPeriod.unknownCurrencyPaymentEventCount ?? 0)
                      + (todayPeriod.excludedForeignCurrencyPaymentEventCount ?? 0)
                      + (todayPeriod.unknownCurrencyDepositEventCount ?? 0)
                      + (todayPeriod.excludedForeignCurrencyDepositEventCount ?? 0)
                      + (financialSummary.balances.unknownCurrencyAppointmentCount ?? 0)
                      + (financialSummary.balances.excludedForeignCurrencyAppointmentCount ?? 0)
                    ) > 0;
                    const forfeitureTaxBuckets
                    = todayPeriod.forfeitureTaxIdentityBuckets ?? [];
                    const actualTaxBuckets
                    = todayPeriod.actualTaxIdentityBuckets ?? [];

                    return (
                      <div className="space-y-3 p-4">
                        <div className="rounded-2xl bg-gradient-to-br from-[#4C1D2E] to-[#8B1538] p-4 text-white">
                          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-rose-100">
                            Revenue today
                          </p>
                          <p className="mt-1 text-3xl font-bold tabular-nums">
                            {formatMoney(
                              todayPeriod.completedAppointmentRevenueCents,
                              financialSummary.currency,
                            )}
                          </p>
                          <p className="mt-1 text-xs text-rose-100">
                            Completed appointment revenue
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            [
                              'Revenue this week',
                              financialSummary.currentPeriods.weekToDate,
                            ],
                            [
                              'Revenue this month',
                              financialSummary.currentPeriods.monthToDate,
                            ],
                          ].map(([label, period]) => {
                            const summary = period as typeof todayPeriod;
                            return (
                              <div
                                key={label as string}
                                className="rounded-2xl border border-rose-100 bg-rose-50/50 p-3"
                              >
                                <p className="text-[12px] font-bold uppercase tracking-widest text-[var(--owner-accent,#8f3155)]">
                                  {label as string}
                                </p>
                                <p className="mt-1 text-xl font-bold tabular-nums text-stone-950">
                                  {formatMoney(
                                    summary.completedAppointmentRevenueCents,
                                    financialSummary.currency,
                                  )}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                        {statusLine && (
                          <p
                            className="rounded-2xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-xs leading-relaxed text-stone-600"
                            data-testid={isEmpty ? 'owner-revenue-summary-empty' : 'owner-revenue-history-notice'}
                          >
                            {statusLine}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => setRevenueBreakdownOpen(open => !open)}
                          aria-expanded={revenueBreakdownOpen}
                          aria-controls="owner-revenue-breakdown"
                          data-testid="owner-revenue-breakdown-toggle"
                          className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-[var(--owner-line,#dfd1d4)] px-3 py-2.5 text-sm font-semibold text-[var(--owner-ink,#30262a)] outline-none transition-colors hover:bg-[var(--owner-blush,#f6e7ec)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)]"
                        >
                          {revenueBreakdownOpen ? 'Hide breakdown' : 'View breakdown'}
                          <ChevronDown
                            size={16}
                            className={`shrink-0 text-[var(--owner-muted,#706267)] transition-transform ${revenueBreakdownOpen ? 'rotate-180' : ''}`}
                          />
                        </button>
                        {revenueBreakdownOpen && (
                          <div className="space-y-3" id="owner-revenue-breakdown">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-stone-100 pt-4 text-sm">
                              {visibleSecondaryMetrics.map(([label, cents]) => (
                                <div key={label}>
                                  <p className="text-xs text-stone-500">{label}</p>
                                  <p className="mt-0.5 font-semibold tabular-nums text-stone-900">
                                    {formatMoney(cents, financialSummary.currency)}
                                  </p>
                                </div>
                              ))}
                            </div>
                            {forfeitureTaxBuckets.length > 0 && (
                              <div
                                className="space-y-2 rounded-2xl border border-stone-100 bg-stone-50 p-3 text-xs text-stone-700"
                                data-testid="owner-forfeiture-tax-identities"
                              >
                                <p className="font-semibold text-stone-900">
                                  Forfeiture tax estimate identities
                                </p>
                                {forfeitureTaxBuckets.map(bucket => (
                                  <div
                                    key={[
                                      bucket.schemaVersion,
                                      bucket.classification,
                                      bucket.label ?? 'none',
                                      bucket.rateBps,
                                      bucket.mode,
                                      bucket.configurationEffectiveFrom ?? 'none',
                                      bucket.configurationSource,
                                      bucket.taxEstimateApplied,
                                    ].join(':')}
                                    className="rounded-xl bg-white px-3 py-2"
                                  >
                                    <p className="font-medium text-stone-900">
                                      {`${bucket.label ?? 'No tax label'} · ${(bucket.rateBps / 100).toFixed(2)}% · ${bucket.mode}`}
                                    </p>
                                    <p className="mt-0.5 text-stone-500">
                                      Schema
                                      {' '}
                                      {bucket.schemaVersion}
                                      {' '}
                                      ·
                                      {' '}
                                      {bucket.classification}
                                      {' '}
                                      ·
                                      {' '}
                                      {bucket.configurationSource}
                                      {bucket.configurationEffectiveFrom
                                        ? ` · effective ${bucket.configurationEffectiveFrom}`
                                        : ''}
                                    </p>
                                    <p className="mt-1 tabular-nums">
                                      Gross
                                      {' '}
                                      {formatMoney(bucket.grossForfeitedCents, financialSummary.currency)}
                                      {' '}
                                      · tax estimate
                                      {' '}
                                      {formatMoney(bucket.estimatedTaxIncludedCents, financialSummary.currency)}
                                      {' '}
                                      · net estimate
                                      {' '}
                                      {formatMoney(bucket.estimatedNetCents, financialSummary.currency)}
                                    </p>
                                    {bucket.refundReversalCount > 0 && (
                                      <p className="mt-1 tabular-nums text-amber-800">
                                        Later refund reversal
                                        {' '}
                                        {formatMoney(bucket.refundReversalCents, financialSummary.currency)}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {actualTaxBuckets.length > 0 && (
                              <div
                                className="space-y-2 rounded-2xl border border-stone-100 bg-stone-50 p-3 text-xs text-stone-700"
                                data-testid="owner-actual-tax-identities"
                              >
                                <p className="font-semibold text-stone-900">
                                  Completed actual tax identities
                                </p>
                                {actualTaxBuckets.map(bucket => (
                                  <div
                                    key={[
                                      bucket.schemaVersion,
                                      bucket.classification,
                                      bucket.label ?? 'none',
                                      bucket.rateBps,
                                      bucket.mode,
                                      bucket.configurationEffectiveFrom ?? 'none',
                                      bucket.configurationSource,
                                      bucket.taxApplied,
                                      bucket.taxExempt,
                                    ].join(':')}
                                    className="rounded-xl bg-white px-3 py-2"
                                  >
                                    <p className="font-medium text-stone-900">
                                      {`${bucket.label ?? 'No tax label'} · ${(bucket.rateBps / 100).toFixed(2)}% · ${bucket.mode}`}
                                    </p>
                                    <p className="mt-0.5 text-stone-500">
                                      Schema
                                      {' '}
                                      {bucket.schemaVersion}
                                      {' '}
                                      ·
                                      {' '}
                                      {bucket.classification}
                                      {' '}
                                      ·
                                      {' '}
                                      {bucket.configurationSource}
                                      {bucket.configurationEffectiveFrom
                                        ? ` · effective ${bucket.configurationEffectiveFrom}`
                                        : ''}
                                      {bucket.taxExempt ? ' · exempt' : ''}
                                    </p>
                                    <p className="mt-1 tabular-nums">
                                      Taxable
                                      {' '}
                                      {formatMoney(bucket.taxableSubtotalCents, financialSummary.currency)}
                                      {' '}
                                      · tax
                                      {' '}
                                      {formatMoney(bucket.taxCents, financialSummary.currency)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {depositReportingIncomplete && (
                              <p
                                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                                data-testid="owner-deposit-reporting-incomplete"
                              >
                                Some payment or deposit activity is excluded because its tenant, event date, currency, or resolution is unknown.
                              </p>
                            )}
                            {currencyReportingIncomplete && (
                              <p
                                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                                data-testid="owner-currency-reporting-incomplete"
                              >
                                Financial activity with unknown or non-
                                {financialSummary.currency}
                                {' '}
                                currency is excluded from these totals.
                              </p>
                            )}
                            {(todayPeriod.unresolvedActualTaxIdentityCount ?? 0) > 0 && (
                              <p
                                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                                data-testid="owner-tax-reporting-incomplete"
                              >
                                Some completed tax activity is excluded from tax identity details because its frozen final snapshot is unavailable or invalid.
                              </p>
                            )}
                          </div>
                        )}
                        {financialSummaryError && (
                          <div
                            role="alert"
                            className="flex items-center gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-950"
                          >
                            <AlertCircle size={16} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              Showing the last available revenue summary. Try
                              again in a moment.
                            </span>
                            <button
                              type="button"
                              onClick={() => void loadFinancialSummary()}
                              className="shrink-0 rounded-full bg-white px-3 py-1.5 font-semibold text-amber-950 shadow-sm"
                            >
                              Try again
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
      </section>

      {retentionLoading
      || retentionError
      || retentionItems.length
      || appointmentReminders.length
        ? (
            <section
              className="overflow-hidden rounded-owner-card border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] shadow-owner-card"
              data-testid="owner-client-followups"
            >
              <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-stone-950">Client follow-ups</h2>
                  <p className="mt-0.5 text-xs text-stone-500">
                    Rebooking, win-back offers, and reminders
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadRetention()}
                  disabled={retentionLoading}
                  aria-label="Refresh client follow-ups"
                  className="flex size-11 items-center justify-center rounded-full text-[var(--owner-accent,#8f3155)] outline-none transition-colors hover:bg-[var(--owner-blush,#f6e7ec)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] disabled:opacity-40"
                >
                  <RefreshCw
                    size={17}
                    className={retentionLoading ? 'animate-spin' : ''}
                  />
                </button>
              </div>

              {retentionLoading && !retention
                ? (
                    <div className="space-y-3 p-5">
                      <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
                      <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
                    </div>
                  )
                : (
                    <div className="space-y-3 p-4">
                      {retentionError && (
                        <div
                          role="alert"
                          className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm text-red-800"
                        >
                          <AlertCircle size={18} className="shrink-0" />
                          <span className="min-w-0 flex-1">{retentionError}</span>
                          <button
                            type="button"
                            onClick={() => void loadRetention()}
                            className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm"
                          >
                            Try again
                          </button>
                        </div>
                      )}

                      {retentionItems.map((item) => {
                        const presentation = retentionPresentation(item.stage);
                        const clientName = item.clientName || 'Client';
                        return (
                          <button
                            key={`${item.clientId}:${item.stage}`}
                            type="button"
                            onClick={() => onOpenClient(item.clientId)}
                            aria-label={`${presentation.action} ${clientName}`}
                            className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-transform active:scale-[0.99] ${presentation.className}`}
                          >
                            <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${presentation.iconClassName}`}>
                              {item.stage === 'rebook'
                                ? <UserRound size={19} />
                                : <Gift size={19} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12px] font-bold uppercase tracking-[0.12em] opacity-70">
                                {presentation.title}
                              </span>
                              <span className="mt-0.5 block truncate text-sm font-semibold">
                                {item.stage === 'rebook'
                                  ? `${clientName} is ready to rebook`
                                  : `${clientName} has not booked recently`}
                              </span>
                              <span className="mt-0.5 block text-xs opacity-70">
                                Last visit
                                {' '}
                                {formatVisitDate(item.lastVisitAt)}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs font-bold">
                              {presentation.action}
                            </span>
                            <ChevronRight size={15} className="shrink-0 opacity-50" />
                          </button>
                        );
                      })}

                      {appointmentReminders.map(reminder => (
                        <button
                          key={reminder.appointmentId}
                          type="button"
                          onClick={() => onOpenClient(reminder.clientId)}
                          aria-label={`Send reminder to ${reminder.clientName || 'client'}`}
                          className="flex w-full items-center gap-3 rounded-2xl border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-blush,#f6e7ec)] p-3 text-left text-[var(--owner-ink,#30262a)] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] active:scale-[0.99]"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--owner-surface,#fffdfb)] text-[var(--owner-accent,#8f3155)]">
                            <BellRing size={19} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--owner-accent,#8f3155)]">
                              Appointment reminder
                            </span>
                            <span className="mt-0.5 block truncate text-sm font-semibold">
                              {reminder.clientName || 'Client'}
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--owner-muted,#706267)]">
                              {formatReminderTime(reminder.startTime)}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-bold text-[var(--owner-accent-strong,#70213f)]">
                            Send reminder
                          </span>
                          <ChevronRight size={15} className="shrink-0 text-[var(--owner-accent,#8f3155)] opacity-60" />
                        </button>
                      ))}
                    </div>
                  )}
            </section>
          )
        : null}

      <QuickActionsWidget onAction={onQuickAction} />

      <GoogleEventReviewQueue salonSlug={salonSlug} />

      <section className="rounded-3xl border border-rose-100/80 bg-white p-5 shadow-[0_10px_30px_rgba(76,29,46,0.05)]">
        <h2 className="text-base font-semibold text-stone-950">
          Your booking page
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Open or share the live links your clients use.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-stone-100 p-3 text-sm font-medium text-stone-800"
          >
            <ExternalLink size={16} />
            <span>Public page</span>
          </a>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-800 p-3 text-sm font-semibold text-white shadow-sm"
          >
            <Link2 size={16} />
            <span>Booking page</span>
          </a>
          <button
            type="button"
            onClick={() => void shareLink(bookingUrl, 'Book with me')}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-100 p-3 text-sm font-medium text-rose-900"
          >
            <Link2 size={16} />
            Share booking link
          </button>
          <button
            type="button"
            onClick={() =>
              void shareLink(findBookingUrl, 'Manage your booking')}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 p-3 text-sm font-medium text-stone-800"
          >
            <MailWarning size={16} />
            Share find-booking link
          </button>
        </div>
      </section>

      <button
        type="button"
        onClick={onOpenIntegrations}
        className="flex w-full items-center justify-between rounded-3xl border border-rose-100/80 bg-white p-5 text-left shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
      >
        {/*
          Not connected is said plainly and offers the one next step. The
          two-way-sync / busy-event vocabulary describes a connection this
          salon does not have yet (AG-today-calendar-06).
        */}
        <div data-testid="owner-google-calendar-card">
          <h2 className="font-semibold text-stone-950">
            {googleNotConnected
              ? 'Connect Google Calendar'
              : 'Google Calendar & reminders'}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {googleNotConnected
              ? 'Not connected yet. Connect it to keep your salon schedule and your own calendar in step.'
              : 'Connect calendars, check two-way sync, and manage optional texting.'}
          </p>
        </div>
        <Settings2 className="shrink-0 text-rose-700" />
      </button>

      {analyticsMessage
      && analyticsTitle?.includes('temporarily')
      && onRefreshAnalytics && (
        <button
          type="button"
          onClick={onRefreshAnalytics}
          className="w-full rounded-2xl border border-stone-200 bg-white p-4 text-left text-sm text-stone-600"
        >
          Dashboard insights are temporarily unavailable. Tap to retry.
        </button>
      )}
    </main>
  );
}
