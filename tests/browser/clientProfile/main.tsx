import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { ClientsModal } from '@/components/admin/ClientsModal';

import { SalonProvider } from './salon-provider';

export function ClientProfileBrowserFixture() {
  return (
    <SalonProvider>
      <main className="owner-workspace-theme min-h-screen bg-stone-50">
        <ClientsModal onClose={() => {}} />
      </main>
    </SalonProvider>
  );
}

createRoot(document.getElementById('root')!).render(<ClientProfileBrowserFixture />);
