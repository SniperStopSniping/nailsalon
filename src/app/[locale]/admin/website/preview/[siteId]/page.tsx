import { notFound, redirect } from 'next/navigation';

import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import {
  onboardingCompiledSiteDocumentSchema,
  onboardingPersistedSnapshotSchema,
} from '@/features/onboarding-v1-integration/contracts';
import { getClaimedOnboardingSite } from '@/features/onboarding-v1-integration/persistence.server';
import {
  createSavedSitePreviewModel,
  type SavedPreviewMediaRecord,
} from '@/features/onboarding-v1-integration/saved-preview';
import { getAdminSession } from '@/libs/adminAuth';

import { SavedSitePreviewClient } from './SavedSitePreviewClient';

export const dynamic = 'force-dynamic';

type SavedWebsitePreviewPageProps = {
  params: { locale: string; siteId: string };
  searchParams: { audit?: string | string[]; embed?: string | string[] };
};

const queryEnabled = (value: string | string[] | undefined): boolean =>
  (Array.isArray(value) ? value[0] : value) === '1';

export default async function SavedWebsitePreviewPage({
  params,
  searchParams,
}: SavedWebsitePreviewPageProps) {
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
  const media: SavedPreviewMediaRecord[] = claimed.media.flatMap((item) => {
    if (
      item.claimStatus !== 'ready'
      || !item.storageKey
      || !item.publicUrl
      || !item.publicUrl.startsWith('/api/onboarding/v1/media/')
    ) {
      return [];
    }
    const metadataByteSize = item.metadata.byteSize;
    return [{
      altText: item.altText,
      assetId: item.id,
      fileName: item.fileName,
      fileSize: item.fileSize
        ?? (typeof metadataByteSize === 'number' ? metadataByteSize : null),
      height: item.height,
      localItemId: item.localItemId,
      mimeType: item.mimeType,
      publicUrl: `/api/onboarding/v1/media/${encodeURIComponent(item.id)}`,
      role: item.role,
      sortOrder: item.sortOrder,
      width: item.width,
    }];
  });
  const setupUrl = `/${locale}/onboarding-v1?resume=review&site=${encodeURIComponent(claimed.site.id)}`;

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
      setupUrl={setupUrl}
      showAuditRevision={
        process.env.NODE_ENV !== 'production'
        && queryEnabled(searchParams.audit)
      }
    />
  );
}
