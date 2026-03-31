import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { type BookingStep, getNextStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { buildBookingUrl, parseSelectedAddOnsParam, repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getClientSession } from '@/libs/clientAuth';
import { resolvePublicBookingTechnicianContext } from '@/libs/publicBookingTechnicians';
import { getLocationById, getPrimaryLocation } from '@/libs/queries';
import { buildTenantRedirectPath, checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';
import { getPublicPageContext } from '@/libs/tenant';

import { BookTechClient } from './BookTechClient';

/**
 * Technician Selection Page (Server Component)
 *
 * Fetches technicians and selected services from the database.
 * This is step 2 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookTechPage({
  searchParams,
  params,
}: {
  searchParams: {
    serviceIds?: string;
    baseServiceId?: string;
    selectedAddOns?: string;
    techId?: string;
    locationId?: string;
    salonSlug?: string;
    originalAppointmentId?: string;
  };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('book-technician', searchParams, params);

  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const baseServiceId = searchParams.baseServiceId || null;
  const selectedAddOns = parseSelectedAddOnsParam(searchParams.selectedAddOns || null);

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

  if (!baseServiceId && serviceIdList.length === 0) {
    redirect(buildBookingUrl('/book/service', {
      salonSlug: searchParams.salonSlug ?? salon.slug,
      baseServiceId,
      selectedAddOns,
      locationId: searchParams.locationId ?? null,
      techId: null,
      originalAppointmentId: searchParams.originalAppointmentId ?? null,
    }, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  // Get the booking flow for this salon
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);

  // If tech step is not in the flow, redirect to the next step
  if (!bookingFlow.includes('tech')) {
    const nextStep = getNextStep('service', bookingFlow) ?? 'time';
    redirect(buildBookingUrl(`/book/${nextStep}`, {
      salonSlug: searchParams.salonSlug ?? salon.slug,
      serviceIds: serviceIdList.length > 0 ? serviceIdList : undefined,
      baseServiceId,
      selectedAddOns,
      locationId: searchParams.locationId ?? null,
      originalAppointmentId: searchParams.originalAppointmentId ?? null,
    }, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  // Deep-link repair: validate locationId and redirect if missing or invalid
  // Uses shouldRepairBookingUrl() to prevent redirect loops
  // getLocationById validates: exists + belongs to salonId + isActive (explicit filter)
  const primaryLocation = await getPrimaryLocation(salon.id);
  let resolvedLocationId = searchParams.locationId || primaryLocation?.id || null;

  // NOTE: If salon has no locations (primaryLocation is null), we don't redirect.
  // The booking flow will proceed with locationId=null (valid for single-address salons).
  if (searchParams.locationId && primaryLocation) {
    // Validate provided locationId exists, belongs to salon, and is active
    const validLocation = await getLocationById(searchParams.locationId, salon.id);
    if (!validLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
      // Invalid locationId - redirect with primary (preserves all other params)
      redirect(repairBookingUrl('/book/tech', searchParams, primaryLocation.id, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }
    resolvedLocationId = validLocation?.id ?? primaryLocation.id;
  } else if (primaryLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
    // Missing locationId - inject primary (preserves all other params)
    redirect(repairBookingUrl('/book/tech', searchParams, primaryLocation.id, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  const clientSession = await getClientSession();
  const resolvedTechnicianContext = await resolvePublicBookingTechnicianContext({
    salonId: salon.id,
    baseServiceId,
    selectedAddOns,
    serviceIds: serviceIdList,
    technicianId: searchParams.techId ?? null,
    locationId: resolvedLocationId,
    clientPhone: clientSession?.phone ?? null,
    originalAppointmentId: searchParams.originalAppointmentId ?? null,
    allowAutoSkip: true,
  });
  const resolvedLocation = resolvedLocationId
    ? await getLocationById(resolvedLocationId, salon.id)
    : null;

  if (resolvedTechnicianContext.shouldAutoSkipTech && resolvedTechnicianContext.soleCompatibleTechnician) {
    const nextStep = getNextStep('tech', bookingFlow) ?? 'time';
    redirect(buildBookingUrl(`/book/${nextStep}`, {
      salonSlug: searchParams.salonSlug ?? salon.slug,
      serviceIds: serviceIdList.length > 0 ? serviceIdList : undefined,
      baseServiceId,
      selectedAddOns,
      locationId: resolvedLocationId,
      techId: resolvedTechnicianContext.soleCompatibleTechnician.id,
      originalAppointmentId: searchParams.originalAppointmentId ?? null,
    }, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  const services = resolvedTechnicianContext.resolvedSelection.services.map(service => ({
    id: service.id,
    name: service.name,
    price: service.priceCents / 100,
    duration: service.durationMinutes,
  }));

  const compatibleTechnicianIds = new Set(resolvedTechnicianContext.compatibleTechnicianIds);

  // Map DB technicians to the shape expected by the client component
  const technicians = resolvedTechnicianContext.activeTechnicians
    .map((technician) => {
      const bookable = compatibleTechnicianIds.has(technician.id);
      return {
        id: technician.id,
        name: technician.name,
        imageUrl: technician.imageUrl,
        specialties: technician.specialties || [],
        rating: technician.rating,
        reviewCount: technician.reviewCount || 0,
        bookable,
        unavailableReason: bookable
          ? null
          : 'Not assigned to this service yet',
      };
    })
    .filter(technician => resolvedTechnicianContext.resolvedSelection.mode === 'base-service' || technician.bookable);

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="book-technician"
      salon={context.salon}
    >
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookTechClient
          services={services}
          addOns={resolvedTechnicianContext.resolvedSelection.addOns.map(addOn => ({
            id: addOn.id,
            name: addOn.name,
            quantity: addOn.quantity,
            price: addOn.lineTotalCents / 100,
            duration: addOn.lineDurationMinutes,
          }))}
          totalPrice={resolvedTechnicianContext.resolvedSelection.totalPriceCents / 100}
          totalDuration={resolvedTechnicianContext.resolvedSelection.visibleDurationMinutes}
          locationName={resolvedLocation?.name ?? primaryLocation?.name ?? null}
          technicians={technicians}
          bookingFlow={bookingFlow}
        />
      </Suspense>
    </PublicSalonPageShell>
  );
}
