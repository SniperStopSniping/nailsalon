'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AppointmentData } from './StaffAppointmentCard';

// =============================================================================
// Cappuccino Design Tokens
// =============================================================================

const cappuccino = {
  title: '#6F4E37',
  cardBg: '#FAF8F5',
  cardBorder: '#E6DED6',
  primary: '#4B2E1E',
  secondary: '#EADBC8',
  secondaryText: '#4B2E1E',
};

// =============================================================================
// Types
// =============================================================================

type ActionBarProps = {
  appointment: AppointmentData;
  onOpenPhotos: () => void;
  onClose: () => void;
  /** Whether before photo is required by policy */
  requireBeforePhoto?: boolean;
  /** Whether after photo is required by policy */
  requireAfterPhoto?: boolean;
};

// =============================================================================
// Action Bar Component
// =============================================================================

export function ActionBar({
  appointment,
  onOpenPhotos,
  onClose,
  requireBeforePhoto = false,
  requireAfterPhoto = false,
}: ActionBarProps) {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine current canvas state
  const canvasState = appointment.canvasState || mapLegacyStatus(appointment.status);
  const hasBeforePhoto = appointment.photos.some(p => p.photoType === 'before');
  const hasAfterPhoto = appointment.photos.some(p => p.photoType === 'after');

  // Policy gating
  const canStart = !requireBeforePhoto || hasBeforePhoto;
  const canComplete = !requireAfterPhoto || hasAfterPhoto;

  // =============================================================================
  // Transition Handler
  // =============================================================================

  const handleTransition = async (to: 'working' | 'complete' | 'cancelled' | 'no_show') => {
    if (isTransitioning) {
      return;
    }

    setIsTransitioning(true);
    setError(null);

    try {
      const response = await fetch(`/api/appointments/${appointment.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });

      if (!response.ok) {
        const data = await response.json();
        const reason = data.error?.reason || data.error?.message || 'Transition failed';

        // Map reason codes to friendly messages
        const friendlyMessages: Record<string, string> = {
          before_photo_required_to_start: '☕️ Before photo required to start.',
          after_photo_required_to_complete: '☕️ Final photo required to complete.',
          already_terminal: 'This appointment is already completed.',
          invalid_transition: 'This action is not available right now.',
        };

        setError(friendlyMessages[reason] || reason);
        return;
      }

      // Success - refresh to get updated data
      router.refresh();
      onClose();
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error('Transition error:', err);
    } finally {
      setIsTransitioning(false);
    }
  };

  // =============================================================================
  // Render
  // =============================================================================

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;

  return (
    <div
      role="button"
      tabIndex={0}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isTransitioning) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isTransitioning) {
          onClose();
        }
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl shadow-2xl sm:rounded-2xl"
        style={{ backgroundColor: cappuccino.cardBg }}
      >
        <div className="p-6">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2
              className="text-xl font-semibold"
              style={{ color: cappuccino.title }}
            >
              Appointment Actions
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={isTransitioning}
              className="text-2xl text-neutral-400 transition-colors hover:text-neutral-600 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          {/* Client Info */}
          <div
            className="mb-4 rounded-xl p-3"
            style={{ backgroundColor: cappuccino.secondary }}
          >
            <div
              className="font-medium"
              style={{ color: cappuccino.secondaryText }}
            >
              {appointment.clientName || 'Client'}
            </div>
            <div className="text-sm text-neutral-600">
              {appointment.services.map(s => s.name).join(', ')}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-sm text-neutral-500">
                {formatTime(appointment.startTime)}
                {' '}
                –
                {formatTime(appointment.endTime)}
              </span>
              <span
                className="font-bold"
                style={{ color: cappuccino.title }}
              >
                {formatPrice(appointment.totalPrice)}
              </span>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Policy Gating Hints */}
          {canvasState === 'waiting' && !canStart && (
            <div
              className="mb-4 rounded-xl p-3 text-sm"
              style={{ backgroundColor: cappuccino.secondary, color: cappuccino.secondaryText }}
            >
              ☕️ Before photo required to start.
            </div>
          )}

          {canvasState === 'wrap_up' && !canComplete && (
            <div
              className="mb-4 rounded-xl p-3 text-sm"
              style={{ backgroundColor: cappuccino.secondary, color: cappuccino.secondaryText }}
            >
              ☕️ Final photo required to complete.
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Start Service - only in waiting state */}
            {canvasState === 'waiting' && (
              <button
                type="button"
                onClick={() => handleTransition('working')}
                disabled={isTransitioning || !canStart}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: cappuccino.primary }}
              >
                {isTransitioning ? 'Starting...' : '▶ Start Service'}
              </button>
            )}

            {/* Add Photos - available in waiting, working, wrap_up */}
            {['waiting', 'working', 'wrap_up'].includes(canvasState) && (
              <button
                type="button"
                onClick={onOpenPhotos}
                disabled={isTransitioning}
                className="w-full rounded-xl py-3 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{
                  backgroundColor: cappuccino.secondary,
                  color: cappuccino.secondaryText,
                }}
              >
                📸 Add Photos
              </button>
            )}

            {/* Complete - only in wrap_up state (or working if no wrap_up step) */}
            {(canvasState === 'wrap_up' || canvasState === 'working') && (
              <button
                type="button"
                onClick={() => handleTransition('complete')}
                disabled={isTransitioning || !canComplete}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: '#059669' }}
              >
                {isTransitioning ? 'Completing...' : '✓ Complete & Close'}
              </button>
            )}

            {/* Cancel - available in non-terminal states */}
            {['waiting', 'working', 'wrap_up'].includes(canvasState) && (
              <button
                type="button"
                onClick={() => handleTransition('cancelled')}
                disabled={isTransitioning}
                className="w-full rounded-xl py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                Cancel Appointment
              </button>
            )}
          </div>

          {/* Terminal State Message */}
          {['complete', 'cancelled', 'no_show'].includes(canvasState) && (
            <div className="mt-4 text-center text-sm text-neutral-500">
              This appointment is
              {' '}
              {canvasState === 'complete' ? 'completed' : canvasState}
              .
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helper: Map legacy status to canvas state
// =============================================================================

function mapLegacyStatus(status: string): string {
  const mapping: Record<string, string> = {
    pending: 'waiting',
    confirmed: 'waiting',
    in_progress: 'working',
    completed: 'complete',
    cancelled: 'cancelled',
    no_show: 'no_show',
  };
  return mapping[status] || 'waiting';
}

export default ActionBar;
