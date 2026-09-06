import { renderBookServicePage } from '@/app/(unauth)/book/service/BookServicePageServer';
import { getI18nPath } from '@/utils/Helpers';

import { OwnerDraftPreviewChrome } from './OwnerDraftPreviewChrome';

export const dynamic = 'force-dynamic';

type OwnerBookingPagePreviewProps = {
  searchParams: Promise<{
    locationId?: string;
    salonSlug?: string;
    campaign?: string;
    builderPreview?: string | string[];
    ownerChrome?: string | string[];
    presetPreview?: string;
    presetPreviewVersion?: string;
  }>;
  params: Promise<{ locale: string; slug: string }>;
};

/**
 * Private Owner DRAFT preview entrypoint.
 *
 * The route itself owns no presentation code: after an exact salon-scoped
 * server authorization it invokes the existing canonical service page. Its
 * location under /admin is intentional so middleware can establish Clerk
 * context on the dashboard origin without teaching the public booking route
 * to understand a privileged query flag or exposing a reusable draft token.
 *
 * AG-hub-publish-08 adds owner chrome (back-to-editor + a width switcher)
 * AROUND that render, never inside it — `renderBookServicePage` still returns
 * the untouched customer markup and still performs the whole authorization
 * (`notFound()` for anyone who is not the owner) before any chrome exists.
 * The chrome is suppressed for the two embedded uses of this same route so
 * they stay exactly what they were: the editor's live-preview iframe
 * (`builderPreview=…`) and the width frames the chrome itself mounts
 * (`ownerChrome=0`).
 */
export default async function OwnerBookingPagePreview(props: OwnerBookingPagePreviewProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const content = await renderBookServicePage({
    searchParams,
    params,
  }, { requireOwnerDraftPreview: true });

  const ownerChrome = Array.isArray(searchParams.ownerChrome)
    ? searchParams.ownerChrome[0]
    : searchParams.ownerChrome;
  if (searchParams.builderPreview !== undefined || ownerChrome === '0') {
    return content;
  }

  const previewPath = getI18nPath(
    `/admin/booking-page/preview/${encodeURIComponent(params.slug)}`,
    params.locale,
  );
  const frameQuery = new URLSearchParams({ ownerChrome: '0' });
  if (searchParams.locationId) {
    frameQuery.set('locationId', searchParams.locationId);
  }

  return (
    <OwnerDraftPreviewChrome
      editorUrl={`/${params.locale}/admin/website?salon=${encodeURIComponent(params.slug)}#preview-draft`}
      frameSrc={`${previewPath}?${frameQuery.toString()}`}
    >
      {content}
    </OwnerDraftPreviewChrome>
  );
}
