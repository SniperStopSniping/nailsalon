import '@/styles/global.css';
import './review.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ClientsModal } from '@/components/admin/ClientsModal';
import { ScheduleCalendarModal } from '@/components/admin/ScheduleCalendarModal';
import { ServicesModal } from '@/components/admin/ServicesModal';

import { SalonProvider } from '../clientProfile/salon-provider';
import { installReviewApi } from './review-api';

installReviewApi();
export function CoreTabsReview() {
  const [closed, setClosed] = useState(false);
  const [destination, setDestination] = useState('');
  const screen = new URLSearchParams(window.location.search).get('screen') ?? 'calendar';
  const close = () => setClosed(true);
  return (
    <SalonProvider>
      <main className="owner-workspace-theme owner-theme-scope mx-auto min-h-screen max-w-2xl bg-[var(--owner-ground)]">
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
