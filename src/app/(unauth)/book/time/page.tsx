import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getPageAppearance } from '@/libs/pageAppearance';
import { getLocationById, getPrimaryLocation, getSalonBySlug, getServicesByIds, getTechnicianById } from '@/libs/queries';
import { checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';

import { BookTimeClient } from './BookTimeClient';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';
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
  searchParams: { serviceIds?: string; techId?: string; locationId?: string };
}) {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'book-datetime');

  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const techId = searchParams.techId || '';

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
      redirect(repairBookingUrl('/book/time', searchParams, primaryLocation.id));
    }
  } else if (primaryLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
    // Missing locationId - inject primary (preserves all other params)
    redirect(repairBookingUrl('/book/time', searchParams, primaryLocation.id));
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

  // Get the booking flow for this salon
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="book-datetime">
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookTimeClient services={services} technician={technician} bookingFlow={bookingFlow} />
      </Suspense>
    </PageThemeWrapper>
  );
}
