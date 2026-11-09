import '@/styles/global.css';
import './review.css';

import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppModal } from '@/components/admin/AppModal';
import { ClientsModal } from '@/components/admin/ClientsModal';
import { ScheduleCalendarModal } from '@/components/admin/ScheduleCalendarModal';
import { ServicesModal } from '@/components/admin/ServicesModal';

import { SalonProvider } from '../clientProfile/salon-provider';
import { installReviewApi } from './review-api';

const AdminModalHost = lazy(() => import('@/components/admin/AdminModalHost').then(module => ({ default: module.AdminModalHost })));

installReviewApi();
export function CoreTabsReview() {
  const screen = new URLSearchParams(window.location.search).get('screen') ?? 'calendar';
  const inSheet = new URLSearchParams(window.location.search).get('surface') === 'sheet';
  const [closed, setClosed] = useState(inSheet && screen === 'clients');
  const [destination, setDestination] = useState('');
  const close = () => setClosed(true);
  if (inSheet && screen === 'clients') {
    return (
      <SalonProvider>
        <button type="button" onClick={() => setClosed(false)}>Open Clients</button>
        <Suspense fallback={null}>
          <AdminModalHost
            activeModal={closed ? null : 'clients'}
            activeSalonSlug="isla-browser"
            isFreeSolo
            onCloseModal={close}
            showNotifications={false}
            setShowNotifications={() => {}}
            showFraudSignals={false}
            setShowFraudSignals={() => {}}
            showScheduleCalendar={false}
            setShowScheduleCalendar={() => {}}
            showWalkIn={false}
            setShowWalkIn={() => {}}
            userName="Browser fixture"
            userInitial="B"
            analyticsProps={{}}
            fraudSignals={[]}
            fraudSignalsTotalCount={0}
            fraudSignalsLoading={false}
            fraudSignalsError={null}
            fetchFraudSignals={() => {}}
            onFraudSignalResolved={() => {}}
          />
        </Suspense>
      </SalonProvider>
    );
  }
  return (
    <SalonProvider>
      <main className={`owner-workspace-theme owner-theme-scope mx-auto min-h-screen bg-[var(--owner-ground)] ${screen === 'calendar' ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <p className="px-4 py-2 text-center text-xs text-[var(--owner-muted)]">Isolated component review · synthetic data</p>
        {closed
          ? (
              <p role="status">
                Closed
                {screen}
              </p>
            )
          : inSheet
            ? <AppModal isOpen onClose={close} topInset="tall"><ServicesModal onClose={close} salonSlug="isla-browser" /></AppModal>
            : screen === 'clients' ? <ClientsModal onClose={close} /> : screen === 'services' ? <ServicesModal onClose={close} salonSlug="isla-browser" /> : <ScheduleCalendarModal onClose={close} salonSlug="isla-browser" onNavigate={(app, view) => setDestination(`${app}/${view}`)} />}
        {destination && (
          <p role="status">
            Navigate to
            {destination}
          </p>
        )}
      </main>
    </SalonProvider>
  );
}
createRoot(document.getElementById('root')!).render(<CoreTabsReview />);
