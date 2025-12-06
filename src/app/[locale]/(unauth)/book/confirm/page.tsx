import { Suspense } from 'react';

import { getSalonBySlug, getServicesByIds, getTechnicianById } from '@/libs/queries';

import { BookConfirmClient } from './BookConfirmClient';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Booking Confirmation Page (Server Component)
 *
 * Fetches services and technician data to display confirmation details.
 * The actual booking is created client-side via POST to /api/appointments.
 *
 * This is step 4 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookConfirmPage({
  searchParams,
}: {
  searchParams: { serviceIds?: string; techId?: string; date?: string; time?: string };
}) {
  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const techId = searchParams.techId || '';
  const dateStr = searchParams.date || '';
  const timeStr = searchParams.time || '';

  // Fetch salon data
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-t-transparent border-amber-500 rounded-full" /></div>}>
        <BookConfirmClient
          services={[]}
          technician={null}
          salonSlug={DEFAULT_SALON_SLUG}
          dateStr={dateStr}
          timeStr={timeStr}
        />
      </Suspense>
    );
  }

  // Fetch the selected services
  const dbServices = await getServicesByIds(serviceIdList, salon.id);

  // Fetch the selected technician (if not "any")
  let technician = null;
  if (techId && techId !== 'any') {
    const dbTech = await getTechnicianById(techId, salon.id);
    if (dbTech) {
      technician = {
        id: dbTech.id,
        name: dbTech.name,
        imageUrl: dbTech.avatarUrl || '/assets/images/tech-daniela.jpeg',
      };
    }
  }

  // Map DB services to the shape expected by the client component
  // Convert price from cents to dollars for display
  const services = dbServices.map(service => ({
    id: service.id,
    name: service.name,
    price: service.price / 100, // Convert cents to dollars
    duration: service.durationMinutes,
  }));

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-t-transparent border-amber-500 rounded-full" /></div>}>
      <BookConfirmClient
        services={services}
        technician={technician}
        salonSlug={salon.slug}
        dateStr={dateStr}
        timeStr={timeStr}
      />
    </Suspense>
  );
}
