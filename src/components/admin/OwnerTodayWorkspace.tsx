'use client';

import { AlertTriangle, CalendarDays, ExternalLink, Link2, Settings2, Sparkles, Users } from 'lucide-react';

import { QuickActionsWidget } from '@/components/admin/QuickActionsWidget';

type AppointmentGlance = {
  total: number;
  completed: number;
  noShows: number;
  upcoming: number;
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
}) {
  const publicUrl = `/${encodeURIComponent(salonSlug)}`;
  const bookingUrl = `${publicUrl}/book`;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-5 pb-28 pt-3" data-testid="owner-today-workspace">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#4C1D2E] via-[#8B1538] to-[#D6A34A] p-5 text-white shadow-[0_18px_45px_rgba(76,29,46,0.18)]">
        <div className="absolute -right-8 -top-10 size-32 rounded-full bg-white/10 blur-sm" />
        <Sparkles className="relative text-amber-200" size={22} />
        <p className="relative mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-rose-100">Luster for nail techs</p>
        <h2 className="relative mt-1 text-2xl font-semibold tracking-tight">Your day, polished.</h2>
        <p className="relative mt-2 max-w-md text-sm text-rose-50/90">Bookings, clients, services, Calendar sync, and salon growth tools in one place.</p>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onOpenCalendar} className="rounded-3xl border border-rose-100/80 bg-white p-4 text-left shadow-[0_10px_30px_rgba(76,29,46,0.05)]">
          <CalendarDays className="text-rose-700" size={23} />
          <p className="mt-3 text-3xl font-bold text-stone-950">{appointments.upcoming}</p>
          <p className="text-sm text-stone-500">Upcoming today</p>
        </button>
        <button type="button" onClick={onOpenBookings} className="rounded-3xl border border-amber-100 bg-white p-4 text-left shadow-[0_10px_30px_rgba(76,29,46,0.05)]">
          <Users className="text-amber-600" size={23} />
          <p className="mt-3 text-3xl font-bold text-stone-950">{appointments.total}</p>
          <p className="text-sm text-stone-500">Appointments today</p>
        </button>
      </section>

      <QuickActionsWidget onAction={onQuickAction} />

      <section className="rounded-3xl border border-rose-100/80 bg-white p-5 shadow-[0_10px_30px_rgba(76,29,46,0.05)]">
        <h2 className="text-base font-semibold text-stone-950">Your booking page</h2>
        <p className="mt-1 text-sm text-stone-500">Open or share the live links your clients use.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-stone-100 p-3 text-sm font-medium text-stone-800">
            <ExternalLink size={16} />
            <span>Public page</span>
          </a>
          <a href={bookingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-800 p-3 text-sm font-semibold text-white shadow-sm">
            <Link2 size={16} />
            <span>Booking page</span>
          </a>
        </div>
      </section>

      <button type="button" onClick={onOpenIntegrations} className="flex w-full items-center justify-between rounded-3xl border border-rose-100/80 bg-white p-5 text-left shadow-[0_10px_30px_rgba(76,29,46,0.05)]">
        <div>
          <h2 className="font-semibold text-stone-950">Google Calendar & reminders</h2>
          <p className="mt-1 text-sm text-stone-500">Connect calendars, check two-way sync, and manage optional texting.</p>
        </div>
        <Settings2 className="shrink-0 text-rose-700" />
      </button>

      {analyticsMessage && (
        <section className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="analytics-addon-notice">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <div>
            <p className="font-semibold">{analyticsTitle || 'Advanced analytics is optional'}</p>
            <p className="mt-1 text-amber-800">{analyticsMessage}</p>
            <p className="mt-1 text-amber-800">Your calendar, bookings, clients, services, and settings are still available.</p>
            {onRefreshAnalytics && (
              <button type="button" onClick={onRefreshAnalytics} className="mt-2 font-semibold text-amber-950 underline">
                Refresh analytics access
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
