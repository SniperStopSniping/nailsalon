import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getPublicPageContext } from '@/libs/tenant';

import GalleryContent from './GalleryContent';

/**
 * Gallery Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function GalleryPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('gallery', searchParams, params);

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="gallery"
      salon={context.salon}
    >
      <GalleryContent />
    </PublicSalonPageShell>
  );
}
