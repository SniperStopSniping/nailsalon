'use client';

/**
 * Salon Policy Form Component
 *
 * Form for salon admins to configure appointment photo requirements.
 * Shows effective policy preview with source badges.
 */

import { AlertCircle, Camera, Check, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { resolveEffectivePolicy } from '@/core/appointments/policyResolver';
import type { PhotoRequirementMode as PolicyPhotoMode } from '@/core/appointments/policyTypes';

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

type PolicyFormProps = {
  initialSalonPolicy: SalonPolicy;
  superAdminPolicy: SuperAdminPolicy;
  salonName: string;
  onSave: (policy: Partial<SalonPolicy>) => Promise<void>;
  section?: 'all' | 'photos' | 'social';
};

// =============================================================================
// HELPERS
// =============================================================================

const PHOTO_MODE_OPTIONS: { value: PhotoRequirementMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'optional', label: 'Optional' },
  { value: 'required', label: 'Required' },
];

function getSourceBadge(
  _field: string,
  salonValue: unknown,
  superAdminValue: unknown,
  effectiveValue: unknown,
): 'SA Forced' | 'Salon' | 'Default' {
  // If super admin has a value set and it matches effective, it's forced
  if (superAdminValue !== null && superAdminValue !== undefined && superAdminValue === effectiveValue) {
    return 'SA Forced';
  }
  // If salon value matches effective, it's from salon
  if (salonValue === effectiveValue) {
    return 'Salon';
  }
  return 'Default';
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SalonPolicyForm({
  initialSalonPolicy,
  superAdminPolicy,
  salonName,
  onSave,
}: PolicyFormProps) {
  const [policy, setPolicy] = useState<SalonPolicy>(initialSalonPolicy);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset saved state after 3 seconds
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [saved]);

  // Compute effective policy in real-time
  const effectivePolicy = useMemo(() => {
    return resolveEffectivePolicy({
      salon: {
        requireBeforePhotoToStart: policy.requireBeforePhotoToStart as PolicyPhotoMode,
        requireAfterPhotoToFinish: policy.requireAfterPhotoToFinish as PolicyPhotoMode,
        requireAfterPhotoToPay: policy.requireAfterPhotoToPay as PolicyPhotoMode,
        autoPostEnabled: policy.autoPostEnabled,
        autoPostPlatforms: policy.autoPostPlatforms as Array<'instagram' | 'facebook' | 'tiktok'>,
        autoPostIncludePrice: policy.autoPostIncludePrice,
        autoPostIncludeColor: policy.autoPostIncludeColor,
        autoPostIncludeBrand: policy.autoPostIncludeBrand,
        autoPostAIcaptionEnabled: policy.autoPostAiCaptionEnabled,
      },
      superAdmin: {
        requireBeforePhotoToStart: superAdminPolicy.requireBeforePhotoToStart as PolicyPhotoMode | undefined ?? undefined,
        requireAfterPhotoToFinish: superAdminPolicy.requireAfterPhotoToFinish as PolicyPhotoMode | undefined ?? undefined,
        requireAfterPhotoToPay: superAdminPolicy.requireAfterPhotoToPay as PolicyPhotoMode | undefined ?? undefined,
        autoPostEnabled: superAdminPolicy.autoPostEnabled ?? undefined,
        autoPostAIcaptionEnabled: superAdminPolicy.autoPostAiCaptionEnabled ?? undefined,
      },
    });
  }, [policy, superAdminPolicy]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const ownedPolicy = {
        requireAfterPhotoToFinish: policy.requireAfterPhotoToFinish,
        requireAfterPhotoToPay: policy.requireAfterPhotoToPay,
        requireBeforePhotoToStart: policy.requireBeforePhotoToStart,
      };

      await onSave(ownedPolicy);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const updatePolicy = <K extends keyof SalonPolicy>(key: K, value: SalonPolicy[K]) => {
    setPolicy(prev => ({ ...prev, [key]: value }));
  };

  // Check if a field is overridden by super admin
  const isOverridden = (field: keyof SuperAdminPolicy) => {
    const saValue = superAdminPolicy[field];
    return saValue !== null && saValue !== undefined;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">What these rules do</h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose when appointment photos are needed for
          {' '}
          {salonName}
          .
        </p>
      </div>

      {/* Photo Requirements Section */}
      {(
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Camera className="size-5 text-blue-500" />
            <h3 className="font-semibold text-gray-900">Photo Requirements</h3>
          </div>

          <div className="space-y-4">
            {/* Before Photo to Start */}
            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="policy-requireBeforePhotoToStart" className="text-sm font-medium text-gray-700">
                  Before Photo to Start
                </label>
                <p className="text-xs text-gray-500">Require photo before starting service</p>
              </div>
              <select
                id="policy-requireBeforePhotoToStart"
                value={policy.requireBeforePhotoToStart}
                onChange={e => updatePolicy('requireBeforePhotoToStart', e.target.value as PhotoRequirementMode)}
                disabled={isOverridden('requireBeforePhotoToStart')}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                {PHOTO_MODE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* After Photo to Finish */}
            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="policy-requireAfterPhotoToFinish" className="text-sm font-medium text-gray-700">
                  After Photo to Finish
                </label>
                <p className="text-xs text-gray-500">Require photo before completing</p>
              </div>
              <select
                id="policy-requireAfterPhotoToFinish"
                value={policy.requireAfterPhotoToFinish}
                onChange={e => updatePolicy('requireAfterPhotoToFinish', e.target.value as PhotoRequirementMode)}
                disabled={isOverridden('requireAfterPhotoToFinish')}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                {PHOTO_MODE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* After Photo to Pay */}
            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="policy-requireAfterPhotoToPay" className="text-sm font-medium text-gray-700">
                  After Photo to Pay
                </label>
                <p className="text-xs text-gray-500">Require photo before payment</p>
              </div>
              <select
                id="policy-requireAfterPhotoToPay"
                value={policy.requireAfterPhotoToPay}
                onChange={e => updatePolicy('requireAfterPhotoToPay', e.target.value as PhotoRequirementMode)}
                disabled={isOverridden('requireAfterPhotoToPay')}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                {PHOTO_MODE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-purple-50 p-5">
        <h3 className="mb-3 font-semibold text-gray-900">What is enforced right now</h3>
        <p className="mb-4 text-xs text-gray-500">
          This is what your team is actually held to today. Where Luster has set
          a rule for every salon, that rule wins over the choice above.
        </p>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Before Photo to Start</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{effectivePolicy.requireBeforePhotoToStart}</span>
              <SourceBadge
                source={getSourceBadge(
                  'requireBeforePhotoToStart',
                  policy.requireBeforePhotoToStart,
                  superAdminPolicy.requireBeforePhotoToStart,
                  effectivePolicy.requireBeforePhotoToStart,
                )}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">After Photo to Finish</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{effectivePolicy.requireAfterPhotoToFinish}</span>
              <SourceBadge
                source={getSourceBadge(
                  'requireAfterPhotoToFinish',
                  policy.requireAfterPhotoToFinish,
                  superAdminPolicy.requireAfterPhotoToFinish,
                  effectivePolicy.requireAfterPhotoToFinish,
                )}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">After Photo to Pay</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{effectivePolicy.requireAfterPhotoToPay}</span>
              <SourceBadge
                source={getSourceBadge(
                  'requireAfterPhotoToPay',
                  policy.requireAfterPhotoToPay,
                  superAdminPolicy.requireAfterPhotoToPay,
                  effectivePolicy.requireAfterPhotoToPay,
                )}
              />
            </div>
          </div>

        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Save Button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 py-3 font-semibold text-white transition-colors hover:bg-blue-600 disabled:bg-blue-300"
      >
        {saving
          ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Saving...
              </>
            )
          : saved
            ? (
                <>
                  <Check className="size-5" />
                  Saved!
                </>
              )
            : (
                'Save photo rules'
              )}
      </button>
    </div>
  );
}

// =============================================================================
// SOURCE BADGE COMPONENT
// =============================================================================

/**
 * AG-w2-settings-integrations-15: owners were shown the internal source codes
 * ("SA Forced", "Salon") as-is. The codes stay — other callers type against
 * them — but the owner reads who decided, in their own words.
 */
const SOURCE_LABELS: Record<'SA Forced' | 'Salon' | 'Default', string> = {
  'SA Forced': 'Set by Luster',
  'Salon': 'Your choice',
  'Default': 'Luster default',
};

function SourceBadge({ source }: { source: 'SA Forced' | 'Salon' | 'Default' }) {
  const colors = {
    'SA Forced': 'bg-red-100 text-red-700',
    'Salon': 'bg-green-100 text-green-700',
    'Default': 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[source]}`}>
      {SOURCE_LABELS[source]}
    </span>
  );
}
