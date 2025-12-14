'use client';

/**
 * TimeOffRequestsInbox Component
 *
 * iOS-style inbox for managing staff time-off requests.
 * Features:
 * - Filterable list by status (Pending/Approved/Denied/All)
 * - Search by technician name
 * - Detail slide-over panel with conflict warnings
 * - Approve/Deny actions with confirmation
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// =============================================================================
// TYPES
// =============================================================================

type TimeOffRequest = {
  id: string;
  salonId: string;
  salonName?: string;
  technicianId: string;
  technicianName: string | null;
  startDate: string;
  endDate: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  decidedAt: string | null;
  decidedBy?: string | null;
  createdAt: string;
};

type RequestDetail = {
  conflicts: {
    appointmentCount: number;
    range: { from: string; to: string };
  };
} & TimeOffRequest;

type StatusFilter = 'PENDING' | 'APPROVED' | 'DENIED' | 'ALL';

// =============================================================================
// HELPERS
// =============================================================================

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  if (startDate === endDate) {
    return start.toLocaleDateString('en-US', opts);
  }

  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'PENDING':
      return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' };
    case 'APPROVED':
      return { bg: 'bg-green-100', text: 'text-green-700', label: 'Approved' };
    case 'DENIED':
      return { bg: 'bg-red-100', text: 'text-red-700', label: 'Denied' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
  }
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

/**
 * Status Filter Tabs
 */
