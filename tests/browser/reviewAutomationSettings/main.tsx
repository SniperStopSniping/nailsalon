import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { ReviewRequestSettings } from '@/components/admin/ReviewRequestSettings';

createRoot(document.getElementById('root')!).render(
  <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50 p-3">
    <h1 className="mb-4 text-xl font-semibold">Review automation settings</h1>
    <ReviewRequestSettings salonSlug="review-fixture" />
  </main>,
);
