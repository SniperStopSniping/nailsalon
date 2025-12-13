import { redirect } from 'next/navigation';

import { getLatestAutopostFailure, getSuperAdminPolicy } from '@/core/appointments/policyRepo';
import { isSuperAdmin } from '@/libs/superAdmin';

import { SuperAdminPoliciesClient } from './client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Global Policies | Super Admin',
  description: 'Configure platform-wide policy overrides',
};

export default async function SuperAdminPoliciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const isSuper = await isSuperAdmin();

  if (!isSuper) {
    redirect(`/${locale}/admin-login`);
  }

  // Fetch policy and latest failure
  const [policy, latestFailure] = await Promise.all([
    getSuperAdminPolicy(),
    getLatestAutopostFailure(),
  ]);

  // Get Meta status from env (presence only, not values)
  const metaStatus = {
    hasSystemUserToken: !!process.env.META_SYSTEM_USER_TOKEN,
    hasFacebookPageId: !!process.env.META_FACEBOOK_PAGE_ID,
    hasInstagramAccountId: !!process.env.META_INSTAGRAM_ACCOUNT_ID,
    graphVersion: process.env.META_GRAPH_VERSION ?? 'v19.0',
  };

  return (
    <SuperAdminPoliciesClient
      initialPolicy={{
        requireBeforePhotoToStart: policy.requireBeforePhotoToStart as 'off' | 'optional' | 'required' | null,
        requireAfterPhotoToFinish: policy.requireAfterPhotoToFinish as 'off' | 'optional' | 'required' | null,
        requireAfterPhotoToPay: policy.requireAfterPhotoToPay as 'off' | 'optional' | 'required' | null,
        autoPostEnabled: policy.autoPostEnabled,
        autoPostAiCaptionEnabled: policy.autoPostAiCaptionEnabled,
      }}
      metaStatus={metaStatus}
      latestFailure={latestFailure
        ? {
            platform: latestFailure.platform,
            error: latestFailure.error,
            retryCount: latestFailure.retryCount,
            processedAt: latestFailure.processedAt?.toISOString() ?? null,
          }
        : null}
      locale={locale}
    />
  );
}
