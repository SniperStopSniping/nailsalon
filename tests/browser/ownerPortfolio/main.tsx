import '@/styles/global.css';
import '../ownerForms/review.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppModal } from '@/components/admin/AppModal';
import { PortfolioModal } from '@/components/admin/PortfolioModal';

import { SalonProvider } from '../clientProfile/salon-provider';
import { installReviewApi } from './review-api';

installReviewApi();
export function PortfolioReview() {
  const [open, setOpen] = useState(true);
  return (
    <SalonProvider>
      <main className="owner-workspace-theme owner-theme-scope min-h-screen bg-[var(--owner-ground)] text-[var(--owner-ink)]">
        <p className="p-2 text-center text-xs text-[var(--owner-muted)]">Isolated Portfolio review · synthetic data</p>
        <button type="button" className="owner-action m-4" onClick={() => setOpen(true)}>Open Portfolio</button>
        <AppModal isOpen={open} onClose={() => setOpen(false)} topInset="tall">
          <PortfolioModal onClose={() => setOpen(false)} />
        </AppModal>
      </main>
    </SalonProvider>
  );
}
createRoot(document.getElementById('root')!).render(<PortfolioReview />);
