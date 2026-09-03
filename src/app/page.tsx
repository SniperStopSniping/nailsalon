import { redirect } from 'next/navigation';

import { LusterHome } from '@/components/LusterHome';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { buildBookingUrl } from '@/libs/bookingParams';
import { AppConfig } from '@/utils/AppConfig';

export default function HomePage({
  searchParams,
}: {
  searchParams?: { salonSlug?: string };
}) {
  if (searchParams?.salonSlug) {
    redirect(buildBookingUrl('/book', {
      salonSlug: searchParams.salonSlug,
    }, { locale: AppConfig.defaultLocale }));
  }

  return <LusterHome locale={AppConfig.defaultLocale} websiteSetupEnabled={isOnboardingV1IntegrationEnabled()} />;
}
