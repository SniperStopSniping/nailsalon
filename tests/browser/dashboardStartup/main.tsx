import '@/styles/global.css';

import { useRouter, useSearchParams } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AdminModalHost } from '@/components/admin/AdminModalHost';
import type { TimePeriod } from '@/components/admin/AnalyticsWidgets';
import type { AppId } from '@/components/admin/AppGrid';
import { DeferredNewAppointmentModal } from '@/components/admin/DeferredOwnerDialogs';
import en from '@/locales/en.json';
import { SalonProvider } from '@/providers/SalonProvider';

import { installReviewApi } from '../ownerCoreTabs/review-api';

installReviewApi();

export function DashboardStartupFixture() {
  const query = useSearchParams();
  const router = useRouter();
  const app = query.get('app') as AppId | null;
  const salon = query.get('salon') ?? 'isla-browser';
  const [reportPeriod, setReportPeriod] = useState<TimePeriod>('Weekly');
  const [reportAnchor, setReportAnchor] = useState('2026-10-05');
  const populatedReports = query.get('reports') === 'populated';
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const navigate = (next: string | null) => {
    const params = new URLSearchParams(query);
    if (next) {
      params.set('app', next);
    } else {
      params.delete('app');
    }
    router.push(`/?${params.toString()}`);
  };
  return (
    <SalonProvider salonSlug={salon} salonId={`id-${salon}`} salonName={salon}>
      <main className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] p-5 text-[var(--owner-ink)]">
        <h1 className="owner-title text-3xl">Today</h1>
        <p>Isolated startup review. Synthetic data; no account or provider writes.</p>
        <nav aria-label="Tools" className="mt-6 flex flex-wrap gap-3">
          {(['schedule', 'clients', 'services', 'settings', 'payments', 'analytics'] as const).map(id => <button className="min-h-11 rounded-full border border-[var(--owner-line)] px-4" key={id} onClick={() => navigate(id)} type="button">{id}</button>)}
          <button onClick={() => setAppointmentOpen(true)} type="button">New appointment</button>
          <button onClick={() => setWalkInOpen(true)} type="button">Walk-in</button>
          <button onClick={() => setNotificationsOpen(true)} type="button">Activity</button>
          <button onClick={() => router.push('/?salon=other-browser')} type="button">Switch salon</button>
        </nav>
        <AdminModalHost
          activeModal={app}
          activeSalonSlug={salon}
          activeSalonId={`id-${salon}`}
          activeSalonName={salon}
          isFreeSolo
          onCloseModal={() => navigate(null)}
          onOpenApp={navigate}
          showNotifications={notificationsOpen}
          setShowNotifications={setNotificationsOpen}
          showFraudSignals={false}
          setShowFraudSignals={() => {}}
          showScheduleCalendar={app === 'schedule'}
          setShowScheduleCalendar={() => {}}
          showWalkIn={walkInOpen}
          setShowWalkIn={setWalkInOpen}
          userName="Synthetic owner"
          userInitial="S"
          analyticsAppAvailable
          analyticsProps={{
            appointments: populatedReports ? { total: 999, completed: 780, upcoming: 217, noShows: 2 } : undefined,
            revenue: populatedReports ? 123456789 : 0,
            revenueTrend: populatedReports ? -13 : 0,
            revenueTrendAvailable: populatedReports,
            revenueSeries: populatedReports ? [10, 30, 15, 42, 24, 15, 60] : [],
            staffData: populatedReports ? [{ id: 1, name: 'Alexandra Marie — Senior Nail Artist', role: 'Technician', revenue: '$1,234,567.89', avatarColor: 'bg-blue-100' }] : [],
            utilization: populatedReports ? [{ name: 'Alexandra Marie — Senior Nail Artist', percent: 72, color: '#8f3155' }, { name: 'Daniela', percent: 48, color: '#67545e' }] : [],
            services: populatedReports ? [{ label: 'Russian Manicure with French Tips & Hand-painted Nail Art', percent: 65, color: '#8f3155' }, { label: 'Gel Pedicure', percent: 35, color: '#67545e' }] : [],
            timePeriod: reportPeriod,
            onTimePeriodChange: setReportPeriod,
            anchorDate: reportAnchor,
            onPrev: () => setReportAnchor('2026-09-28'),
            onNext: () => setReportAnchor('2026-10-05'),
            onToday: () => setReportAnchor('2026-10-10'),
            onAnchorChange: setReportAnchor,
            onQuickAction: (action) => {
              if (action === 'new-appointment') {
                setAppointmentOpen(true);
              }
              if (action === 'walk-in') {
                setWalkInOpen(true);
              }
            },
          }}
          fraudSignals={[]}
          fraudSignalsTotalCount={0}
          fraudSignalsLoading={false}
          fraudSignalsError={null}
          fetchFraudSignals={() => {}}
          onFraudSignalResolved={() => {}}
        />
        <DeferredNewAppointmentModal isOpen={appointmentOpen} onClose={() => setAppointmentOpen(false)} salonSlug={salon} />
      </main>
    </SalonProvider>
  );
}

createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale="en" messages={en}><DashboardStartupFixture /></NextIntlClientProvider>);
