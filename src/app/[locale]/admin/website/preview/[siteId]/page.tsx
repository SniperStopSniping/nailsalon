import { notFound, redirect } from 'next/navigation';

import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import {
  onboardingCompiledSiteDocumentSchema,
  onboardingPersistedSnapshotSchema,
} from '@/features/onboarding-v1-integration/contracts';
import { getClaimedOnboardingSite } from '@/features/onboarding-v1-integration/persistence.server';
import {
  createSavedPreviewMediaRecords,
  createSavedSitePreviewModel,
} from '@/features/onboarding-v1-integration/saved-preview';
import { getAdminSession } from '@/libs/adminAuth';

import { SavedSitePreviewClient } from './SavedSitePreviewClient';

export const dynamic = 'force-dynamic';

type SavedWebsitePreviewPageProps = {
  params: Promise<{ locale: string; siteId: string }>;
  searchParams: Promise<{ audit?: string | string[]; embed?: string | string[] }>;
};

const queryEnabled = (value: string | string[] | undefined): boolean =>
  (Array.isArray(value) ? value[0] : value) === '1';

export default async function SavedWebsitePreviewPage(props: SavedWebsitePreviewPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (!isOnboardingV1IntegrationEnabled()) {
    notFound();
  }
  const locale = params.locale === 'fr' ? 'fr' : 'en';
  const admin = await getAdminSession();
  if (!admin) {
    redirect(`/${locale}/owner-sign-in`);
  }
  const claimed = await getClaimedOnboardingSite({
    adminId: admin.id,
    siteId: params.siteId,
  });
  if (!claimed) {
    notFound();
  }
  const [snapshot, document] = [
    onboardingPersistedSnapshotSchema.safeParse(claimed.revision.snapshot),
    onboardingCompiledSiteDocumentSchema.safeParse(claimed.revision.document),
  ];
  if (!snapshot.success || !document.success) {
    notFound();
  }
  const media = createSavedPreviewMediaRecords(claimed.media);
  const setupUrl = `/${locale}/onboarding-v1?resume=review&site=${encodeURIComponent(claimed.site.id)}&revision=${claimed.revision.revision}`;

  return (
    <SavedSitePreviewClient
      embedded={queryEnabled(searchParams.embed)}
      locale={locale}
      model={createSavedSitePreviewModel({
        document: document.data,
        media,
        snapshot: snapshot.data,
      })}
      revision={claimed.revision.revision}
      salonSlug={claimed.site.salonSlug}
      siteId={claimed.site.id}
      setupAvailable={claimed.site.salonPublicationStatus !== 'published'}
      setupUrl={setupUrl}
      showAuditRevision={
        process.env.NODE_ENV !== 'production'
        && queryEnabled(searchParams.audit)
      }
    />
  );
}
