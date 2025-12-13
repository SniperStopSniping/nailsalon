'use client';

import { ChevronLeft, ChevronRight, Clock, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type AuditLog = {
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
};

type AuditLogTableProps = {
  salonId: string;
  limit?: number;
};

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
        `/api/super-admin/organizations/${salonId}/logs?page=${page}&limit=${limit}`,
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
      <div className="flex h-32 items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
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
              className="rounded-lg border border-gray-100 bg-gray-50 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${actionConfig.color}`}
                  >
                    {actionConfig.label}
                  </span>
                  <div className="min-w-0">
                    {log.metadata?.details && (
                      <div className="truncate text-sm text-gray-900">
                        {log.metadata.details}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <User className="size-3" />
                        <span className="max-w-[150px] truncate">
                          {log.performedByEmail || 'Unknown'}
                        </span>
                      </div>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        <Clock className="size-3" />
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
        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <div className="text-xs text-gray-500">
            {totalCount}
            {' '}
            total entries
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              aria-label="Previous page"
              className="rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs text-gray-600">
              {page}
              {' '}
              /
              {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || loading}
              aria-label="Next page"
              className="rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
