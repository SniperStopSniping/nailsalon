'use client';

/**
 * Salon Detail Panel
 *
 * Slide-over panel for viewing and editing salon details.
 * Features:
 * - Overview section with basic info
 * - Plan & limits configuration
 * - Status management
 * - Internal notes (super admin only)
 */

import { AlertCircle, Building2, Calendar, CheckCircle, Loader2, Search, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { OrgPlan, OrgStatus } from '@/models/Schema';

import type { SalonListItem } from './SuperAdminDashboard';

// =============================================================================
// Types
// =============================================================================

type SalonDetailPanelProps = {
  salon: SalonListItem | null;
  onClose: () => void;
  onUpdated: () => void;
};

type SalonDetail = {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  status: OrgStatus;
  maxLocations: number;
  maxTechnicians: number;
  isMultiLocationEnabled: boolean;
  internalNotes: string | null;
  createdAt: string;
  owner: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  locations: Array<{ id: string; name: string }>;
  techniciansCount: number;
  clientsCount: number;
  appointmentsLast30Days: number;
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

const PLAN_OPTIONS: { value: OrgPlan; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'single_salon', label: 'Single Salon' },
  { value: 'multi_salon', label: 'Multi-Salon' },
  { value: 'enterprise', label: 'Enterprise' },
];

const STATUS_OPTIONS: { value: OrgStatus; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: 'bg-green-100 text-green-700' },
  { value: 'trial', label: 'Trial', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'suspended', label: 'Suspended', color: 'bg-red-100 text-red-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-500' },
];

// =============================================================================
// Component
// =============================================================================

