import 'server-only';

// Server-only implementation shared by the public route and the private Owner
// DRAFT-preview route. Both entrypoints still use this one canonical renderer.
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';

import type { PreviewBannerVariant } from '@/components/PreviewBanner';
import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getBookingConfigForSalon, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { resolveBookingPagePresetPreviewSide } from '@/libs/bookingPagePresetPreview';
import { repairBookingUrl, shouldRepairBookingUrl } from '@/libs/bookingParams';
import { getClientSession } from '@/libs/clientAuth';
import { isClientEligibleForFirstVisitDiscount } from '@/libs/firstVisitDiscount';
import { resolveDraftSalonAccess } from '@/libs/ownerPreview';
import { mapPublicTechnician } from '@/libs/publicBookingTechnicians';
import { getActiveAddOnsBySalonId, getActiveLocationsBySalonId, getServiceAddOnRulesBySalonId, getServicesBySalonId, getTechniciansBySalonId } from '@/libs/queries';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import { applyLocationDisplayMode } from '@/libs/salonContent';
import { resolveMerchandisingSettings } from '@/libs/salonMerchandisingSettings';
import { buildTenantRedirectPath, checkFeatureEnabled, checkSalonStatus } from '@/libs/salonStatus';
import { getPublicBookableServiceIds } from '@/libs/serviceAssignments';
import { resolveServiceCardImage } from '@/libs/serviceImage';
import {
  resolvePublicSalonPhone,
  resolveSharedSalonProfile,
} from '@/libs/sharedSalonProfile';
import { getPublicPageContext } from '@/libs/tenant';
import type { SalonOwnerPreviewState } from '@/providers/SalonProvider';
import type { SalonSettings } from '@/types/salonPolicy';

import { BookServiceClient } from './BookServiceClient';
import { resolvePublicQuickBookProfile } from './quickBookProfile';

const NEW_CLIENT_PROMO_END_DATE = '2026-04-30';

export type BookServicePageProps = {
  searchParams: {
    locationId?: string;
    salonSlug?: string;
    campaign?: string;
    builderPreview?: string | string[];
    presetPreview?: string;
    presetPreviewVersion?: string;
  };
  params?: { locale?: string; slug?: string };
};

type BookServicePageRenderOptions = Readonly<{
  /**
   * Server-only capability used exclusively by the dedicated Owner route.
   * It converts every missing/wrong/stale authorization result into a 404;
   * unlike the public route, this surface may never downgrade to LIVE.
   */
  requireOwnerDraftPreview?: boolean;
}>;

function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  ) as Record<string, string>;

  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/**
 * Service Selection Page (Server Component)
 *
 * Fetches services from the database and passes them to the client component.
 * This is step 1 of the booking flow: Service → Tech → Time → Confirm
 */
