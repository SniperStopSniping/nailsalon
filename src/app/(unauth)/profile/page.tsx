import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getPageAppearance } from '@/libs/pageAppearance';

import ProfileContent from './ProfileContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';

/**
 * Profile Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function ProfilePage() {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'profile');

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="profile">
      <ProfileContent />
    </PageThemeWrapper>
  );
}
