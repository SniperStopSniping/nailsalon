import { renderBookServicePage } from '@/app/(unauth)/book/service/BookServicePageServer';

export const dynamic = 'force-dynamic';

type OwnerBookingPagePreviewProps = {
  searchParams: Promise<{
    locationId?: string;
    salonSlug?: string;
    campaign?: string;
    builderPreview?: string | string[];
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
 */
export default async function OwnerBookingPagePreview(props: OwnerBookingPagePreviewProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  return renderBookServicePage({
    searchParams,
    params,
  }, { requireOwnerDraftPreview: true });
}
