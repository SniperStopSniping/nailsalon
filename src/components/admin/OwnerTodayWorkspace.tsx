'use client';

import {
  AlertCircle,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  Link2,
  Lock,
  MailWarning,
  RefreshCw,
  Settings2,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { QuickActionsWidget } from '@/components/admin/QuickActionsWidget';
import { SmsBalanceCard } from '@/components/admin/SmsBalanceCard';
import {
  APPOINTMENT_DATA_CHANGED_EVENT,
  RETENTION_DATA_CHANGED_EVENT,
} from '@/libs/dashboardEvents';
import type { ReportingProvenance } from '@/libs/financialReporting';
import { formatMoney } from '@/libs/formatMoney';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  getZonedDayBounds,
} from '@/libs/timeZone';
import type { OwnerFinancialSummary } from '@/types/ownerFinancialSummary';
import type { RetentionStage } from '@/types/retention';

import { getTodayOperationalState } from './todayState';

type AppointmentGlance = {
  total: number;
  completed: number;
  noShows: number;
  upcoming: number;
};

type ScheduleAppointment = {
  id: string;
  clientName: string | null;
  startTime: string;
  endTime: string;
  status: string;
  totalDurationMinutes: number;
  technicianId?: string | null;
  services: string[];
  clientSensitivities?: string | null;
};

type TodayData = {
  date: string;
  timeZone: string;
  technicians?: Array<{ id: string; name: string }>;
  appointments: ScheduleAppointment[];
  tomorrow?: { date: string; appointments: ScheduleAppointment[] };
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

const SCHEDULE_TABS = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
] as const;
const APPOINTMENT_PREVIEW_LIMIT = 5;

function shortClientName(name: string | null): string {
  const [first, ...rest] = name?.trim().split(/\s+/) ?? [];
  const last = rest.at(-1);
  return last ? `${first} ${Array.from(last)[0]}.` : first || 'Guest client';
}

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

