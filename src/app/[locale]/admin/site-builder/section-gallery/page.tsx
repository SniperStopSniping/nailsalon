import { notFound, redirect } from 'next/navigation';

import { isSectionLibraryV1Enabled } from '@/features/section-library-v1/config.server';
import { requireAdminSalonForSlug } from '@/libs/adminAuth';

import { SectionGalleryClient } from './SectionGalleryClient';

export const dynamic = 'force-dynamic';

type SectionGalleryPageProps = {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** The salon this page previews comes from the URL when the URL names one. */
function readSalonParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | null {
  for (const key of ['salon', 'salonSlug'] as const) {
    const value = searchParams?.[key];
    const slug = (Array.isArray(value) ? value[0] : value)?.trim();
    if (slug) {
      return slug;
    }
  }
  return null;
}

export default async function SectionGalleryPage(props: SectionGalleryPageProps) {
  const params = await props.params;
  if (!isSectionLibraryV1Enabled()) {
    notFound();
  }
  const locale = params.locale === 'fr' ? 'fr' : 'en';

  /*
    AG-w2-settings-integrations-15: an authenticated admin session was the only
    gate here, so any signed-in admin — including one who manages no salon —
    reached a page that previews salon-shaped content. The same salon guard the
    rest of the workspace uses now applies: the caller must manage a salon, and
    a `?salon=` they do not manage is refused rather than answered from the
    active-salon cookie.
  */
  const requestedSlug = readSalonParam(await props.searchParams);
  const { salon, error } = await requireAdminSalonForSlug(requestedSlug, {
    persistActiveSalon: false,
  });

  if (error?.status === 401) {
    redirect(`/${locale}/owner-sign-in`);
  }

  if (error || !salon) {
    notFound();
  }

  return <SectionGalleryClient />;
}
