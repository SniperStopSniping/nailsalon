import { notFound, redirect } from 'next/navigation';

import { businessSetupSelfServeEnabled } from '@/features/business-setup/access.server';
import { linkedOnboardingCanvaDraft } from '@/features/custom-sites/manual-origin.server';
import { getOnboardingAuthProviderAvailability } from '@/features/onboarding-v1-integration/auth-providers.server';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { OnboardingV1Integration } from '@/features/onboarding-v1-integration/OnboardingV1Integration';
import { getClaimedOnboardingSite } from '@/features/onboarding-v1-integration/persistence.server';
import { loadInitialOnboardingResumeDraft } from '@/features/onboarding-v1-integration/resume.server';
import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';

export const dynamic = 'force-dynamic';

type OnboardingV1PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    resume?: string | string[];
    revision?: string | string[];
    site?: string | string[];
  }>;
};

const firstQueryValue = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

export default async function OnboardingV1Page(props: OnboardingV1PageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (!isOnboardingV1IntegrationEnabled()) {
    notFound();
  }
  const locale = params.locale === 'fr' ? 'fr' : 'en';
  const authProviders = await getOnboardingAuthProviderAvailability();
  const aiBuilderEnabled = businessSetupSelfServeEnabled();
  if (firstQueryValue(searchParams.resume) !== 'review') {
    return <OnboardingV1Integration authProviders={authProviders} locale={locale} aiBuilderEnabled={aiBuilderEnabled} />;
  }

  const siteId = firstQueryValue(searchParams.site);
  const revisionValue = firstQueryValue(searchParams.revision);
  const verifiedRevision = /^\d+$/u.test(revisionValue)
    ? Number(revisionValue)
    : 0;
  if (!isUuid(siteId) || !Number.isSafeInteger(verifiedRevision) || verifiedRevision < 1) {
    notFound();
  }

  const admin = await getAdminSession();
  if (!admin) {
    redirect(`/${locale}/owner-sign-in`);
  }
  const claimed = await getClaimedOnboardingSite({ adminId: admin.id, siteId, expectedRevision: verifiedRevision, ownerOnly: true });
  const linked = claimed && await linkedOnboardingCanvaDraft(db, { salonId: claimed.site.salonId, siteId: claimed.site.id, revisionId: claimed.revision.id });
  if (linked) {
    redirect(`/${locale}/admin/business-setup?salon=${encodeURIComponent(linked.salonSlug)}&mode=manual`);
  }
  const initialResumeDraft = await loadInitialOnboardingResumeDraft({
    adminId: admin.id,
    siteId,
    verifiedRevision,
  });
  if (!initialResumeDraft) {
    notFound();
  }
  return (
    <OnboardingV1Integration
      aiBuilderEnabled={aiBuilderEnabled}
      authProviders={authProviders}
      initialResumeDraft={initialResumeDraft}
      locale={locale}
    />
  );
}
