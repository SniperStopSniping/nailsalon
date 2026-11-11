import '@/styles/global.css';
import './review.css';

import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ClientsModal } from '@/components/admin/ClientsModal';
import { ScheduleCalendarModal } from '@/components/admin/ScheduleCalendarModal';
import { ServicesModal } from '@/components/admin/ServicesModal';
import { DialogShell } from '@/components/ui/dialog-shell';

import { SalonProvider } from '../clientProfile/salon-provider';
import { installReviewApi } from './review-api';

const AdminModalHost = lazy(() => import('@/components/admin/AdminModalHost').then(module => ({ default: module.AdminModalHost })));
const sheetNames = { calendar: 'Calendar', clients: 'Clients', services: 'Services', marketing: 'Marketing', settings: 'Settings', team: 'Team', payments: 'Payments' };

function ViewportDialogReview() {
  const [nested, setNested] = useState(false);
  return (
    <DialogShell isOpen onClose={() => {}} maxWidthClassName="max-w-md" alignClassName="items-end justify-center p-0" contentClassName="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div role="dialog" aria-label="Shared form" className="flex min-h-0 flex-1 flex-col">
        <h1 className="shrink-0 p-4">Shared form</h1>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="shared-form-scroll">
          <label>
            Message
            <textarea className="block w-full border" />
          </label>
          <div className="h-[900px]">Long form content</div>
          <button type="button" onClick={() => setNested(true)}>Open confirmation</button>
        </div>
        <button type="button" className="min-h-11 shrink-0">Save form</button>
      </div>
      <DialogShell isOpen={nested} onClose={() => setNested(false)}>
        <div role="dialog" aria-label="Confirmation">
          <button type="button" onClick={() => setNested(false)}>Close confirmation</button>
        </div>
      </DialogShell>
    </DialogShell>
  );
}

installReviewApi();
export function CoreTabsReview() {
  const screen = new URLSearchParams(window.location.search).get('screen') ?? 'calendar';
  const inSheet = new URLSearchParams(window.location.search).get('surface') === 'sheet';
  const [closed, setClosed] = useState(inSheet && (screen === 'clients' || new URLSearchParams(window.location.search).has('closed')));
  const [destination, setDestination] = useState('');
  const close = () => setClosed(true);
  if (screen === 'viewport-dialog') {
    return <ViewportDialogReview />;
  }
  if (inSheet && Object.hasOwn(sheetNames, screen)) {
    const sheetScreen = screen as keyof typeof sheetNames;
    return (
      <SalonProvider>
        <button type="button" onClick={() => setClosed(false)}>
          { `Open ${sheetNames[sheetScreen]}` }
        </button>
        <Suspense fallback={null}>
          <AdminModalHost
            activeModal={closed || sheetScreen === 'calendar' ? null : sheetScreen}
            activeSalonSlug="isla-browser"
            isFreeSolo
            onCloseModal={close}
            showNotifications={false}
            setShowNotifications={() => {}}
            showFraudSignals={false}
            setShowFraudSignals={() => {}}
            showScheduleCalendar={!closed && screen === 'calendar'}
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
