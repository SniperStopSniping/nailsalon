import { Suspense } from 'react';

import { getSalonBySlug, getServicesByIds, getTechnicianById } from '@/libs/queries';

import { BookTimeClient } from './BookTimeClient';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Time Selection Page (Server Component)
 *
 * Fetches services and technician from the database and passes them to the client component.
 * This is step 3 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookTimePage({
  searchParams,
}: {
  searchParams: { serviceIds?: string; techId?: string };
}) {
  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const techId = searchParams.techId || '';

  // Fetch salon data
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    return <BookTimeClient services={[]} technician={null} />;
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
      <BookTimeClient services={services} technician={technician} />
    </Suspense>
  );
}
