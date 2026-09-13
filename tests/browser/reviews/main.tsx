import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { ReviewRequestSettings } from '@/components/admin/ReviewRequestSettings';
import { ReviewRequestSuppression } from '@/components/admin/ReviewRequestSuppression';
import { ReviewRequestAction } from '@/components/appointments/ReviewRequestAction';

function ReviewBrowserFixture() {
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50 p-3">
      <h1 className="mb-4 text-xl font-semibold">Review request test salon</h1>
      <ReviewRequestSettings salonSlug="review-fixture" />
      <section className="mt-6">
        <ReviewRequestAction appointmentId="review-appointment" salonSlug="review-fixture" timeZone="America/Toronto" appointmentStatus="completed" />
      </section>
      <section className="mt-6">
        <ReviewRequestSuppression salonSlug="review-fixture" clientId="review-client" />
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ReviewBrowserFixture />);
