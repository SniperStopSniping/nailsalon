'use client';

import {
  AlertCircle,
  BellRing,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Gift,
  Link2,
  MailWarning,
  RefreshCw,
  Settings2,
  Sparkles,
  TriangleAlert,
  UserRound,
  Users,
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

const INCOMPLETE_HISTORY_EXPLANATION
  = 'Some historical appointments could not be included because their financial details are unavailable.';
const ESTIMATED_HISTORY_EXPLANATION
  = 'Some historical totals use booked values because finalized checkout details are unavailable.';

function getFinancialHistoryNotice(summary: OwnerFinancialSummary): {
  label: 'Incomplete history' | 'Estimated history';
  explanation: string;
} | null {
  const provenances: ReportingProvenance[] = [
    summary.currentPeriods.today.provenance,
    summary.currentPeriods.weekToDate.provenance,
    summary.currentPeriods.monthToDate.provenance,
    summary.balances.completed,
  ];

  if (provenances.some(item => item.unresolvedAppointmentCount > 0)) {
    return {
      label: 'Incomplete history',
      explanation: INCOMPLETE_HISTORY_EXPLANATION,
    };
  }

  if (provenances.some(item => item.legacyAppointmentCount > 0)) {
    return {
      label: 'Estimated history',
      explanation: ESTIMATED_HISTORY_EXPLANATION,
    };
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
  const financialSummaryCacheRef = useRef<
    Record<string, OwnerFinancialSummary>
  >({});
  const latestFinancialRequestRef = useRef(0);

  const financialSummary
    = financialSummaryState?.salonSlug === salonSlug
      ? financialSummaryState.data
      : null;

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
        error?: { message?: string } | string;
      } | null;

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
  const integrationNeedsAttention = Boolean(
    today?.integrationHealth.google.reconnectRequired
    || today?.integrationHealth.google.readiness === 'setup_incomplete'
    || today?.integrationHealth.google.inboundSyncError
    || today?.integrationHealth.calendarOutbox.failed,
  );
  const todayTotal = today?.appointments.length ?? appointments.total;
  const todayUpcoming
    = today?.appointments.filter(
      appointment =>
        ['pending', 'confirmed', 'in_progress'].includes(appointment.status)
        && new Date(appointment.endTime).getTime() >= Date.now(),
    ).length ?? appointments.upcoming;

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
      <section className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onOpenCalendar}
          className="rounded-3xl border border-rose-100/80 bg-white p-4 text-left shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
        >
          <CalendarDays className="text-rose-700" size={23} />
          <p className="mt-3 text-3xl font-bold text-stone-950">
            {todayUpcoming}
          </p>
          <p className="text-sm text-stone-500">Upcoming today</p>
        </button>
        <button
          type="button"
          onClick={onOpenBookings}
          className="rounded-3xl border border-amber-100 bg-white p-4 text-left shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
        >
          <Users className="text-amber-600" size={23} />
          <p className="mt-3 text-3xl font-bold text-stone-950">{todayTotal}</p>
          <p className="text-sm text-stone-500">Appointments today</p>
        </button>
      </section>

      <section
        className="overflow-hidden rounded-3xl border border-rose-100/80 bg-white shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
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
            className="rounded-full p-2 text-rose-800 transition-colors hover:bg-rose-50 disabled:opacity-40"
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
                        className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-rose-50/50 ${appointment.id === nextAppointmentId ? 'bg-amber-50/60' : ''} ${['completed', 'cancelled', 'no_show'].includes(appointment.status) ? 'opacity-55' : ''}`}
                      >
                        <div className="w-16 shrink-0">
                          <p className="text-sm font-semibold text-rose-900">
                            {formatTime(appointment.startTime)}
                          </p>
                          <p className="text-[11px] text-stone-400">
                            {appointment.totalDurationMinutes}
                            {' '}
                            min
                          </p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-stone-950">
                            {appointment.clientName || 'Guest client'}
                            {appointment.id === nextAppointmentId && (
                              <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide text-white">
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
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${appointmentStatusChipClasses(appointment.status)}`}>
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
          className="flex w-full items-center justify-center gap-2 border-t border-stone-100 px-4 py-3 text-sm font-semibold text-rose-800"
        >
          Open appointment calendar
          <ChevronRight size={15} />
        </button>
      </section>

      <section
        className="overflow-hidden rounded-3xl border border-rose-100/80 bg-white shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
        data-testid="owner-revenue-summary"
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-800">
              <CircleDollarSign size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-stone-950">Revenue</h2>
              <p className="mt-0.5 text-xs text-stone-500">
                Completed appointments · tax and tips separate
              </p>
            </div>
          </div>
          {financialSummary && (
            <button
              type="button"
              onClick={() => void loadFinancialSummary()}
              disabled={financialSummaryLoading}
              aria-label="Refresh revenue summary"
              className="shrink-0 rounded-full p-2 text-rose-800 transition-colors hover:bg-rose-50 disabled:opacity-40"
            >
              <RefreshCw
                size={17}
                className={financialSummaryLoading ? 'animate-spin' : ''}
              />
            </button>
          )}
        </div>

        {financialSummaryLoading && !financialSummary
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
                  const secondaryMetrics = [
                    ['Collected today', todayPeriod.cashCollectedCents],
                    [
                      'Completed outstanding',
                      financialSummary.balances.completedOutstandingCents,
                    ],
                    ['Tips today', todayPeriod.tipsCents],
                    ['Tax today', todayPeriod.taxCents],
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

                  return (
                    <div className="space-y-3 p-4">
                      <div className="rounded-2xl bg-gradient-to-br from-[#4C1D2E] to-[#8B1538] p-4 text-white">
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-rose-100">
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
                              <p className="text-[11px] font-bold uppercase tracking-widest text-rose-700">
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
                      {isEmpty && (
                        <div
                          className="rounded-2xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-xs text-stone-600"
                          data-testid="owner-revenue-summary-empty"
                        >
                          No completed financial activity yet.
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-stone-100 pt-4 text-sm">
                        {secondaryMetrics.map(([label, cents]) => (
                          <div key={label}>
                            <p className="text-xs text-stone-500">{label}</p>
                            <p className="mt-0.5 font-semibold tabular-nums text-stone-900">
                              {formatMoney(cents, financialSummary.currency)}
                            </p>
                          </div>
                        ))}
                      </div>
                      {historyNotice && (
                        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-950">
                          <p className="font-semibold">
                            {historyNotice.label}
                          </p>
                          <p className="mt-0.5">
                            {historyNotice.explanation}
                          </p>
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
              className="overflow-hidden rounded-3xl border border-rose-100/80 bg-white shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
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
                  className="rounded-full p-2 text-rose-800 transition-colors hover:bg-rose-50 disabled:opacity-40"
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
                              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">
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
                          className="flex w-full items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-left text-blue-950 transition-transform active:scale-[0.99]"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                            <BellRing size={19} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">
                              Appointment reminder
                            </span>
                            <span className="mt-0.5 block truncate text-sm font-semibold">
                              {reminder.clientName || 'Client'}
                            </span>
                            <span className="mt-0.5 block text-xs text-blue-700">
                              {formatReminderTime(reminder.startTime)}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-bold text-blue-800">
                            Send reminder
                          </span>
                          <ChevronRight size={15} className="shrink-0 text-blue-400" />
                        </button>
                      ))}
                    </div>
                  )}
            </section>
          )
        : null}

      {today?.failedConfirmations.length
      || legacyDueClients.length
      || today?.googleEventsNeedingReview
      || integrationNeedsAttention
        ? (
            <section
              className="rounded-3xl border border-amber-100 bg-white p-5 shadow-[0_10px_30px_rgba(76,29,46,0.05)]"
              data-testid="owner-needs-attention"
            >
              <div className="flex items-center gap-2">
                <AlertCircle size={19} className="text-amber-600" />
                <h2 className="font-semibold text-stone-950">Needs attention</h2>
              </div>
              <div className="mt-4 space-y-2">
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
        <div>
          <h2 className="font-semibold text-stone-950">
            Google Calendar & reminders
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Connect calendars, check two-way sync, and manage optional texting.
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
