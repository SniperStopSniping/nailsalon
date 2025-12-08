import { getPageAppearance } from '@/libs/pageAppearance';
import { PageThemeWrapper } from '@/components/PageThemeWrapper';

import MembershipContent from './MembershipContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';

/**
 * Membership Benefits Page (Server Component)
 *
 * Displays user's membership tier, progress to next tier,
 * and all unlocked/locked member perks.
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function MembershipPage() {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'membership');

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="membership">
      <MembershipContent />
    </PageThemeWrapper>
  );
}
