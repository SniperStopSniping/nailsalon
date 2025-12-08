import { Suspense } from 'react';

import { getPageAppearance } from '@/libs/pageAppearance';
import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getSalonBySlug, getServicesByIds, getTechniciansBySalonId } from '@/libs/queries';

import { BookTechClient } from './BookTechClient';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Technician Selection Page (Server Component)
 *
 * Fetches technicians and selected services from the database.
 * This is step 2 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookTechPage({
  searchParams,
}: {
  searchParams: { serviceIds?: string };
}) {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'book-technician');

  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];

  // Fetch salon data
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    return (
      <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="book-technician">
        <BookTechClient services={[]} technicians={[]} />
      </PageThemeWrapper>
    );
  }

  // Fetch selected services
  const dbServices = await getServicesByIds(serviceIdList, salon.id);

  // Fetch technicians for this salon
  const dbTechnicians = await getTechniciansBySalonId(salon.id);

  // Map DB services to the shape expected by the client component
  const services = dbServices.map(service => ({
    id: service.id,
    name: service.name,
    price: service.price / 100, // Convert cents to dollars
    duration: service.durationMinutes,
  }));

  // Map DB technicians to the shape expected by the client component
  const technicians = dbTechnicians.map(tech => ({
    id: tech.id,
    name: tech.name,
    imageUrl: tech.avatarUrl || '/assets/images/tech-daniela.jpeg',
    specialties: tech.specialties || [],
    rating: Number(tech.rating) || 5.0,
    reviewCount: tech.reviewCount || 0,
  }));

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="book-technician">
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-t-transparent border-amber-500" /></div>}>
        <BookTechClient services={services} technicians={technicians} />
      </Suspense>
    </PageThemeWrapper>
  );
}