export function SalonDetailPanel({ salon, onClose, onUpdated }: SalonDetailPanelProps) {
  // Detail data
  const [detail, setDetail] = useState<SalonDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState<OrgPlan>('single_salon');
  const [status, setStatus] = useState<OrgStatus>('active');
  const [maxLocations, setMaxLocations] = useState(1);
  const [maxTechnicians, setMaxTechnicians] = useState(10);
  const [isMultiLocationEnabled, setIsMultiLocationEnabled] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');

  // Owner management
  const [showOwnerSearch, setShowOwnerSearch] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerResults, setOwnerResults] = useState<ClerkUser[]>([]);
  const [searchingOwner, setSearchingOwner] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<{ id: string; email: string; name: string | null } | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch detail
  const fetchDetail = useCallback(async () => {
    if (!salon) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salon.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch salon details');
      }

      const data = await response.json();
      const salonDetail: SalonDetail = data.data;

      setDetail(salonDetail);
      setName(salonDetail.name);
      setSlug(salonDetail.slug);
      setPlan(salonDetail.plan);
      setStatus(salonDetail.status);
      setMaxLocations(salonDetail.maxLocations);
      setMaxTechnicians(salonDetail.maxTechnicians);
      setIsMultiLocationEnabled(salonDetail.isMultiLocationEnabled);
      setInternalNotes(salonDetail.internalNotes || '');
      setSelectedOwner(salonDetail.owner);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [salon]);

  useEffect(() => {
    if (salon) {
      fetchDetail();
      setSaveSuccess(false);
      setSaveError(null);
    } else {
      setDetail(null);
    }
  }, [salon, fetchDetail]);

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

  // Handle save
  const handleSave = async () => {
    if (!salon) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salon.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          plan,
          status,
          maxLocations,
          maxTechnicians,
          isMultiLocationEnabled,
          internalNotes: internalNotes.trim() || null,
          ownerClerkUserId: selectedOwner?.id ?? null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update salon');
      }

      setSaveSuccess(true);
      setTimeout(() => {
        onUpdated();
      }, 1000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  if (!salon) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close panel"
      />

      {/* Panel */}
      <div className="relative flex size-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-[20px] font-semibold text-[#1C1C1E]">
            Salon Details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-2 rounded-full p-2 text-[#8E8E93] transition-colors hover:bg-gray-100 hover:text-[#1C1C1E]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-64 items-center justify-center">
              <Loader2 size={32} className="animate-spin text-[#007AFF]" aria-label="Loading" />
            </div>
          )}
          {!loading && error && (
            <div className="p-6">
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
                <div>
                  <p className="text-[14px] text-red-700">{error}</p>
                  <button
                    type="button"
                    onClick={fetchDetail}
                    className="mt-1 text-[14px] font-medium text-red-600 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}
          {!loading && !error && detail && (
            <div className="space-y-6 p-6">
              {/* Success Message */}
              {saveSuccess && (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-3">
                  <CheckCircle size={18} className="text-green-600" />
                  <p className="text-[14px] text-green-700">Changes saved successfully!</p>
                </div>
              )}

              {/* Save Error */}
              {saveError && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3">
                  <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
                  <p className="text-[14px] text-red-700">{saveError}</p>
                </div>
              )}

              {/* Overview Section */}
              <section>
                <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                  Overview
                </h3>
                <div className="space-y-4 rounded-xl bg-[#F2F2F7] p-4">
                  {/* Name */}
                  <div>
                    <label htmlFor="detailSalonName" className="mb-1 block text-[13px] font-medium text-[#8E8E93]">
                      Salon Name
                    </label>
                    <input
                      id="detailSalonName"
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full rounded-lg bg-white px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                    />
                  </div>

                  {/* Slug */}
                  <div>
                    <label htmlFor="detailSalonSlug" className="mb-1 block text-[13px] font-medium text-[#8E8E93]">
                      Slug
                    </label>
                    <input
                      id="detailSalonSlug"
                      type="text"
                      value={slug}
                      onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      className="w-full rounded-lg bg-white px-3 py-2 font-mono text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                    />
                  </div>

                  {/* Owner */}
                  <div>
                    <span className="mb-1 block text-[13px] font-medium text-[#8E8E93]">
                      Owner
                    </span>
                    {showOwnerSearch
                      ? (
                          <div className="relative">
                            <Search
                              size={16}
                              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]"
                            />
                            <input
                              type="text"
                              value={ownerSearch}
                              onChange={e => setOwnerSearch(e.target.value)}
                              placeholder="Search by email..."
                              aria-label="Search owner by email"
                              className="w-full rounded-lg bg-white py-2 pl-9 pr-4 text-[15px] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                            />
                            {searchingOwner && (
                              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#8E8E93]" />
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setShowOwnerSearch(false);
                                setOwnerSearch('');
                                setOwnerResults([]);
                              }}
                              className="absolute right-10 top-1/2 -translate-y-1/2 text-[13px] text-[#FF3B30]"
                            >
                              Cancel
                            </button>

                            {ownerResults.length > 0 && (
                              <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-hidden overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                {ownerResults.map(user => (
                                  <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedOwner(user);
                                      setShowOwnerSearch(false);
                                      setOwnerSearch('');
                                      setOwnerResults([]);
                                    }}
                                    className="w-full border-b border-gray-100 px-3 py-2 text-left transition-colors last:border-0 hover:bg-gray-50"
                                  >
                                    <p className="text-[14px] font-medium text-[#1C1C1E]">
                                      {user.name || user.email}
                                    </p>
                                    <p className="text-[12px] text-[#8E8E93]">{user.email}</p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      : (
                          <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                            <span className="text-[15px] text-[#1C1C1E]">
                              {selectedOwner?.email || (
                                <span className="italic text-[#8E8E93]">No owner assigned</span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowOwnerSearch(true)}
                              className="text-[14px] font-medium text-[#007AFF]"
                            >
                              Change
                            </button>
                          </div>
                        )}
                  </div>

                  {/* Created At */}
                  <div>
                    <span className="mb-1 block text-[13px] font-medium text-[#8E8E93]">
                      Created
                    </span>
                    <p className="text-[15px] text-[#1C1C1E]">
                      {new Date(detail.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>

                  {/* Quick Metrics */}
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="text-center">
                      <div className="mb-1 flex items-center justify-center gap-1 text-[#8E8E93]">
                        <Building2 size={14} />
                        <span className="text-[11px] font-medium">Locations</span>
                      </div>
                      <p className="text-[18px] font-semibold text-[#1C1C1E]">
                        {detail.locations.length}
                      </p>
                    </div>
                    <div className="text-center">
                      <div className="mb-1 flex items-center justify-center gap-1 text-[#8E8E93]">
                        <Users size={14} />
                        <span className="text-[11px] font-medium">Techs</span>
                      </div>
                      <p className="text-[18px] font-semibold text-[#1C1C1E]">
                        {detail.techniciansCount}
                      </p>
                    </div>
                    <div className="text-center">
                      <div className="mb-1 flex items-center justify-center gap-1 text-[#8E8E93]">
                        <Calendar size={14} />
                        <span className="text-[11px] font-medium">30d Appts</span>
                      </div>
                      <p className="text-[18px] font-semibold text-[#1C1C1E]">
                        {detail.appointmentsLast30Days}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Plan & Limits Section */}
              <section>
                <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                  Plan & Limits
                </h3>
                <div className="space-y-4 rounded-xl bg-[#F2F2F7] p-4">
                  {/* Plan */}
                  <div>
                    <span className="mb-2 block text-[13px] font-medium text-[#8E8E93]">
                      Plan
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {PLAN_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setPlan(option.value)}
                          className={`rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
                            plan === option.value
                              ? 'bg-[#007AFF] text-white'
                              : 'bg-white text-[#1C1C1E] hover:bg-gray-100'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Limits */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="detailMaxLocations" className="mb-1 block text-[13px] font-medium text-[#8E8E93]">
                        Max Locations
                      </label>
                      <input
                        id="detailMaxLocations"
                        type="number"
                        value={maxLocations}
                        onChange={e => setMaxLocations(Math.max(1, Number.parseInt(e.target.value) || 1))}
                        min={1}
                        disabled={plan === 'free' || plan === 'single_salon'}
                        className="w-full rounded-lg bg-white px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label htmlFor="detailMaxTechnicians" className="mb-1 block text-[13px] font-medium text-[#8E8E93]">
                        Max Technicians
                      </label>
                      <input
                        id="detailMaxTechnicians"
                        type="number"
                        value={maxTechnicians}
                        onChange={e => setMaxTechnicians(Math.max(1, Number.parseInt(e.target.value) || 1))}
                        min={1}
                        className="w-full rounded-lg bg-white px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                      />
                    </div>
                  </div>

                  {/* Multi-location Toggle */}
                  <div className="flex items-center justify-between rounded-lg bg-white p-3">
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
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        isMultiLocationEnabled ? 'bg-[#34C759]' : 'bg-gray-300'
                      } ${(plan === 'free' || plan === 'single_salon') ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      <div
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                          isMultiLocationEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>

              {/* Status & Notes Section */}
              <section>
                <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                  Status & Notes
                </h3>
                <div className="space-y-4 rounded-xl bg-[#F2F2F7] p-4">
                  {/* Status */}
                  <div>
                    <span className="mb-2 block text-[13px] font-medium text-[#8E8E93]">
                      Status
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setStatus(option.value)}
                          className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                            status === option.value
                              ? option.color
                              : 'bg-white text-[#8E8E93] hover:bg-gray-100'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Internal Notes */}
                  <div>
                    <label htmlFor="internalNotes" className="mb-1 block text-[13px] font-medium text-[#8E8E93]">
                      Internal Notes
                    </label>
                    <p className="mb-2 text-[11px] text-[#8E8E93]">
                      Only visible to super admins, not salon owners
                    </p>
                    <textarea
                      id="internalNotes"
                      value={internalNotes}
                      onChange={e => setInternalNotes(e.target.value)}
                      placeholder="Add private notes about this salon..."
                      rows={4}
                      className="w-full resize-none rounded-lg bg-white px-3 py-2 text-[14px] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        {detail && (
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl px-5 py-2.5 text-[15px] font-medium text-[#1C1C1E] transition-colors hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim() || !slug.trim()}
              className="flex items-center gap-2 rounded-xl bg-[#007AFF] px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#0066DD] active:bg-[#0055CC] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              Save Changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
