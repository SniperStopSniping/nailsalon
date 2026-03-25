import { getPublicPageContext } from '@/libs/tenant';

import AppointmentHistoryContent from './AppointmentHistoryContent';

export default async function AppointmentHistoryPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('appointments-history', searchParams, params);
  const { salon } = context;

  return (
    <AppointmentHistoryContent
      salonName={salon.name}
      salonSlug={salon.slug}
    />
  );
}
