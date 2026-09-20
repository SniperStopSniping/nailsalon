import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { NextVisitOfferSettings } from '@/components/admin/NextVisitOfferSettings';
import { RebookingPromptSettings } from '@/components/admin/RebookingPromptSettings';
import { NextVisitOfferRebook } from '@/components/appointments/NextVisitOfferRebook';
import { RebookingPrompt } from '@/components/appointments/RebookingPrompt';

createRoot(document.getElementById('root')!).render(
  <main className="owner-workspace-theme mx-auto min-h-screen max-w-md p-3">
    {new URLSearchParams(window.location.search).has('rebooking-settings')
      ? <RebookingPromptSettings salonSlug="fixture" />
      : new URLSearchParams(window.location.search).has('rebooking')
        ? <RebookingPrompt token="private-token" />
        : (
            <>
              <NextVisitOfferSettings salonSlug="fixture" />
              <NextVisitOfferRebook token="private-token" />
            </>
          )}

  </main>,
);
