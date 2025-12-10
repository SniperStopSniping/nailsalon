'use client';

import { ChevronLeft, ChevronRight, Clock, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

interface AuditLog {
  id: string;
  action: string;
  performedBy: string;
  performedByEmail: string | null;
  metadata: {
    previousValue?: unknown;
    newValue?: unknown;
    field?: string;
    details?: string;
  } | null;
  createdAt: string;
}

interface AuditLogTableProps {
  salonId: string;
  limit?: number;
}

// =============================================================================
// Helpers
// =============================================================================

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  created: { label: 'Created', color: 'bg-green-100 text-green-800' },
  updated: { label: 'Updated', color: 'bg-blue-100 text-blue-800' },
  deleted: { label: 'Deleted', color: 'bg-red-100 text-red-800' },
  restored: { label: 'Restored', color: 'bg-emerald-100 text-emerald-800' },
  owner_changed: { label: 'Owner Changed', color: 'bg-purple-100 text-purple-800' },
  plan_changed: { label: 'Plan Changed', color: 'bg-indigo-100 text-indigo-800' },
  status_changed: { label: 'Status Changed', color: 'bg-amber-100 text-amber-800' },
  data_reset: { label: 'Data Reset', color: 'bg-red-100 text-red-800' },
  location_added: { label: 'Location Added', color: 'bg-cyan-100 text-cyan-800' },
  location_updated: { label: 'Location Updated', color: 'bg-cyan-100 text-cyan-800' },
  location_deleted: { label: 'Location Deleted', color: 'bg-red-100 text-red-800' },
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// =============================================================================
// Component
// =============================================================================

export function AuditLogTable({ salonId, limit = 10 }: AuditLogTableProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/logs?page=${page}&limit=${limit}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch logs');
      }

      const data = await response.json();
      setLogs(data.logs || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalCount(data.pagination?.totalCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [salonId, page, limit]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No activity logs yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Logs */}
      <div className="space-y-2">
        {logs.map((log) => {
          const actionConfig = ACTION_LABELS[log.action] || {
            label: log.action,
            color: 'bg-gray-100 text-gray-800',
          };

          return (
            <div
              key={log.id}
              className="p-3 bg-gray-50 rounded-lg border border-gray-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${actionConfig.color}`}
                  >
                    {actionConfig.label}
                  </span>
                  <div className="min-w-0">
                    {log.metadata?.details && (
                      <div className="text-sm text-gray-900 truncate">
                        {log.metadata.details}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span className="truncate max-w-[150px]">
                          {log.performedByEmail || 'Unknown'}
                        </span>
                      </div>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatDate(log.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="text-xs text-gray-500">
            {totalCount} total entries
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              aria-label="Previous page"
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-600">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || loading}
              aria-label="Next page"
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
