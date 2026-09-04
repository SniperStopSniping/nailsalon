import { Gift } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';
import { appendSalonSlug } from '@/libs/bookingParams';

export const metadata = {
  title: 'Rewards Unavailable',
  description: 'The rewards program is not currently available for this salon.',
};

export default async function RewardsDisabledPage(
  props: {
    searchParams: Promise<{ salonSlug?: string }>;
    params?: Promise<{ locale?: string; slug?: string }>;
  },
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
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
      ]}
      footer="The rewards program may be temporarily unavailable or not offered by this salon."
    />
  );
}
