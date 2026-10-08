import '@/styles/global.css';
import './review.css';

import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppGrid } from '@/components/admin/AppGrid';
import { OwnerWorkspaceHeader } from '@/components/admin/OwnerWorkspaceHeader';
import { SmsBalanceCard } from '@/components/admin/SmsBalanceCard';
import { SmsCreditsModal } from '@/components/admin/SmsCreditsModal';
import { SMS_CREDITS_CHANGED_EVENT, smsCreditStatus } from '@/libs/smsCreditStatus';

const query = new URLSearchParams(window.location.search);
let remaining = Number(query.get('credits') ?? 18);
let totalPurchased = 500;
let paid = false;
let failed = query.get('state') === 'error';
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith('/api/')) {
    return realFetch(input, init);
  }
  if (url.includes('/checkout/')) {
    const key = JSON.parse(String(init?.body)).topupOfferKey;
    return new Response(JSON.stringify({ data: { url: `/?checkout=${key}` } }));
  }
  if (failed) {
    return new Response('', { status: 503 });
  }
  return new Response(JSON.stringify({ data: {
    salonId: 'salon_synthetic',
    canPurchase: true,
    creditPurchasesAvailable: true,
    balance: { availableCredits: remaining, allocationCredits: remaining <= 100 && !paid ? 100 : null, pendingCredits: 0, status: smsCreditStatus(remaining), totalPurchased, usedThisMonth: 82, timeZone: 'America/Toronto', lastPurchaseOfferKey: 'topup_500_2026_10' },
    topupOffers: [{ key: 'topup_100_2026_10', credits: 100, priceCents: 2000 }, { key: 'topup_200_2026_10', credits: 200, priceCents: 3000 }, { key: 'topup_500_2026_10', credits: 500, priceCents: 5000 }].map(offer => ({ ...offer, currency: 'cad', available: true })),
    activity: { items: [{ id: 'send', type: 'debit', bucket: 'purchased', credits: -2, eventType: 'appointment_reminder', createdAt: '2026-10-08T14:00:00Z' }, { id: 'follow', type: 'debit', bucket: 'purchased', credits: -1, eventType: 'rebooking_reminder', createdAt: '2026-10-08T12:00:00Z' }, { id: 'purchase', type: 'grant', bucket: 'purchased', credits: 500, eventType: null, createdAt: '2026-10-07T14:00:00Z' }], nextCursor: null },
  } }));
};
export function Fixture() {
  const [view, setView] = useState<'topup' | 'history' | null>(query.get('view') as 'topup' | 'history' | null);
  const [completed, setCompleted] = useState(false);
  const checkout = query.get('checkout');
  return (
    <NextIntlClientProvider locale="en" messages={{ NoShowRecords: { tile_name: 'No-show records', tile_description: 'Review and correct mistaken no-shows' } }}>
      <main className="owner-workspace-theme owner-theme-scope mx-auto min-h-screen max-w-2xl bg-[var(--owner-ground)]">
        <p className="px-4 py-2 text-center text-[10px] text-[var(--owner-muted)]">Isolated component review · synthetic data · no real payment</p>
        {checkout && !completed
          ? (
              <div className="p-5">
                <h1 className="owner-title text-3xl">Isolated checkout fixture</h1>
                <p className="my-4">This only simulates the confirmed-payment balance refresh for browser testing.</p>
                <button
                  type="button"
                  className="owner-action owner-action--primary"
                  onClick={() => {
                    remaining = 518;
                    totalPurchased = 1000;
                    paid = true;
                    setCompleted(true);
                    window.dispatchEvent(new Event(SMS_CREDITS_CHANGED_EVENT));
                  }}
                >
                  Simulate verified payment
                </button>
              </div>
            )
          : (
              <>
                <OwnerWorkspaceHeader title="More" subtitle="Managing Isla Nail Studio" actions={<button type="button" className="owner-action size-11 !p-0" aria-label="Profile">D</button>} />
                {completed && <p role="status" className="px-5 text-sm">Fixture purchase confirmed. 500 credits added.</p>}
                {query.get('screen') === 'today'
                  ? (
                      <div className="p-5">
                        <SmsBalanceCard compact salonSlug="synthetic" onBuy={() => setView('topup')} />
                        <h2 className="owner-title mt-6 text-3xl">Your day, beautifully managed.</h2>
                      </div>
                    )
                  : <AppGrid salonSlug="synthetic" onOpenCredits={setView} onAppTap={() => {}} hiddenIds={['schedule', 'bookings', 'clients', 'services']} />}
                {view && <SmsCreditsModal initialView={view} salonSlug="synthetic" onClose={() => setView(null)} />}
              </>
            )}
        {failed && (
          <button
            type="button"
            className="owner-action m-5"
            onClick={() => {
              failed = false;
              window.dispatchEvent(new Event(SMS_CREDITS_CHANGED_EVENT));
            }}
          >
            Restore fixture connection
          </button>
        )}
      </main>
    </NextIntlClientProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
