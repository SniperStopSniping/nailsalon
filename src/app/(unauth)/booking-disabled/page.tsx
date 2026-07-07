import { CalendarX } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';
import { appendSalonSlug } from '@/libs/bookingParams';

export const metadata = {
  title: 'Online Booking Unavailable',
  description: 'Online booking is not currently available for this salon.',
};

export default function BookingDisabledPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const resolvedSalonSlug = params?.slug ?? searchParams.salonSlug;
  const tenantRoute = { routeSalonSlug: params?.slug, locale: params?.locale };

  return (
    <SalonStatusPage
      icon={CalendarX}
      title="Online Booking Unavailable"
      description="This salon is not currently accepting online bookings. Please contact the salon directly to schedule your appointment."
      actions={[
        {
          label: 'Back to Profile',
          href: appendSalonSlug('/profile', resolvedSalonSlug, tenantRoute),
        },
      ]}
      footer="Online booking may be temporarily unavailable or not offered by this salon."
    />
  );
}
