import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { getBookingConfigForSalon, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import { repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getClientSession } from '@/libs/clientAuth';
import { isClientEligibleForFirstVisitDiscount } from '@/libs/firstVisitDiscount';
import { getActiveAddOnsBySalonId, getActiveLocationsBySalonId, getServiceAddOnRulesBySalonId, getServicesBySalonId, getTechniciansBySalonId } from '@/libs/queries';
import { buildTenantRedirectPath, checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';
import { normalizePublicServiceImageUrl } from '@/libs/serviceImage';
import { getPublicPageContext } from '@/libs/tenant';
import { normalizePublicAvatarUrl } from '@/libs/technicianAvatar';

import { BookServiceClient } from './BookServiceClient';

export const dynamic = 'force-dynamic';

/**
 * Service Selection Page (Server Component)
 *
 * Fetches services from the database and passes them to the client component.
 * This is step 1 of the booking flow: Service → Tech → Time → Confirm
 */
export default async function BookServicePage({
  searchParams,
  params,
}: {
  searchParams: { locationId?: string; salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('book-service', searchParams, params);
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

  // Fetch services for this salon
  const bookingConfig = await getBookingConfigForSalon(salon.id);
  const clientSession = await getClientSession();
  const [dbServices, dbAddOns, dbServiceAddOnRules, dbTechnicians] = await Promise.all([
    getServicesBySalonId(salon.id),
    getActiveAddOnsBySalonId(salon.id),
    getServiceAddOnRulesBySalonId(salon.id),
    getTechniciansBySalonId(salon.id),
  ]);

  const services = dbServices.map(service => ({
    id: service.id,
    name: service.name,
    description: service.description ?? null,
    descriptionItems: service.descriptionItems ?? [],
    durationMinutes: service.durationMinutes,
    priceCents: service.price,
    priceDisplayText: service.priceDisplayText ?? null,
    category: service.category,
    imageUrl: normalizePublicServiceImageUrl(service.imageUrl),
    resolvedIntroPriceLabel: resolveIntroPriceLabel({
      isIntroPrice: service.isIntroPrice,
      introPriceExpiresAt: service.introPriceExpiresAt,
      introPriceLabel: service.introPriceLabel,
      bookingConfig,
    }),
    sortOrder: service.sortOrder ?? null,
  }));

  const addOns = dbAddOns.map(addOn => ({
    id: addOn.id,
    name: addOn.name,
    descriptionItems: addOn.descriptionItems ?? [],
    category: addOn.category,
    pricingType: addOn.pricingType,
    unitLabel: addOn.unitLabel ?? null,
    maxQuantity: addOn.maxQuantity ?? null,
    durationMinutes: addOn.durationMinutes,
    priceCents: addOn.priceCents,
    priceDisplayText: addOn.priceDisplayText ?? null,
    isActive: addOn.isActive ?? true,
  }));

  const serviceAddOnRules = dbServiceAddOnRules.map(rule => ({
    id: rule.id,
    serviceId: rule.serviceId,
    addOnId: rule.addOnId,
    selectionMode: rule.selectionMode,
    defaultQuantity: rule.defaultQuantity ?? null,
    maxQuantityOverride: rule.maxQuantityOverride ?? null,
    displayOrder: rule.displayOrder ?? 0,
  }));

  const technicians = dbTechnicians.map(technician => ({
    id: technician.id,
    name: technician.name,
    imageUrl: normalizePublicAvatarUrl(technician.avatarUrl),
    specialties: technician.specialties ?? [],
    rating: technician.rating ? Number(technician.rating) : null,
    reviewCount: technician.reviewCount ?? 0,
    enabledServiceIds: technician.enabledServiceIds ?? [],
    serviceIds: technician.serviceIds ?? [],
    primaryLocationId: technician.primaryLocationId ?? null,
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
      redirect(repairBookingUrl('/book/service', searchParams, primaryLocation.id, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
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

  const showFirstVisitOffer = bookingConfig.firstVisitDiscountEnabled
    && (!clientSession || await isClientEligibleForFirstVisitDiscount({
      salonId: salon.id,
      clientPhone: clientSession.phone,
    }));

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="book-service"
      salon={context.salon}
    >
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookServiceClient
          services={services}
          addOns={addOns}
          serviceAddOnRules={serviceAddOnRules}
          bookingFlow={bookingFlow}
          locations={locations}
          technicians={technicians}
          currency={bookingConfig.currency}
          showFirstVisitOffer={showFirstVisitOffer}
        />
      </Suspense>
    </PublicSalonPageShell>
  );
}
