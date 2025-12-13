'use client';

/**
 * FraudSignalsModal Component
 *
 * iOS-style modal for viewing and resolving fraud signals.
 * Features:
 * - List of unresolved fraud signals
 * - Mark as reviewed with optional note
 * - Optimistic UI updates
 * - Empty state when all clear
 */

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Shield, X } from 'lucide-react';
import { useState } from 'react';

import { BackButton, ModalHeader } from './AppModal';

// =============================================================================
// Types
// =============================================================================

export type FraudSignal = {
  id: string;
  type: 'HIGH_APPOINTMENT_FREQUENCY' | 'HIGH_REWARD_VELOCITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  metadata: {
    appointmentsInPeriod?: number;
    pointsInPeriod?: number;
    periodDays?: number;
    threshold?: number;
    clientPhone?: string;
  };
  createdAt: string;
  resolvedAt: string | null;
  appointmentId: string;
  client: {
    name: string;
    phone: string;
  };
};

type FraudSignalsModalProps = {
  signals: FraudSignal[];
  totalCount: number; // Total unresolved count from API (for "X total" display)
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onResolved: (signalId: string) => void;
  onRefetch: () => void;
};

// =============================================================================
// Helpers
// =============================================================================

function getSeverityStyle(severity: string) {
  switch (severity) {
    case 'HIGH':
      return { bgColor: 'bg-red-100', textColor: 'text-red-700', label: 'High' };
    case 'MEDIUM':
      return { bgColor: 'bg-amber-100', textColor: 'text-amber-700', label: 'Medium' };
    case 'LOW':
      return { bgColor: 'bg-blue-100', textColor: 'text-blue-700', label: 'Low' };
    default:
      return { bgColor: 'bg-gray-100', textColor: 'text-gray-700', label: severity };
  }
}

function getTypeLabel(type: string) {
  switch (type) {
    case 'HIGH_APPOINTMENT_FREQUENCY':
      return 'High Appointment Frequency';
    case 'HIGH_REWARD_VELOCITY':
      return 'High Point Accumulation';
    default:
      return type;
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatPhone(phone: string): string {
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  return phone;
}

// =============================================================================
// Signal Card Component
// =============================================================================

function SignalCard({
  signal,
  onResolve,
  resolving,
}: {
  signal: FraudSignal;
  onResolve: (signalId: string) => void;
  resolving: boolean;
}) {
  const severityStyle = getSeverityStyle(signal.severity);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className="rounded-xl border border-[#E5E5EA] bg-white p-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className={`rounded-full p-1.5 ${severityStyle.bgColor}`}>
            <AlertTriangle size={16} className={severityStyle.textColor} />
          </div>
          <div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityStyle.bgColor} ${severityStyle.textColor}`}>
              {severityStyle.label}
            </span>
          </div>
        </div>
        <span className="text-xs text-[#8E8E93]">{formatRelativeTime(signal.createdAt)}</span>
      </div>

      {/* Client Info */}
      <div className="mt-3">
        <p className="font-medium text-[#1C1C1E]">{signal.client.name || 'Unknown Client'}</p>
        <p className="text-sm text-[#8E8E93]">{formatPhone(signal.client.phone)}</p>
      </div>

      {/* Type & Reason */}
      <div className="mt-2">
        <p className="text-sm font-medium text-[#3C3C43]">{getTypeLabel(signal.type)}</p>
        <p className="mt-0.5 text-sm text-[#8E8E93]">{signal.reason}</p>
      </div>

      {/* Action Button */}
      <button
        type="button"
        onClick={() => onResolve(signal.id)}
        disabled={resolving}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#34C759] py-2.5 font-medium text-white transition-colors hover:bg-[#2DB84D] active:bg-[#28A745] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Check size={18} />
        <span>{resolving ? 'Marking...' : 'Mark as Reviewed'}</span>
      </button>
    </motion.div>
  );
}

// =============================================================================
// Main Component
// =============================================================================
// Parent owns signals state. Modal just renders and emits onResolved(id).
// Badge count = signals.length (computed in parent).
// =============================================================================

export function FraudSignalsModal({
  signals,
  totalCount,
  loading,
  error,
  onClose,
  onResolved,
  onRefetch,
}: FraudSignalsModalProps) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Track all IDs being resolved to prevent double-clicks
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  // Handle resolve - prevent double-clicks via in-flight tracking
  // Always send PATCH (server is idempotent) - don't skip just because signal is missing locally
  // (list may be paginated/filtered/refetched)
  const handleResolve = async (signalId: string) => {
    // Guard: Already resolving this signal (in-flight request)
    if (resolvingIds.has(signalId)) return;

    // Mark as resolving IMMEDIATELY (before any async work)
    setResolvingIds(prev => new Set(prev).add(signalId));
    setResolvingId(signalId);

    try {
      const response = await fetch(`/api/admin/fraud-signals/${signalId}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        // Revert - allow retry
        setResolvingIds(prev => {
          const next = new Set(prev);
          next.delete(signalId);
          return next;
        });
        throw new Error('Failed to resolve signal');
      }

      // Success - notify parent to update state
      // Parent will: remove from local list AND decrement totalCount
      onResolved(signalId);
    } catch (err) {
      console.error('Failed to resolve signal:', err);
      // Refetch to restore correct state
      onRefetch();
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-hidden rounded-t-3xl bg-[#F2F2F7]"
      >
        {/* Header */}
        <ModalHeader
          title="Activity Review"
          leftAction={<BackButton onClick={onClose} />}
          rightAction={
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-full bg-black/5"
            >
              <X size={18} className="text-[#8E8E93]" />
            </button>
          }
        />

        {/* Content */}
        <div className="max-h-[calc(90vh-60px)] overflow-y-auto px-4 pb-8">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="size-8 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
              <p className="mt-4 text-sm text-[#8E8E93]">Loading...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-20">
              <AlertTriangle size={48} className="text-red-400" />
              <p className="mt-4 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={onRefetch}
                className="mt-4 rounded-lg bg-[#007AFF] px-4 py-2 text-sm font-medium text-white"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && signals.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="mb-4 rounded-full bg-green-100 p-4">
                <Shield size={48} className="text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-[#1C1C1E]">All Clear</h3>
              <p className="mt-1 text-center text-sm text-[#8E8E93]">
                No activity requiring review at this time.
              </p>
            </div>
          )}

          {!loading && !error && signals.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-[#8E8E93]">
                {/* Show current page count vs total if different (pagination) */}
                {signals.length === totalCount
                  ? `${signals.length} ${signals.length === 1 ? 'item' : 'items'} flagged for review`
                  : `Showing ${signals.length} of ${totalCount} items`}
              </p>
              <AnimatePresence mode="popLayout">
                {signals.map(signal => (
                  <SignalCard
                    key={signal.id}
                    signal={signal}
                    onResolve={handleResolve}
                    resolving={resolvingId === signal.id}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
