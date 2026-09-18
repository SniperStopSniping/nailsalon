import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { CustomerAssistantLauncher } from '@/components/customerAssistant/CustomerAssistantLauncher';

// Component-browser fixture. The spec intercepts every assistant request with
// synthetic catalogue data; it is not an end-to-end booking journey.
export function CustomerAssistantBrowserFixture() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-stone-50 p-4">
      <h1 className="mb-4 text-xl font-semibold text-neutral-950">Isla Nail Studio</h1>
      <p className="mb-5 text-sm text-neutral-700">Book your next appointment.</p>
      <CustomerAssistantLauncher salonSlug="isla-nail-studio" locale="en" />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<CustomerAssistantBrowserFixture />);
