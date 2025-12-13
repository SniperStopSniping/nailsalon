'use client';

import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type ResetDataModalProps = {
  isOpen: boolean;
  onClose: () => void;
  salonId: string;
  salonName: string;
  onSuccess: () => void;
};

type ResetOptions = {
  appointments: boolean;
  clients: boolean;
  staff: boolean;
  rewards: boolean;
};

// =============================================================================
// Component
// =============================================================================

export function ResetDataModal({ isOpen, onClose, salonId, salonName, onSuccess }: ResetDataModalProps) {
  const [options, setOptions] = useState<ResetOptions>({
    appointments: false,
    clients: false,
    staff: false,
    rewards: false,
  });
  const [resetAll, setResetAll] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOptionChange = (key: keyof ResetOptions) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
    setResetAll(false);
  };

  const handleResetAllChange = () => {
    const newValue = !resetAll;
    setResetAll(newValue);
    if (newValue) {
      setOptions({
        appointments: true,
        clients: true,
        staff: true,
        rewards: true,
      });
    }
  };

  const hasSelection = Object.values(options).some(v => v) || resetAll;
  const isConfirmed = confirmText === 'RESET';

  const handleReset = async () => {
    if (!hasSelection || !isConfirmed) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetAll ? { all: true } : options),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reset data');
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
    setOptions({ appointments: false, clients: false, staff: false, rewards: false });
    setResetAll(false);
    setConfirmText('');
    setError(null);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="size-5 text-amber-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Reset Salon Data</h2>
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
              Select the data you want to reset for
              {' '}
              <strong>{salonName}</strong>
              . This action cannot be undone.
            </p>

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Options */}
            <div className="space-y-3">
              {/* Reset All */}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <input
                  type="checkbox"
                  checked={resetAll}
                  onChange={handleResetAllChange}
                  className="size-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <div>
                  <div className="font-medium text-red-900">Reset ALL Data</div>
                  <div className="text-xs text-red-700">Clear everything below</div>
                </div>
              </label>

              <div className="my-2 border-t border-gray-100" />

              {/* Individual Options */}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={options.appointments}
                  onChange={() => handleOptionChange('appointments')}
                  className="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium text-gray-900">Appointments</div>
                  <div className="text-xs text-gray-500">All bookings, services, photos</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={options.clients}
                  onChange={() => handleOptionChange('clients')}
                  className="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium text-gray-900">Client Preferences</div>
                  <div className="text-xs text-gray-500">Saved preferences, favorites</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={options.staff}
                  onChange={() => handleOptionChange('staff')}
                  className="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium text-gray-900">Staff / Technicians</div>
                  <div className="text-xs text-gray-500">All techs, schedules, time off</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={options.rewards}
                  onChange={() => handleOptionChange('rewards')}
                  className="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium text-gray-900">Rewards & Referrals</div>
                  <div className="text-xs text-gray-500">Points, referral history</div>
                </div>
              </label>
            </div>

            {/* Confirmation */}
            {hasSelection && (
              <div className="border-t border-gray-200 pt-4">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Type
                  {' '}
                  <strong>RESET</strong>
                  {' '}
                  to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="RESET"
                  className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                />
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
              onClick={handleReset}
              disabled={loading || !hasSelection || !isConfirmed}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? (
                    <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )
                : (
                    <Trash2 className="size-4" />
                  )}
              Reset Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
