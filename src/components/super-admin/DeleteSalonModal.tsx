'use client';

import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type DeleteSalonModalProps = {
  isOpen: boolean;
  onClose: () => void;
  salonId: string;
  salonName: string;
  salonSlug: string;
  isDeleted: boolean; // true if already soft-deleted
  onSuccess: () => void;
};

// =============================================================================
// Component
// =============================================================================

export function DeleteSalonModal({
  isOpen,
  onClose,
  salonId,
  salonName,
  salonSlug,
  isDeleted,
  onSuccess,
}: DeleteSalonModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ tables: Record<string, number>; totalRows: number } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  // The mode follows the salon's state rather than a radio the operator can get
  // out of sync with. The API enforces the same rule: permanent deletion is only
  // reachable once a salon has been archived, so an active salon with live
  // bookings can never be destroyed in a single action.
  const deleteType: 'soft' | 'hard' = isDeleted ? 'hard' : 'soft';

  // Biggest tables first — that is what an operator scans for when checking they
  // picked the right salon.
  const impactRows = impact ? Object.entries(impact.tables).sort(([, a], [, b]) => b - a) : [];

  const requiredConfirmText = deleteType === 'hard' ? salonSlug : 'DELETE';
  // Guard the empty case: SalonDetailPanel passes `salon?.slug || ''` while the
  // salon is still loading, which would otherwise arm the button with no typing.
  const isConfirmed = requiredConfirmText.length > 0 && confirmText.trim() === requiredConfirmText;

  // Dry run of the real purge plan, so the operator confirms against actual row
  // counts rather than a hardcoded list of categories.
  useEffect(() => {
    if (!isOpen || !salonId) {
      return;
    }

    let cancelled = false;
    setImpactLoading(true);

    fetch(`/api/super-admin/organizations/${salonId}/impact`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('unavailable');
        }
        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setImpact({ tables: data.tables ?? {}, totalRows: data.totalRows ?? 0 });
        }
      })
      .catch(() => {
        // The preview is an aid, not a gate — deletion still works without it.
        if (!cancelled) {
          setImpact(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setImpactLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, salonId]);

  const handleDelete = async () => {
    if (!isConfirmed) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = deleteType === 'hard'
        ? `/api/super-admin/organizations/${salonId}?hard=true`
        : `/api/super-admin/organizations/${salonId}`;

      const response = await fetch(url, {
        method: 'DELETE',
        ...(deleteType === 'hard'
          ? {
              headers: { 'Content-Type': 'application/json' },
              // Re-checked server-side against the stored slug.
              body: JSON.stringify({ confirmSlug: confirmText.trim() }),
            }
          : {}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete salon');
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setConfirmText('');
    setError(null);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/*
        Backdrop. A real <button> so the click handler sits on an interactive
        element, but hidden from assistive tech and the tab order: it would
        otherwise be a second, unlabelled "close" control duplicating the X
        button, which is the keyboard affordance.
      */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="fixed inset-0 size-full cursor-default bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="size-5 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Delete Salon</h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close modal"
              className="-m-2 p-2 text-gray-400 hover:text-gray-600"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Content */}
          <div className="space-y-4 p-6">
            <p className="text-sm text-gray-600">
              You are about to delete
              {' '}
              <strong>{salonName}</strong>
              . This is a destructive action.
            </p>

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* What this action does. Determined by the salon's state, not a radio. */}
            {deleteType === 'soft'
              ? (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="font-medium text-gray-900">Archive Salon</div>
                    <div className="text-xs text-gray-500">
                      Marks the salon as deleted and takes it offline, but preserves all data.
                      You can restore it at any time. To destroy the data permanently, archive it
                      first, then use Delete Permanently.
                    </div>
                  </div>
                )
              : (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <div className="font-medium text-red-900">Permanent Delete</div>
                    <div className="text-xs text-red-700">
                      Remove ALL data permanently: appointments, clients, staff, services, rewards.
                      This CANNOT be undone.
                    </div>
                  </div>
                )}

            {/* Confirmation */}
            <div className="border-t border-gray-200 pt-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {deleteType === 'hard'
                  ? (
                      <>
                        Type
                        {' '}
                        <strong>{salonSlug}</strong>
                        {' '}
                        to confirm permanent deletion
                      </>
                    )
                  : (
                      <>
                        Type
                        {' '}
                        <strong>DELETE</strong>
                        {' '}
                        to confirm
                      </>
                    )}
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={requiredConfirmText}
                className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Warning for hard delete, showing the real rows about to be destroyed */}
            {deleteType === 'hard' && (
              <div className="rounded-lg border border-red-200 bg-red-100 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
                  <div className="min-w-0 flex-1 text-xs text-red-800">
                    <strong>Warning:</strong>
                    {' '}
                    This will permanently delete
                    {impact ? ` ${impact.totalRows.toLocaleString()} rows:` : ' all data for this salon.'}

                    {impactLoading && <div className="mt-1 text-red-700">Counting affected records…</div>}

                    {impact && impactRows.length > 0 && (
                      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                        {impactRows.map(([table, count]) => (
                          <li key={table} className="flex justify-between gap-3">
                            <span className="truncate font-mono">{table}</span>
                            <span className="shrink-0 font-semibold">{count.toLocaleString()}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {impact && impactRows.length === 0 && !impactLoading && (
                      <div className="mt-1">This salon has no remaining data rows.</div>
                    )}

                    <div className="mt-2 font-semibold">This CANNOT be undone.</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading || !isConfirmed}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                deleteType === 'hard'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {loading
                ? (
                    <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )
                : (
                    <Trash2 className="size-4" />
                  )}
              {deleteType === 'hard' ? 'Delete Permanently' : 'Archive Salon'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
