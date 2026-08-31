import { notFound, redirect } from 'next/navigation';

import { isSectionLibraryV1Enabled } from '@/features/section-library-v1/config.server';
import { getAdminSession } from '@/libs/adminAuth';

import { SectionGalleryClient } from './SectionGalleryClient';

export const dynamic = 'force-dynamic';

type SectionGalleryPageProps = {
  params: { locale: string };
};

export default async function SectionGalleryPage({
  params,
}: SectionGalleryPageProps) {
  if (!isSectionLibraryV1Enabled()) {
    notFound();
  }
  const locale = params.locale === 'fr' ? 'fr' : 'en';
  const admin = await getAdminSession();
  if (!admin) {
    redirect(`/${locale}/owner-sign-in`);
  }

  return <SectionGalleryClient />;
}
