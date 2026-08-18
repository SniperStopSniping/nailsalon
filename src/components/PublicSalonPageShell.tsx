import type { CSSProperties } from 'react';

import {
  getBookingExperienceCssVariables,
  resolveBookingExperience,
} from '@/libs/bookingExperience';
import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import type { LocationDisplayMode } from '@/libs/bookingPageContent';
import { resolveBookingExperienceEntitlement } from '@/libs/featureEntitlements';
import type { PageAppearanceResult } from '@/libs/pageAppearance';
import type {
  SalonContentAddOnInput,
  SalonContentLocationInput,
  SalonContentServiceInput,
  SalonContentTechnicianInput,
} from '@/libs/salonContent';
import { resolveSalonContent } from '@/libs/salonContent';
import type { Salon, SalonStatus } from '@/models/Schema';
import { type SalonOwnerPreviewState, SalonProvider } from '@/providers/SalonProvider';

import { PageThemeWrapper } from './PageThemeWrapper';
import { PreviewBanner, type PreviewBannerVariant } from './PreviewBanner';

type PublicSalonPageShellProps = {
  appearance: PageAppearanceResult;
  children: React.ReactNode;
  pageName: string;
  salon: Salon;
  /**
   * The resolved `bookingPage` draft/live side for this request, already
   * gated server-side by `resolveDraftSalonAccess()` in the calling
   * page.tsx (mirrors what `[locale]/[slug]/layout.tsx` does for its own
   * nested SalonProvider). Forwarded into the SalonProvider mounted here so
   * `useSalon().bookingPage` resolves correctly on every actual
   * booking-flow page (service/tech/time/confirm) — reached either via the
   * canonical `/book` URL, which the tenant layout never wraps at all, or
   * via `[locale]/[slug]/book/*`, which re-exports the same page.tsx and IS
   * nested under that layout.
   */
  bookingPage?: BookingPageConfigSide;
  /** Owner-preview state for this request, already gated server-side. */
  ownerPreview?: SalonOwnerPreviewState;
  /**
   * Raw ingredients for the server-resolved `SalonContent` (Luster UI/UX
   * plan rev 3, section 4A.A) — everything the content contract needs that
   * this shell does not already have (`salon` and the entitlement-resolved
   * `bookingExperience` below cover the rest). Resolved via
   * `resolveSalonContent` right here, once per render, so
   * `salonContent.policies`/`.social` always come from the SAME
   * entitlement-gated `bookingExperience` value this shell already computes
   * for the page itself — never a second, independently-resolved copy that
   * could drift out of sync with the entitlement gate. Omitted fields
   * default to empty, which is always safe to render.
   */
  salonContentInput?: {
    technicians?: SalonContentTechnicianInput[];
    services?: SalonContentServiceInput[];
    addOns?: SalonContentAddOnInput[];
    locations?: SalonContentLocationInput[];
    lusterFeaturingEnabled?: boolean;
    /**
     * The active (draft/live-resolved) `bookingPageContent` side (PR 5's
     * heroImageUrl/specialtyLine/bio), forwarded straight into
     * `resolveSalonContent`'s own `content` input (PR 6). Optional so every
     * existing caller that has not resolved `bookingPageContent` yet keeps
     * today's behaviour unchanged.
     */
    content?: {
      heroImageUrl?: string | null;
      specialtyLine?: string | null;
      bio?: string | null;
      /**
       * The active (draft/live-resolved) `bookingPageContent.locationDisplayMode`
       * (Post-launch privacy fix) — forwarded straight into
       * `resolveSalonContent`'s own `content.locationDisplayMode`, the
       * server-side projection point that strips street address/unit and
       * postal/ZIP from `salonContent.place` when set to `'city_only'`.
       * Optional so every existing caller that has not resolved
       * `bookingPageContent` yet keeps today's `'full_address'` behaviour.
       */
      locationDisplayMode?: LocationDisplayMode;
    };
  };
  /**
   * Which preview banner (if any) to render for this request, computed by
   * the caller from the same `resolveDraftSalonAccess()` result used for
   * `ownerPreview`/`bookingPage` above. Rendered here — not in
   * `[locale]/[slug]/layout.tsx`, which resolves the same gate but
   * deliberately never renders a banner — so `PublicSalonPageShell` is the
   * single place a banner mounts, regardless of which of the two real URL
   * paths (canonical `/book`, or the nested `[locale]/[slug]/book/*`
   * re-export) reached this page. Rendering it in both places would
   * duplicate the banner on the nested path, since that path physically
   * mounts this shell inside the tenant layout.
   */
  previewBannerVariant?: PreviewBannerVariant | null;
};

export function PublicSalonPageShell({
  appearance,
  children,
  pageName,
  salon,
  bookingPage,
  ownerPreview,
  salonContentInput,
  previewBannerVariant,
}: PublicSalonPageShellProps) {
  let bookingExperience = resolveBookingExperience(null);

  try {
    const entitlement = resolveBookingExperienceEntitlement({
      storedPlan: salon.plan,
      features: salon.features,
    });

    if (entitlement.entitled) {
      bookingExperience = resolveBookingExperience(salon.settings);
    }
  } catch {
    // Customization is optional. If entitlement resolution ever fails, keep
    // public pages available with the canonical, uncustomized experience.
  }

  const bookingExperienceStyles = pageName.startsWith('book-')
    ? getBookingExperienceCssVariables(bookingExperience.primaryColor)
    : {};
  const hasBookingColorOverride = Object.keys(bookingExperienceStyles).length > 0;

  const salonContent = resolveSalonContent({
    salon: {
      name: salon.name,
      logoUrl: salon.logoUrl ?? null,
      address: salon.address ?? null,
      city: salon.city ?? null,
      state: salon.state ?? null,
      zipCode: salon.zipCode ?? null,
      businessHours: salon.businessHours ?? null,
    },
    technicians: salonContentInput?.technicians ?? [],
    services: salonContentInput?.services ?? [],
    addOns: salonContentInput?.addOns,
    locations: salonContentInput?.locations,
    bookingExperience,
    lusterFeaturingEnabled: salonContentInput?.lusterFeaturingEnabled,
    content: salonContentInput?.content,
  });

  return (
    <SalonProvider
      salonId={salon.id}
      salonName={salon.name}
      salonSlug={salon.slug}
      themeKey={salon.themeKey ?? undefined}
      status={(salon.status ?? 'active') as SalonStatus}
      bookingExperience={bookingExperience}
      bookingPage={bookingPage}
      ownerPreview={ownerPreview}
      salonContent={salonContent}
    >
      {previewBannerVariant && <PreviewBanner variant={previewBannerVariant} />}
      <PageThemeWrapper
        mode={appearance.mode}
        themeKey={appearance.themeKey}
        pageName={pageName}
      >
        {hasBookingColorOverride
          ? (
              <div
                data-booking-experience-theme={pageName}
                style={bookingExperienceStyles as CSSProperties}
              >
                {children}
              </div>
            )
          : children}
      </PageThemeWrapper>
    </SalonProvider>
  );
}
