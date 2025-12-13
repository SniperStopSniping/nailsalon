'use client';

import { Search, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

type ClientData = {
  clientPhone: string;
  clientName: string;
  totalVisits: number;
  totalSpent: number;
  lastVisit: string | null;
  firstVisit: string | null;
};

type ClientsTabProps = {
  technicianId: string;
};

// =============================================================================
// Helpers
// =============================================================================

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return 'Never';
  }
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// =============================================================================
// Component
// =============================================================================

export function ClientsTab({ technicianId }: ClientsTabProps) {
  const { salonSlug } = useSalon();
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const fetchClients = useCallback(async (resetPage = false) => {
    if (!salonSlug) {
      return;
    }

    const currentPage = resetPage ? 1 : page;

    try {
      setLoading(true);
      const params = new URLSearchParams({
        salonSlug,
        page: String(currentPage),
        limit: '20',
        ...(searchQuery && { search: searchQuery }),
      });

      const response = await fetch(
        `/api/admin/technicians/${technicianId}/clients?${params}`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch clients');
      }

      const result = await response.json();
      const newClients = result.data?.clients ?? [];
      const pagination = result.data?.pagination ?? {};

      if (resetPage) {
        setClients(newClients);
        setPage(1);
      } else {
        setClients(prev => [...prev, ...newClients]);
      }

      setTotal(pagination.total ?? 0);
      setHasMore(currentPage < (pagination.totalPages ?? 1));
    } catch (err) {
      console.error('Error fetching clients:', err);
    } finally {
      setLoading(false);
    }
  }, [salonSlug, technicianId, searchQuery, page]);

  useEffect(() => {
    fetchClients(true);
  }, [salonSlug, technicianId, searchQuery]);

  const loadMore = () => {
    if (!hasMore || loading) {
      return;
    }
    setPage(prev => prev + 1);
  };

  useEffect(() => {
    if (page > 1) {
      fetchClients(false);
    }
  }, [page]);

  return (
    <div className="space-y-4 p-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8E8E93]" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search clients..."
          className="w-full rounded-xl bg-[#E5E5EA] py-2.5 pl-10 pr-4 text-[15px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none"
        />
      </div>

      {/* Count */}
      <p className="px-1 text-[13px] text-[#8E8E93]">
        {total}
        {' '}
        client
        {total !== 1 ? 's' : ''}
        {' '}
        served
      </p>

      {/* Client List */}
      {loading && clients.length === 0 ? (
        <LoadingSkeleton />
      ) : clients.length === 0 ? (
        <EmptyState searchQuery={searchQuery} />
      ) : (
        <div className="overflow-hidden rounded-[12px] bg-white">
          {clients.map((client, index) => (
            <div
              key={client.clientPhone}
              className={`flex items-center p-4 ${
                index !== clients.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              {/* Avatar */}
              <div className="mr-3 flex size-12 items-center justify-center rounded-full bg-[#F2F2F7] text-[#8E8E93]">
                <User className="size-6" />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-medium text-[#1C1C1E]">
                  {client.clientName}
                </div>
                <div className="text-[13px] text-[#8E8E93]">
                  {client.totalVisits}
                  {' '}
                  visit
                  {client.totalVisits !== 1 ? 's' : ''}
                  {' '}
                  · Last:
                  {formatDate(client.lastVisit)}
                </div>
              </div>

              {/* Total Spent */}
              <div className="text-right">
                <div className="text-[15px] font-semibold text-[#34C759]">
                  {formatCurrency(client.totalSpent)}
                </div>
                <div className="text-[11px] text-[#8E8E93]">total</div>
              </div>
            </div>
          ))}

          {/* Load More */}
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="w-full border-t border-gray-100 py-3 text-[15px] font-medium text-[#007AFF]"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-[12px] bg-white">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="flex items-center border-b border-gray-100 p-4">
          <div className="mr-3 size-12 rounded-full bg-gray-200" />
          <div className="flex-1">
            <div className="mb-2 h-4 w-32 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Empty State
// =============================================================================

function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-12">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#F2F2F7]">
        <User className="size-8 text-[#8E8E93]" />
      </div>
      <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">
        {searchQuery ? 'No Results' : 'No Clients Yet'}
      </h3>
      <p className="text-center text-[15px] text-[#8E8E93]">
        {searchQuery
          ? `No clients found matching "${searchQuery}"`
          : 'This staff member has not served any clients yet'}
      </p>
    </div>
  );
}
