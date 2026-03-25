import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getTechniciansBySalonId } from '@/libs/queries';
import { getPublicPageContext } from '@/libs/tenant';

import PreferencesContent from './PreferencesContent';

export const dynamic = 'force-dynamic';

/**
 * Preferences Page (Server Component)
 *
 * Fetches page appearance settings and technicians, conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function PreferencesPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('preferences', searchParams, params);
  const technicians = await getTechniciansBySalonId(context.salon.id);

  // Map to the shape expected by the client component
  const technicianData = technicians.map(tech => ({
    id: tech.id,
    name: tech.name,
    image: tech.avatarUrl || '/assets/images/default-avatar.png',
  }));

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="preferences"
      salon={context.salon}
    >
      <PreferencesContent technicians={technicianData} />
    </PublicSalonPageShell>
  );
}
