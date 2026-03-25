import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getPublicPageContext } from '@/libs/tenant';

import ProfileContent from './ProfileContent';

/**
 * Profile Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function ProfilePage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('profile', searchParams, params);

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="profile"
      salon={context.salon}
    >
      <ProfileContent />
    </PublicSalonPageShell>
  );
}
