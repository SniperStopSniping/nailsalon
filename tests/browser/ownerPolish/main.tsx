import '@/styles/global.css';
import './review.css';

import { Bell, Building2 } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppGrid } from '@/components/admin/AppGrid';
import { AppModal, BackButton, ModalHeader } from '@/components/admin/AppModal';
import { OwnerTodayWorkspace } from '@/components/admin/OwnerTodayWorkspace';
import { OwnerWorkspaceHeader } from '@/components/admin/OwnerWorkspaceHeader';
import { OwnerWorkspaceNav, type OwnerWorkspaceTab } from '@/components/admin/OwnerWorkspaceNav';
import en from '@/locales/en.json';

// Isolated browser fixture: render production components with synthetic API data.
// Never connects to a real tenant, auth provider, messaging or payments service.
const query = new URLSearchParams(location.search);
const empty = query.get('state') === 'empty';
const error = query.get('state') === 'error';
const now = new Date();
const time = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);
const appointment = (id: string, name: string, minutes: number, status = 'confirmed') => ({
  id,
  clientName: name,
  startTime: time(minutes),
  endTime: time(minutes + 45),
  status,
  totalPrice: 5500,
  totalDurationMinutes: 45,
  technicianName: 'Daniela',
  technicianId: 'qa-tech',
  services: ['Gel manicure'],
});
const provenance = {
  mode: empty ? 'empty' : 'finalized',
  finalizedAppointmentCount: empty ? 0 : 2,
  legacyAppointmentCount: 0,
  unresolvedAppointmentCount: 0,
  finalizedAmountCents: empty ? 0 : 11000,
  legacyFallbackAmountCents: 0,
  isEstimated: false,
};
const period = (amount: number) => ({
  completedAppointmentRevenueCents: empty ? 0 : amount,
  cashCollectedCents: empty ? 0 : amount,
  appointmentPaymentsCollectedCents: empty ? 0 : amount,
  depositCollectedCents: 0,
  depositRefundedCents: 0,
  depositAppliedCents: 0,
  discountsCents: 0,
  taxCents: 0,
  tipsCents: 0,
  completedAppointmentCount: empty ? 0 : 2,
  provenance,
  dateRange: { start: time(-480), end: time(480), timezone: 'America/Toronto', isToDate: true },
});
window.fetch = async (input) => {
  const url = String(input);
  if (!url.startsWith('/api/admin/')) {
    throw new Error(`Unexpected fixture request: ${url}`);
  }
  if (error) {
    return new Response(JSON.stringify({ error: { message: 'Could not refresh the dashboard. Try again.' } }), { status: 503 });
  }
  const data = url.includes('/today?')
    ? {
        date,
        timeZone: 'America/Toronto',
        technicians: [{ id: 'qa-tech', name: 'Daniela' }],
        appointments: empty ? [] : [appointment('qa-current', 'Sofia Martin', -10, 'in_progress'), appointment('qa-next', 'Emma Chen', 70), appointment('qa-later', 'Olivia James', 150)],
        dueClients: [],
        failedConfirmations: [],
        googleEventsNeedingReview: 0,
        integrationHealth: { google: { status: 'connected', readiness: 'ready' }, calendarOutbox: { pending: 0, failed: 0 } },
        links: { publicUrl: '/qa-studio', bookingUrl: '/qa-studio/book', findBookingUrl: '/qa-studio/find-booking' },
      }
    : url.includes('/retention?')
      ? { retention: [], appointmentReminders: [], history: [] }
      : url.includes('/financial-summary?')
        ? {
            currency: 'CAD',
            timeZone: 'America/Toronto',
            asOf: now.toISOString(),
            currentPeriods: { today: period(11000), weekToDate: period(48500), monthToDate: period(189000) },
            balances: { completedOutstandingCents: 0, completed: provenance, settledByLegacyPaymentStatusCount: 0, asOf: now.toISOString() },
          }
        : null;
  if (!data) {
    throw new Error(`Unhandled fixture API: ${url}`);
  }
  return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
};

export function Review() {
  const [tab, setTab] = useState<OwnerWorkspaceTab>('today');
  const [action, setAction] = useState('');
  return (
    <div className="owner-workspace-theme min-h-screen">
      <OwnerWorkspaceHeader
        title={tab === 'more' ? 'More' : 'Today'}
        subtitle="Managing Isla Nail Studio · isolated review"
        actions={(
          <>
            <button type="button" className="owner-action size-11 !min-h-11 !p-0" aria-label="Switch salon" onClick={() => setAction('salons')}><Building2 size={19} /></button>
            <button type="button" className="owner-action size-11 !min-h-11 !p-0" aria-label="Activity" onClick={() => setAction('activity')}><Bell size={19} /></button>
          </>
        )}
      />
      {tab === 'today'
        ? (
            <OwnerTodayWorkspace
              salonSlug="qa-owner-polish"
              appointments={{ total: 3, completed: 0, noShows: 0, upcoming: 3 }}
              onQuickAction={setAction}
              onOpenBookings={() => setAction('bookings')}
              onOpenCalendar={() => setAction('calendar')}
              onOpenIntegrations={() => setAction('integrations')}
              onOpenAppointment={id => setAction(`appointment: ${id}`)}
              onOpenClient={id => setAction(`client: ${id}`)}
            />
          )
        : tab === 'more'
          ? (
              <AppGrid
                onAppTap={setAction}
                hiddenIds={['schedule', 'bookings', 'clients', 'services']}
                account={{ name: 'Daniela', salonName: 'Isla Nail Studio', onLogOut: () => setAction('logout') }}
              />
            )
          : <p className="p-5">This isolated fixture covers Today, More and shared dialog chrome.</p>}
      <OwnerWorkspaceNav active={tab} onSelect={setTab} />
      <AppModal isOpen={Boolean(action)} onClose={() => setAction('')}>
        <ModalHeader
          title={query.has('longTitle') ? 'Gel Manicure + Gel Pedicure' : 'Action selected'}
          leftAction={<BackButton label={query.has('longTitle') ? 'Services' : 'Back'} onClick={() => setAction('')} />}
          rightAction={query.has('longTitle') ? <button className="owner-action" type="button" onClick={() => setAction('')}>Save</button> : undefined}
        />
        <p className="p-5" role="status">{action}</p>
      </AppModal>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale="en" messages={en}><Review /></NextIntlClientProvider>);
