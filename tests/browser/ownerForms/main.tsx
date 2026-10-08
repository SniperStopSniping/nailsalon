import '@/styles/global.css';
import './review.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppModal } from '@/components/admin/AppModal';
import { CalendarBlockTime } from '@/components/admin/CalendarBlockTime';
import { AddClientDialog } from '@/components/admin/clients/AddClientDialog';
import { ServicesModal } from '@/components/admin/ServicesModal';

import { SalonProvider } from '../clientProfile/salon-provider';
import { installReviewApi } from './review-api';

installReviewApi();
export function OwnerFormsReview() {
  const [clientOpen, setClientOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const [notice, setNotice] = useState('');
  const screen = new URLSearchParams(window.location.search).get('screen') ?? 'services';
  return (
    <SalonProvider>
      <main className="owner-workspace-theme owner-theme-scope min-h-screen bg-[var(--owner-ground)] text-[var(--owner-ink)]">
        <p className="px-4 py-2 text-center text-xs text-[var(--owner-muted)]">Isolated form review · synthetic data</p>
        {closed
          ? <p role="status">Back to Calendar</p>
          : screen === 'services'
            ? <AppModal isOpen onClose={() => setClosed(true)} topInset="tall"><ServicesModal onClose={() => setClosed(true)} salonSlug="isla-browser" /></AppModal>
            : screen === 'client'
              ? (
                  <>
                    <button className="owner-action owner-action--primary m-4" type="button" onClick={() => setClientOpen(true)}>Add client</button>
                    <AddClientDialog
                      isOpen={clientOpen}
                      salonSlug="isla-browser"
                      onClose={() => setClientOpen(false)}
                      onSuccess={(result) => {
                        setNotice(result.message);
                        setClientOpen(false);
                      }}
                    />
                  </>
                )
              : <CalendarBlockTime salonSlug="isla-browser" date="2026-10-07" technicians={[{ id: 'tech_1', name: 'Daniela' }, { id: 'tech_2', name: 'Emma' }]} onClose={() => setClosed(true)} />}
        {notice && <p role="status">{notice}</p>}
      </main>
    </SalonProvider>
  );
}
createRoot(document.getElementById('root')!).render(<OwnerFormsReview />);
