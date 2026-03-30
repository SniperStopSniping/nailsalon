import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { parseSelectedAddOnsParam, repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getClientSession } from '@/libs/clientAuth';
import { buildDirectionsDestination, resolveDirectionsLocation } from '@/libs/directions';
import { resolvePublicBookingSelection } from '@/libs/publicBookingSelection';
import { getLocationById, getPrimaryLocation, getTechnicianById } from '@/libs/queries';
import { buildTenantRedirectPath, checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';
import { getPublicPageContext } from '@/libs/tenant';
import { normalizePublicAvatarUrl } from '@/libs/technicianAvatar';

import { BookConfirmClient } from './BookConfirmClient';

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
  params,
}: {
  searchParams: {
    serviceIds?: string;
    baseServiceId?: string;
    selectedAddOns?: string;
    techId?: string;
    date?: string;
    time?: string;
    locationId?: string;
    salonSlug?: string;
    originalAppointmentId?: string;
  };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('book-confirm', searchParams, params);

  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const baseServiceId = searchParams.baseServiceId || null;
  const selectedAddOns = parseSelectedAddOnsParam(searchParams.selectedAddOns || null);
  const techId = searchParams.techId || '';
  const dateStr = searchParams.date || '';
  const timeStr = searchParams.time || '';
  const locationId = searchParams.locationId || '';
  const originalAppointmentId = searchParams.originalAppointmentId || null;

  const { salon } = context;
  const tenantRoute = {
    salonSlug: salon.slug,
    routeSalonSlug: params?.slug,
    locale: params?.locale,
  };

  // Check salon status - redirect if suspended/cancelled
  const statusCheck = await checkSalonStatus(salon.id);
  const statusRedirectPath = buildTenantRedirectPath(statusCheck.redirectPath, tenantRoute);
  if (statusRedirectPath) {
    redirect(statusRedirectPath);
  }

  // Check if online booking is enabled
  const featureCheck = await checkFeatureEnabled(salon.id, 'onlineBooking');
  const featureRedirectPath = buildTenantRedirectPath(featureCheck.redirectPath, tenantRoute);
  if (featureRedirectPath) {
    redirect(featureRedirectPath);
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
      redirect(repairBookingUrl('/book/confirm', searchParams, primaryLocation.id, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }
  } else if (primaryLocation && shouldRepairBookingUrl(locationId, primaryLocation.id)) {
    // Missing locationId - inject primary (preserves all other params)
    redirect(repairBookingUrl('/book/confirm', searchParams, primaryLocation.id, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  const clientSession = await getClientSession();
  const resolvedSelection = await resolvePublicBookingSelection({
    salonId: salon.id,
    baseServiceId,
    selectedAddOns,
    serviceIds: serviceIdList,
    technicianId: techId && techId !== 'any' ? techId : null,
    clientPhone: clientSession?.phone ?? null,
    originalAppointmentId,
  });

  // Fetch the selected technician (if not "any")
  let technician = null;
  if (techId && techId !== 'any') {
    const dbTech = await getTechnicianById(techId, salon.id);
    if (dbTech) {
      technician = {
        id: dbTech.id,
        name: dbTech.name,
        imageUrl: normalizePublicAvatarUrl(dbTech.avatarUrl),
      };
    }
  }

  // Fetch the selected location (already validated above, or use primary)
  // At this point locationId is guaranteed to be valid or we've redirected
  const requestedLocation = locationId
    ? await getLocationById(locationId, salon.id)
    : primaryLocation;
  const resolvedLocation = resolveDirectionsLocation(requestedLocation, primaryLocation);
  const salonDirectionsFallback = buildDirectionsDestination({
    address: salon.address,
    city: salon.city,
    state: salon.state,
    zipCode: salon.zipCode,
  })
    ? {
        id: locationId || `salon_${salon.id}`,
        name: salon.name,
        address: salon.address,
        city: salon.city,
        state: salon.state,
        zipCode: salon.zipCode,
      }
    : null;

  // Build location summary for client
  const locationSummary = resolvedLocation
    ? {
        id: resolvedLocation.id,
        name: resolvedLocation.name,
        address: resolvedLocation.address,
        city: resolvedLocation.city,
        state: resolvedLocation.state,
        zipCode: resolvedLocation.zipCode,
      }
    : salonDirectionsFallback;

  const services = resolvedSelection.services.map(service => ({
    id: service.id,
    name: service.name,
    price: service.priceCents / 100,
    duration: service.durationMinutes,
  }));

  // Get the booking flow for this salon
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="book-confirm"
      salon={context.salon}
    >
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookConfirmClient
          services={services}
          addOns={resolvedSelection.addOns.map(addOn => ({
            id: addOn.id,
            name: addOn.name,
            quantity: addOn.quantity,
            price: addOn.lineTotalCents / 100,
            duration: addOn.lineDurationMinutes,
          }))}
          baseServiceId={resolvedSelection.baseServiceId}
          selectedAddOns={resolvedSelection.selectedAddOns}
          subtotalBeforeDiscount={resolvedSelection.subtotalBeforeDiscountCents / 100}
          discountAmount={resolvedSelection.discountAmountCents / 100}
          firstVisitDiscountPreview={resolvedSelection.firstVisitDiscountPreview}
          totalPrice={resolvedSelection.totalPriceCents / 100}
          totalDuration={resolvedSelection.visibleDurationMinutes}
          technician={technician}
          salonSlug={salon.slug}
          dateStr={dateStr}
          timeStr={timeStr}
          bookingFlow={bookingFlow}
          location={locationSummary}
        />
      </Suspense>
    </PublicSalonPageShell>
  );
}
