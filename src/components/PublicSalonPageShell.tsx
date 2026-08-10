import type { CSSProperties } from 'react';

import {
  getBookingExperienceCssVariables,
  resolveBookingExperience,
} from '@/libs/bookingExperience';
import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import { resolveBookingExperienceEntitlement } from '@/libs/featureEntitlements';
import type { PageAppearanceResult } from '@/libs/pageAppearance';
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
   * `useSalon().bookingPage` resolves correctly on the actual booking-flow
   * pages (service/tech/time/confirm), not just on the tenant layout that
   * never wraps these pages when reached via the canonical `/book` URL.
   */
  bookingPage?: BookingPageConfigSide;
  /** Owner-preview state for this request, already gated server-side. */
  ownerPreview?: SalonOwnerPreviewState;
  /**
   * Which preview banner (if any) to render for this request, computed by
   * the caller from the same `resolveDraftSalonAccess()` result used for
   * `ownerPreview`/`bookingPage` above. Rendered here — not in
   * `[locale]/[slug]/layout.tsx` — because that layout is bypassed
   * entirely by the canonical `/book?salonSlug=...` entry URL, so it is
   * never the only place an owner previewing their draft actually sees it.
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
