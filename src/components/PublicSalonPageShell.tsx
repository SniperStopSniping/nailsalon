import type { CSSProperties } from 'react';

import {
  getBookingExperienceCssVariables,
  resolveBookingExperience,
} from '@/libs/bookingExperience';
import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
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
   * The exact `previewGate.isPreviewingDraftConfig` value each page.tsx
   * already computes from its own `resolveDraftSalonAccess()` call, before
   * ever mounting this shell (mirrors how `bookingPage`/`ownerPreview` above
   * are threaded). Privacy fix (post-launch): this shell is the single
   * choke point that resolves `bookingPageContent` — and therefore
   * `locationDisplayMode`, the address-redaction switch — for EVERY public
   * booking page (service/tech/time/confirm), not just the ones that
   * happen to remember to thread it themselves. Forwarded explicitly
   * rather than re-derived from `ownerPreview.isPreviewing` (which
   * conflates "salon itself is a draft" with "config is being previewed")
   * or recomputed here (which would be a second, independent preview
   * decision — `resolveDraftSalonAccess()` must stay the ONE place that
   * decides who may see draft state). Defaults to `false` (live), the safe
   * default for any caller that omits it.
   */
  isPreviewingDraftConfig?: boolean;
  /**
   * Raw ingredients for the server-resolved `SalonContent` (Luster UI/UX
   * plan rev 3, section 4A.A) — everything the content contract needs that
   * this shell does not already have (`salon` and the resolved
   * `bookingExperience` below cover the rest). Resolved via
   * `resolveSalonContent` right here, once per render, so
   * `salonContent.policies`/`.social` always come from the SAME resolved
   * `bookingExperience` value this shell already computes for the page
   * itself — never a second, independently-resolved copy that could drift.
   * (S1/Stage 1 correction: this previously said "entitlement-resolved" and
   * "entitlement-gated". There is no entitlement gate in this file any more —
   * the reason for single resolution is consistency, not entitlement.)
   * Omitted fields default to empty, which is always safe to render.
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
     *
     * Deliberately has NO `locationDisplayMode` field (post-launch privacy
     * fix): that one field is always resolved by this shell itself, below,
     * from `salon.settings` + `isPreviewingDraftConfig` — never threaded in
     * by the caller. A caller-supplied privacy switch is exactly the shape
     * of bug this fix closes (a page that forgets to thread it silently
     * fails open), so there is intentionally no way to pass one in here.
     */
    content?: {
      heroImageUrl?: string | null;
      specialtyLine?: string | null;
      bio?: string | null;
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
  isPreviewingDraftConfig = false,
  salonContentInput,
  previewBannerVariant,
}: PublicSalonPageShellProps) {
  // UX-OD-02 (Stage 1): owner-authored operational content — booking message,
  // policy, social links, quick facts, confirmation message — and the single
  // brand accent colour are UNIVERSAL. They are salon content, not premium
  // style, so no entitlement is consulted here. `resolveBookingExperience` is
  // the defensive canonical resolver: an absent field stays absent, so a salon
  // that authored nothing still renders exactly the neutral default it renders
  // today. Nothing is fabricated and no salon is auto-populated.
  //
  // Premium style (`stylePack` / `tokenOverrides`) lives in `bookingPageConfig`,
  // is currently writable-but-inert, and is deliberately NOT touched here. The
  // binding deferred invariant: the first PR that gives either field a
  // production renderer reader must add the premium entitlement boundary in
  // that same PR, before activation.
  let bookingExperience = resolveBookingExperience(null);

  try {
    bookingExperience = resolveBookingExperience(salon.settings);
  } catch {
    // Customization is optional. If resolution ever fails, keep public pages
    // available with the canonical, uncustomized experience.
  }

  const bookingExperienceStyles = pageName.startsWith('book-')
    ? getBookingExperienceCssVariables(bookingExperience.primaryColor)
    : {};
  const hasBookingColorOverride = Object.keys(bookingExperienceStyles).length > 0;

  // Post-launch privacy fix: resolved HERE, unconditionally, for every
  // caller — not threaded in by each page.tsx — so `locationDisplayMode`
  // can never silently default to `'full_address'` just because a given
  // public page (tech/time/confirm) never got around to resolving
  // `bookingPageContent` itself. `resolveBookingPageContent` is pure/
  // DB-free (it only parses `salon.settings`, already in hand), so calling
  // it here costs nothing and closes the gap for every current AND future
  // page that mounts this shell.
  const bookingPageContent = resolveBookingPageContent(salon.settings);
  const activeBookingPageContentSide = isPreviewingDraftConfig
    ? bookingPageContent.draft
    : bookingPageContent.live;

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
    content: {
      ...salonContentInput?.content,
      locationDisplayMode: activeBookingPageContentSide.locationDisplayMode,
    },
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
