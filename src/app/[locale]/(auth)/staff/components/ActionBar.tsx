'use client';

import { useRef, useState } from 'react';

import { CheckoutSheet } from '@/components/appointments/CheckoutSheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import { formatMoney } from '@/libs/formatMoney';

import { ReviewFollowupModal } from './ReviewFollowupModal';
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const transitionInFlightRef = useRef(false);
  // 'actions' = status buttons; 'completing' = complete form; 'review' = review prompt
  const [view, setView] = useState<'actions' | 'completing' | 'review'>('actions');

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

  const handleTransition = async (to: 'working' | 'cancelled' | 'no_show') => {
    if (transitionInFlightRef.current) {
      return;
    }

    transitionInFlightRef.current = true;
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
        const reason = data.error?.reason || data.error?.code || data.error?.message || 'Transition failed';

        // Map reason codes to friendly messages
        const friendlyMessages: Record<string, string> = {
          before_photo_required_to_start: '☕️ Before photo required to start.',
          after_photo_required_to_complete: '☕️ Final photo required to complete.',
          PHOTOS_REQUIRED: '☕️ Final photo required to complete.',
          already_terminal: 'This appointment is already completed.',
          invalid_transition: 'This action is not available right now.',
        };

        setError(friendlyMessages[reason] || reason);
        return;
      }

      onClose();
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error('Transition error:', err);
    } finally {
      transitionInFlightRef.current = false;
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

  const formatPrice = (cents: number) => appointment.invoiceCurrency
    ? formatMoney(cents, appointment.invoiceCurrency)
    : 'Unavailable';

  // Completion checkout overlay (sits above the action bar) — the same
  // Complete-appointment flow every other surface uses.
  if (view === 'completing') {
    return (
      <CheckoutSheet
        isOpen
        appointmentId={appointment.id}
        onClose={() => setView('actions')}
        onCompleted={({ showReviewPrompt }) => {
          if (showReviewPrompt) {
            setView('review');
          } else {
            onClose();
          }
        }}
      />
    );
  }

  // Post-completion review follow-up prompt
  if (view === 'review') {
    return (
      <ReviewFollowupModal
        appointmentId={appointment.id}
        clientName={appointment.clientName}
        onDone={onClose}
      />
    );
  }

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      closeOnBackdrop={!isTransitioning}
      closeOnEscape={!isTransitioning}
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      maxWidthClassName="max-w-md"
      contentClassName="max-h-[90vh] touch-pan-y overflow-y-auto overscroll-contain rounded-t-2xl shadow-2xl sm:rounded-2xl"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-appointment-actions-title"
        className="w-full"
        style={{ backgroundColor: cappuccino.cardBg }}
      >
        <div className="p-6">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2
              id="staff-appointment-actions-title"
              className="text-xl font-semibold"
              style={{ color: cappuccino.title }}
            >
              Appointment Actions
            </h2>
            <button
              type="button"
              aria-label="Close appointment actions"
              onClick={onClose}
              disabled={isTransitioning}
              className="flex size-11 items-center justify-center rounded-lg text-2xl text-neutral-400 transition-colors hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B2E1E] disabled:opacity-50"
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
                data-testid="staff-action-start"
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
                data-testid="staff-action-complete"
                onClick={() => setView('completing')}
                disabled={isTransitioning || !canComplete}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: '#059669' }}
              >
                ✓ Complete Appointment
              </button>
            )}

            {/* Cancel - available in non-terminal states */}
            {['waiting', 'working', 'wrap_up'].includes(canvasState) && (
              <button
                type="button"
                onClick={() => setShowCancelConfirmation(true)}
                disabled={isTransitioning}
                className="min-h-11 w-full rounded-xl px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50"
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
      <ConfirmDialog
        isOpen={showCancelConfirmation}
        title={`Cancel ${appointment.clientName || 'this client'}'s appointment?`}
        description="This will mark the appointment as cancelled."
        confirmLabel="Cancel appointment"
        tone="danger"
        busy={isTransitioning}
        onClose={() => setShowCancelConfirmation(false)}
        onConfirm={() => void handleTransition('cancelled')}
      />
    </DialogShell>
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
