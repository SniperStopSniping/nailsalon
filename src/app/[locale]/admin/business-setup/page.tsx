import { notFound } from 'next/navigation';

import { requireSetupOwner } from '@/features/business-setup/access.server';
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
    notFound();
  }
  return <SetupEditor key={access.salon.id} salonSlug={access.salon.slug} locale={locale} aiEnabled={access.aiEnabled} existingSalon={access.salon.publicationStatus === 'published'} />;
}
