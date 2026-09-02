import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import type { PreviewBannerVariant } from '@/components/PreviewBanner';
import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { buildBookingUrl, parseSelectedAddOnsParam, repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getClientSession } from '@/libs/clientAuth';
import {
  buildDepositDisclosure,
  buildDepositDisclosureFingerprint,
  isDepositGovernedBySystem,
  resolveDepositChargeForTotal,
  resolveDisclosureTotalCents,
} from '@/libs/depositPolicy';
import { getDepositPolicyForSalon } from '@/libs/depositPolicy.server';
import { buildDirectionsDestination, resolveDirectionsLocation } from '@/libs/directions';
import { resolveDraftSalonAccess } from '@/libs/ownerPreview';
import { resolvePublicBookingTechnicianContext } from '@/libs/publicBookingTechnicians';
import { resolvePublicRetentionCampaignPreview } from '@/libs/publicRetentionCampaign';
import { getLocationById, getPrimaryLocation } from '@/libs/queries';
import { applyLocationDisplayMode } from '@/libs/salonContent';
import { buildTenantRedirectPath, checkFeatureEnabled, checkSalonStatus, isRewardsEnabled, isSmsEnabled } from '@/libs/salonStatus';
import {
  resolvePublicSalonPhone,
  resolveSharedSalonProfile,
} from '@/libs/sharedSalonProfile';
import { buildTaxConfigurationSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import { getPublicPageContext } from '@/libs/tenant';
import { getDateKeyInTimeZone, getTimeKeyInTimeZone } from '@/libs/timeZone';
import type { SalonOwnerPreviewState } from '@/providers/SalonProvider';
import type { SalonSettings } from '@/types/salonPolicy';

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
    startTime?: string;
    locationId?: string;
    salonSlug?: string;
    originalAppointmentId?: string;
    manageToken?: string;
    campaign?: string;
    smartFitDiscountCents?: string | string[];
    smartFitTotalCents?: string | string[];
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
  // The URL-repair helpers preserve every unrelated param and are typed for
  // single-valued ones. A duplicated key arrives as an array; take the first
  // value, exactly as `useSearchParams().get()` does on the client.
  const repairableSearchParams: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

  const { salon } = context;
  const bookingConfig = await getBookingConfigForSalon(salon.id);
  const bookingTaxConfig = resolveTaxConfig(
    (salon.settings as SalonSettings | null | undefined) ?? null,
    new Date(),
  );
  const bookingTaxConfigurationIdentity
    = buildTaxConfigurationSnapshot(bookingTaxConfig).configurationIdentity;
  const parsedStartTime = searchParams.startTime ? new Date(searchParams.startTime) : null;
  const canonicalStartTime = parsedStartTime
    && !Number.isNaN(parsedStartTime.getTime())
    && getDateKeyInTimeZone(parsedStartTime, bookingConfig.timezone) === dateStr
    && getTimeKeyInTimeZone(parsedStartTime, bookingConfig.timezone) === timeStr.padStart(5, '0')
    ? parsedStartTime.toISOString()
    : null;
  const tenantRoute = {
    salonSlug: salon.slug,
    routeSalonSlug: params?.slug,
    locale: params?.locale,
  };

  // Owner-preview gate (Luster UI/UX plan rev 3, PR3): reuse the SAME
  // authorization matrix `[locale]/[slug]/layout.tsx` already resolved for
  // this request, rather than letting checkSalonStatus() below run an
  // independent, unaware publication check that would re-404 an owner (or
  // authorized impersonating super admin) the layout just let through.
  const previewGate = await resolveDraftSalonAccess({
    id: salon.id,
    publicationStatus: salon.publicationStatus,
    freeSoloEnabled: salon.freeSoloEnabled,
  });
  if (!previewGate.allowed) {
    redirect(buildTenantRedirectPath('/not-found', tenantRoute) ?? '/not-found');
  }

  // Thread the same gate result into the SalonProvider PublicSalonPageShell
  // mounts below (Luster UI/UX plan rev 3, PR3). `[locale]/[slug]/layout.tsx`
  // resolves this same gate and enforces its own notFound()/redirect above
  // it, but never renders PreviewBanner — PublicSalonPageShell is the single
  // owner of banner rendering for every public page reached through this
  // page.tsx, whether via the canonical `/book?salonSlug=...` entry URL
  // (outside the `[locale]/[slug]` tree, so the layout above never wraps it
  // at all) or via `[locale]/[slug]/book/confirm`, which re-exports this
  // exact page and IS nested under the layout.
  const bookingPageConfig = resolveBookingPageConfig(salon.settings);
  const activeBookingPageSide = previewGate.isPreviewingDraftConfig
    ? bookingPageConfig.draft
    : bookingPageConfig.live;
  // Post-launch privacy fix: this page builds its OWN `locationSummary` for
  // `BookConfirmClient` below (directions/Google-Maps + the on-screen
  // "Location" row), entirely independent of `PublicSalonPageShell`'s
  // internal `resolveSalonContent` projection — mirrors why
  // `book/service/page.tsx` resolves its own `activeBookingPageContentSide`
  // for its separate `locations` prop. Same draft/live gate
  // (`previewGate.isPreviewingDraftConfig`) as everything else on this page.
  const bookingPageContent = resolveBookingPageContent(salon.settings);
  const activeBookingPageContentSide = previewGate.isPreviewingDraftConfig
    ? bookingPageContent.draft
    : bookingPageContent.live;
  const sharedProfile = resolveSharedSalonProfile(salon.settings);
  const ownerPreviewState: SalonOwnerPreviewState = {
    isPreviewing: previewGate.isPreviewingDraftSalon || previewGate.isPreviewingDraftConfig,
    actorType: previewGate.actorType,
  };
  const previewBannerVariant: PreviewBannerVariant | null = previewGate.isPreviewingDraftSalon
    ? 'draft-salon'
    : previewGate.isPreviewingDraftConfig
      ? 'draft-config'
      : null;

  // Check salon status - redirect if suspended/cancelled. Deleted/
  // suspended/cancelled checks still apply even when previewing a draft
  // salon; only the "not published" branch is bypassed for an authorized
  // previewer.
  const statusCheck = await checkSalonStatus(salon.id, {
    allowUnpublishedPreview: previewGate.isPreviewingDraftSalon,
  });
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
      redirect(repairBookingUrl('/book/confirm', repairableSearchParams, primaryLocation.id, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }
  } else if (primaryLocation && shouldRepairBookingUrl(locationId, primaryLocation.id)) {
    // Missing locationId - inject primary (preserves all other params)
    redirect(repairBookingUrl('/book/confirm', repairableSearchParams, primaryLocation.id, {
      routeSalonSlug: params?.slug,
      locale: params?.locale,
    }));
  }

  const clientSession = await getClientSession();
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);
  const techStepEnabled = bookingFlow.includes('tech');
  const resolvedTechnicianContext = await resolvePublicBookingTechnicianContext({
    salonId: salon.id,
    baseServiceId,
    selectedAddOns,
    serviceIds: serviceIdList,
    technicianId: techId || null,
    locationId: locationId || primaryLocation?.id || null,
    clientPhone: clientSession?.phone ?? null,
    originalAppointmentId,
    allowAutoSkip: techStepEnabled || salon.freeSoloEnabled,
  });

  if (techStepEnabled && resolvedTechnicianContext.shouldAutoSkipTech && resolvedTechnicianContext.soleCompatibleTechnician) {
    if (techId !== resolvedTechnicianContext.soleCompatibleTechnician.id) {
      redirect(buildBookingUrl('/book/confirm', {
        salonSlug: searchParams.salonSlug ?? salon.slug,
        serviceIds: serviceIdList.length > 0 ? serviceIdList : undefined,
        baseServiceId,
        selectedAddOns,
        techId: resolvedTechnicianContext.soleCompatibleTechnician.id,
        date: dateStr,
        time: timeStr,
        startTime: canonicalStartTime,
        locationId: locationId || primaryLocation?.id || null,
        originalAppointmentId,
        manageToken: searchParams.manageToken ?? null,
        campaignToken: searchParams.campaign ?? null,
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
        locationId: locationId || primaryLocation?.id || null,
        techId: null,
        techError: 'unsupported',
        originalAppointmentId,
        manageToken: searchParams.manageToken ?? null,
        campaignToken: searchParams.campaign ?? null,
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
        locationId: locationId || primaryLocation?.id || null,
        techId: null,
        originalAppointmentId,
        manageToken: searchParams.manageToken ?? null,
        campaignToken: searchParams.campaign ?? null,
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

  // Fetch the selected location (already validated above, or use primary)
  // At this point locationId is guaranteed to be valid or we've redirected
  const requestedLocation = locationId
    ? await getLocationById(locationId, salon.id)
    : primaryLocation;
  const resolvedLocation = resolveDirectionsLocation(requestedLocation, primaryLocation);
  // Post-launch privacy fix: `buildDirectionsDestination` below decides
  // whether a usable destination exists at all — that check runs against
  // the RAW (unredacted) salon fields on purpose, since city/state alone
  // (which always survive redaction) can still be a valid destination.
  // `applyLocationDisplayMode` is only applied to the object actually
  // handed to the client, below.
  const salonDirectionsFallback = buildDirectionsDestination({
    address: salon.address,
    city: salon.city,
    state: salon.state,
    zipCode: salon.zipCode,
  })
    ? applyLocationDisplayMode({
      id: locationId || `salon_${salon.id}`,
      name: salon.name,
      address: salon.address,
      city: salon.city,
      state: salon.state,
      zipCode: salon.zipCode,
    }, activeBookingPageContentSide.locationDisplayMode)
    : null;

  // Build location summary for client. This — not `resolveSalonContent`'s
  // `salonContent.place` (projected inside `PublicSalonPageShell`) — is the
  // ONLY thing that reaches `BookConfirmClient`'s on-screen "Location" row
  // and its `buildGoogleMapsDirectionsUrl()` call (`directions.ts`), on this
  // PUBLIC, pre-submit (unauth) route. Redacting it here, at the source,
  // means the directions URL — built downstream from whatever `address`/
  // `zipCode` this object carries — can never reconstruct a `city_only`
  // salon's street address either: with both nulled, only city/state (if
  // any) end up in the destination string.
  const locationSummary = resolvedLocation
    ? applyLocationDisplayMode({
      id: resolvedLocation.id,
      name: resolvedLocation.name,
      address: resolvedLocation.address,
      city: resolvedLocation.city,
      state: resolvedLocation.state,
      zipCode: resolvedLocation.zipCode,
    }, activeBookingPageContentSide.locationDisplayMode)
    : salonDirectionsFallback;

  const services = resolvedTechnicianContext.resolvedSelection.services.map(service => ({
    id: service.id,
    name: service.name,
    price: service.priceCents / 100,
    duration: service.durationMinutes,
  }));
  const campaignResolution = await resolvePublicRetentionCampaignPreview({
    token: searchParams.campaign ?? null,
    salonId: salon.id,
    services: resolvedTechnicianContext.resolvedSelection.services.map(service => ({
      id: service.id,
      priceCents: service.priceCents,
    })),
  });
  const campaignPreview = campaignResolution.status === 'valid'
    ? campaignResolution.preview
    : null;
  const subtotalBeforeDiscountCents = resolvedTechnicianContext.resolvedSelection.subtotalBeforeDiscountCents;
  const discountAmountCents = campaignPreview
    ? campaignPreview.discountAmountCents
    : resolvedTechnicianContext.resolvedSelection.discountAmountCents;
  const totalPriceCents = campaignPreview
    ? Math.max(0, subtotalBeforeDiscountCents - campaignPreview.discountAmountCents)
    : resolvedTechnicianContext.resolvedSelection.totalPriceCents;
  // Deposits (D3) — wired but DARK behind two independent gates. While either is
  // off the three props below are constants and every public page renders
  // identically to base.
  //
  // A duplicated query key yields an ARRAY, whose stringified form the cents
  // parser rejects — the server would then fall back to the full server total and
  // DISCLOSE MORE than the client's CTA shows, because `useSearchParams().get()`
  // takes the first value on the client. Coerce to the first value here too.
  const firstParam = (value: string | string[] | undefined): string | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const depositPolicy = await getDepositPolicyForSalon({
    salonId: salon.id,
    salon: context.salon,
  });
  const disclosureTotalCents = resolveDisclosureTotalCents({
    serverTotalCents: totalPriceCents,
    subtotalBeforeDiscountCents,
    smartFitDiscountCentsParam: firstParam(searchParams.smartFitDiscountCents),
    smartFitTotalCentsParam: firstParam(searchParams.smartFitTotalCents),
  });
  const depositCharge = resolveDepositChargeForTotal(
    depositPolicy,
    disclosureTotalCents,
    { mode: 'disclosure', isReschedule: Boolean(originalAppointmentId) },
  );
  const depositDisclosure = buildDepositDisclosure(depositCharge, {
    locale: params?.locale === 'fr' ? 'fr-CA' : 'en-CA',
  });
  const depositFingerprint = buildDepositDisclosureFingerprint(depositCharge);
  const depositNoticeSuppressed = isDepositGovernedBySystem(depositPolicy);

  // Rewards program state — points messaging is hidden when the program is off
  const rewardsEnabled = await isRewardsEnabled(salon.id);
  // SMS reminder state — "we'll text you" copy is hidden when reminders are off
  const smsEnabled = await isSmsEnabled(salon.id);
  const effectiveBookingFlow = resolvedTechnicianContext.shouldAutoSkipTech
    ? bookingFlow.filter(step => step !== 'tech')
    : bookingFlow;

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="book-confirm"
      salon={context.salon}
      bookingPage={activeBookingPageSide}
      ownerPreview={ownerPreviewState}
      isPreviewingDraftConfig={previewGate.isPreviewingDraftConfig}
      previewBannerVariant={previewBannerVariant}
    >
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
        <BookConfirmClient
          services={services}
          addOns={resolvedTechnicianContext.resolvedSelection.addOns.map(addOn => ({
            id: addOn.id,
            name: addOn.name,
            quantity: addOn.quantity,
            price: addOn.lineTotalCents / 100,
            duration: addOn.lineDurationMinutes,
          }))}
          baseServiceId={resolvedTechnicianContext.resolvedSelection.baseServiceId}
          selectedAddOns={resolvedTechnicianContext.resolvedSelection.selectedAddOns}
          subtotalBeforeDiscount={subtotalBeforeDiscountCents / 100}
          discountAmount={discountAmountCents / 100}
          firstVisitDiscountPreview={campaignPreview
            ? null
            : resolvedTechnicianContext.resolvedSelection.firstVisitDiscountPreview}
          campaignPromotionPreview={campaignPreview}
          campaignMessage={campaignResolution.status === 'invalid'
            ? campaignResolution.message
            : null}
          totalPrice={totalPriceCents / 100}
          currency={bookingConfig.currency.toUpperCase()}
          taxConfig={bookingTaxConfig}
          taxConfigurationIdentity={bookingTaxConfigurationIdentity}
          totalDuration={resolvedTechnicianContext.resolvedSelection.visibleDurationMinutes}
          technician={technician}
          salonSlug={salon.slug}
          dateStr={dateStr}
          timeStr={timeStr}
          canonicalStartTime={canonicalStartTime}
          salonTimeZone={bookingConfig.timezone}
          technicianSelectionSource={resolvedTechnicianContext.effectiveTechnicianSelectionSource}
          bookingFlow={effectiveBookingFlow}
          location={locationSummary}
          rewardsEnabled={rewardsEnabled}
          smsEnabled={smsEnabled}
          clientChangeCutoffHours={bookingConfig.clientChangeCutoffHours}
          // Post-launch privacy fix: this is the "call the salon" escape
          // hatch on the duplicate-booking screen (`ExistingAppointmentOptions`
          // renders it as a `tel:` link) — a second, independent public phone
          // surface on this same page, alongside `locationSummary` above. For
          // a `city_only` home-based solo tech, the salon phone IS the
          // personal mobile tied to the same private residence being
          // redacted, so it gets the identical projection via
          // `applyPhoneDisplayMode` (`@/libs/salonContent`), the scalar
          // counterpart of the `applyLocationDisplayMode` calls above — same
          // choke point, same `activeBookingPageContentSide.locationDisplayMode`
          // gate, never a second/drifting redaction decision.
          salonPhone={resolvePublicSalonPhone(
            sharedProfile,
            salon.phone ?? null,
            activeBookingPageContentSide.locationDisplayMode,
          )}
          depositDisclosure={depositDisclosure}
          depositNoticeSuppressed={depositNoticeSuppressed}
          depositFingerprint={depositFingerprint}
        />
      </Suspense>
    </PublicSalonPageShell>
  );
}
