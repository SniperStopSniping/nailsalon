import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { MarketingModal } from '@/components/admin/MarketingModal';
import { SalonProvider } from '@/providers/SalonProvider';

export function MarketingBrowserFixture() {
  return (
    <SalonProvider salonId="salon_marketing" salonName="Isla Nail Studio" salonSlug="isla" status="active">
      <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50">
        <MarketingModal onClose={() => {}} onOpenApp={() => {}} salonName="Isla Nail Studio" />
      </main>
    </SalonProvider>
  );
}

createRoot(document.getElementById('root')!).render(<MarketingBrowserFixture />);
