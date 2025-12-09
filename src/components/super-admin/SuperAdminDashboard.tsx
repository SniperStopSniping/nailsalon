'use client';

import { Plus, Search, ChevronLeft, ChevronRight, Building2 } from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';

import { CreateSalonModal } from './CreateSalonModal';
import { SalonDetailPanel } from './SalonDetailPanel';
import type { SalonPlan, SalonStatus } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

interface SalonItem {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  plan: SalonPlan;
  maxLocations: number;
  isMultiLocationEnabled: boolean;
  status: SalonStatus;
  createdAt: string;
  locationsCount: number;
  techsCount: number;
  clientsCount: number;
  appointmentsLast30d: number;
}

interface ListResponse {
  items: SalonItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// =============================================================================
// Constants
// =============================================================================

const PLAN_OPTIONS = [
  { value: '', label: 'All Plans' },
  { value: 'free', label: 'Free' },
  { value: 'single_salon', label: 'Single Salon' },
  { value: 'multi_salon', label: 'Multi Salon' },
  { value: 'enterprise', label: 'Enterprise' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'trial', label: 'Trial' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PLAN_COLORS: Record<SalonPlan, string> = {
  free: 'bg-gray-100 text-gray-700',
  single_salon: 'bg-blue-100 text-blue-700',
  multi_salon: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
};

const STATUS_COLORS: Record<SalonStatus, string> = {
  active: 'bg-green-100 text-green-700',
  trial: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

// =============================================================================
// Component
// =============================================================================

export function SuperAdminDashboard() {
  const [salons, setSalons] = useState<SalonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters - use debounced search for API calls
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);

  // Track if this is the initial mount
  const isInitialMount = useRef(true);

  // Debounce search input - only update debouncedSearch after 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      // Reset to page 1 when search changes (but not on initial mount)
      if (!isInitialMount.current) {
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch salons - uses debouncedSearch instead of search
  const fetchSalons = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (planFilter) params.set('plan', planFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('pageSize', '20');

      const response = await fetch(`/api/super-admin/organizations?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch salons');
      }

      const data: ListResponse = await response.json();
      setSalons(data.items);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, planFilter, statusFilter, page]);

  // Fetch when filters change
  useEffect(() => {
    fetchSalons();
    isInitialMount.current = false;
  }, [fetchSalons]);

  const handleCreateSuccess = () => {
    setShowCreateModal(false);
    fetchSalons();
  };

  const handleDetailClose = () => {
    setSelectedSalonId(null);
    fetchSalons();
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
                <p className="text-sm text-gray-500">Platform owner controls</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Salon
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search salons, slugs, or owner emails..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Plan filter */}
            <select
              value={planFilter}
              onChange={(e) => {
                setPlanFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by plan"
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            >
              {PLAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by status"
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {error && (
            <div className="p-4 bg-red-50 border-b border-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Salon
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Owner
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Plan
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Locs
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Techs
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Clients
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Appts (30d)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        Loading...
                      </div>
                    </td>
                  </tr>
                ) : salons.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                      No salons found
                    </td>
                  </tr>
                ) : (
                  salons.map((salon) => (
                    <tr key={salon.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <div>
                          <div className="font-medium text-gray-900">{salon.name}</div>
                          <div className="text-sm text-gray-500">{salon.slug}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-sm text-gray-600">
                          {salon.ownerEmail || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${PLAN_COLORS[salon.plan]}`}
                        >
                          {salon.plan.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center text-sm text-gray-600">
                        {salon.locationsCount}
                      </td>
                      <td className="px-4 py-4 text-center text-sm text-gray-600">
                        {salon.techsCount}
                      </td>
                      <td className="px-4 py-4 text-center text-sm text-gray-600">
                        {salon.clientsCount}
                      </td>
                      <td className="px-4 py-4 text-center text-sm text-gray-600">
                        {salon.appointmentsLast30d}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[salon.status]}`}
                        >
                          {salon.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedSalonId(salon.id)}
                          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, total)} of {total} salons
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateSalonModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
        />
      )}

      {selectedSalonId && (
        <SalonDetailPanel
          salonId={selectedSalonId}
          onClose={handleDetailClose}
        />
      )}
    </div>
  );
}
