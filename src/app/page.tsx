import { redirect } from 'next/navigation';

import { LusterHome } from '@/components/LusterHome';
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

  return <LusterHome locale={AppConfig.defaultLocale} />;
}
