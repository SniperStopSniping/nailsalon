import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getPageAppearance } from '@/libs/pageAppearance';

import RewardsContent from './RewardsContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';

/**
 * Rewards Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function RewardsPage() {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'rewards');

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="rewards">
      <RewardsContent />
    </PageThemeWrapper>
  );
}
