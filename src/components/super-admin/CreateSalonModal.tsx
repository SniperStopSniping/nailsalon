'use client';

/**
 * Create Salon Modal
 *
 * Modal for super admins to create new salons/organizations.
 * Features:
 * - Basic salon info (name, slug)
 * - Owner assignment (search Clerk users)
 * - Plan and limits configuration
 */

import { AlertCircle, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { OrgPlan } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type CreateSalonModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type ClerkUser = {
  id: string;
  email: string;
  name: string | null;
  organizations: Array<{ id: string; name: string; slug: string }>;
};

// =============================================================================
// Constants
// =============================================================================

const PLAN_OPTIONS: { value: OrgPlan; label: string; description: string }[] = [
  { value: 'free', label: 'Free', description: 'Basic features, limited usage' },
  { value: 'single_salon', label: 'Single Salon', description: '1 location, standard features' },
  { value: 'multi_salon', label: 'Multi-Salon', description: 'Multiple locations enabled' },
  { value: 'enterprise', label: 'Enterprise', description: 'Unlimited with custom features' },
];

// =============================================================================
// Component
// =============================================================================

export function CreateSalonModal({ isOpen, onClose, onCreated }: CreateSalonModalProps) {
  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState<OrgPlan>('single_salon');
  const [maxLocations, setMaxLocations] = useState(1);
  const [maxTechnicians, setMaxTechnicians] = useState(10);
  const [isMultiLocationEnabled, setIsMultiLocationEnabled] = useState(false);

  // Owner search
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerResults, setOwnerResults] = useState<ClerkUser[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<ClerkUser | null>(null);
  const [searchingOwner, setSearchingOwner] = useState(false);

  // Form status
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from name
  useEffect(() => {
    const generated = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
    setSlug(generated);
  }, [name]);

  // Adjust limits based on plan
  useEffect(() => {
    if (plan === 'free' || plan === 'single_salon') {
      setMaxLocations(1);
      setIsMultiLocationEnabled(false);
    } else if (plan === 'multi_salon') {
      if (maxLocations < 2) {
        setMaxLocations(3);
      }
      setIsMultiLocationEnabled(true);
    } else if (plan === 'enterprise') {
      if (maxLocations < 5) {
        setMaxLocations(10);
      }
      setIsMultiLocationEnabled(true);
    }
  }, [plan, maxLocations]);

  // Search for owners
  const searchOwners = useCallback(async (query: string) => {
    if (query.length < 2) {
      setOwnerResults([]);
      return;
    }

    setSearchingOwner(true);
    try {
      const response = await fetch(`/api/super-admin/users/search?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setOwnerResults(data.data || []);
      }
    } catch {
      // Ignore search errors
    } finally {
      setSearchingOwner(false);
    }
  }, []);

  // Debounced owner search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchOwners(ownerSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [ownerSearch, searchOwners]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setName('');
      setSlug('');
      setPlan('single_salon');
      setMaxLocations(1);
      setMaxTechnicians(10);
      setIsMultiLocationEnabled(false);
      setOwnerSearch('');
      setOwnerResults([]);
      setSelectedOwner(null);
      setError(null);
    }
  }, [isOpen]);

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Salon name is required');
      return;
    }

    if (!slug.trim()) {
      setError('Slug is required');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/super-admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          ownerClerkUserId: selectedOwner?.id,
          plan,
          maxLocations,
          maxTechnicians,
          isMultiLocationEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create salon');
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close modal"
      />

      {/* Modal */}
      <div className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-[20px] font-semibold text-[#1C1C1E]">
            Create New Salon
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="-mr-2 rounded-full p-2 text-[#8E8E93] transition-colors hover:bg-gray-100 hover:text-[#1C1C1E]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="max-h-[calc(90vh-140px)] overflow-y-auto">
          <div className="space-y-5 px-6 py-4">
            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3">
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-[14px] text-red-700">{error}</p>
              </div>
            )}

            {/* Salon Name */}
            <div>
              <label className="mb-1.5 block text-[14px] font-medium text-[#1C1C1E]">
                Salon Name
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Glow Nails"
                className="w-full rounded-xl bg-[#F2F2F7] px-4 py-2.5 text-[15px] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
              />
            </div>

            {/* Slug */}
            <div>
              <label className="mb-1.5 block text-[14px] font-medium text-[#1C1C1E]">
                Slug / Identifier
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="e.g., glow-nails"
                className="w-full rounded-xl bg-[#F2F2F7] px-4 py-2.5 font-mono text-[15px] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
              />
              <p className="mt-1 text-[12px] text-[#8E8E93]">
                Used for URLs: yourapp.com/
                <span className="font-medium">{slug || 'slug'}</span>
              </p>
            </div>

            {/* Owner */}
            <div>
              <span className="mb-1.5 block text-[14px] font-medium text-[#1C1C1E]">
                Owner (Optional)
              </span>
              {selectedOwner
                ? (
                    <div className="flex items-center justify-between rounded-xl bg-[#F2F2F7] p-3">
                      <div>
                        <p className="text-[15px] font-medium text-[#1C1C1E]">
                          {selectedOwner.name || selectedOwner.email}
                        </p>
                        <p className="text-[13px] text-[#8E8E93]">{selectedOwner.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOwner(null);
                          setOwnerSearch('');
                        }}
                        className="text-[14px] font-medium text-[#FF3B30] hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  )
                : (
                    <div className="relative">
                      <Search
                        size={18}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]"
                      />
                      <input
                        type="text"
                        value={ownerSearch}
                        onChange={e => setOwnerSearch(e.target.value)}
                        placeholder="Search by email..."
                        className="w-full rounded-xl bg-[#F2F2F7] py-2.5 pl-10 pr-4 text-[15px] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                      />
                      {searchingOwner && (
                        <Loader2
                          size={16}
                          className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#8E8E93]"
                        />
                      )}

                      {/* Search Results */}
                      {ownerResults.length > 0 && (
                        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                          {ownerResults.map(user => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => {
                                setSelectedOwner(user);
                                setOwnerSearch('');
                                setOwnerResults([]);
                              }}
                              className="w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-0 hover:bg-gray-50"
                            >
                              <p className="text-[14px] font-medium text-[#1C1C1E]">
                                {user.name || user.email}
                              </p>
                              <p className="text-[12px] text-[#8E8E93]">{user.email}</p>
                              {user.organizations.length > 0 && (
                                <p className="mt-0.5 text-[11px] text-[#8E8E93]">
                                  Owns:
                                  {' '}
                                  {user.organizations.map(o => o.name).join(', ')}
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
            </div>

            {/* Plan */}
            <div>
              <span className="mb-1.5 block text-[14px] font-medium text-[#1C1C1E]">
                Plan
              </span>
              <div className="grid grid-cols-2 gap-2">
                {PLAN_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPlan(option.value)}
                    className={`rounded-xl border-2 p-3 text-left transition-colors ${
                      plan === option.value
                        ? 'border-[#007AFF] bg-[#007AFF]/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`text-[14px] font-medium ${
                      plan === option.value ? 'text-[#007AFF]' : 'text-[#1C1C1E]'
                    }`}
                    >
                      {option.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#8E8E93]">
                      {option.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Limits */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="maxLocations" className="mb-1.5 block text-[14px] font-medium text-[#1C1C1E]">
                  Max Locations
                </label>
                <input
                  id="maxLocations"
                  type="number"
                  value={maxLocations}
                  onChange={e => setMaxLocations(Math.max(1, Number.parseInt(e.target.value) || 1))}
                  min={1}
                  disabled={plan === 'free' || plan === 'single_salon'}
                  className="w-full rounded-xl bg-[#F2F2F7] px-4 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="maxTechnicians" className="mb-1.5 block text-[14px] font-medium text-[#1C1C1E]">
                  Max Technicians
                </label>
                <input
                  id="maxTechnicians"
                  type="number"
                  value={maxTechnicians}
                  onChange={e => setMaxTechnicians(Math.max(1, Number.parseInt(e.target.value) || 1))}
                  min={1}
                  className="w-full rounded-xl bg-[#F2F2F7] px-4 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                />
              </div>
            </div>

            {/* Multi-location Toggle */}
            <div className="flex items-center justify-between rounded-xl bg-[#F2F2F7] p-4">
              <div>
                <p className="text-[14px] font-medium text-[#1C1C1E]">
                  Multi-location Features
                </p>
                <p className="text-[12px] text-[#8E8E93]">
                  Enable location management UI
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (plan !== 'free' && plan !== 'single_salon') {
                    setIsMultiLocationEnabled(!isMultiLocationEnabled);
                  }
                }}
                disabled={plan === 'free' || plan === 'single_salon'}
                aria-label={`Multi-location features ${isMultiLocationEnabled ? 'enabled' : 'disabled'}`}
                role="switch"
                aria-checked={isMultiLocationEnabled}
                className={`relative h-7 w-12 rounded-full transition-colors ${
                  isMultiLocationEnabled ? 'bg-[#34C759]' : 'bg-gray-300'
                } ${(plan === 'free' || plan === 'single_salon') ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <div
                  className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${
                    isMultiLocationEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl px-5 py-2.5 text-[15px] font-medium text-[#1C1C1E] transition-colors hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !slug.trim()}
              className="flex items-center gap-2 rounded-xl bg-[#007AFF] px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#0066DD] active:bg-[#0055CC] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              Create Salon
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
