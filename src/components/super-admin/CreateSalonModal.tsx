'use client';

import { X } from 'lucide-react';
import { useState } from 'react';

import type { SalonPlan } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type CreateSalonModalProps = {
  onClose: () => void;
  onSuccess: () => void;
};

// =============================================================================
// Component
// =============================================================================

export function CreateSalonModal({ onClose, onSuccess }: CreateSalonModalProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [plan, setPlan] = useState<SalonPlan>('single_salon');
  const [maxLocations, setMaxLocations] = useState(1);
  const [isMultiLocationEnabled, setIsMultiLocationEnabled] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(value));
    }
  };

  const generateSlug = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/super-admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          ownerName,
          ownerPhone: ownerPhone.replace(/\D/g, ''),
          ownerEmail,
          plan,
          maxLocations,
          isMultiLocationEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create salon');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Create Salon</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="-m-2 p-2 text-gray-400 hover:text-gray-600"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5 p-6">
            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
                Salon Name
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., Glow Nails"
              />
            </div>

            {/* Slug */}
            <div>
              <label htmlFor="slug" className="mb-1 block text-sm font-medium text-gray-700">
                Slug / Identifier
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="slug"
                value={slug}
                onChange={e => setSlug(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., glow-nails"
              />
              <p className="mt-1 text-xs text-gray-500">
                Used for URLs and subdomains
              </p>
            </div>

            {/* Owner Name */}
            <div>
              <label htmlFor="ownerName" className="mb-1 block text-sm font-medium text-gray-700">
                Owner Name
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="ownerName"
                value={ownerName}
                onChange={e => setOwnerName(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., John Smith"
              />
            </div>

            {/* Owner Phone */}
            <div>
              <label htmlFor="ownerPhone" className="mb-1 block text-sm font-medium text-gray-700">
                Owner Phone
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                id="ownerPhone"
                value={ownerPhone}
                onChange={e => setOwnerPhone(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., (416) 555-1234"
              />
            </div>

            {/* Owner Email */}
            <div>
              <label htmlFor="ownerEmail" className="mb-1 block text-sm font-medium text-gray-700">
                Owner Email
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="ownerEmail"
                value={ownerEmail}
                onChange={e => setOwnerEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="owner@example.com"
              />
            </div>

            {/* Plan */}
            <div>
              <label htmlFor="plan" className="mb-1 block text-sm font-medium text-gray-700">
                Plan
              </label>
              <select
                id="plan"
                value={plan}
                onChange={(e) => {
                  const newPlan = e.target.value as SalonPlan;
                  setPlan(newPlan);
                  if (newPlan === 'single_salon' || newPlan === 'free') {
                    setMaxLocations(1);
                    setIsMultiLocationEnabled(false);
                  } else if (newPlan === 'multi_salon' && maxLocations < 2) {
                    setMaxLocations(2);
                  }
                }}
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="free">Free</option>
                <option value="single_salon">Single Salon</option>
                <option value="multi_salon">Multi Salon</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            {/* Max Locations */}
            <div>
              <label htmlFor="maxLocations" className="mb-1 block text-sm font-medium text-gray-700">
                Max Locations
              </label>
              <input
                type="number"
                id="maxLocations"
                value={maxLocations}
                onChange={e => setMaxLocations(Math.max(1, Number.parseInt(e.target.value) || 1))}
                min={1}
                disabled={plan === 'single_salon' || plan === 'free'}
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>

            {/* Multi-location toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Multi-location Features</div>
                <div className="text-xs text-gray-500">Enable multi-location UI and features</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isMultiLocationEnabled}
                onClick={() => setIsMultiLocationEnabled(!isMultiLocationEnabled)}
                disabled={plan === 'single_salon' || plan === 'free'}
                aria-label="Toggle multi-location features"
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  isMultiLocationEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                } ${plan === 'single_salon' || plan === 'free' ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <div
                  className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    isMultiLocationEnabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={loading || !name || !slug || !ownerName || !ownerPhone || !ownerEmail}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && (
                <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              Create Salon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
