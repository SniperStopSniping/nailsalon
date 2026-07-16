'use client';

import {
  AlertCircle,
  CalendarDays,
  ChevronRight,
  Clock3,
  ExternalLink,
  Link2,
  MailWarning,
  RefreshCw,
  Settings2,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { GoogleEventReviewQueue } from '@/components/admin/GoogleEventReviewQueue';
import { QuickActionsWidget } from '@/components/admin/QuickActionsWidget';

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
      reconnectRequired?: boolean;
      inboundSyncError?: string | null;
    };
    calendarOutbox: { pending: number; failed: number };
  };
  links?: { publicUrl: string; bookingUrl: string; findBookingUrl: string };
};

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
  onOpenClients,
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
  onOpenClients: () => void;
}) {
  const [today, setToday] = useState<TodayData | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<string | null>(null);

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

  useEffect(() => {
    void loadToday();
    const timer = window.setInterval(() => void loadToday(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadToday]);

  const nextAppointmentId = useMemo(
    () =>
      today?.appointments.find(
        appointment => new Date(appointment.endTime).getTime() >= Date.now(),
      )?.id ?? null,
    [today],
  );
  const integrationNeedsAttention = Boolean(
    today?.integrationHealth.google.reconnectRequired
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
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#4C1D2E] via-[#8B1538] to-[#D6A34A] p-5 text-white shadow-[0_18px_45px_rgba(76,29,46,0.18)]">
        <div className="absolute -right-8 -top-10 size-32 rounded-full bg-white/10 blur-sm" />
        <Sparkles className="relative text-amber-200" size={22} />
        <p className="relative mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-rose-100">
          Luster for nail techs
        </p>
        <h2 className="relative mt-1 text-2xl font-semibold tracking-tight">
          Your day, polished.
        </h2>
        <p className="relative mt-2 max-w-md text-sm text-rose-50/90">
          Bookings, clients, services, Calendar sync, and salon growth tools in
          one place.
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
            onClick={() => void loadToday()}
            disabled={todayLoading}
            aria-label="Refresh today"
            className="rounded-full p-2 text-rose-800 transition-colors hover:bg-rose-50 disabled:opacity-40"
          >
            <RefreshCw
              size={17}
              className={todayLoading ? 'animate-spin' : ''}
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
                        className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-rose-50/50 ${appointment.id === nextAppointmentId ? 'bg-amber-50/60' : ''}`}
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
                          </p>
                          <p className="truncate text-xs text-stone-500">
                            {appointment.services.join(', ')}
                            {appointment.technicianName
                              ? ` · ${appointment.technicianName}`
                              : ''}
                          </p>
                        </div>
                        <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-semibold capitalize text-stone-600">
                          {appointment.status.replace('_', ' ')}
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

      {today?.failedConfirmations.length
      || today?.dueClients.length
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
                {Boolean(today?.dueClients.length) && (
                  <button
                    type="button"
                    onClick={onOpenClients}
                    className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-3 text-left text-sm text-amber-900"
                  >
                    <UserRound size={18} />
                    <span className="flex-1">
                      {today!.dueClients.length}
                      {' '}
                      client
                      {today!.dueClients.length === 1 ? '' : 's'}
                      {' '}
                      due for rebooking
                    </span>
                    <ChevronRight size={15} />
                  </button>
                )}
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
                    <span className="flex-1">Google Calendar needs attention</span>
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