export async function renderBookServicePage({
  searchParams,
  params,
}: BookServicePageProps, {
  requireOwnerDraftPreview = false,
}: BookServicePageRenderOptions = {}) {
  const context = await getPublicPageContext('book-service', searchParams, params);
  const { salon } = context;
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
  if (requireOwnerDraftPreview
    && (!previewGate.allowed || !previewGate.isPreviewingDraftConfig)) {
    notFound();
  }
  if (!previewGate.allowed) {
    redirect(buildTenantRedirectPath('/not-found', tenantRoute) ?? '/not-found');
  }

  // The embedded owner-builder iframe deliberately blocks scripts. Mark only
  // its exact, generated numeric revision URL as static-preview rendering so
  // the canonical client renderer can expose its server-rendered pixels
  // without waiting for a hydration-only entrance reveal. The existing owner
  // preview gate remains the authority: an anonymous/live request cannot opt
  // into this mode by adding a public query parameter, and repeated or
  // malformed values fail closed.
  const isEmbeddedBuilderPreview = previewGate.isPreviewingDraftConfig
    && typeof searchParams.builderPreview === 'string'
    && /^(?:0|[1-9]\d*)$/.test(searchParams.builderPreview);
  const repairableSearchParams: Record<string, string | undefined> = {
    ...searchParams,
    // A repeated builder-preview key is not an authorized preview revision
    // and must not be propagated through an unrelated location repair.
    builderPreview: typeof searchParams.builderPreview === 'string'
      ? searchParams.builderPreview
      : undefined,
  };

  // Thread the same gate result into the SalonProvider PublicSalonPageShell
  // mounts below (Luster UI/UX plan rev 3, PR3). `[locale]/[slug]/layout.tsx`
  // resolves this same gate and enforces its own notFound()/redirect above
  // it, but never renders PreviewBanner — PublicSalonPageShell is the single
  // owner of banner rendering for every public page reached through this
  // page.tsx, whether via the canonical `/book?salonSlug=...` entry URL
  // (outside the `[locale]/[slug]` tree, so the layout above never wraps it
  // at all) or via `[locale]/[slug]/book/service`, which re-exports this
  // exact page and IS nested under the layout.
  const bookingPageConfig = resolveBookingPageConfig(salon.settings);
  const selectedBookingPageSide = previewGate.isPreviewingDraftConfig
    ? bookingPageConfig.draft
    : bookingPageConfig.live;
  const activeBookingPageSide = resolveBookingPagePresetPreviewSide({
    currentSide: selectedBookingPageSide,
    isPreviewingDraftConfig: previewGate.isPreviewingDraftConfig,
    previewQuery: searchParams,
  });
  // PR 6: the same draft/live selection the bookingPage config above already
  // makes, applied to its sibling bookingPageContent side (PR 5's
  // heroImageUrl/specialtyLine/bio) — never a second, independently-decided
  // gate, so a previewing owner sees their own draft hero/specialty/bio
  // alongside their own draft layout/section config, never a mismatched pair.
  const bookingPageContent = resolveBookingPageContent(salon.settings);
  const activeBookingPageContentSide = previewGate.isPreviewingDraftConfig
    ? bookingPageContent.draft
    : bookingPageContent.live;
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

  // Fetch services for this salon
  const bookingConfig = await getBookingConfigForSalon(salon.id);
  const merchandising = resolveMerchandisingSettings(
    (salon.settings as SalonSettings | null | undefined) ?? null,
  );
  const clientSession = await getClientSession();
  const [dbServices, dbAddOns, dbServiceAddOnRules, dbTechnicians, publicBookableServiceIds] = await Promise.all([
    getServicesBySalonId(salon.id),
    getActiveAddOnsBySalonId(salon.id),
    getServiceAddOnRulesBySalonId(salon.id),
    getTechniciansBySalonId(salon.id),
    getPublicBookableServiceIds(salon.id),
  ]);

  const services = dbServices
    .filter(service => publicBookableServiceIds === null || publicBookableServiceIds.has(service.id))
    .map(service => ({
      id: service.id,
      name: service.name,
      description: service.description ?? null,
      descriptionItems: service.descriptionItems ?? [],
      durationMinutes: service.durationMinutes,
      priceCents: service.price,
      priceDisplayText: service.priceDisplayText ?? null,
      category: service.category,
      bookingCategory: service.bookingCategory,
      templateKey: service.templateKey ?? null,
      featuredOrder: service.featuredOrder ?? null,
      imageUrl: resolveServiceCardImage({
        imageUrl: service.imageUrl,
        templateKey: service.templateKey,
        bookingCategory: service.bookingCategory,
        name: service.name,
      }),
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

  // S5 (Stage 1): this used to be a second, hand-maintained copy of
  // `mapPublicTechnician` — same input type, byte-identical output keys. Two
  // independent allowlists over the same unrestricted technician row is one
  // more place a sensitive field can be added by accident, so this now reuses
  // the single shared projector.
  const technicians = dbTechnicians.map(mapPublicTechnician);

  // Get the booking flow for this salon
  const bookingFlow = normalizeBookingFlow(salon.bookingFlow as BookingStep[] | null);

  // Fetch active locations for multi-location support
  // LOCATION POLICY:
  // - Multi-location salons: must have 1+ active locations, invalid locationId → redirect to primary
  // - Single-address salons: activeLocations is empty, locationId stays null (valid)
  // - If multi-location salon has 0 active locations (admin misconfig), booking proceeds with null
  const [activeLocations, retentionSettings] = await Promise.all([
    getActiveLocationsBySalonId(salon.id),
    activeBookingPageSide.layout === 'quick_book'
      ? getRetentionSettingsForSalon(salon.id)
      : Promise.resolve(null),
  ]);
  const primaryLocation = activeLocations.find(l => l.isPrimary) || activeLocations[0];

  // Server-side locationId validation: if provided but invalid, redirect with primary
  // Uses shouldRepairBookingUrl() to prevent redirect loops
  if (searchParams.locationId && primaryLocation) {
    const isValidLocation = activeLocations.some(l => l.id === searchParams.locationId);
    if (!isValidLocation && shouldRepairBookingUrl(searchParams.locationId, primaryLocation.id)) {
      // Invalid locationId - redirect with primary (preserves all other params)
      if (requireOwnerDraftPreview) {
        // A private Owner preview must never repair onto the public LIVE route.
        // Drop the legacy public salonSlug query and keep the authoritative
        // route slug in the private path so the same server authorization is
        // required after the redirect as before it.
        redirect(repairBookingUrl(
          `/admin/booking-page/preview/${encodeURIComponent(salon.slug)}`,
          { ...repairableSearchParams, salonSlug: undefined },
          primaryLocation.id,
          { locale: params?.locale },
        ));
      }
      redirect(repairBookingUrl('/book/service', repairableSearchParams, primaryLocation.id, {
        routeSalonSlug: params?.slug,
        locale: params?.locale,
      }));
    }
  }

  const sharedProfile = resolveSharedSalonProfile(
    (salon.settings as SalonSettings | null | undefined) ?? null,
  );

  // Map locations to the shape expected by the client component.
  // Post-launch privacy fix: `activeBookingPageContentSide.locationDisplayMode`
  // is applied here via `applyLocationDisplayMode` (`@/libs/salonContent`) —
  // the SAME redaction `resolveSalonContent` applies to `salonContent.place`
  // below, reused rather than reimplemented — because this `locations` array
  // is a second, independent public-location surface: it feeds
  // `BookServiceClient`'s location picker directly and never passes through
  // `resolveSalonContent` at all. Without this, `city_only` would redact the
  // Editorial "Visit" section but leave the exact street address visible in
  // the service location picker.
  const locations = activeLocations.map(loc => applyLocationDisplayMode({
    id: loc.id,
    name: loc.name,
    address: loc.address,
    city: loc.city,
    state: loc.state,
    zipCode: loc.zipCode,
    phone: resolvePublicSalonPhone(
      sharedProfile,
      loc.phone,
      activeBookingPageContentSide.locationDisplayMode,
    ),
    isPrimary: loc.isPrimary ?? false,
  }, activeBookingPageContentSide.locationDisplayMode));

  const showFirstVisitOffer = bookingConfig.firstVisitDiscountEnabled
    && (!clientSession || await isClientEligibleForFirstVisitDiscount({
      salonId: salon.id,
      clientPhone: clientSession.phone,
    }));
  const showNewClientPromo = showFirstVisitOffer
    && getDateKeyInTimeZone(new Date(), bookingConfig.timezone) <= NEW_CLIENT_PROMO_END_DATE;
  const bookingExperience = resolveBookingExperience(salon.settings);
  const quickBookProfile = activeBookingPageSide.layout === 'quick_book'
    ? resolvePublicQuickBookProfile({
      salon: {
        name: salon.name,
        logoUrl: salon.logoUrl ?? null,
        phone: salon.phone ?? null,
        email: salon.email ?? null,
        address: salon.address ?? null,
        city: salon.city ?? null,
        state: salon.state ?? null,
        zipCode: salon.zipCode ?? null,
        businessHours: salon.businessHours ?? null,
      },
      technicians,
      locations: activeLocations.map(location => ({
        name: location.name,
        address: location.address ?? null,
        city: location.city ?? null,
        state: location.state ?? null,
        zipCode: location.zipCode ?? null,
        phone: location.phone ?? null,
        email: location.email ?? null,
        businessHours: location.businessHours ?? null,
        isPrimary: location.isPrimary ?? false,
      })),
      bookingExperience,
      reviewUrl: retentionSettings?.googleReviewUrl ?? null,
      parkingInstructions: retentionSettings?.parkingInstructions ?? null,
      sharedProfile,
      visibility: activeBookingPageSide.quickBookProfile,
      bio: activeBookingPageContentSide.bio,
      locationDisplayMode: activeBookingPageContentSide.locationDisplayMode,
      publicContactPreferences: sharedProfile.callEnabled === null
        && sharedProfile.textEnabled === null
        && sharedProfile.textNumber === null
        ? null
        : {
            callEnabled: sharedProfile.callEnabled === true,
            textEnabled: sharedProfile.textEnabled === true,
            textNumber: sharedProfile.textNumber,
          },
      timeZone: bookingConfig.timezone,
    })
    : undefined;

  const bookingContent = (
    <BookServiceClient
      services={services}
      addOns={addOns}
      serviceAddOnRules={serviceAddOnRules}
      bookingFlow={bookingFlow}
      locations={locations}
      technicians={technicians}
      currency={bookingConfig.currency}
      showNewClientPromo={showNewClientPromo}
      lusterFeaturingEnabled={merchandising.featureLusterManicure}
      showServiceImages={merchandising.showServiceImages}
      isEmbeddedBuilderPreview={isEmbeddedBuilderPreview}
      quickBookProfile={quickBookProfile}
    />
  );

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="book-service"
      salon={context.salon}
      bookingPage={activeBookingPageSide}
      ownerPreview={ownerPreviewState}
      isPreviewingDraftConfig={previewGate.isPreviewingDraftConfig}
      salonContentInput={{
        technicians: dbTechnicians,
        services,
        addOns,
        locations: activeLocations,
        lusterFeaturingEnabled: merchandising.featureLusterManicure,
        content: {
          heroImageUrl: activeBookingPageContentSide.heroImageUrl,
          specialtyLine: activeBookingPageContentSide.specialtyLine,
          bio: activeBookingPageContentSide.bio,
        },
      }}
      previewBannerVariant={previewBannerVariant}
    >
      {/* The view-only iframe deliberately cannot run scripts. Streaming a
          Suspense fallback would leave its real content hidden until React's
          reveal script runs, so this dynamic route waits for the content. */}
      {isEmbeddedBuilderPreview
        ? bookingContent
        : (
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" /></div>}>
              {bookingContent}
            </Suspense>
          )}
    </PublicSalonPageShell>
  );
}
