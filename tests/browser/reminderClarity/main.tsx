import '@/styles/global.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { RebookingReminderSettings } from '@/components/admin/RebookingReminderSettings';

export function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-2xl">
      {open
        ? <RebookingReminderSettings salonSlug="isla-nail-studio" salonName="Isla Nail Studio" onClose={() => setOpen(false)} />
        : <h1>Marketing &amp; Messages</h1>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
