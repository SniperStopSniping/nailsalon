import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { CustomerAssistantLauncher } from '@/components/customerAssistant/CustomerAssistantLauncher';

// Synthetic browser fixture. Component specs intercept responses; the guarded
// PostgreSQL journey bridges requests to real public server handlers.
export function CustomerAssistantBrowserFixture() {
  const backendJourney = new URLSearchParams(window.location.search).has('backend');
  return (
    <main className="mx-auto min-h-screen max-w-md bg-stone-50 p-4">
      <h1 className="mb-4 text-xl font-semibold text-neutral-950">{backendJourney ? 'Synthetic Booking Test Salon' : 'Isla Nail Studio'}</h1>
      <p className="mb-5 text-sm text-neutral-700">Book your next appointment.</p>
      <CustomerAssistantLauncher salonId={backendJourney ? 'synthetic-browser-isla-salon' : 'fixture-salon'} salonSlug="isla-nail-studio" locale="en" />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<CustomerAssistantBrowserFixture />);
