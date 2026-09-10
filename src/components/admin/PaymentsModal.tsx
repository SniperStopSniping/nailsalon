'use client';

import { BadgeDollarSign, CreditCard, Landmark, ReceiptText } from 'lucide-react';
import { useState } from 'react';

import { OwnerAppHub, type OwnerAppHubItem } from './OwnerAppHub';
import { SettingsModal } from './SettingsModal';

type PaymentsView = 'home' | 'deposits' | 'methods' | 'taxes' | 'stripe';

const PAYMENT_ITEMS: ReadonlyArray<OwnerAppHubItem<Exclude<PaymentsView, 'home'>>> = [
  { id: 'deposits', title: 'Deposits', description: 'Amount, requirement and collection readiness', icon: BadgeDollarSign },
  { id: 'methods', title: 'Payment Methods', description: 'Cards, e-Transfer and in-person payments', icon: CreditCard },
  { id: 'taxes', title: 'Taxes', description: 'Rates, tax-inclusive pricing and scheduled changes', icon: ReceiptText },
  { id: 'stripe', title: 'Stripe / Payouts', description: 'Connection status and payout readiness', icon: Landmark },
];

export function PaymentsModal({
  onClose,
  salonSlug,
  salonId,
  isFreeSolo,
  onOpenIntegrations,
}: {
  onClose: () => void;
  salonSlug: string | null;
  salonId?: string | null;
  isFreeSolo?: boolean;
  onOpenIntegrations?: () => void;
}) {
  const [view, setView] = useState<PaymentsView>('home');

  if (view === 'home') {
    return (
      <OwnerAppHub
        title="Payments"
        subtitle="How clients pay your salon"
        items={PAYMENT_ITEMS}
        onBack={onClose}
        onOpen={(next) => {
          if (next === 'stripe') {
            onOpenIntegrations?.();
            return;
          }
          setView(next);
        }}
      />
    );
  }

  return (
    <SettingsModal
      initialView="payments"
      leafOnly
      leafBackLabel="Payments"
      paymentFocus={view === 'stripe' ? undefined : view}
      onClose={() => setView('home')}
      salonId={salonId}
      salonSlug={salonSlug}
      isFreeSolo={isFreeSolo}
      onOpenApp={appId => appId === 'integrations' && onOpenIntegrations?.()}
    />
  );
}
