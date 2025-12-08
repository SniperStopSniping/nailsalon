'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, User } from 'lucide-react';

import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

interface ClientData {
  clientPhone: string;
  clientName: string;
  totalVisits: number;
  totalSpent: number;
  lastVisit: string | null;
  firstVisit: string | null;
}

interface ClientsTabProps {
  technicianId: string;
}

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
  if (!dateString) return 'Never';
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
    if (!salonSlug) return;

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
        `/api/admin/technicians/${technicianId}/clients?${params}`
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
        setClients((prev) => [...prev, ...newClients]);
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
    if (!hasMore || loading) return;
    setPage((prev) => prev + 1);
  };

  useEffect(() => {
    if (page > 1) {
      fetchClients(false);
    }
  }, [page]);

  return (
    <div className="p-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search clients..."
          className="w-full pl-10 pr-4 py-2.5 bg-[#E5E5EA] rounded-xl text-[15px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none"
        />
      </div>

      {/* Count */}
      <p className="text-[13px] text-[#8E8E93] px-1">
        {total} client{total !== 1 ? 's' : ''} served
      </p>

      {/* Client List */}
      {loading && clients.length === 0 ? (
        <LoadingSkeleton />
      ) : clients.length === 0 ? (
        <EmptyState searchQuery={searchQuery} />
      ) : (
        <div className="bg-white rounded-[12px] overflow-hidden">
          {clients.map((client, index) => (
            <div
              key={client.clientPhone}
              className={`flex items-center p-4 ${
                index !== clients.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              {/* Avatar */}
              <div className="w-12 h-12 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#8E8E93] mr-3">
                <User className="w-6 h-6" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-[17px] font-medium text-[#1C1C1E] truncate">
                  {client.clientName}
                </div>
                <div className="text-[13px] text-[#8E8E93]">
                  {client.totalVisits} visit{client.totalVisits !== 1 ? 's' : ''} · Last: {formatDate(client.lastVisit)}
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
              className="w-full py-3 text-[#007AFF] text-[15px] font-medium border-t border-gray-100"
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
    <div className="bg-white rounded-[12px] overflow-hidden animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center p-4 border-b border-gray-100">
          <div className="w-12 h-12 rounded-full bg-gray-200 mr-3" />
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-24" />
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
    <div className="flex flex-col items-center justify-center py-12 px-8">
      <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
        <User className="w-8 h-8 text-[#8E8E93]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#1C1C1E] mb-1">
        {searchQuery ? 'No Results' : 'No Clients Yet'}
      </h3>
      <p className="text-[15px] text-[#8E8E93] text-center">
        {searchQuery
          ? `No clients found matching "${searchQuery}"`
          : 'This staff member has not served any clients yet'}
      </p>
    </div>
  );
}
