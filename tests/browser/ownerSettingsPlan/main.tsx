import '@/styles/global.css';

import { useRouter, useSearchParams } from 'next/navigation';
import { createRoot } from 'react-dom/client';

import { OwnerManagementModal } from '@/components/admin/OwnerManagementModal';
import { SettingsModal } from '@/components/admin/SettingsModal';

function Fixture() {
  const router = useRouter();
  const search = useSearchParams();
  const app = search.get('app');
  const openApp = (next: string) => {
    const query = new URLSearchParams(search.toString());
    query.set('salon', 'salon-a');
    query.set('app', next);
    query.delete('view');
    router.push(`/en/admin?${query.toString()}`);
  };
  const close = () => router.push('/en/admin?salon=salon-a');
  if (app === 'plan-usage') {
    return <OwnerManagementModal app="plan-usage" salonSlug="salon-a" salonId="salon_1" isFreeSolo={false} teamAvailable={false} onClose={close} onOpenApp={openApp} />;
  }
  return <SettingsModal salonSlug="salon-a" salonId="salon_1" userName="Daniela" onClose={close} onOpenApp={openApp} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
