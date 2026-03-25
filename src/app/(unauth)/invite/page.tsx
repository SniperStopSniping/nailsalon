import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getPublicPageContext } from '@/libs/tenant';

import InviteContent from './InviteContent';

/**
 * Invite Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function InvitePage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('invite', searchParams, params);

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="invite"
      salon={context.salon}
    >
      <InviteContent />
    </PublicSalonPageShell>
  );
}
