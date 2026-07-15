'use client';

import { AlertTriangle, CalendarDays, ExternalLink, Link2, Settings2, Users } from 'lucide-react';

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
    <main className="mx-auto max-w-2xl space-y-4 px-5 pb-28 pt-4" data-testid="owner-today-workspace">
      <section className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onOpenCalendar} className="rounded-3xl bg-white p-4 text-left shadow-sm">
          <CalendarDays className="text-blue-600" size={23} />
          <p className="mt-3 text-3xl font-bold text-[#1C1C1E]">{appointments.upcoming}</p>
          <p className="text-sm text-[#8E8E93]">Upcoming today</p>
        </button>
        <button type="button" onClick={onOpenBookings} className="rounded-3xl bg-white p-4 text-left shadow-sm">
          <Users className="text-emerald-600" size={23} />
          <p className="mt-3 text-3xl font-bold text-[#1C1C1E]">{appointments.total}</p>
          <p className="text-sm text-[#8E8E93]">Appointments today</p>
        </button>
      </section>

      <QuickActionsWidget onAction={onQuickAction} />

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[#1C1C1E]">Your booking page</h2>
        <p className="mt-1 text-sm text-[#8E8E93]">Open or share the live links your clients use.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-stone-100 p-3 text-sm font-medium text-stone-800">
            <ExternalLink size={16} />
            <span>Public page</span>
          </a>
          <a href={bookingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-700 p-3 text-sm font-medium text-white">
            <Link2 size={16} />
            <span>Booking page</span>
          </a>
        </div>
      </section>

      <button type="button" onClick={onOpenIntegrations} className="flex w-full items-center justify-between rounded-3xl bg-white p-5 text-left shadow-sm">
        <div>
          <h2 className="font-semibold text-[#1C1C1E]">Google Calendar & reminders</h2>
          <p className="mt-1 text-sm text-[#8E8E93]">Connect calendars, check sync, and manage optional texting.</p>
        </div>
        <Settings2 className="shrink-0 text-blue-600" />
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
