import { redirect } from 'next/navigation';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { buildTenantRedirectPath, checkFeatureEnabled } from '@/libs/salonStatus';
import { getPublicPageContext } from '@/libs/tenant';

import RewardsContent from './RewardsContent';

export const dynamic = 'force-dynamic';

/**
 * Rewards Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function RewardsPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('rewards', searchParams, params);
  const tenantRoute = {
    salonSlug: context.salon.slug,
    routeSalonSlug: params?.slug,
    locale: params?.locale,
  };

  // Check if rewards are enabled for this salon
  const featureCheck = await checkFeatureEnabled(context.salon.id, 'rewards');
  const featureRedirectPath = buildTenantRedirectPath(featureCheck.redirectPath, tenantRoute);
  if (featureRedirectPath) {
    redirect(featureRedirectPath);
  }

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="rewards"
      salon={context.salon}
    >
      <RewardsContent />
    </PublicSalonPageShell>
  );
}
