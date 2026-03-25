import { redirect } from 'next/navigation';

import { buildBookingUrl } from '@/libs/bookingParams';
import { AppConfig } from '@/utils/AppConfig';

export default function IndexPage(props: {
  params: { locale: string };
  searchParams?: { salonSlug?: string };
}) {
  const locale = props.params.locale;
  const target = buildBookingUrl(
    locale === AppConfig.defaultLocale ? '/book' : `/${locale}/book`,
    {
      salonSlug: props.searchParams?.salonSlug ?? null,
    },
    props.searchParams?.salonSlug
      ? { locale }
      : undefined,
  );

  redirect(target);
}
