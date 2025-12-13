import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getPageAppearance } from '@/libs/pageAppearance';

import PreferencesContent from './PreferencesContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';

/**
 * Preferences Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function PreferencesPage() {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'preferences');

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="preferences">
      <PreferencesContent />
    </PageThemeWrapper>
  );
}
