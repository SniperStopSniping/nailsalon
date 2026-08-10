import { notFound } from 'next/navigation';

import { PreviewBanner } from '@/components/PreviewBanner';
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
  const previewGate = await resolveDraftSalonAccess({
    id: salon.id,
    publicationStatus: salon.publicationStatus,
    freeSoloEnabled: salon.freeSoloEnabled,
  });

  if (!previewGate.allowed) {
    notFound();
  }

  const bookingPageConfig = resolveBookingPageConfig(salon.settings);
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
        bookingPage={activeBookingPageSide}
        ownerPreview={{
          isPreviewing: previewGate.isPreviewingDraftSalon || previewGate.isPreviewingDraftConfig,
          actorType: previewGate.actorType,
        }}
      >
        {previewGate.isPreviewingDraftSalon && <PreviewBanner variant="draft-salon" />}
        {!previewGate.isPreviewingDraftSalon && previewGate.isPreviewingDraftConfig && (
          <PreviewBanner variant="draft-config" />
        )}
        {children}
        {salon.freeSoloEnabled && (
          <footer
            data-testid="public-salon-footer"
            className="border-t border-stone-200 bg-white p-4 text-center text-xs text-stone-500"
            style={{ marginBottom: 'var(--service-sticky-footer-clearance, 0px)' }}
          >
            Free booking by
            {' '}
            <a href="https://lusterstudio.ca" className="font-semibold text-stone-700 underline underline-offset-2">Luster</a>
            <span className="mx-2">·</span>
            <a href={`/${params.locale}/${params.slug}/find-booking`} className="font-semibold text-stone-700 underline underline-offset-2">Find my booking</a>
            <span className="mx-2">·</span>
            <a href={`${getCanonicalAppOrigin()}/owner`} className="font-semibold text-stone-700 underline underline-offset-2">Salon owner login</a>
          </footer>
        )}
      </SalonProvider>
    </ThemeProvider>
  );
}
