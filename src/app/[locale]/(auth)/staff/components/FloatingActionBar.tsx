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

type FloatingActionBarProps = {
  appointment: AppointmentData | null;
  onOpenPhotos: () => void;
  onSuccess?: () => void;
};

// =============================================================================
// Haptic Feedback
// =============================================================================

function triggerHaptic() {
  if ('vibrate' in navigator) {
    navigator.vibrate(10);
  }
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

// =============================================================================
// Floating Action Bar Component
// =============================================================================

export function FloatingActionBar({
  appointment,
  onOpenPhotos,
  onSuccess,
}: FloatingActionBarProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  // Don't render if no appointment or terminal state
  if (!appointment) {
    return null;
  }

  const canvasState = appointment.canvasState || mapLegacyStatus(appointment.status);
  const isTerminal = ['complete', 'cancelled', 'no_show'].includes(canvasState);

  if (isTerminal) {
    return null;
  }

  // Determine primary action based on state
  const hasAfterPhoto = appointment.photos.some(p => p.photoType === 'after');

  let primaryAction: {
    label: string;
    icon: string;
    color: string;
    action: () => Promise<void> | void;
  } | null = null;

  if (canvasState === 'waiting') {
    primaryAction = {
      label: 'Start Service',
      icon: '▶',
      color: '#059669', // Green
      action: async () => {
        setIsLoading(true);
        try {
          const response = await fetch(`/api/appointments/${appointment.id}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'working' }),
          });

          if (response.ok) {
            triggerHaptic();
            router.refresh();
            onSuccess?.();
          }
        } finally {
          setIsLoading(false);
        }
      },
    };
  } else if (canvasState === 'working' || canvasState === 'wrap_up') {
    if (hasAfterPhoto) {
      primaryAction = {
        label: 'Complete',
        icon: '✓',
        color: cappuccino.primary,
        action: async () => {
          setIsLoading(true);
          try {
            const response = await fetch(`/api/appointments/${appointment.id}/transition`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: 'complete' }),
            });

            if (response.ok) {
              triggerHaptic();
              router.refresh();
              onSuccess?.();
            }
          } finally {
            setIsLoading(false);
          }
        },
      };
    } else {
      primaryAction = {
        label: 'Add Photo',
        icon: '📸',
        color: '#2563EB', // Blue
        action: () => {
          onOpenPhotos();
        },
      };
    }
  }

  if (!primaryAction) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4"
      style={{
        animation: 'slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <button
        type="button"
        onClick={() => primaryAction?.action()}
        disabled={isLoading}
        className="flex items-center gap-2 rounded-full px-6 py-3 shadow-lg transition-all active:scale-95 disabled:opacity-50"
        style={{
          backgroundColor: primaryAction.color,
          boxShadow: `0 8px 24px -8px ${primaryAction.color}80`,
        }}
      >
        {isLoading
          ? (
              <div className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )
          : (
              <span className="text-lg">{primaryAction.icon}</span>
            )}
        <span className="text-sm font-semibold text-white">
          {primaryAction.label}
        </span>
        <span className="ml-1 max-w-[120px] truncate text-xs text-white/80">
          {appointment.clientName || 'Client'}
        </span>
      </button>

      <style jsx>
        {`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}
      </style>
    </div>
  );
}

export default FloatingActionBar;
