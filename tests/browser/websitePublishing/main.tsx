import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { BookingPageHub } from '@/components/admin/BookingPageHub';

const query = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(
  <BookingPageHub locale="en" salonName="Isla Nail Studio" salonSlug="synthetic-publishing-salon" published={query.has('published')} hasDraftChanges={query.has('changes')} setupUrl="/en/onboarding-v1?site=synthetic&revision=1" publicUrl="https://www.lustergel.app/en/synthetic-publishing-salon" canPublish={!query.has('collaborator')} />,
);
