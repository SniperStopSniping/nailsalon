'use client';

/**
 * Salon Policies Client Component
 *
 * Client-side wrapper for the salon admin policies page.
 * Handles form state and API calls.
 */

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { MetaStatusPanel } from '@/components/admin/MetaStatusPanel';
import { SalonPolicyForm } from '@/components/admin/PolicyForm';

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
  metaStatus,
  latestFailure,
  locale,
}: Props) {
  const router = useRouter();

  const handleSave = async (policy: SalonPolicy) => {
    const response = await fetch('/api/admin/policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy),
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
              onClick={() => router.push(`/${locale}/admin`)}
              className="-ml-2 rounded-lg p-2 transition-colors hover:bg-gray-100"
            >
              <ArrowLeft className="size-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Policy Settings</h1>
              <p className="text-sm text-gray-500">{salonName}</p>
            </div>
          </div>
        </div>
      </div>

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
