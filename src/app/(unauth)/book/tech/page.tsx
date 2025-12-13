import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { type BookingStep, getNextStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getPageAppearance } from '@/libs/pageAppearance';
import { getLocationById, getPrimaryLocation, getSalonBySlug, getServicesByIds, getTechniciansBySalonId } from '@/libs/queries';
import { checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';

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
  searchParams: { serviceIds?: string; locationId?: string };
}) {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'book-technician');

  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];

  // Fetch salon data
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    redirect('/not-found');
  }

  // Check salon status - redirect if suspended/cancelled
  const statusCheck = await checkSalonStatus(salon.id);
  if (statusCheck.redirectPath) {
    redirect(statusCheck.redirectPath);
  }

  // Check if online booking is enabled
  const featureCheck = await checkFeatureEnabled(salon.id, 'onlineBooking');
  if (featureCheck.redirectPath) {
    redirect(featureCheck.redirectPath);
  }

  // Get the booking flow for this salon
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);

  // If tech step is not in the flow, redirect to the next step
  if (!bookingFlow.includes('tech')) {
    const nextStep = getNextStep('service', bookingFlow) ?? 'time';
    const params = new URLSearchParams();
    if (searchParams.serviceIds) {
      params.set('serviceIds', searchParams.serviceIds);
    }
    if (searchParams.locationId) {
      params.set('locationId', searchParams.locationId);
    }
    redirect(`/book/${nextStep}?${params.toString()}`);
  }

  // Deep-link repair: validate locationId and redirect if missing or invalid
  // Uses shouldRepairBookingUrl() to prevent redirect loops
  // getLocationById validates: exists + belongs to salonId + isActive (explicit filter)
  const primaryLocation = await getPrimaryLocation(salon.id);

  // NOTE: If salon has no locations (primaryLocation is null), we don't redirect.
  // The booking flow will proceed with locationId=null (valid for single-address salons).
  if (searchParams.locationId && primaryLocation) {
    // Validate provided locationId exists, belongs to salon, and is active
    const validLocation = await getLocationById(searchParams.locationId, salon.id);
    if (!validLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
      // Invalid locationId - redirect with primary (preserves all other params)
      redirect(repairBookingUrl('/book/tech', searchParams, primaryLocation.id));
    }
  } else if (primaryLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
    // Missing locationId - inject primary (preserves all other params)
    redirect(repairBookingUrl('/book/tech', searchParams, primaryLocation.id));
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
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookTechClient services={services} technicians={technicians} bookingFlow={bookingFlow} />
      </Suspense>
    </PageThemeWrapper>
  );
}
