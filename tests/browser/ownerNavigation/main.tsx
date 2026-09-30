import '@/styles/global.css';

import { useRouter, useSearchParams } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppGrid } from '@/components/admin/AppGrid';
import { AdminSalonSelector } from '@/components/admin/dashboard/AdminSalonSelector';
import { OwnerManagementModal } from '@/components/admin/OwnerManagementModal';
import { PaymentsModal } from '@/components/admin/PaymentsModal';
import { ServicesModal } from '@/components/admin/ServicesModal';
import { isOwnerManagementApp } from '@/libs/ownerNavigation';
import en from '@/locales/en.json';

export function OwnerNavigationFixture() {
  const router = useRouter();
  const query = useSearchParams();
  const app = query.get('app');
  const isFreeSolo = query.get('freeSolo') === '1';
  const [removedSalons, setRemovedSalons] = useState<string[]>([]);
  const chooserSalons = [
    { id: 'salon_old', slug: 'old', name: 'Old Studio', role: 'owner', status: 'cancelled' },
    { id: 'salon_live', slug: 'live', name: 'Current Studio', role: 'owner', status: 'active' },
  ];
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

  if (app === 'salon-chooser') {
    return (
      <AdminSalonSelector
        salons={chooserSalons.filter(salon => !removedSalons.includes(salon.id))}
        hiddenSalons={chooserSalons.filter(salon => removedSalons.includes(salon.id))}
        onSelect={() => {}}
        onVisibilityChange={async (salon, hidden) => {
          setRemovedSalons(current => hidden
            ? [...current, salon.id]
            : current.filter(id => id !== salon.id));
        }}
      />
    );
  }

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

createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en" messages={en}>
    <OwnerNavigationFixture />
  </NextIntlClientProvider>,
);
