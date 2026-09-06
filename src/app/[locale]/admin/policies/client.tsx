'use client';

/**
 * Salon Policies Client Component
 *
 * Client-side wrapper for the salon admin policies page.
 * Handles form state and API calls.
 */

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { AdminImpersonationBanner } from '@/components/admin/AdminImpersonationBanner';
import { MetaStatusPanel } from '@/components/admin/MetaStatusPanel';
import { SalonPolicyForm } from '@/components/admin/PolicyForm';
import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';

// =============================================================================
// TYPES
// =============================================================================

type PhotoRequirementMode = 'off' | 'optional' | 'required';
type AutoPostPlatform = 'instagram' | 'facebook' | 'tiktok';

type SalonPolicy = {
  requireBeforePhotoToStart: PhotoRequirementMode;
  requireAfterPhotoToFinish: PhotoRequirementMode;
  requireAfterPhotoToPay: PhotoRequirementMode;
  autoPostEnabled: boolean;
  autoPostPlatforms: AutoPostPlatform[];
  autoPostIncludePrice: boolean;
  autoPostIncludeColor: boolean;
  autoPostIncludeBrand: boolean;
  autoPostAiCaptionEnabled: boolean;
};

type SuperAdminPolicy = {
  requireBeforePhotoToStart: PhotoRequirementMode | null;
  requireAfterPhotoToFinish: PhotoRequirementMode | null;
  requireAfterPhotoToPay: PhotoRequirementMode | null;
  autoPostEnabled: boolean | null;
  autoPostAiCaptionEnabled: boolean | null;
};

type MetaStatus = {
  hasSystemUserToken: boolean;
  hasFacebookPageId: boolean;
  hasInstagramAccountId: boolean;
  graphVersion: string;
};

type AutopostFailure = {
  platform: string;
  error: string | null;
  retryCount: number;
  processedAt: string | null;
};

type Props = {
  initialSalonPolicy: SalonPolicy;
  superAdminPolicy: SuperAdminPolicy;
  salonName: string;
  /** The salon this page resolved from the URL; every write carries it. */
  salonSlug: string;
  metaStatus: MetaStatus;
  latestFailure: AutopostFailure | null;
  locale: string;
};

// =============================================================================
// COMPONENT
// =============================================================================

export function SalonPoliciesClient({
  initialSalonPolicy,
  superAdminPolicy,
  salonName,
  salonSlug,
  metaStatus,
  latestFailure,
  locale,
}: Props) {
  const router = useRouter();

  const handleSave = async (policy: SalonPolicy) => {
    // The page may be showing a salon the active-salon cookie does not name,
    // so the write repeats the slug the page resolved instead of trusting it.
    const response = await fetch(
      `/api/admin/policies?salonSlug=${encodeURIComponent(salonSlug)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      },
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message ?? 'Failed to save policy');
    }
  };

  return (
    /*
      AG-w2-settings-integrations-15: this page used to render in a different
      visual language from the workspace it belongs to — iOS grey ground, a
      generic "Policy Settings" title and no sign of which salon was being
      edited beyond a grey subtitle. It now wears the same chrome as every
      other owner screen: the workspace ground and faces, the shared page
      header, the "Managing <salon>" line, and a Back control that says where
      it goes.
    */
    <div
      className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] font-sans text-[var(--owner-ink)]"
      data-theme-scope="owner"
      data-testid="admin-policies-page"
    >
      {/* Header */}
      <div
        className="border-b border-[var(--owner-line)] bg-[var(--owner-surface)]"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto max-w-2xl p-4">
          <WorkspacePageHeader
            title="Photo & auto-post rules"
            subtitle={`Managing ${salonName}`}
            titleClassName="owner-title text-[22px] font-semibold tracking-tight text-[var(--owner-ink)]"
            subtitleClassName="text-[14px] text-[var(--owner-muted)]"
            leading={(
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/${locale}/admin?salon=${encodeURIComponent(salonSlug)}`,
                  )}
                aria-label="Back to your workspace"
                className="-ml-1 flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-accent)] outline-none transition-colors hover:bg-[var(--owner-blush)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
              >
                <ArrowLeft className="size-5" />
              </button>
            )}
          />
        </div>
      </div>

      <AdminImpersonationBanner className="mx-auto max-w-2xl" />

      {/* Content */}
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="space-y-6">
          {/* Policy Form */}
          <SalonPolicyForm
            initialSalonPolicy={initialSalonPolicy}
            superAdminPolicy={superAdminPolicy}
            salonName={salonName}
            onSave={handleSave}
          />

          {/* Meta Status Panel */}
          <MetaStatusPanel
            status={metaStatus}
            latestFailure={latestFailure}
            scope="salon"
          />
        </div>
      </div>
    </div>
  );
}
