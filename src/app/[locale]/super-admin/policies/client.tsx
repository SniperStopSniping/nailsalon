'use client';

/**
 * Super Admin Policies Client Component
 *
 * Client-side wrapper for the super admin policies page.
 * Handles form state and API calls.
 */

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { MetaStatusPanel } from '@/components/admin/MetaStatusPanel';
import { SuperAdminPolicyForm } from '@/components/super-admin/SuperAdminPolicyForm';

// =============================================================================
// TYPES
// =============================================================================

type PhotoRequirementMode = 'off' | 'optional' | 'required' | null;

type SuperAdminPolicy = {
  requireBeforePhotoToStart: PhotoRequirementMode;
  requireAfterPhotoToFinish: PhotoRequirementMode;
  requireAfterPhotoToPay: PhotoRequirementMode;
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
  initialPolicy: SuperAdminPolicy;
  metaStatus: MetaStatus;
  latestFailure: AutopostFailure | null;
  locale: string;
};

// =============================================================================
// COMPONENT
// =============================================================================

export function SuperAdminPoliciesClient({
  initialPolicy,
  metaStatus,
  latestFailure,
  locale,
}: Props) {
  const router = useRouter();

  const handleSave = async (policy: SuperAdminPolicy) => {
    const response = await fetch('/api/super-admin/policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requireBeforePhotoToStart: policy.requireBeforePhotoToStart ?? undefined,
        requireAfterPhotoToFinish: policy.requireAfterPhotoToFinish ?? undefined,
        requireAfterPhotoToPay: policy.requireAfterPhotoToPay ?? undefined,
        autoPostEnabled: policy.autoPostEnabled ?? undefined,
        autoPostAiCaptionEnabled: policy.autoPostAiCaptionEnabled ?? undefined,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message ?? 'Failed to save policy');
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-2xl p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(`/${locale}/super-admin`)}
              className="-ml-2 rounded-lg p-2 transition-colors hover:bg-gray-100"
            >
              <ArrowLeft className="size-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Global Policies</h1>
              <p className="text-sm text-gray-500">Platform-wide policy overrides</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="space-y-6">
          {/* Policy Form */}
          <SuperAdminPolicyForm
            initialPolicy={initialPolicy}
            onSave={handleSave}
          />

          {/* Meta Status Panel */}
          <MetaStatusPanel
            status={metaStatus}
            latestFailure={latestFailure}
            scope="global"
          />
        </div>
      </div>
    </div>
  );
}
