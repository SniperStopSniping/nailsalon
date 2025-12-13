'use client';

/**
 * Salon Policy Form Component
 *
 * Form for salon admins to configure photo requirements and auto-post settings.
 * Shows effective policy preview with source badges.
 */

import { AlertCircle, Camera, Check, Facebook, Instagram, Loader2, Share2, Sparkles } from 'lucide-react';
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
  onSave: (policy: SalonPolicy) => Promise<void>;
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
      await onSave(policy);
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

  const togglePlatform = (platform: AutoPostPlatform) => {
    setPolicy(prev => ({
      ...prev,
      autoPostPlatforms: prev.autoPostPlatforms.includes(platform)
        ? prev.autoPostPlatforms.filter(p => p !== platform)
        : [...prev.autoPostPlatforms, platform],
    }));
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
        <h2 className="text-lg font-semibold text-gray-900">Policy Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure photo requirements and auto-posting for
          {' '}
          {salonName}
        </p>
      </div>

      {/* Photo Requirements Section */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Camera className="size-5 text-blue-500" />
          <h3 className="font-semibold text-gray-900">Photo Requirements</h3>
        </div>

        <div className="space-y-4">
          {/* Before Photo to Start */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Before Photo to Start
              </label>
              <p className="text-xs text-gray-500">Require photo before starting service</p>
            </div>
            <select
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
              <label className="text-sm font-medium text-gray-700">
                After Photo to Finish
              </label>
              <p className="text-xs text-gray-500">Require photo before completing</p>
            </div>
            <select
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
              <label className="text-sm font-medium text-gray-700">
                After Photo to Pay
              </label>
              <p className="text-xs text-gray-500">Require photo before payment</p>
            </div>
            <select
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

      {/* Auto-Post Section */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Share2 className="size-5 text-purple-500" />
          <h3 className="font-semibold text-gray-900">Auto-Post Settings</h3>
        </div>

        <div className="space-y-4">
          {/* Enable Auto-Post */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Enable Auto-Post
              </label>
              <p className="text-xs text-gray-500">Automatically post after photos to social media</p>
            </div>
            <button
              type="button"
              onClick={() => updatePolicy('autoPostEnabled', !policy.autoPostEnabled)}
              disabled={isOverridden('autoPostEnabled')}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                policy.autoPostEnabled ? 'bg-green-500' : 'bg-gray-300'
              } ${isOverridden('autoPostEnabled') ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span
                className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${
                  policy.autoPostEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Platforms */}
          {policy.autoPostEnabled && (
            <>
              <div className="border-t pt-2">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Platforms
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => togglePlatform('instagram')}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2 transition-colors ${
                      policy.autoPostPlatforms.includes('instagram')
                        ? 'border-pink-300 bg-pink-50 text-pink-700'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                    }`}
                  >
                    <Instagram className="size-4" />
                    Instagram
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePlatform('facebook')}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2 transition-colors ${
                      policy.autoPostPlatforms.includes('facebook')
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                    }`}
                  >
                    <Facebook className="size-4" />
                    Facebook
                  </button>
                </div>
              </div>

              {/* Caption Options */}
              <div className="border-t pt-2">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Caption Options
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policy.autoPostIncludePrice}
                      onChange={e => updatePolicy('autoPostIncludePrice', e.target.checked)}
                      className="size-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Include price</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policy.autoPostIncludeColor}
                      onChange={e => updatePolicy('autoPostIncludeColor', e.target.checked)}
                      className="size-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Include color</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policy.autoPostIncludeBrand}
                      onChange={e => updatePolicy('autoPostIncludeBrand', e.target.checked)}
                      className="size-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Include brand</span>
                  </label>
                </div>
              </div>

              {/* AI Caption */}
              <div className="flex items-center justify-between border-t pt-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-amber-500" />
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      AI Caption
                    </label>
                    <p className="text-xs text-gray-500">Generate captions with AI</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => updatePolicy('autoPostAiCaptionEnabled', !policy.autoPostAiCaptionEnabled)}
                  disabled={isOverridden('autoPostAiCaptionEnabled')}
                  className={`relative h-7 w-12 rounded-full transition-colors ${
                    policy.autoPostAiCaptionEnabled ? 'bg-amber-500' : 'bg-gray-300'
                  } ${isOverridden('autoPostAiCaptionEnabled') ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span
                    className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${
                      policy.autoPostAiCaptionEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Effective Policy Preview */}
      <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-purple-50 p-5">
        <h3 className="mb-3 font-semibold text-gray-900">Effective Policy Preview</h3>
        <p className="mb-4 text-xs text-gray-500">
          This is what will actually be enforced after super admin overrides are applied.
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
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Auto-Post Enabled</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{effectivePolicy.autoPostEnabled ? 'Yes' : 'No'}</span>
              <SourceBadge
                source={getSourceBadge(
                  'autoPostEnabled',
                  policy.autoPostEnabled,
                  superAdminPolicy.autoPostEnabled,
                  effectivePolicy.autoPostEnabled,
                )}
              />
            </div>
          </div>
          {effectivePolicy.autoPostEnabled && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Platforms</span>
                <span className="font-medium">
                  {effectivePolicy.autoPostPlatforms.join(', ') || 'None'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">AI Caption</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{effectivePolicy.autoPostAIcaptionEnabled ? 'Yes' : 'No'}</span>
                  <SourceBadge
                    source={getSourceBadge(
                      'autoPostAiCaptionEnabled',
                      policy.autoPostAiCaptionEnabled,
                      superAdminPolicy.autoPostAiCaptionEnabled,
                      effectivePolicy.autoPostAIcaptionEnabled,
                    )}
                  />
                </div>
              </div>
            </>
          )}
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
                'Save Changes'
              )}
      </button>
    </div>
  );
}

// =============================================================================
// SOURCE BADGE COMPONENT
// =============================================================================

function SourceBadge({ source }: { source: 'SA Forced' | 'Salon' | 'Default' }) {
  const colors = {
    'SA Forced': 'bg-red-100 text-red-700',
    'Salon': 'bg-green-100 text-green-700',
    'Default': 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[source]}`}>
      {source}
    </span>
  );
}
