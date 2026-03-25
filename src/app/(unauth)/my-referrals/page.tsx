import { getPublicPageContext } from '@/libs/tenant';

import MyReferralsContent from './MyReferralsContent';

export default async function MyReferralsPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('my-referrals', searchParams, params);
  const { salon } = context;

  return (
    <MyReferralsContent
      salonName={salon.name}
      salonSlug={salon.slug}
    />
  );
}
