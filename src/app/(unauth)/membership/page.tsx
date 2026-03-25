import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getPublicPageContext } from '@/libs/tenant';

import MembershipContent from './MembershipContent';

/**
 * Membership Benefits Page (Server Component)
 *
 * Displays user's membership tier, progress to next tier,
 * and all unlocked/locked member perks.
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function MembershipPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('membership', searchParams, params);

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="membership"
      salon={context.salon}
    >
      <MembershipContent />
    </PublicSalonPageShell>
  );
}
