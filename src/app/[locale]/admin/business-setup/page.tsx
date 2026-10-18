import { notFound } from 'next/navigation';

import { aiCreditsEnabled } from '@/features/ai-credits/config.server';
import { requireSetupOwner } from '@/features/business-setup/access.server';
import { ClerkSetupSession } from '@/features/business-setup/ClerkSetupSession';
import { RecoverSetupSession } from '@/features/business-setup/RecoverSetupSession';
import { SetupEditor } from '@/features/business-setup/SetupEditor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function BusinessSetupPage(props: {
  searchParams: Promise<{
    salon?: string;
  }>;
  params: Promise<{
    locale: string;
  }>;
}) {
  const { salon } = await props.searchParams;
  const { locale } = await props.params;
  if (!salon) {
    notFound();
  }
  const access = await requireSetupOwner(salon);
  if (access.response) {
    if (access.response.status === 401) {
      return <RecoverSetupSession locale={locale} />;
    }
    notFound();
  }
  const editor = <SetupEditor key={access.salon.id} salonSlug={access.salon.slug} locale={locale} aiEnabled={access.aiEnabled} creditsEnabled={aiCreditsEnabled()} existingSalon={access.salon.publicationStatus === 'published'} />;
  // Legacy sessions deliberately bypass SDK readiness; their existing cookie
  // and server ownership checks remain authoritative, even without Clerk JS.
  return access.clerkUserId ? <ClerkSetupSession userId={access.clerkUserId} locale={locale}>{editor}</ClerkSetupSession> : editor;
}
