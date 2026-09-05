import { notFound, redirect } from 'next/navigation';

import { BookingPageHub } from '@/components/admin/BookingPageHub';
import { getOnboardingSiteHandoff } from '@/features/onboarding-v1-integration/admin-handoff.server';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { getAdminSession, requireAdmin } from '@/libs/adminAuth';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { getSalonBySlug } from '@/libs/queries';

export const dynamic = 'force-dynamic';

export default async function WebsiteHubPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ salon?: string | string[] }>;
}) {
  const [{ locale: requestedLocale }, query] = await Promise.all([params, searchParams]);
  const locale = requestedLocale === 'fr' ? 'fr' : 'en';
  const admin = await getAdminSession();
  if (!admin) {
    redirect(`/${locale}/owner-sign-in`);
  }
  const slug = typeof query.salon === 'string' ? query.salon : '';
  if (!slug) {
    redirect(`/${locale}/admin`);
  }
  const salon = await getSalonBySlug(slug);
  if (!salon) {
    notFound();
  }
  const authorized = await requireAdmin(salon.id);
  if (!authorized.ok) {
    notFound();
  }
  const config = resolveBookingPageConfig(salon.settings);
  const content = resolveBookingPageContent(salon.settings);
  const handoff = isOnboardingV1IntegrationEnabled()
    ? await getOnboardingSiteHandoff({
      canEditSetup: admin.salons.some(item => item.salonId === salon.id && item.role === 'owner'),
      locale,
      salon,
    })
    : null;

  return (
    <BookingPageHub
      hasDraftChanges={JSON.stringify(config.draft) !== JSON.stringify(config.live) || JSON.stringify(content.draft) !== JSON.stringify(content.live)}
      locale={locale}
      published={salon.publicationStatus === 'published'}
      salonName={salon.name}
      salonSlug={salon.slug}
      setupUrl={handoff?.site.setupAvailable ? handoff.site.setupUrl : null}
    />
  );
}
