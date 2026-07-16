'use client';

import { Check, LockKeyhole } from 'lucide-react';

import { resolveEntitlement } from '@/libs/featureEntitlements';
import {
  applySalonFeaturePreset,
  CORE_SALON_FEATURES,
  OPTIONAL_SALON_FEATURES,
  type SalonFeaturePreset,
  setOptionalSalonFeature,
} from '@/libs/salonFeatureRegistry';
import type { SalonFeatures } from '@/types/salonPolicy';

export function SalonFeatureAccessManager({
  features,
  onChange,
  saving = false,
  saveStatus = 'idle',
  error,
}: {
  features: SalonFeatures;
  onChange: (features: SalonFeatures) => void;
  saving?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  error?: string | null;
}) {
  const applyPreset = (preset: SalonFeaturePreset) => {
    onChange(applySalonFeaturePreset(features, preset));
  };

  return (
    <div className="space-y-5" data-testid="super-admin-feature-access">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h4 className="font-semibold text-emerald-950">Core workspace — always included</h4>
        <p className="mt-1 text-xs text-emerald-800">These tools keep every salon usable and cannot be accidentally removed.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {CORE_SALON_FEATURES.map(feature => (
            <div key={feature.key} className="flex gap-2 rounded-lg bg-white p-3">
              <LockKeyhole className="mt-0.5 shrink-0 text-emerald-700" size={15} />
              <div>
                <p className="text-sm font-medium text-gray-900">{feature.label}</p>
                <p className="text-xs text-gray-500">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-gray-900">Optional access</h4>
            <p className="text-xs text-gray-500">Changes save immediately and control what appears in the owner workspace.</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-xs">
            <button type="button" disabled={saving} onClick={() => applyPreset('free_solo')} className="rounded-md px-2 py-1.5 hover:bg-white disabled:opacity-50">Free Solo</button>
            <button type="button" disabled={saving} onClick={() => applyPreset('pro')} className="rounded-md px-2 py-1.5 hover:bg-white disabled:opacity-50">Pro</button>
            <button type="button" disabled={saving} onClick={() => applyPreset('all_available')} className="rounded-md px-2 py-1.5 hover:bg-white disabled:opacity-50">All</button>
          </div>
        </div>
        <div className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-4">
          {OPTIONAL_SALON_FEATURES.map((feature) => {
            const enabled = resolveEntitlement(features, feature.group, feature.nestedKey);
            return (
              <div key={feature.key} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{feature.label}</p>
                  <p className="text-xs text-gray-500">{feature.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Toggle ${feature.label}`}
                  disabled={saving}
                  onClick={() => onChange(setOptionalSalonFeature(features, feature.key, !enabled))}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${enabled ? 'bg-rose-700' : 'bg-gray-200'}`}
                >
                  <span className={`absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : ''}`}>
                    {enabled && <Check size={12} className="text-rose-700" />}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 min-h-5 text-xs" aria-live="polite">
          {saveStatus === 'saving' && <span className="text-stone-500">Saving feature access…</span>}
          {saveStatus === 'saved' && <span className="font-medium text-emerald-700">Saved to the owner dashboard.</span>}
          {saveStatus === 'error' && <span className="font-medium text-red-700">{error || 'Feature access could not be saved.'}</span>}
        </div>
      </div>
    </div>
  );
}
