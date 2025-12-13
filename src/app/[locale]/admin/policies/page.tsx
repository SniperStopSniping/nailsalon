import { redirect } from 'next/navigation';

import { getLatestAutopostFailure, getSalonPolicy, getSuperAdminPolicy } from '@/core/appointments/policyRepo';
import { getAdminSession } from '@/libs/adminAuth';

import { SalonPoliciesClient } from './client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Policy Settings | Admin',
  description: 'Configure photo requirements and auto-posting',
};

export default async function SalonPoliciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Check admin auth
  const admin = await getAdminSession();
  if (!admin) {
    redirect(`/${locale}/admin-login`);
  }

  // Get admin's salon
  const salonMembership = admin.salons[0];
  if (!salonMembership) {
    redirect(`/${locale}/admin-login`);
  }

  const salonId = salonMembership.salonId;
  const salonName = salonMembership.salonName;

  // Fetch policies and latest failure
  const [salonPolicy, superAdminPolicy, latestFailure] = await Promise.all([
    getSalonPolicy(undefined, salonId),
    getSuperAdminPolicy(),
    getLatestAutopostFailure(undefined, { salonId }),
  ]);

  // Get Meta status from env (presence only, not values)
  const metaStatus = {
    hasSystemUserToken: !!process.env.META_SYSTEM_USER_TOKEN,
    hasFacebookPageId: !!process.env.META_FACEBOOK_PAGE_ID,
    hasInstagramAccountId: !!process.env.META_INSTAGRAM_ACCOUNT_ID,
    graphVersion: process.env.META_GRAPH_VERSION ?? 'v19.0',
  };

  return (
    <SalonPoliciesClient
      initialSalonPolicy={{
        requireBeforePhotoToStart: salonPolicy.requireBeforePhotoToStart as 'off' | 'optional' | 'required',
        requireAfterPhotoToFinish: salonPolicy.requireAfterPhotoToFinish as 'off' | 'optional' | 'required',
        requireAfterPhotoToPay: salonPolicy.requireAfterPhotoToPay as 'off' | 'optional' | 'required',
        autoPostEnabled: salonPolicy.autoPostEnabled,
        autoPostPlatforms: salonPolicy.autoPostPlatforms as Array<'instagram' | 'facebook' | 'tiktok'>,
        autoPostIncludePrice: salonPolicy.autoPostIncludePrice,
        autoPostIncludeColor: salonPolicy.autoPostIncludeColor,
        autoPostIncludeBrand: salonPolicy.autoPostIncludeBrand,
        autoPostAiCaptionEnabled: salonPolicy.autoPostAiCaptionEnabled,
      }}
      superAdminPolicy={{
        requireBeforePhotoToStart: superAdminPolicy.requireBeforePhotoToStart as 'off' | 'optional' | 'required' | null,
        requireAfterPhotoToFinish: superAdminPolicy.requireAfterPhotoToFinish as 'off' | 'optional' | 'required' | null,
        requireAfterPhotoToPay: superAdminPolicy.requireAfterPhotoToPay as 'off' | 'optional' | 'required' | null,
        autoPostEnabled: superAdminPolicy.autoPostEnabled,
        autoPostAiCaptionEnabled: superAdminPolicy.autoPostAiCaptionEnabled,
      }}
      salonName={salonName}
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
