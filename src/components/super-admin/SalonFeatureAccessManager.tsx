'use client';

import { Check } from 'lucide-react';

import {
  CORE_SALON_FEATURES,
  OPTIONAL_SALON_FEATURES,
} from '@/libs/salonFeatureRegistry';
import type { SalonFeatures } from '@/types/salonPolicy';

export function SalonFeatureAccessManager(_props: {
  features: SalonFeatures;
  onChange: (features: SalonFeatures) => void;
  saving?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  error?: string | null;
}) {
  const included = [
    ...CORE_SALON_FEATURES,
    ...OPTIONAL_SALON_FEATURES.filter(feature => feature.group !== 'catalog'),
    { key: 'deposits', label: 'Deposits & no-show protection', description: 'Owner-controlled deposit rules after payment setup' },
  ];

  return (
    <div className="space-y-5" data-testid="super-admin-feature-access">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h4 className="font-semibold text-emerald-950">Every plan includes all salon features</h4>
        <p className="mt-1 text-xs text-emerald-800">Only the SMS allowance changes by plan. Owners choose which features to turn on in their settings.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {included.map(feature => (
            <div key={feature.key} className="flex gap-2 rounded-lg bg-white p-3">
              <Check className="mt-0.5 shrink-0 text-emerald-700" size={15} aria-hidden="true" />
              <div>
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                  {feature.label}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Included</span>
                </p>
                <p className="text-xs text-gray-500">{feature.description}</p>
                {feature.key === 'smsReminders' && <p className="mt-1 text-xs text-gray-500">The owner manages texting and reminders in communication preferences.</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
