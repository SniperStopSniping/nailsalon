import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getPageAppearance } from '@/libs/pageAppearance';

import InviteContent from './InviteContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';

/**
 * Invite Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function InvitePage() {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'invite');

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="invite">
      <InviteContent />
    </PageThemeWrapper>
  );
}
