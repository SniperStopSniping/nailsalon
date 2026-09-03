import { redirect } from 'next/navigation';

import { LusterHome } from '@/components/LusterHome';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { buildBookingUrl } from '@/libs/bookingParams';
import { AppConfig } from '@/utils/AppConfig';

export default function IndexPage(props: {
  params: { locale: string };
  searchParams?: { salonSlug?: string };
}) {
  const locale = props.params.locale;
  if (!props.searchParams?.salonSlug) {
    return <LusterHome locale={locale} websiteSetupEnabled={isOnboardingV1IntegrationEnabled()} />;
  }
  const target = buildBookingUrl(
    locale === AppConfig.defaultLocale ? '/book' : `/${locale}/book`,
    {
      salonSlug: props.searchParams.salonSlug,
    },
    { locale },
  );

  redirect(target);
}
