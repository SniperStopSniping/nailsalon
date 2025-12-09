'use client';

/**
 * Super Admin Dashboard
 *
 * Main dashboard for platform owners to manage all salons/organizations.
 * Features:
 * - Filterable table of all salons
 * - Create new salon modal
 * - Salon detail panel for editing
 */

import { Building2, Calendar, ChevronDown, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { OrgPlan, OrgStatus } from '@/models/Schema';

import { CreateSalonModal } from './CreateSalonModal';
import { SalonDetailPanel } from './SalonDetailPanel';

// =============================================================================
// Types
// =============================================================================

export type SalonListItem = {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  status: OrgStatus;
  maxLocations: number;
  maxTechnicians: number;
  isMultiLocationEnabled: boolean;
  createdAt: string;
  ownerEmail: string | null;
  ownerClerkUserId: string | null;
  locationsCount: number;
  techniciansCount: number;
  clientsCount: number;
  appointmentsLast30Days: number;
};

type ListResponse = {
  data: SalonListItem[];
  page: number;
  totalPages: number;
  totalCount: number;
};

// =============================================================================
// Constants
// =============================================================================

const PLAN_OPTIONS: { value: OrgPlan | ''; label: string }[] = [
  { value: '', label: 'All Plans' },
  { value: 'free', label: 'Free' },
  { value: 'single_salon', label: 'Single Salon' },
  { value: 'multi_salon', label: 'Multi-Salon' },
  { value: 'enterprise', label: 'Enterprise' },
];

const STATUS_OPTIONS: { value: OrgStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'trial', label: 'Trial' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PLAN_COLORS: Record<OrgPlan, string> = {
  free: 'bg-gray-100 text-gray-700',
  single_salon: 'bg-blue-100 text-blue-700',
  multi_salon: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
};

const STATUS_COLORS: Record<OrgStatus, string> = {
  active: 'bg-green-100 text-green-700',
  trial: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

// =============================================================================
// Component
// =============================================================================

export function SuperAdminDashboard() {
  // State
  const [salons, setSalons] = useState<SalonListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<OrgPlan | ''>('');
  const [statusFilter, setStatusFilter] = useState<OrgStatus | ''>('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSalon, setSelectedSalon] = useState<SalonListItem | null>(null);

  // Fetch data
  const fetchSalons = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) {
        params.set('search', search);
      }
      if (planFilter) {
        params.set('plan', planFilter);
      }
      if (statusFilter) {
        params.set('status', statusFilter);
      }
      params.set('page', page.toString());
      params.set('limit', '20');

      const response = await fetch(`/api/super-admin/organizations?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch organizations');
      }

      const data: ListResponse = await response.json();
      setSalons(data.data);
      setTotalPages(data.totalPages);
      setTotalCount(data.totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [search, planFilter, statusFilter, page]);

  useEffect(() => {
    fetchSalons();
  }, [fetchSalons]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Handle salon created
  const handleSalonCreated = () => {
    setShowCreateModal(false);
    fetchSalons();
  };

  // Handle salon updated
  const handleSalonUpdated = () => {
    setSelectedSalon(null);
    fetchSalons();
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-[#1C1C1E]">Super Admin</h1>
              <p className="text-[13px] text-[#8E8E93]">
                {totalCount}
                {' '}
                organization
                {totalCount !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-[#007AFF] px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-[#0066DD] active:bg-[#0055CC]"
            >
              <Plus size={18} />
              Create Salon
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl p-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative min-w-[200px] max-w-md flex-1">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]"
              />
              <input
                type="text"
                placeholder="Search salons, slugs, emails..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-lg bg-[#F2F2F7] py-2 pl-10 pr-4 text-[15px] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
              />
            </div>

            {/* Plan Filter */}
            <div className="relative">
              <select
                value={planFilter}
                onChange={(e) => {
                  setPlanFilter(e.target.value as OrgPlan | '');
                  setPage(1);
                }}
                aria-label="Filter by plan"
                className="cursor-pointer appearance-none rounded-lg bg-[#F2F2F7] py-2 pl-4 pr-10 text-[15px] text-[#1C1C1E] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
              >
                {PLAN_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93]"
              />
            </div>

            {/* Status Filter */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as OrgStatus | '');
                  setPage(1);
                }}
                aria-label="Filter by status"
                className="cursor-pointer appearance-none rounded-lg bg-[#F2F2F7] py-2 pl-4 pr-10 text-[15px] text-[#1C1C1E] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93]"
              />
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={fetchSalons}
              disabled={loading}
              aria-label="Refresh salon list"
              className="rounded-lg bg-[#F2F2F7] p-2 text-[#8E8E93] transition-colors hover:bg-gray-200 hover:text-[#1C1C1E] disabled:opacity-50"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-[15px] text-red-700">{error}</p>
            <button
              type="button"
              onClick={fetchSalons}
              className="mt-2 text-[15px] font-medium text-red-600 hover:underline"
            >
              Try again
            </button>
          </div>
        )}
        {!error && loading && salons.length === 0 && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {[1, 2, 3, 4, 5].map(n => (
              <div
                key={n}
                className="flex items-center gap-4 border-b border-gray-100 p-4 last:border-0"
              >
                <div className="size-10 animate-pulse rounded-lg bg-gray-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-48 animate-pulse rounded bg-gray-50" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded-full bg-gray-100" />
              </div>
            ))}
          </div>
        )}
        {!error && !loading && salons.length === 0 && (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <Building2 size={48} className="mx-auto mb-4 text-[#8E8E93]" />
            <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">
              No salons found
            </h3>
            <p className="mb-4 text-[15px] text-[#8E8E93]">
              {search || planFilter || statusFilter
                ? 'Try adjusting your filters'
                : 'Create your first salon to get started'}
            </p>
            {!search && !planFilter && !statusFilter && (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="rounded-lg bg-[#007AFF] px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-[#0066DD]"
              >
                Create Salon
              </button>
            )}
          </div>
        )}
        {!error && salons.length > 0 && (
          <>
            {/* Table */}
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/50">
                      <th className="px-4 py-3 text-left text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        Salon
                      </th>
                      <th className="px-4 py-3 text-left text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        Owner
                      </th>
                      <th className="px-4 py-3 text-left text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        Plan
                      </th>
                      <th className="px-4 py-3 text-center text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        <Users size={14} className="mr-1 inline" />
                        Techs
                      </th>
                      <th className="px-4 py-3 text-center text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        Clients
                      </th>
                      <th className="px-4 py-3 text-center text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        <Calendar size={14} className="mr-1 inline" />
                        30d
                      </th>
                      <th className="px-4 py-3 text-left text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        Status
                      </th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {salons.map(salon => (
                      <tr
                        key={salon.id}
                        className="cursor-pointer border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50/50"
                        onClick={() => setSelectedSalon(salon)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#007AFF] to-[#5856D6] text-[15px] font-semibold text-white">
                              {salon.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-[15px] font-medium text-[#1C1C1E]">
                                {salon.name}
                              </p>
                              <p className="text-[13px] text-[#8E8E93]">
                                {salon.slug}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[14px] text-[#1C1C1E]">
                            {salon.ownerEmail || (
                              <span className="italic text-[#8E8E93]">No owner</span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium ${PLAN_COLORS[salon.plan]}`}
                          >
                            {salon.plan.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-[14px] text-[#1C1C1E]">
                            {salon.techniciansCount}
                            <span className="text-[#8E8E93]">
                              /
                              {salon.maxTechnicians}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-[14px] text-[#1C1C1E]">
                            {salon.clientsCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-[14px] text-[#1C1C1E]">
                            {salon.appointmentsLast30Days}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium ${STATUS_COLORS[salon.status]}`}
                          >
                            {salon.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSalon(salon);
                            }}
                            className="text-[14px] font-medium text-[#007AFF] hover:underline"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-[14px] text-[#8E8E93]">
                  Page
                  {' '}
                  {page}
                  {' '}
                  of
                  {' '}
                  {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-[15px] font-medium text-[#1C1C1E] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-[15px] font-medium text-[#1C1C1E] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      <CreateSalonModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleSalonCreated}
      />

      {/* Detail Panel */}
      <SalonDetailPanel
        salon={selectedSalon}
        onClose={() => setSelectedSalon(null)}
        onUpdated={handleSalonUpdated}
      />
    </div>
  );
}
