import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getPageAppearance } from '@/libs/pageAppearance';
import { getLocationById, getPrimaryLocation, getSalonBySlug, getServicesByIds, getTechnicianById } from '@/libs/queries';
import { checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';

import { BookConfirmClient } from './BookConfirmClient';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';
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
  searchParams: { serviceIds?: string; techId?: string; date?: string; time?: string; locationId?: string };
}) {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'book-confirm');

  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const techId = searchParams.techId || '';
  const dateStr = searchParams.date || '';
  const timeStr = searchParams.time || '';
  const locationId = searchParams.locationId || '';

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
  if (locationId && primaryLocation) {
    // Validate provided locationId exists, belongs to salon, and is active
    const validLocation = await getLocationById(locationId, salon.id);
    if (!validLocation && shouldRepairBookingUrl(locationId, primaryLocation.id)) {
      // Invalid locationId - redirect with primary (preserves all other params)
      redirect(repairBookingUrl('/book/confirm', searchParams, primaryLocation.id));
    }
  } else if (primaryLocation && shouldRepairBookingUrl(locationId, primaryLocation.id)) {
    // Missing locationId - inject primary (preserves all other params)
    redirect(repairBookingUrl('/book/confirm', searchParams, primaryLocation.id));
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

  // Fetch the selected location (already validated above, or use primary)
  // At this point locationId is guaranteed to be valid or we've redirected
  const location = locationId
    ? await getLocationById(locationId, salon.id)
    : primaryLocation;

  // Build location summary for client
  const locationSummary = location
    ? {
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        zipCode: location.zipCode,
      }
    : null;

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
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="book-confirm">
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookConfirmClient
          services={services}
          technician={technician}
          salonSlug={salon.slug}
          dateStr={dateStr}
          timeStr={timeStr}
          bookingFlow={bookingFlow}
          location={locationSummary}
        />
      </Suspense>
    </PageThemeWrapper>
  );
}
