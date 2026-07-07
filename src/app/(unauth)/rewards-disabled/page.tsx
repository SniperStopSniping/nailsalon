import { Gift } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';
import { appendSalonSlug } from '@/libs/bookingParams';

export const metadata = {
  title: 'Rewards Unavailable',
  description: 'The rewards program is not currently available for this salon.',
};

export default function RewardsDisabledPage({
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
      icon={Gift}
      title="Rewards Program Unavailable"
      description="The rewards program is not currently available for this salon. Please contact the salon directly for information about promotions and special offers."
      actions={[
        {
          label: 'Book an Appointment',
          href: appendSalonSlug('/book', resolvedSalonSlug, tenantRoute),
          primary: true,
        },
        {
          label: 'Back to Profile',
          href: appendSalonSlug('/profile', resolvedSalonSlug, tenantRoute),
        },
      ]}
      footer="The rewards program may be temporarily unavailable or not offered by this salon."
    />
  );
}
