'use client';

import { Building2, ChevronLeft, ChevronRight, LogOut, Plus, Search, UserPlus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SalonPlan, SalonStatus } from '@/models/Schema';

import { CreateSalonModal } from './CreateSalonModal';
import { InvitesModal } from './InvitesModal';
import { SalonDetailPanel } from './SalonDetailPanel';

// =============================================================================
// Types
// =============================================================================

type SalonItem = {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  ownerPhoneE164: string | null;
  ownerAdminId: string | null;
  ownerName: string | null;
  ownerInviteStatus: 'none' | 'pending' | 'expired' | 'used';
  pendingOwnerPhone: string | null;
  plan: SalonPlan;
  maxLocations: number;
  isMultiLocationEnabled: boolean;
  status: SalonStatus;
  createdAt: string;
  locationsCount: number;
  techsCount: number;
  clientsCount: number;
  appointmentsLast30d: number;
};

type ListResponse = {
  items: SalonItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

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

// Format phone for display
function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

// =============================================================================
// Component
// =============================================================================

export function SuperAdminDashboard() {
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

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
  const [showInvitesModal, setShowInvitesModal] = useState(false);
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);

  // Owner management
  const [removingOwnerId, setRemovingOwnerId] = useState<string | null>(null);

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
      if (debouncedSearch) {
        params.set('q', debouncedSearch);
      }
      if (planFilter !== 'all') {
        params.set('plan', planFilter);
      }
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
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

  // Handle remove/demote owner
  const handleRemoveOwner = async (salonId: string, action: 'demote' | 'remove') => {
    const confirmMsg = action === 'remove'
      ? 'Remove this owner completely? They will lose access to the salon.'
      : 'Demote this owner to admin? They will keep access but not be listed as owner.';

    if (!window.confirm(confirmMsg)) {
      return;
    }

    setRemovingOwnerId(salonId);
    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/owner`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update owner');
      }

      // Refresh the list
      fetchSalons();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update owner');
    } finally {
      setRemovingOwnerId(null);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    // Use hard redirect to ensure clean navigation after session clear
    window.location.href = `/${locale}/super-admin-login`;
  };

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
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
                <Building2 className="size-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
                <p className="text-sm text-gray-500">Platform owner controls</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowInvitesModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700"
              >
                <UserPlus className="size-4" />
                Invites
              </button>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                <Plus className="size-4" />
                Create Salon
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
              >
                <LogOut className="size-4" />
                Log Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mx-auto max-w-7xl p-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search salons, slugs, or owner phones..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {PLAN_OPTIONS.map(opt => (
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
              className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {error && (
            <div className="border-b border-red-100 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Salon
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Owner
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Plan
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    Locs
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    Techs
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    Clients
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    Appts (30d)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading
                  ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                          <div className="flex items-center justify-center gap-2">
                            <div className="size-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                            Loading...
                          </div>
                        </td>
                      </tr>
                    )
                  : salons.length === 0
                    ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                            No salons found
                          </td>
                        </tr>
                      )
                    : (
                        salons.map(salon => (
                          <tr key={salon.id} className="hover:bg-gray-50">
                            <td className="p-4">
                              <div>
                                <div className="font-medium text-gray-900">{salon.name}</div>
                                <div className="text-sm text-gray-500">{salon.slug}</div>
                              </div>
                            </td>
                            <td className="p-4">
                              {salon.ownerPhoneE164
                                ? (
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1">
                                        <span className="text-sm text-gray-900">
                                          {formatPhoneDisplay(salon.ownerPhoneE164)}
                                        </span>
                                        {salon.ownerName && (
                                          <div className="text-xs text-gray-500">{salon.ownerName}</div>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveOwner(salon.id, 'demote')}
                                          disabled={removingOwnerId === salon.id}
                                          className="text-xs text-amber-600 hover:text-amber-800 disabled:opacity-50"
                                          title="Demote to admin"
                                        >
                                          Demote
                                        </button>
                                        <span className="text-gray-300">|</span>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveOwner(salon.id, 'remove')}
                                          disabled={removingOwnerId === salon.id}
                                          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                                          title="Remove access"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  )
                                : salon.pendingOwnerPhone
                                  ? (
                                      <div>
                                        <span className="text-sm text-amber-600">
                                          {formatPhoneDisplay(salon.pendingOwnerPhone)}
                                        </span>
                                        <div className="text-xs text-amber-500">Pending invite</div>
                                      </div>
                                    )
                                  : salon.ownerEmail
                                    ? (
                                        <span className="text-sm text-gray-400" title="Legacy (Clerk)">
                                          {salon.ownerEmail}
                                        </span>
                                      )
                                    : (
                                        <span className="text-sm text-gray-400">No owner</span>
                                      )}
                            </td>
                            <td className="p-4">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${PLAN_COLORS[salon.plan]}`}
                              >
                                {salon.plan.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="p-4 text-center text-sm text-gray-600">
                              {salon.locationsCount}
                            </td>
                            <td className="p-4 text-center text-sm text-gray-600">
                              {salon.techsCount}
                            </td>
                            <td className="p-4 text-center text-sm text-gray-600">
                              {salon.clientsCount}
                            </td>
                            <td className="p-4 text-center text-sm text-gray-600">
                              {salon.appointmentsLast30d}
                            </td>
                            <td className="p-4">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[salon.status]}`}
                              >
                                {salon.status}
                              </span>
                            </td>
                            <td className="p-4 text-right">
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
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
              <div className="text-sm text-gray-500">
                Showing
                {' '}
                {(page - 1) * 20 + 1}
                {' '}
                to
                {' '}
                {Math.min(page * 20, total)}
                {' '}
                of
                {' '}
                {total}
                {' '}
                salons
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                  className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm text-gray-600">
                  Page
                  {' '}
                  {page}
                  {' '}
                  of
                  {' '}
                  {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                  className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronRight className="size-4" />
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

      {showInvitesModal && (
        <InvitesModal onClose={() => setShowInvitesModal(false)} />
      )}
    </div>
  );
}
