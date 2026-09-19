import '@/styles/global.css';

import { useRouter, useSearchParams } from 'next/navigation';
import { createRoot } from 'react-dom/client';

import { AppGrid } from '@/components/admin/AppGrid';
import { OwnerManagementModal } from '@/components/admin/OwnerManagementModal';
import { PaymentsModal } from '@/components/admin/PaymentsModal';
import { ServicesModal } from '@/components/admin/ServicesModal';
import { isOwnerManagementApp } from '@/libs/ownerNavigation';

export function OwnerNavigationFixture() {
  const router = useRouter();
  const query = useSearchParams();
  const app = query.get('app');
  const isFreeSolo = query.get('freeSolo') === '1';
  const openApp = (nextApp: string) => {
    const next = new URLSearchParams(query.toString());
    next.set('salon', 'isla');
    next.set('app', nextApp);
    next.delete('view');
    router.push(`/en/admin?${next.toString()}`, { scroll: false });
  };
  const close = () => {
    const next = new URLSearchParams(query.toString());
    next.delete('app');
    next.delete('view');
    router.push(`/en/admin?${next.toString()}`, { scroll: false });
  };

  if (app === 'workspace-tour') {
    return (
      <main data-testid="workspace-tour-screen">
        <button onClick={close} type="button">More</button>
        <h1>Workspace tour</h1>
      </main>
    );
  }
  if (app === 'luster') {
    return (
      <main data-testid="luster-screen">
        <button onClick={close} type="button">More</button>
        <h1>Luster resources</h1>
      </main>
    );
  }
  if (app === 'schedule') {
    return (
      <main data-testid="calendar-screen">
        <button onClick={close} type="button">More</button>
        <h1>Calendar</h1>
      </main>
    );
  }
  if (app === 'payments') {
    return <PaymentsModal onClose={close} salonSlug="isla" salonId="salon_isla" />;
  }
  if (app === 'services') {
    return (
      <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50">
        <ServicesModal onClose={close} salonSlug="isla" />
      </main>
    );
  }
  if (isOwnerManagementApp(app)) {
    return <OwnerManagementModal app={app} salonSlug="isla" salonId="salon_isla" isFreeSolo={isFreeSolo} teamAvailable={false} onClose={close} onOpenApp={openApp} />;
  }
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50" data-testid="more-screen">
      <h1 className="px-4 pt-4 text-xl font-semibold">More</h1>
      <AppGrid onAppTap={openApp} hiddenIds={['schedule', 'bookings', 'clients', 'services']} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<OwnerNavigationFixture />);
