import { redirect } from 'next/navigation';

import { buildBookingUrl } from '@/libs/bookingParams';
import { AppConfig } from '@/utils/AppConfig';

export default function HomePage({
  searchParams,
}: {
  searchParams?: { salonSlug?: string };
}) {
  redirect(buildBookingUrl('/book', {
    salonSlug: searchParams?.salonSlug ?? null,
  }, searchParams?.salonSlug
    ? { locale: AppConfig.defaultLocale }
    : undefined));
}
