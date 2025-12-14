import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getPageAppearance } from '@/libs/pageAppearance';
import { getSalonBySlug, getTechniciansBySalonId } from '@/libs/queries';

import PreferencesContent from './PreferencesContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Preferences Page (Server Component)
 *
 * Fetches page appearance settings and technicians, conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function PreferencesPage() {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'preferences');

  // Fetch salon and technicians from database
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);
  const technicians = salon ? await getTechniciansBySalonId(salon.id) : [];

  // Map to the shape expected by the client component
  const technicianData = technicians.map(tech => ({
    id: tech.id,
    name: tech.name,
    image: tech.avatarUrl || '/assets/images/default-avatar.png',
  }));

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="preferences">
      <PreferencesContent technicians={technicianData} />
    </PageThemeWrapper>
  );
}
