import { Suspense } from 'react';

import { getSalonBySlug, getServicesByIds, getTechniciansBySalonId } from '@/libs/queries';

import { BookTechClient } from './BookTechClient';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Technician Selection Page (Server Component)
 *
 * Fetches technicians and services from the database and passes them to the client component.
 * This is step 2 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookTechPage({
  searchParams,
}: {
  searchParams: { serviceIds?: string };
}) {
  // Parse service IDs from URL
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];

  // Fetch salon data
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-t-transparent border-amber-500 rounded-full" /></div>}>
        <BookTechClient technicians={[]} services={[]} />
      </Suspense>
    );
  }

  // Fetch technicians for this salon
  const dbTechnicians = await getTechniciansBySalonId(salon.id);

  // Fetch the selected services to show in summary
  const dbServices = await getServicesByIds(serviceIdList, salon.id);

  // Map DB technicians to the shape expected by the client component
  const technicians = dbTechnicians.map(tech => ({
    id: tech.id,
    name: tech.name,
    imageUrl: tech.avatarUrl || '/assets/images/tech-daniela.jpeg', // Fallback
    specialties: (tech.specialties as string[]) || [],
    rating: tech.rating ? Number.parseFloat(tech.rating) : 4.5,
    reviewCount: tech.reviewCount || 0,
  }));

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
      <BookTechClient technicians={technicians} services={services} />
    </Suspense>
  );
}
