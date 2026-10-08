import '@/styles/global.css';
import './review.css';

import { useRouter, useSearchParams } from 'next/navigation';
import { createRoot } from 'react-dom/client';

import { AppModal } from '@/components/admin/AppModal';
import { OwnerManagementModal } from '@/components/admin/OwnerManagementModal';
import { PaymentsModal } from '@/components/admin/PaymentsModal';
import { SettingsModal } from '@/components/admin/SettingsModal';
import { UsageBillingModal } from '@/components/admin/UsageBillingModal';

import { SalonProvider } from '../clientProfile/salon-provider';
import { installReviewApi } from './review-api';

installReviewApi();
export function OwnerSecondaryReview() {
  const router = useRouter();
  const query = useSearchParams();
  const app = query.get('app') ?? 'settings';
  const open = (next: string) => {
    const search = new URLSearchParams(query.toString());
    search.set('app', next);
    search.delete('view');
    router.push(`/?${search}`);
  };
  const close = () => open('settings');
  return (
    <SalonProvider>
      <main className="owner-workspace-theme owner-theme-scope min-h-screen bg-[var(--owner-ground)] text-[var(--owner-ink)]">
        <p className="p-2 text-center text-xs text-[var(--owner-muted)]">Isolated settings review · synthetic data</p>
        {app === 'usage'
          ? <UsageBillingModal salonSlug="isla-browser" onClose={close} />
          : (
              <AppModal isOpen onClose={close} topInset="tall">
                {app === 'payments'
                  ? <PaymentsModal salonSlug="isla-browser" salonId="salon_1" onClose={close} />
                  : app === 'booking-rules' || app === 'plan-usage'
                    ? <OwnerManagementModal app={app} salonSlug="isla-browser" salonId="salon_1" isFreeSolo={false} teamAvailable={false} onClose={close} onOpenApp={open} />
                    : <SettingsModal salonSlug="isla-browser" salonId="salon_1" userName="Review owner" onClose={close} onOpenApp={open} />}
              </AppModal>
            )}
      </main>
    </SalonProvider>
  );
}
createRoot(document.getElementById('root')!).render(<OwnerSecondaryReview />);
