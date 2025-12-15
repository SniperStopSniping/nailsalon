'use client';

/**
 * Super Admin Policy Form Component
 *
 * Form for super admins to configure global policy defaults/overrides.
 * These settings override all salon-level settings.
 */

import { AlertCircle, Camera, Check, Loader2, Share2, Shield, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

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

type SuperAdminPolicyFormProps = {
  initialPolicy: SuperAdminPolicy;
  onSave: (policy: SuperAdminPolicy) => Promise<void>;
};

// =============================================================================
// HELPERS
// =============================================================================

const PHOTO_MODE_OPTIONS: { value: PhotoRequirementMode; label: string }[] = [
  { value: null, label: 'No Override (Salon Decides)' },
  { value: 'off', label: 'Force Off' },
  { value: 'optional', label: 'Force Optional' },
  { value: 'required', label: 'Force Required' },
];

const TOGGLE_OPTIONS: { value: boolean | null; label: string }[] = [
  { value: null, label: 'No Override' },
  { value: true, label: 'Force On' },
  { value: false, label: 'Force Off' },
];

// =============================================================================
// COMPONENT
// =============================================================================

export function SuperAdminPolicyForm({
  initialPolicy,
  onSave,
}: SuperAdminPolicyFormProps) {
  const [policy, setPolicy] = useState<SuperAdminPolicy>(initialPolicy);
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

  const updatePolicy = <K extends keyof SuperAdminPolicy>(key: K, value: SuperAdminPolicy[K]) => {
    setPolicy(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-red-500" />
          <h2 className="text-lg font-semibold text-gray-900">Global Policy Overrides</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          These settings override all salon-level configurations. Use with caution.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <h4 className="font-medium text-amber-800">Platform-Wide Impact</h4>
            <p className="mt-1 text-sm text-amber-700">
              Settings configured here will override all salon policies across the entire platform.
              Salons will not be able to change overridden settings.
            </p>
          </div>
        </div>
      </div>

      {/* Photo Requirements Section */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Camera className="size-5 text-blue-500" />
          <h3 className="font-semibold text-gray-900">Photo Requirements</h3>
        </div>

        <div className="space-y-4">
          {/* Before Photo to Start */}
          <div>
            <label htmlFor="sapolicy-before-photo" className="mb-1 block text-sm font-medium text-gray-700">
              Before Photo to Start
            </label>
            <select
              id="sapolicy-before-photo"
              value={policy.requireBeforePhotoToStart ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                updatePolicy(
                  'requireBeforePhotoToStart',
                  val === '' ? null : (val as PhotoRequirementMode),
                );
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {PHOTO_MODE_OPTIONS.map(opt => (
                <option key={opt.value ?? 'null'} value={opt.value ?? ''}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* After Photo to Finish */}
          <div>
            <label htmlFor="sapolicy-after-finish" className="mb-1 block text-sm font-medium text-gray-700">
              After Photo to Finish
            </label>
            <select
              id="sapolicy-after-finish"
              value={policy.requireAfterPhotoToFinish ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                updatePolicy(
                  'requireAfterPhotoToFinish',
                  val === '' ? null : (val as PhotoRequirementMode),
                );
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {PHOTO_MODE_OPTIONS.map(opt => (
                <option key={opt.value ?? 'null'} value={opt.value ?? ''}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* After Photo to Pay */}
          <div>
            <label htmlFor="sapolicy-after-pay" className="mb-1 block text-sm font-medium text-gray-700">
              After Photo to Pay
            </label>
            <select
              id="sapolicy-after-pay"
              value={policy.requireAfterPhotoToPay ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                updatePolicy(
                  'requireAfterPhotoToPay',
                  val === '' ? null : (val as PhotoRequirementMode),
                );
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {PHOTO_MODE_OPTIONS.map(opt => (
                <option key={opt.value ?? 'null'} value={opt.value ?? ''}>
                  {opt.label}
                </option>
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
          <div>
            <label htmlFor="sapolicy-autopost" className="mb-1 block text-sm font-medium text-gray-700">
              Enable Auto-Post
            </label>
            <select
              id="sapolicy-autopost"
              value={policy.autoPostEnabled === null ? '' : policy.autoPostEnabled.toString()}
              onChange={(e) => {
                const val = e.target.value;
                updatePolicy(
                  'autoPostEnabled',
                  val === '' ? null : val === 'true',
                );
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {TOGGLE_OPTIONS.map(opt => (
                <option key={opt.value === null ? 'null' : opt.value.toString()} value={opt.value === null ? '' : opt.value.toString()}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* AI Caption */}
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              <label htmlFor="sapolicy-aicaption" className="text-sm font-medium text-gray-700">
                AI Caption
              </label>
            </div>
            <select
              id="sapolicy-aicaption"
              value={policy.autoPostAiCaptionEnabled === null ? '' : policy.autoPostAiCaptionEnabled.toString()}
              onChange={(e) => {
                const val = e.target.value;
                updatePolicy(
                  'autoPostAiCaptionEnabled',
                  val === '' ? null : val === 'true',
                );
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {TOGGLE_OPTIONS.map(opt => (
                <option key={opt.value === null ? 'null' : opt.value.toString()} value={opt.value === null ? '' : opt.value.toString()}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Current Settings Summary */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <h3 className="mb-3 font-semibold text-gray-900">Current Override Summary</h3>
        <div className="space-y-2 text-sm">
          <SummaryRow
            label="Before Photo to Start"
            value={policy.requireBeforePhotoToStart}
            type="photo"
          />
          <SummaryRow
            label="After Photo to Finish"
            value={policy.requireAfterPhotoToFinish}
            type="photo"
          />
          <SummaryRow
            label="After Photo to Pay"
            value={policy.requireAfterPhotoToPay}
            type="photo"
          />
          <SummaryRow
            label="Auto-Post Enabled"
            value={policy.autoPostEnabled}
            type="boolean"
          />
          <SummaryRow
            label="AI Caption"
            value={policy.autoPostAiCaptionEnabled}
            type="boolean"
          />
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
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-3 font-semibold text-white transition-colors hover:bg-red-600 disabled:bg-red-300"
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
                'Save Global Overrides'
              )}
      </button>
    </div>
  );
}

// =============================================================================
// SUMMARY ROW COMPONENT
// =============================================================================

function SummaryRow({
  label,
  value,
  type,
}: {
  label: string;
  value: string | boolean | null;
  type: 'photo' | 'boolean';
}) {
  let displayValue: string;
  let badgeColor: string;

  if (value === null) {
    displayValue = 'No Override';
    badgeColor = 'bg-gray-100 text-gray-600';
  } else if (type === 'boolean') {
    displayValue = value ? 'Force On' : 'Force Off';
    badgeColor = value ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
  } else {
    displayValue = `Force ${(value as string).charAt(0).toUpperCase() + (value as string).slice(1)}`;
    badgeColor = value === 'required'
      ? 'bg-red-100 text-red-700'
      : value === 'optional'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-gray-100 text-gray-600';
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-600">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}>
        {displayValue}
      </span>
    </div>
  );
}
