'use client';

import { X, AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';

// =============================================================================
// Types
// =============================================================================

interface DeleteSalonModalProps {
  isOpen: boolean;
  onClose: () => void;
  salonId: string;
  salonName: string;
  salonSlug: string;
  isDeleted: boolean; // true if already soft-deleted
  onSuccess: () => void;
}

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
  const [deleteType, setDeleteType] = useState<'soft' | 'hard'>('soft');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredConfirmText = deleteType === 'hard' ? salonSlug : 'DELETE';
  const isConfirmed = confirmText === requiredConfirmText;

  const handleDelete = async () => {
    if (!isConfirmed) return;

    setLoading(true);
    setError(null);

    try {
      const url = deleteType === 'hard'
        ? `/api/super-admin/organizations/${salonId}?hard=true`
        : `/api/super-admin/organizations/${salonId}`;

      const response = await fetch(url, {
        method: 'DELETE',
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
    setDeleteType('soft');
    setConfirmText('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Delete Salon</h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close modal"
              className="p-2 -m-2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              You are about to delete <strong>{salonName}</strong>. This is a destructive action.
            </p>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Delete Type Selection */}
            <div className="space-y-3">
              {!isDeleted && (
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="deleteType"
                    checked={deleteType === 'soft'}
                    onChange={() => setDeleteType('soft')}
                    className="mt-0.5 w-4 h-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Soft Delete</div>
                    <div className="text-xs text-gray-500">
                      Mark salon as deleted but preserve all data. Can be restored later.
                    </div>
                  </div>
                </label>
              )}

              <label className="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50 cursor-pointer">
                <input
                  type="radio"
                  name="deleteType"
                  checked={deleteType === 'hard'}
                  onChange={() => setDeleteType('hard')}
                  className="mt-0.5 w-4 h-4 border-gray-300 text-red-600 focus:ring-red-500"
                />
                <div>
                  <div className="font-medium text-red-900">Permanent Delete</div>
                  <div className="text-xs text-red-700">
                    Remove ALL data permanently: appointments, clients, staff, services, rewards.
                    This CANNOT be undone.
                  </div>
                </div>
              </label>
            </div>

            {/* Confirmation */}
            <div className="pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {deleteType === 'hard' ? (
                  <>Type <strong>{salonSlug}</strong> to confirm permanent deletion</>
                ) : (
                  <>Type <strong>DELETE</strong> to confirm</>
                )}
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={requiredConfirmText}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            {/* Warning for hard delete */}
            {deleteType === 'hard' && (
              <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-red-800">
                    <strong>Warning:</strong> This will permanently delete:
                    <ul className="mt-1 ml-4 list-disc">
                      <li>All appointments and booking history</li>
                      <li>All services and pricing</li>
                      <li>All technicians and schedules</li>
                      <li>All client preferences</li>
                      <li>All rewards and referrals</li>
                      <li>All photos and media</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
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
              className={`inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                deleteType === 'hard'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {deleteType === 'hard' ? 'Delete Permanently' : 'Soft Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
