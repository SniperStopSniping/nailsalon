import { redirect } from 'next/navigation';

import { getLatestAutopostFailure, getSalonPolicy, getSuperAdminPolicy } from '@/core/appointments/policyRepo';
import { requireAdminSalonForSlug } from '@/libs/adminAuth';

import { SalonPoliciesClient } from './client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Policy Settings | Admin',
  description: 'Configure photo requirements and auto-posting',
};

/** The salon this page edits comes from the URL when the URL names one. */
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

export default async function SalonPoliciesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedSlug = readSalonParam(resolvedSearchParams);

  // AG-w2-settings-integrations-07: the URL names the salon this page writes
  // to. It used to be ignored, so a link naming salon A edited whichever salon
  // the active-salon cookie held. The requested slug now wins after the
  // caller's membership is checked, and an unauthorised slug is refused in
  // words instead of quietly editing a different salon.
  const { salon, error } = await requireAdminSalonForSlug(requestedSlug, {
    persistActiveSalon: false,
  });

  if (error && error.status === 401) {
    redirect(`/${locale}/admin-login`);
  }

  if (error || !salon) {
    return (
      <div className="min-h-screen bg-[#F2F2F7]">
        <div className="mx-auto max-w-2xl px-4 py-10">
          <div
            className="rounded-[14px] border border-amber-200 bg-amber-50 p-5 text-amber-950"
            role="alert"
          >
            <h1 className="text-lg font-semibold">
              You cannot edit this salon
            </h1>
            <p className="mt-2 text-sm leading-6">
              {requestedSlug
                ? `This link asks for “${requestedSlug}”, which is not a salon your account manages. Nothing was changed.`
                : 'Your account does not manage a salon yet, so there is no policy to edit.'}
            </p>
            <a
              className="mt-4 inline-flex rounded-[10px] bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white"
              href={`/${locale}/admin`}
            >
              Back to the dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }

  const salonId = salon.id;
  const salonName = salon.name;

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
      salonSlug={salon.slug}
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
