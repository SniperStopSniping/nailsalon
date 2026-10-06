import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import BookingPageOwnerSurface from '@/app/[locale]/admin/booking-page/page';
import { BookingPageHub } from '@/components/admin/BookingPageHub';

import { useSearchParams } from './navigation';

function Fixture() {
  const query = useSearchParams();
  return window.location.pathname.endsWith('/website')
    ? <BookingPageHub locale="en" salonName="Isla Nail Studio (test fixture)" salonSlug={query.get('salon') || 'isla'} published hasDraftChanges={false} setupUrl={null} />
    : <BookingPageOwnerSurface />;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
