import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import BookingPageOwnerSurface from '@/app/[locale]/admin/booking-page/page';

createRoot(document.getElementById('root')!).render(<BookingPageOwnerSurface />);
