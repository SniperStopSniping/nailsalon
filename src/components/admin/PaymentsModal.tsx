'use client';

import { BadgeDollarSign, Coins, CreditCard, Landmark, ReceiptText } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { OwnerAppHub, type OwnerAppHubItem } from './OwnerAppHub';
import { SettingsModal } from './SettingsModal';
import { StripeConnectPanel } from './StripeConnectPanel';

type PaymentsView = 'home' | 'deposits' | 'methods' | 'taxes' | 'stripe' | 'currency';

function normalizeView(value: string | null | undefined): PaymentsView {
  return ['deposits', 'methods', 'taxes', 'stripe', 'currency'].includes(value ?? '') ? value as PaymentsView : 'home';
}

const PAYMENT_ITEMS: ReadonlyArray<OwnerAppHubItem<Exclude<PaymentsView, 'home'>>> = [
  { id: 'deposits', title: 'Deposits', description: 'Amount, requirement and collection readiness', icon: BadgeDollarSign },
  { id: 'methods', title: 'Payment Methods', description: 'Cards, e-Transfer and in-person payments', icon: CreditCard },
  { id: 'taxes', title: 'Taxes', description: 'Rates, tax-inclusive pricing and scheduled changes', icon: ReceiptText },
  { id: 'currency', title: 'Currency', description: 'Currency for service prices and client payments', icon: Coins },
  { id: 'stripe', title: 'Stripe / Payouts', description: 'Connection status and payout readiness', icon: Landmark },
];

export function PaymentsModal({
  onClose,
  salonSlug,
  salonId,
  isFreeSolo,
}: {
  onClose: () => void;
  salonSlug: string | null;
  salonId?: string | null;
  isFreeSolo?: boolean;
}) {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const requestedView = normalizeView(search?.get('view'));
  const [view, setView] = useState<PaymentsView>(requestedView);
  const pushed = useRef(false);
  useEffect(() => setView(requestedView), [requestedView]);
  const href = (next: PaymentsView) => {
    const query = new URLSearchParams(search?.toString());
    query.set('app', 'payments');
    if (salonSlug) {
      query.set('salon', salonSlug);
    }
    query.delete('view');
    if (next !== 'home') {
      query.set('view', next);
    }
    return `/${typeof params?.locale === 'string' ? params.locale : 'en'}/admin?${query}`;
  };

  if (view === 'home') {
    return (
      <OwnerAppHub
        title="Payments"
        subtitle="How clients pay your salon"
        items={PAYMENT_ITEMS}
        onBack={onClose}
        onOpen={(next) => {
          setView(next);
          pushed.current = true;
          router.push(href(next), { scroll: false });
        }}
      />
    );
  }

  if (view === 'stripe') {
    return (
      <div className="flex min-h-full flex-col bg-[var(--owner-ground)]">
        <div className="sticky top-0 z-20 bg-[var(--owner-ground)]">
          <button
            type="button"
            onClick={() => {
              setView('home');
              if (pushed.current) {
                pushed.current = false;
                router.back();
              } else {
                router.replace(href('home'), { scroll: false });
              }
            }}
            className="min-h-11 px-4 text-sm font-semibold"
          >
            Back to Payments
          </button>
        </div>
        <main className="grow px-4 pb-10">
          <h2 className="mb-1 text-xl font-bold">Stripe & Payouts</h2>
          <p className="mb-4 text-sm text-[var(--owner-muted)]">Deposit collection and payout readiness.</p>
          <StripeConnectPanel salonSlug={salonSlug} />
        </main>
      </div>
    );
  }

  return (
    <SettingsModal
      key={`${salonSlug}:${view}`}
      initialView={view === 'currency' ? 'currency' : 'payments'}
      leafOnly
      leafBackLabel="Payments"
      paymentFocus={view === 'currency' ? undefined : view}
      onClose={() => {
        setView('home');
        if (pushed.current) {
          pushed.current = false;
          router.back();
        } else {
          router.replace(href('home'), { scroll: false });
        }
      }}
      salonId={salonId}
      salonSlug={salonSlug}
      isFreeSolo={isFreeSolo}
    />
  );
}
