import { redirect } from 'next/navigation';

import { LusterHome } from '@/components/LusterHome';
import { buildBookingUrl } from '@/libs/bookingParams';
import { AppConfig } from '@/utils/AppConfig';

export default function IndexPage(props: {
  params: { locale: string };
  searchParams?: { salonSlug?: string };
}) {
  const locale = props.params.locale;
  if (!props.searchParams?.salonSlug) {
    return <LusterHome locale={locale} />;
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
