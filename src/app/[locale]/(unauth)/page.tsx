import { redirect } from 'next/navigation';

import { LusterHome } from '@/components/LusterHome';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { buildBookingUrl } from '@/libs/bookingParams';
import { AppConfig } from '@/utils/AppConfig';

export default async function IndexPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams?: Promise<{ salonSlug?: string }>;
  },
) {
  const locale = (await props.params).locale;
  const searchParams = await props.searchParams;
  if (!searchParams?.salonSlug) {
    return <LusterHome locale={locale} websiteSetupEnabled={isOnboardingV1IntegrationEnabled()} />;
  }
  const target = buildBookingUrl(
    locale === AppConfig.defaultLocale ? '/book' : `/${locale}/book`,
    {
      salonSlug: searchParams.salonSlug,
    },
    { locale },
  );

  redirect(target);
}
