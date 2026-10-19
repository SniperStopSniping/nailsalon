import '@/styles/global.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { DeleteSalonModal } from '@/components/super-admin/DeleteSalonModal';

export function DeletionReviewFixture() {
  const [open, setOpen] = useState(false);
  return (
    <main className="min-h-screen bg-stone-50 p-6 text-stone-900">
      <h1 className="text-xl font-semibold">Synthetic deletion review</h1>
      <p>No customer data, mail or provider calls. API responses are supplied by the browser test.</p>
      <button type="button" onClick={() => setOpen(true)}>Open deletion review</button>
      <DeleteSalonModal isOpen={open} onClose={() => setOpen(false)} onSuccess={() => {}} salonId="fake-salon" salonName="Disposable test salon" salonSlug="disposable-test-salon" isDeleted />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<DeletionReviewFixture />);
