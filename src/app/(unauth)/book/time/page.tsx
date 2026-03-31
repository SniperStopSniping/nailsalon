import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { buildBookingUrl, parseSelectedAddOnsParam, repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getClientSession } from '@/libs/clientAuth';
import {
  resolvePublicBookingTechnicianContext,
  type ResolvedPublicBookingTechnicianContext,
} from '@/libs/publicBookingTechnicians';
import { getLocationById, getPrimaryLocation } from '@/libs/queries';
import { buildTenantRedirectPath, checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';
import { getPublicPageContext } from '@/libs/tenant';

import { BookTimeClient } from './BookTimeClient';

/**
 * Time Selection Page (Server Component)
 *
 * Fetches services and technician from the database and passes them to the client component.
 * This is step 3 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookTimePage({
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
  const context = await getPublicPageContext('book-datetime', searchParams, params);

  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const baseServiceId = searchParams.baseServiceId || null;
  const selectedAddOns = parseSelectedAddOnsParam(searchParams.selectedAddOns || null);
  const techId = searchParams.techId || '';

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
      techId: searchParams.techId ?? null,
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
      redirect(repairBookingUrl('/book/time', searchParams, primaryLocation.id, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }
    resolvedLocationId = validLocation?.id ?? primaryLocation.id;
  } else if (primaryLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
    // Missing locationId - inject primary (preserves all other params)
    redirect(repairBookingUrl('/book/time', searchParams, primaryLocation.id, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  const clientSession = await getClientSession();
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);
  const techStepEnabled = bookingFlow.includes('tech');
  let resolvedTechnicianContext: ResolvedPublicBookingTechnicianContext;

  try {
    resolvedTechnicianContext = await resolvePublicBookingTechnicianContext({
      salonId: salon.id,
      baseServiceId,
      selectedAddOns,
      serviceIds: serviceIdList,
      technicianId: techId || null,
      locationId: resolvedLocationId,
      clientPhone: clientSession?.phone ?? null,
      originalAppointmentId: searchParams.originalAppointmentId ?? null,
      allowAutoSkip: techStepEnabled,
    });
  } catch {
    redirect(buildBookingUrl('/book/service', {
      salonSlug: searchParams.salonSlug ?? salon.slug,
      baseServiceId: null,
      selectedAddOns: [],
      locationId: searchParams.locationId ?? null,
      techId: searchParams.techId ?? null,
      originalAppointmentId: searchParams.originalAppointmentId ?? null,
    }, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  if (techStepEnabled && resolvedTechnicianContext.shouldAutoSkipTech && resolvedTechnicianContext.soleCompatibleTechnician) {
    if (techId !== resolvedTechnicianContext.soleCompatibleTechnician.id) {
      redirect(buildBookingUrl('/book/time', {
        salonSlug: searchParams.salonSlug ?? salon.slug,
        serviceIds: serviceIdList.length > 0 ? serviceIdList : undefined,
        baseServiceId,
        selectedAddOns,
        techId: resolvedTechnicianContext.soleCompatibleTechnician.id,
        locationId: resolvedLocationId,
        originalAppointmentId: searchParams.originalAppointmentId ?? null,
      }, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }
  } else if (techStepEnabled) {
    const hasExplicitTechId = Boolean(techId && techId !== 'any');
    const requestedAnyArtist = techId === 'any';

    if (hasExplicitTechId && !resolvedTechnicianContext.hasValidExplicitTechnician) {
      redirect(buildBookingUrl('/book/tech', {
        salonSlug: searchParams.salonSlug ?? salon.slug,
        serviceIds: serviceIdList.length > 0 ? serviceIdList : undefined,
        baseServiceId,
        selectedAddOns,
        locationId: resolvedLocationId,
        techId: null,
        techError: 'unsupported',
        originalAppointmentId: searchParams.originalAppointmentId ?? null,
      }, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }

    if (!hasExplicitTechId && !requestedAnyArtist) {
      redirect(buildBookingUrl('/book/tech', {
        salonSlug: searchParams.salonSlug ?? salon.slug,
        serviceIds: serviceIdList.length > 0 ? serviceIdList : undefined,
        baseServiceId,
        selectedAddOns,
        locationId: resolvedLocationId,
        techId: null,
        originalAppointmentId: searchParams.originalAppointmentId ?? null,
      }, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }
  }

  const technician = resolvedTechnicianContext.effectiveTechnician
    ? {
        id: resolvedTechnicianContext.effectiveTechnician.id,
        name: resolvedTechnicianContext.effectiveTechnician.name,
        imageUrl: resolvedTechnicianContext.effectiveTechnician.imageUrl,
      }
    : null;

  const resolvedLocation = resolvedLocationId
    ? await getLocationById(resolvedLocationId, salon.id)
    : primaryLocation;

  const services = resolvedTechnicianContext.resolvedSelection.services.map(service => ({
    id: service.id,
    name: service.name,
    price: service.priceCents / 100,
    duration: service.durationMinutes,
  }));
  const effectiveBookingFlow = resolvedTechnicianContext.shouldAutoSkipTech
    ? bookingFlow.filter(step => step !== 'tech')
    : bookingFlow;

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="book-datetime"
      salon={context.salon}
    >
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookTimeClient
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
          locationName={resolvedLocation?.name ?? null}
          technician={technician}
          technicianSelectionSource={resolvedTechnicianContext.effectiveTechnicianSelectionSource}
          bookingFlow={effectiveBookingFlow}
        />
      </Suspense>
    </PublicSalonPageShell>
  );
}
