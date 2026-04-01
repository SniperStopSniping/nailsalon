import { redirect } from 'next/navigation';

import { buildTenantRedirectPath, checkFeatureEnabled } from '@/libs/salonStatus';
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
  const featureCheck = await checkFeatureEnabled(salon.id, 'referrals');
  const featureRedirectPath = buildTenantRedirectPath(featureCheck.redirectPath, {
    salonSlug: salon.slug,
    routeSalonSlug: params?.slug,
    locale: params?.locale,
  });

  if (featureRedirectPath) {
    redirect(featureRedirectPath);
  }

  return (
    <MyReferralsContent
      salonName={salon.name}
      salonSlug={salon.slug}
    />
  );
}
