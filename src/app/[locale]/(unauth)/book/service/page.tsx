import { Suspense } from 'react';

import { getSalonBySlug, getServicesBySalonId } from '@/libs/queries';

import { BookServiceClient } from './BookServiceClient';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Service Selection Page (Server Component)
 *
 * Fetches services from the database and passes them to the client component.
 * This is step 1 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookServicePage() {
  // Fetch salon data
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    // Fallback to empty services if salon not found (shouldn't happen in production)
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <BookServiceClient services={[]} />
      </Suspense>
    );
  }

  // Fetch services for this salon
  const dbServices = await getServicesBySalonId(salon.id);

  // Map DB services to the shape expected by the client component
  // Convert price from cents to dollars for display
  const services = dbServices.map(service => ({
    id: service.id,
    name: service.name,
    description: service.description,
    duration: service.durationMinutes,
    price: service.price / 100, // Convert cents to dollars
    category: service.category as 'hands' | 'feet' | 'combo',
    imageUrl: service.imageUrl || '/assets/images/biab-short.webp', // Fallback image
  }));

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BookServiceClient services={services} />
    </Suspense>
  );
}
