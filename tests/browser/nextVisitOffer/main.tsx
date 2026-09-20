import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { NextVisitOfferSettings } from '@/components/admin/NextVisitOfferSettings';
import { NextVisitOfferRebook } from '@/components/appointments/NextVisitOfferRebook';

createRoot(document.getElementById('root')!).render(
  <main className="owner-workspace-theme mx-auto min-h-screen max-w-md p-3">
    <NextVisitOfferSettings salonSlug="fixture" />
    <NextVisitOfferRebook token="private-token" />
  </main>,
);