export function OwnerTodayWorkspace({
  salonSlug,
  analyticsTitle,
  analyticsMessage,
  onRefreshAnalytics,
  onQuickAction,
  onOpenBookings,
  onOpenCalendar,
  onOpenIntegrations,
  onOpenAppointment,
  onOpenClient,
  onOpenFollowups,
  onOpenGoogleReview,
  onBuyTexts,
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
  onOpenFollowups?: () => void;
  onOpenGoogleReview?: () => void;
  onBuyTexts?: () => void;
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
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const agendaId = useId();
  const [scheduleDay, setScheduleDay] = useState<'today' | 'tomorrow'>('today');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);
  const financialSummaryCacheRef = useRef<
    Record<string, OwnerFinancialSummary>
  >({});
  const latestTodayRequestRef = useRef(0);
  const latestFinancialRequestRef = useRef(0);
  const financialSummaryOwnerOnlyRef = useRef<string | null>(null);

  const financialSummary
    = financialSummaryState?.salonSlug === salonSlug
      ? financialSummaryState.data
      : null;
  const financialSummaryOwnerOnly
    = Boolean(salonSlug) && financialSummaryOwnerOnlySlug === salonSlug;

  const loadToday = useCallback(async () => {
    const requestId = ++latestTodayRequestRef.current;
    if (!salonSlug) {
      setToday(null);
      setTodayLoading(false);
      return;
    }
    setTodayLoading(true);
    setTodayError(null);
    try {
      const response = await fetch(
        `/api/admin/today?salonSlug=${encodeURIComponent(salonSlug)}&includeTomorrow=1`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data) {
        throw new Error(
          payload?.error?.message || 'Today could not be loaded.',
        );
      }
      if (latestTodayRequestRef.current === requestId) {
        setToday(payload.data);
        setClockNow(Date.now());
      }
    } catch (error) {
      if (latestTodayRequestRef.current === requestId) {
        setTodayError(
          error instanceof Error ? error.message : 'Today could not be loaded.',
        );
      }
    } finally {
      if (latestTodayRequestRef.current === requestId) {
        setTodayLoading(false);
      }
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
    return () => {
      latestTodayRequestRef.current += 1;
      window.clearInterval(timer);
    };
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

  const legacyDueClients
    = !retention && retentionError ? (today?.dueClients ?? []) : [];

  useEffect(() => {
    const tick = () => setClockNow(Date.now());
    const timer = window.setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const todayDate = today?.date;
  const todayTimeZone = today?.timeZone;
  const nextMidnight = useMemo(
    () => todayDate && todayTimeZone
      ? getZonedDayBounds(todayDate, todayTimeZone).endOfDay.getTime() + 1
      : null,
    [todayDate, todayTimeZone],
  );
  const scheduleHasRolled = nextMidnight !== null && clockNow >= nextMidnight;
  useEffect(() => {
    if (nextMidnight === null || scheduleHasRolled) {
      return;
    }
    const timer = window.setTimeout(() => setClockNow(Date.now()), Math.max(0, nextMidnight - Date.now()));
    return () => window.clearTimeout(timer);
  }, [nextMidnight, scheduleHasRolled]);

  useEffect(() => {
    if (scheduleHasRolled) {
      void loadToday();
      void loadFinancialSummary();
    }
  }, [scheduleHasRolled, loadToday, loadFinancialSummary]);

  const schedule = scheduleHasRolled ? null : today;
  const operationalState = useMemo(
    () => getTodayOperationalState(schedule?.appointments ?? [], clockNow),
    [schedule, clockNow],
  );
  const technicians = useMemo(() => schedule?.technicians ?? [], [schedule?.technicians]);
  useEffect(() => {
    if (schedule && selectedTechnicianId && !technicians.some(tech => tech.id === selectedTechnicianId)) {
      setSelectedTechnicianId(null);
      setExpandedDate(null);
    }
  }, [schedule, selectedTechnicianId, technicians]);

  const matchesTechnician = (appointment: ScheduleAppointment) =>
    !selectedTechnicianId || appointment.technicianId === selectedTechnicianId;
  const appointmentsByDay = {
    today: schedule?.appointments.filter(matchesTechnician),
    tomorrow: schedule?.tomorrow?.appointments.filter(matchesTechnician),
  };
  const selectedAppointments = appointmentsByDay[scheduleDay];
  const selectedDate = scheduleDay === 'today' ? schedule?.date : schedule?.tomorrow?.date;
  const selectedLabel = scheduleDay === 'today' ? 'Today' : 'Tomorrow';
  const expanded = Boolean(selectedDate && expandedDate === selectedDate);
  const visibleAppointments = expanded
    ? selectedAppointments
    : selectedAppointments?.slice(0, APPOINTMENT_PREVIEW_LIMIT);
  const sensitivityAlerts = selectedAppointments?.filter(
    appointment => appointment.status !== 'completed' && appointment.clientSensitivities?.trim(),
  ) ?? [];
  const showTechnicianFilter = technicians.length > 1
    && Boolean(schedule?.appointments.length || schedule?.tomorrow?.appointments.length);

  const selectScheduleDay = (day: typeof scheduleDay) => {
    if (day !== scheduleDay) {
      setScheduleDay(day);
      setExpandedDate(null);
    }
  };

  const selectTechnician = (technicianId: string | null) => {
    if (technicianId !== selectedTechnicianId) {
      setSelectedTechnicianId(technicianId);
      setExpandedDate(null);
    }
  };

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

  const formatTime = (value: string) =>
    formatTimeInTimeZone(value, {}, todayTimeZone);

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

  const openFollowups = () => {
    if (onOpenFollowups) {
      onOpenFollowups();
      return;
    }
    const fallbackClientId = retentionItems[0]?.clientId ?? legacyDueClients[0]?.id;
    if (fallbackClientId) {
      onOpenClient(fallbackClientId);
    }
  };

  const urgentSection = operationalState.unresolvedAppointments.length
    || operationalState.pendingRequests.length
    ? (
        <section
          className="rounded-3xl border border-amber-200 bg-amber-50 p-4 shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
          data-testid="owner-urgent-attention"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-amber-700" />
            <h2 className="text-[15px] font-semibold text-stone-950">Action needed today</h2>
          </div>
          <div className="mt-3 space-y-2">
            {operationalState.unresolvedAppointments.slice(0, 2).map(appointment => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => onOpenAppointment(appointment.id)}
                data-testid="owner-unresolved-appointment"
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl bg-white p-3 text-left text-sm text-amber-950"
              >
                <TriangleAlert size={18} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {appointment.clientName || 'Guest client'}
                    {' '}
                    needs an update
                  </span>
                  <span className="mt-0.5 block text-xs opacity-80">
                    Scheduled
                    {' '}
                    {formatTime(appointment.startTime)}
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0" />
              </button>
            ))}
            {operationalState.pendingRequests.slice(0, 2).map(appointment => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => onOpenAppointment(appointment.id)}
                data-testid="owner-pending-booking-request"
                aria-label={`Review booking request from ${appointment.clientName || 'Guest client'}`}
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl bg-white p-3 text-left text-sm text-amber-950"
              >
                <CalendarCheck size={18} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    Booking request from
                    {' '}
                    {appointment.clientName || 'Guest client'}
                  </span>
                  <span className="mt-0.5 block text-xs opacity-80">{formatTime(appointment.startTime)}</span>
                </span>
                <ChevronRight size={15} className="shrink-0" />
              </button>
            ))}
            {(operationalState.unresolvedAppointments.length + operationalState.pendingRequests.length) > 4 && (
              <button
                type="button"
                onClick={onOpenBookings}
                className="flex min-h-11 w-full items-center justify-between rounded-2xl px-3 text-left text-xs font-semibold text-amber-950"
              >
                View all appointment actions
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </section>
      )
    : null;

  const attentionSection = today?.failedConfirmations.length || integrationNeedsAttention
    ? (
        <section
          className="owner-card p-5"
          data-testid="owner-needs-attention"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-stone-700" />
            <h2 className="owner-section-title">Needs attention</h2>
          </div>
          <div className="mt-3 space-y-2">
            {Boolean(today?.failedConfirmations.length) && (
              <button
                type="button"
                onClick={() => today?.failedConfirmations[0]?.appointmentId && onOpenAppointment(today.failedConfirmations[0].appointmentId)}
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl bg-red-50 p-3 text-left text-sm text-red-900"
              >
                <MailWarning size={18} />
                <span className="flex-1">
                  {today!.failedConfirmations.length}
                  {' '}
                  confirmation email
                  {today!.failedConfirmations.length === 1 ? '' : 's'}
                  {' '}
                  need resending
                </span>
                <ChevronRight size={15} />
              </button>
            )}
            {integrationNeedsAttention && (
              <button
                type="button"
                onClick={onOpenIntegrations}
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl bg-stone-100 p-3 text-left text-sm text-stone-800"
              >
                <Settings2 size={18} />
                <span className="flex-1">
                  {today?.integrationHealth.google.readiness === 'setup_incomplete'
                    ? 'Finish Google Calendar setup'
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
      className="mx-auto max-w-2xl space-y-5 px-5 pb-28 pt-3"
      data-testid="owner-today-workspace"
    >
      {onBuyTexts && <SmsBalanceCard compact salonSlug={salonSlug} onBuy={onBuyTexts} />}
      {urgentSection}
      <section
        aria-label="Appointments"
        className="overflow-hidden rounded-owner-card border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] shadow-owner-card"
        data-testid="owner-today-agenda"
      >
        <div className="flex items-center gap-2 px-3 pt-3 sm:px-4">
          <div role="tablist" aria-label="Appointment days" className="grid min-w-0 flex-1 grid-cols-2 gap-1 rounded-full bg-[var(--owner-blush)] p-1">
            {SCHEDULE_TABS.map(({ id, label }) => {
              const selected = id === scheduleDay;
              const count = appointmentsByDay[id]?.length;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`${agendaId}-${id}`}
                  aria-controls={`${agendaId}-panel`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectScheduleDay(id)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                      return;
                    }
                    event.preventDefault();
                    const nextDay = event.key === 'Home' || (event.key !== 'End' && id === 'tomorrow')
                      ? 'today'
                      : 'tomorrow';
                    selectScheduleDay(nextDay);
                    document.getElementById(`${agendaId}-${nextDay}`)?.focus();
                  }}
                  className={`min-h-11 rounded-full px-2 text-sm font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-focus)] ${selected ? 'bg-[var(--owner-accent)] text-white' : 'text-[var(--owner-ink)]'}`}
                >
                  {label}
                  {count === undefined ? '' : ` (${count})`}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void Promise.all([
              loadToday(),
              loadRetention(),
              loadFinancialSummary(),
            ])}
            disabled={todayLoading || retentionLoading || financialSummaryLoading}
            aria-label="Refresh dashboard"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-accent)] outline-none hover:bg-[var(--owner-blush)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus)] disabled:opacity-40"
          >
            <RefreshCw
              size={17}
              className={todayLoading || retentionLoading || financialSummaryLoading ? 'animate-spin motion-reduce:animate-none' : ''}
              aria-hidden="true"
            />
          </button>
        </div>

        <div
          role="tabpanel"
          id={`${agendaId}-panel`}
          aria-labelledby={`${agendaId}-${scheduleDay}`}
          tabIndex={0}
          className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus)]"
        >
          <h2 className="owner-section-title px-4 py-3">
            {selectedLabel}
            {selectedDate && (
              <>
                {' · '}
                <time dateTime={selectedDate}>
                  {formatDateInTimeZone(`${selectedDate}T12:00:00Z`, { weekday: 'short', month: 'short', day: 'numeric' }, 'UTC')}
                </time>
              </>
            )}
          </h2>

          {showTechnicianFilter && (
            <div className="flex gap-2 overflow-x-auto px-4 pb-3" role="group" aria-label="Filter schedule by technician">
              {[{ id: null, name: 'All technicians' }, ...technicians].map(tech => (
                <button
                  key={tech.id ?? 'all'}
                  type="button"
                  onClick={() => selectTechnician(tech.id)}
                  aria-pressed={selectedTechnicianId === tech.id}
                  className={`min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus)] ${selectedTechnicianId === tech.id ? 'bg-[var(--owner-accent)] text-white' : 'bg-stone-100 text-stone-700'}`}
                >
                  {tech.name}
                </button>
              ))}
            </div>
          )}

          {(todayError || (!todayLoading && !selectedAppointments)) && (
            <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <span>
                {todayError || `${selectedLabel}’s appointments could not be loaded.`}
                {selectedAppointments && ' Showing the last available schedule.'}
              </span>
              <button type="button" className="min-h-11 rounded-full px-2 font-semibold underline" onClick={() => void loadToday()}>
                Try again
              </button>
            </div>
          )}
          {todayLoading && !selectedAppointments && (
            <div role="status" className="space-y-2 px-4 pb-4">
              <span className="sr-only">Loading appointments</span>
              <div className="h-12 animate-pulse rounded-2xl bg-stone-100 motion-reduce:animate-none" />
              <div className="h-12 animate-pulse rounded-2xl bg-stone-100 motion-reduce:animate-none" />
            </div>
          )}
          {visibleAppointments && (
            visibleAppointments.length > 0
              ? (
                  <ul id={`${agendaId}-appointments`} className="divide-y divide-[var(--owner-line)] border-t border-[var(--owner-line)]">
                    {visibleAppointments.map(appointment => (
                      <li key={appointment.id}>
                        <button
                          type="button"
                          onClick={() => onOpenAppointment(appointment.id)}
                          className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-[var(--owner-surface-soft)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus)]"
                        >
                          <time
                            dateTime={appointment.startTime}
                            className="w-20 shrink-0 rounded-xl bg-[var(--owner-blush)] p-1.5 text-center text-xs font-semibold tabular-nums text-[var(--owner-accent-strong)]"
                          >
                            {formatTime(appointment.startTime)}
                          </time>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-bold leading-snug text-[var(--owner-ink)]">
                              {shortClientName(appointment.clientName)}
                            </span>
                            <span className="block break-words text-xs leading-snug text-[var(--owner-muted)]">
                              {appointment.services.join(', ') || 'Service'}
                              {' · '}
                              {appointment.totalDurationMinutes}
                              {' min'}
                            </span>
                          </span>
                          <ChevronRight size={16} className="shrink-0 text-[var(--owner-muted)]" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              : (
                  <p className="px-4 py-6 text-center text-sm text-[var(--owner-muted)]">
                    No appointments
                    {' '}
                    {selectedLabel.toLowerCase()}
                  </p>
                )
          )}
          {selectedAppointments && selectedAppointments.length > APPOINTMENT_PREVIEW_LIMIT && (
            <button
              type="button"
              onClick={() => setExpandedDate(expanded ? null : selectedDate ?? null)}
              aria-expanded={expanded}
              aria-controls={`${agendaId}-appointments`}
              className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-[var(--owner-line)] px-4 text-sm font-semibold text-[var(--owner-accent)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus)]"
            >
              {expanded ? 'Show fewer appointments' : 'View all appointments'}
              <ChevronDown size={15} className={expanded ? 'rotate-180' : undefined} aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenBookings}
          className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-[var(--owner-line,#dfd1d4)] px-4 py-3 text-sm font-semibold text-[var(--owner-accent,#8f3155)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus,#b85075)]"
        >
          Open appointment calendar
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </section>

      {sensitivityAlerts.length > 0 && (
        <section className="rounded-owner-card border border-amber-200 bg-amber-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
            <TriangleAlert size={16} aria-hidden="true" />
            Client sensitivities
            {' · '}
            {selectedLabel}
          </h2>
          <ul className="mt-2 space-y-2">
            {sensitivityAlerts.map(appointment => (
              <li key={appointment.id}>
                <button
                  type="button"
                  onClick={() => onOpenAppointment(appointment.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl bg-white px-3 py-2 text-left text-sm text-amber-950 focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                >
                  <span className="min-w-0 break-words">
                    <span className="block font-semibold">
                      {appointment.clientName || 'Guest client'}
                      {' · '}
                      {formatTime(appointment.startTime)}
                    </span>
                    <span className="block whitespace-pre-wrap text-xs">{appointment.clientSensitivities}</span>
                  </span>
                  <ChevronRight size={15} className="shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <QuickActionsWidget onAction={onQuickAction} />

      {attentionSection}

      <section
        className="overflow-hidden rounded-owner-card border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] shadow-owner-card"
        data-testid="owner-revenue-summary"
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="owner-section-title">Completed service revenue</h2>
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
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--owner-muted)]">
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
                    const customerPaymentMetrics = [
                      ['Customer payments (gross)', todayPeriod.customerPaymentCollectedCents ?? 0],
                      ['Customer captures under review', todayPeriod.customerPaymentHeldForReviewCents ?? 0],
                      ['Customer refunds', todayPeriod.customerPaymentRefundedCents ?? 0],
                      ['Customer refunds with unresolved allocations', todayPeriod.customerPaymentUnallocatedRefundCents ?? 0],
                      ['Dispute principal withdrawn', todayPeriod.customerPaymentDisputeWithdrawnCents ?? 0],
                      ['Dispute principal reinstated', todayPeriod.customerPaymentDisputeReinstatedCents ?? 0],
                      ['Dispute fees (signed)', todayPeriod.customerPaymentDisputeFeeCents ?? 0],
                      ['Dispute net movement (signed)', todayPeriod.customerPaymentDisputeNetCents ?? 0],
                      ['Customer refunds under review', todayPeriod.customerPaymentRefundHeldForReviewCents ?? 0],
                      ...(todayPeriod.customerPaymentNetCashCents === undefined
                        ? []
                        : [['Customer payment net cash', todayPeriod.customerPaymentNetCashCents] as const]),
                      ['Platform fee refunds (separate)', todayPeriod.customerPaymentFeeRefundedCents ?? 0],
                      ['Platform fee refunds under review', todayPeriod.customerPaymentFeeRefundHeldForReviewCents ?? 0],
                    ] as const;
                    const customerPaymentsInUse = todayPeriod.customerPaymentMovementReconciliationRequired || customerPaymentMetrics.some(([, cents]) => cents !== 0);
                    const secondaryMetrics = [
                      [customerPaymentsInUse ? 'Collected today (gross)' : 'Collected today', todayPeriod.cashCollectedCents],
                      ...(customerPaymentsInUse ? customerPaymentMetrics : []),
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
                        <div className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface-soft)] p-5">
                          <p className="owner-today-highlight__eyebrow">
                            Completed service revenue today
                          </p>
                          <p className="owner-revenue-amount">
                            {formatMoney(
                              todayPeriod.completedAppointmentRevenueCents,
                              financialSummary.currency,
                            )}
                          </p>
                          <p className="mt-2 text-[13px] text-[var(--owner-muted)]">
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
                                className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3"
                              >
                                <p className="text-[13px] font-medium leading-relaxed text-[var(--owner-muted)]">
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
                            {customerPaymentsInUse && (
                              <p className="text-xs text-stone-500">
                                Customer net cash is gross captures minus successful customer refunds in this period, including amounts under review. Review amounts are shown separately, not deducted again. Platform fee refunds are separate platform money. These figures are not profit or payouts.
                              </p>
                            )}
                            {(todayPeriod.customerPaymentMovementReconciliationRequired || (todayPeriod.customerPaymentUnallocatedRefundCents ?? 0) > 0 || (todayPeriod.customerPaymentDisputeWithdrawnCents ?? 0) > 0 || (todayPeriod.customerPaymentDisputeReinstatedCents ?? 0) > 0) && (
                              <p className="text-xs text-amber-700">
                                {todayPeriod.customerPaymentMovementReconciliationRequired && 'Cash movement reconciliation is required; complete customer net cash is unavailable. '}
                                Refund allocations and booking credit remain unresolved. Disputes and fee returns are separate cash movements, not booking credit.
                              </p>
                            )}
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

      {(retentionError || retentionItems.length || legacyDueClients.length)
        ? (
            <section
              className="rounded-owner-card border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] p-4 shadow-owner-card"
              data-testid="owner-client-followups"
            >
              {retentionError
                ? (
                    <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm text-red-800">
                      <AlertCircle size={18} className="shrink-0" />
                      <span className="min-w-0 flex-1">{retentionError}</span>
                      <button type="button" onClick={() => void loadRetention()} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm">Try again</button>
                    </div>
                  )
                : (
                    <button
                      type="button"
                      onClick={openFollowups}
                      className="flex min-h-14 w-full items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)]"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--owner-blush,#f6e7ec)] text-[var(--owner-accent,#8f3155)]"><UserRound size={19} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-stone-950">
                          {retentionItems.length + legacyDueClients.length}
                          {' '}
                          client
                          {retentionItems.length + legacyDueClients.length === 1 ? '' : 's'}
                          {' '}
                          ready for follow-up
                        </span>
                        <span className="mt-0.5 block text-xs text-stone-500">Rebooking and win-back are managed in Clients.</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-[var(--owner-accent,#8f3155)]">View</span>
                      <ChevronRight size={15} className="shrink-0 text-stone-300" />
                    </button>
                  )}
            </section>
          )
        : null}

      {Boolean(today?.googleEventsNeedingReview) && (
        <button
          type="button"
          onClick={onOpenGoogleReview ?? onOpenCalendar}
          className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-left text-sm text-stone-700"
          data-testid="owner-google-review-housekeeping"
        >
          <Clock3 size={18} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {today!.googleEventsNeedingReview}
            {' '}
            Google event
            {today!.googleEventsNeedingReview === 1 ? '' : 's'}
            {' '}
            need review
          </span>
          <ChevronRight size={15} className="shrink-0" />
        </button>
      )}

      <section className="overflow-hidden rounded-3xl border border-rose-100/80 bg-white shadow-[0_10px_30px_rgba(76,29,46,0.05)]" data-testid="owner-today-utilities">
        <button
          type="button"
          onClick={() => setUtilitiesOpen(open => !open)}
          aria-expanded={utilitiesOpen}
          className="flex min-h-14 w-full items-center gap-3 px-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus,#b85075)]"
        >
          <Settings2 size={19} className="shrink-0 text-[var(--owner-accent,#8f3155)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-stone-950">Utilities</span>
            <span className="mt-0.5 block text-xs text-stone-500">Booking links and connections</span>
          </span>
          <ChevronDown size={17} className={utilitiesOpen ? 'rotate-180 text-stone-400 transition-transform' : 'text-stone-400 transition-transform'} />
        </button>
        {utilitiesOpen && (
          <div className="border-t border-rose-100/80 p-5">
            <div className="grid grid-cols-2 gap-2">
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
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="mt-2 flex min-h-11 w-full items-center justify-between rounded-2xl border border-stone-200 px-3 text-left text-sm font-medium text-stone-800"
            >
              <span>{googleNotConnected ? 'Connect Google Calendar' : 'Manage integrations'}</span>
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </section>

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
