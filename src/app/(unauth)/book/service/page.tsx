import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getPageAppearance } from '@/libs/pageAppearance';
import { getActiveLocationsBySalonId, getSalonBySlug, getServicesBySalonId } from '@/libs/queries';
import { checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';

import { BookServiceClient } from './BookServiceClient';

export const dynamic = 'force-dynamic';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Service Selection Page (Server Component)
 *
 * Fetches services from the database and passes them to the client component.
 * This is step 1 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookServicePage({
  searchParams,
}: {
  searchParams: { locationId?: string };
}) {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'book-service');

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

  // Get the booking flow for this salon
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);

  // Fetch active locations for multi-location support
  // LOCATION POLICY:
  // - Multi-location salons: must have 1+ active locations, invalid locationId → redirect to primary
  // - Single-address salons: activeLocations is empty, locationId stays null (valid)
  // - If multi-location salon has 0 active locations (admin misconfig), booking proceeds with null
  const activeLocations = await getActiveLocationsBySalonId(salon.id);
  const primaryLocation = activeLocations.find(l => l.isPrimary) || activeLocations[0];

  // Server-side locationId validation: if provided but invalid, redirect with primary
  // Uses shouldRepairBookingUrl() to prevent redirect loops
  if (searchParams.locationId && primaryLocation) {
    const isValidLocation = activeLocations.some(l => l.id === searchParams.locationId);
    if (!isValidLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
      // Invalid locationId - redirect with primary (preserves all other params)
      redirect(repairBookingUrl('/book/service', searchParams, primaryLocation.id));
    }
  }

  // Map locations to the shape expected by the client component
  const locations = activeLocations.map(loc => ({
    id: loc.id,
    name: loc.name,
    address: loc.address,
    city: loc.city,
    state: loc.state,
    zipCode: loc.zipCode,
    phone: loc.phone,
    isPrimary: loc.isPrimary ?? false,
  }));

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="book-service">
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookServiceClient services={services} bookingFlow={bookingFlow} locations={locations} />
      </Suspense>
    </PageThemeWrapper>
  );
}