function StatusTabs({
  selected,
  onChange,
  counts,
}: {
  selected: StatusFilter;
  onChange: (status: StatusFilter) => void;
  counts: { pending: number; approved: number; denied: number };
}) {
  const tabs: { id: StatusFilter; label: string; count?: number }[] = [
    { id: 'PENDING', label: 'Pending', count: counts.pending },
    { id: 'APPROVED', label: 'Approved' },
    { id: 'DENIED', label: 'Denied' },
    { id: 'ALL', label: 'All' },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-3">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`
            relative whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium transition-all
            ${
        selected === tab.id
          ? 'bg-[#007AFF] text-white shadow-sm'
          : 'bg-[#F2F2F7] text-[#8E8E93] active:bg-gray-200'
        }
          `}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span
              className={`
                ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold
                ${selected === tab.id ? 'bg-white/25 text-white' : 'bg-[#FF3B30] text-white'}
              `}
            >
              {tab.count > 99 ? '99+' : tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Search Bar
 */
function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-4 pb-3">
      <div className="bg-[#767680]/12 flex h-9 items-center gap-2 rounded-[10px] px-3">
        <Search className="size-4 text-[#8E8E93]" />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Search by technician name"
          className="flex-1 bg-transparent text-[16px] text-[#1C1C1E] placeholder-[#8E8E93] outline-none"
        />
      </div>
    </div>
  );
}

/**
 * Request Row
 */
function RequestRow({
  request,
  isLast,
  onClick,
}: {
  request: TimeOffRequest;
  isLast: boolean;
  onClick: () => void;
}) {
  const name = request.technicianName || 'Unknown';
  const initials = name.substring(0, 2).toUpperCase();
  const badge = getStatusBadge(request.status);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex min-h-[72px] cursor-pointer items-center pl-4 transition-colors active:bg-gray-50"
      onClick={onClick}
    >
      {/* Avatar */}
      <div className="mr-3 flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#FF9500] to-[#FF5E3A] text-[13px] font-bold text-white shadow-sm">
        {initials}
      </div>

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-medium text-[#1C1C1E]">
            {name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#8E8E93]">
            <Calendar className="size-3.5" />
            {formatDateRange(request.startDate, request.endDate)}
          </div>
        </div>

        <div className="ml-2 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}
          >
            {badge.label}
          </span>
          <ChevronRight className="size-4 text-[#C7C7CC]" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Empty State
 */
function EmptyState({
  filter,
  searchQuery,
}: {
  filter: StatusFilter;
  searchQuery: string;
}) {
  const getMessage = () => {
    if (searchQuery) {
      return `No requests matching "${searchQuery}"`;
    }
    switch (filter) {
      case 'PENDING':
        return 'No pending time-off requests';
      case 'APPROVED':
        return 'No approved requests yet';
      case 'DENIED':
        return 'No denied requests';
      default:
        return 'No time-off requests yet';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center px-8 py-20">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#F2F2F7]">
        <Calendar className="size-8 text-[#8E8E93]" />
      </div>
      <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">
        {searchQuery ? 'No Results' : 'All Clear'}
      </h3>
      <p className="text-center text-[15px] text-[#8E8E93]">{getMessage()}</p>
    </div>
  );
}

/**
 * Request Detail Panel (Slide-over)
 */
function RequestDetailPanel({
  request,
  onClose,
  onDecision,
  isSubmitting,
}: {
  request: RequestDetail;
  onClose: () => void;
  onDecision: (status: 'APPROVED' | 'DENIED') => void;
  isSubmitting: boolean;
}) {
  const name = request.technicianName || 'Unknown';
  const badge = getStatusBadge(request.status);
  const hasConflicts = request.conflicts.appointmentCount > 0;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex h-[56px] items-center justify-between border-b border-gray-100 px-4">
        <button
          type="button"
          onClick={onClose}
          className="text-[17px] font-medium text-[#007AFF]"
        >
          Close
        </button>
        <span className="text-[17px] font-semibold text-[#1C1C1E]">
          Request Details
        </span>
        <div className="w-12" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Technician Info */}
        <div className="border-b border-gray-100 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[#FF9500] to-[#FF5E3A] text-[15px] font-bold text-white">
              {name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-[18px] font-semibold text-[#1C1C1E]">
                {name}
              </div>
              <span
                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold ${badge.bg} ${badge.text}`}
              >
                {badge.label}
              </span>
            </div>
          </div>
        </div>

        {/* Date Range */}
        <div className="border-b border-gray-100 p-4">
          <div className="mb-1 text-[13px] uppercase tracking-wide text-[#8E8E93]">
            Requested Dates
          </div>
          <div className="flex items-center gap-2 text-[17px] font-medium text-[#1C1C1E]">
            <Calendar className="size-5 text-[#FF9500]" />
            {formatDateRange(request.startDate, request.endDate)}
          </div>
        </div>

        {/* Note */}
        {request.note && (
          <div className="border-b border-gray-100 p-4">
            <div className="mb-1 text-[13px] uppercase tracking-wide text-[#8E8E93]">
              Note
            </div>
            <div className="text-[15px] text-[#1C1C1E]">{request.note}</div>
          </div>
        )}

        {/* Conflict Warning */}
        {hasConflicts && (
          <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div>
                <div className="text-[15px] font-semibold text-amber-800">
                  {request.conflicts.appointmentCount}
                  {' '}
                  appointment
                  {request.conflicts.appointmentCount !== 1 ? 's' : ''}
                  {' '}
                  affected
                </div>
                <div className="mt-0.5 text-[13px] text-amber-700">
                  There are appointments scheduled during this time-off period.
                </div>
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1 text-[14px] font-medium text-[#007AFF]"
                  onClick={() => {
                    // Navigate to bookings - for MVP, just close and let admin use main nav
                    onClose();
                  }}
                >
                  View schedule
                  <ExternalLink className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Created At */}
        <div className="border-b border-gray-100 p-4">
          <div className="mb-1 text-[13px] uppercase tracking-wide text-[#8E8E93]">
            Submitted
          </div>
          <div className="flex items-center gap-2 text-[15px] text-[#1C1C1E]">
            <Clock className="size-4 text-[#8E8E93]" />
            {formatDateTime(request.createdAt)}
          </div>
        </div>

        {/* Decision Info (if decided) */}
        {request.status !== 'PENDING' && request.decidedAt && (
          <div className="border-b border-gray-100 p-4">
            <div className="mb-1 text-[13px] uppercase tracking-wide text-[#8E8E93]">
              Decision
            </div>
            <div className="text-[15px] text-[#1C1C1E]">
              <span className="font-medium">
                {request.status === 'APPROVED' ? 'Approved' : 'Denied'}
              </span>
              {request.decidedBy && (
                <span className="text-[#8E8E93]">
                  {' '}
                  by
                  {request.decidedBy}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[13px] text-[#8E8E93]">
              {formatDateTime(request.decidedAt)}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons (only for PENDING) */}
      {request.status === 'PENDING' && (
        <div className="flex gap-3 border-t border-gray-100 bg-[#F2F2F7] p-4">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onDecision('DENIED')}
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-[17px] font-semibold text-[#FF3B30] transition-colors active:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-5" />
            Deny
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onDecision('APPROVED')}
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#34C759] text-[17px] font-semibold text-white transition-colors active:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="size-5" />
            Approve
          </button>
        </div>
      )}
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TimeOffRequestsInbox() {
  // State
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<RequestDetail | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch requests
  const fetchRequests = useCallback(async () => {
    try {
      setError(null);
      const statusParam
        = statusFilter === 'ALL' ? '' : `&status=${statusFilter}`;
      const response = await fetch(
        `/api/admin/time-off-requests?${statusParam}`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch requests');
      }

      const data = await response.json();
      setRequests(data.data?.requests ?? []);
    } catch (err) {
      console.error('Error fetching time-off requests:', err);
      setError('Failed to load requests. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Fetch single request detail with conflicts
  const fetchRequestDetail = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/admin/time-off-requests/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch request details');
      }
      const data = await response.json();
      setSelectedRequest({
        ...data.data.request,
        conflicts: data.data.conflicts,
      });
    } catch (err) {
      console.error('Error fetching request detail:', err);
    }
  }, []);

  // Handle decision
  const handleDecision = useCallback(
    async (status: 'APPROVED' | 'DENIED') => {
      if (!selectedRequest) {
        return;
      }

      setIsSubmitting(true);
      try {
        const response = await fetch(
          `/api/admin/time-off-requests/${selectedRequest.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error?.message || 'Failed to update request');
        }

        // Refresh list and close panel
        await fetchRequests();
        setSelectedRequest(null);
      } catch (err) {
        console.error('Error updating request:', err);
        // eslint-disable-next-line no-alert -- no toast system yet (TODO: replace with toast)
        alert(err instanceof Error ? err.message : 'Failed to update request');
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedRequest, fetchRequests],
  );

  // Filter requests by search query (client-side)
  const filteredRequests = requests.filter((req) => {
    if (!searchQuery) {
      return true;
    }
    const name = req.technicianName?.toLowerCase() ?? '';
    return name.includes(searchQuery.toLowerCase());
  });

  // Count pending for badge
  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <div className="size-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-20">
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="size-8 text-red-500" />
        </div>
        <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">
          Something went wrong
        </h3>
        <p className="mb-4 text-center text-[15px] text-[#8E8E93]">{error}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            fetchRequests();
          }}
          className="rounded-lg bg-[#007AFF] px-4 py-2 text-[15px] font-medium text-white"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-[#F2F2F7]">
      {/* Filters */}
      <div className="border-b border-gray-100 bg-white pt-3">
        <StatusTabs
          selected={statusFilter}
          onChange={setStatusFilter}
          counts={{
            pending: pendingCount,
            approved: 0,
            denied: 0,
          }}
        />
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filteredRequests.length === 0
          ? (
              <EmptyState filter={statusFilter} searchQuery={searchQuery} />
            )
          : (
              <div className="mx-4 mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
                {filteredRequests.map((request, idx) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    isLast={idx === filteredRequests.length - 1}
                    onClick={() => fetchRequestDetail(request.id)}
                  />
                ))}
              </div>
            )}
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedRequest && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setSelectedRequest(null)}
            />
            <RequestDetailPanel
              request={selectedRequest}
              onClose={() => setSelectedRequest(null)}
              onDecision={handleDecision}
              isSubmitting={isSubmitting}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
