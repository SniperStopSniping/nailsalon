import { notFound } from 'next/navigation';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveDraftSalonAccess } from '@/libs/ownerPreview';
import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import { getResolvedSalon } from '@/libs/tenant';
import type { SalonStatus } from '@/models/Schema';
import { SalonProvider } from '@/providers/SalonProvider';
import { ThemeProvider } from '@/theme';

export const dynamic = 'force-dynamic';

export default async function SlugTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string; slug: string };
}) {
  const salon = await getResolvedSalon(undefined, params);
  if (!salon) {
    notFound();
  }

  // Single owner-preview authorization matrix (Luster UI/UX plan rev 3, PR3;
  // engineering risk 5: "the owner-preview bypass touches the public 404
  // gate, a mistake publishes drafts to the world"). This one call decides
  // both whether an unpublished salon 404s for everyone except its owner /
  // an authorized impersonating super admin, AND which side of the PR2
  // bookingPage draft/live pair gets resolved below — never two independent
  // checks that could drift apart.
  //
  // This layout only resolves the gate and threads its result into
  // SalonProvider — it does NOT render PreviewBanner. `PublicSalonPageShell`
  // is the single owner of banner rendering for every public page, because
  // the real `[locale]/[slug]/book/*` routes are re-exports of the
  // `(unauth)/book/*` page components and are physically nested under this
  // layout, so a banner rendered here and a banner rendered by
  // PublicSalonPageShell inside those pages would both mount for the same
  // request. See `PublicSalonPageShell.tsx` for where the banner actually
  // renders.
  const previewGate = await resolveDraftSalonAccess({
    id: salon.id,
    publicationStatus: salon.publicationStatus,
    freeSoloEnabled: salon.freeSoloEnabled,
  });

  if (!previewGate.allowed) {
    notFound();
  }

  const bookingPageConfig = resolveBookingPageConfig(salon.settings);
  const bookingTimeZone = resolveBookingConfigFromSettings(salon.settings).timezone;
  const activeBookingPageSide = previewGate.isPreviewingDraftConfig
    ? bookingPageConfig.draft
    : bookingPageConfig.live;

  return (
    <ThemeProvider themeKey={salon?.themeKey ?? undefined}>
      <SalonProvider
        salonId={salon?.id}
        salonName={salon?.name}
        salonSlug={salon?.slug}
        themeKey={salon?.themeKey ?? undefined}
        status={(salon?.status ?? null) as SalonStatus | null}
        bookingTimeZone={bookingTimeZone}
        bookingPage={activeBookingPageSide}
        ownerPreview={{
          isPreviewing: previewGate.isPreviewingDraftSalon || previewGate.isPreviewingDraftConfig,
          actorType: previewGate.actorType,
        }}
      >
        {children}
        {salon.freeSoloEnabled && (
          <footer
            data-testid="public-salon-footer"
            className="border-t border-stone-200 bg-white p-4 text-center text-xs text-stone-500"
            style={{ marginBottom: 'var(--service-sticky-footer-clearance, 0px)' }}
          >
            Free booking by
            {' '}
            <a href="https://lusterstudio.ca" className="inline-flex min-h-11 min-w-11 items-center justify-center font-semibold text-stone-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Luster</a>
            <span className="mx-2">·</span>
            <a href={`/${params.locale}/${params.slug}/find-booking`} className="inline-flex min-h-11 items-center font-semibold text-stone-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Find my booking</a>
            <span className="mx-2">·</span>
            <a href={`${getCanonicalAppOrigin()}/owner`} className="inline-flex min-h-11 items-center font-semibold text-stone-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Salon owner login</a>
          </footer>
        )}
      </SalonProvider>
    </ThemeProvider>
  );
}
