'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';

import type { StaffStatus } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type StaffStatusToggleProps = {
  currentStatus: StaffStatus;
  onStatusChange: (status: StaffStatus) => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'md';
};

const STATUSES: { value: StaffStatus; label: string; color: string }[] = [
  { value: 'available', label: 'Available', color: '#34C759' },
  { value: 'busy', label: 'Busy', color: '#FF9500' },
  { value: 'break', label: 'Break', color: '#FFCC00' },
  { value: 'off', label: 'Off', color: '#8E8E93' },
];

// =============================================================================
// Component
// =============================================================================

export function StaffStatusToggle({
  currentStatus,
  onStatusChange,
  disabled = false,
  size = 'md',
}: StaffStatusToggleProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState<StaffStatus | null>(null);

  const displayStatus = optimisticStatus ?? currentStatus;
  const currentIndex = STATUSES.findIndex(s => s.value === displayStatus);

  const handleStatusChange = async (status: StaffStatus) => {
    if (disabled || isUpdating || status === displayStatus) {
      return;
    }

    // Optimistic update
    setOptimisticStatus(status);
    setIsUpdating(true);

    try {
      await onStatusChange(status);
    } catch (error) {
      // Revert on error
      setOptimisticStatus(null);
      console.error('Failed to update status:', error);
    } finally {
      setIsUpdating(false);
      setOptimisticStatus(null);
    }
  };

  const isSmall = size === 'sm';
  const buttonPadding = isSmall ? 'px-2 py-1' : 'px-3 py-1.5';
  const fontSize = isSmall ? 'text-[11px]' : 'text-[13px]';
  const containerPadding = isSmall ? 'p-0.5' : 'p-1';
  const gap = isSmall ? 'gap-0.5' : 'gap-1';

  return (
    <div
      className={`
        relative flex ${gap} rounded-lg bg-[#F2F2F7] ${containerPadding}
        ${disabled ? 'pointer-events-none opacity-50' : ''}
      `}
    >
      {/* Background slider */}
      <motion.div
        className="absolute rounded-md bg-white shadow-sm"
        style={{
          width: `calc(${100 / STATUSES.length}% - ${isSmall ? '2px' : '4px'})`,
          height: `calc(100% - ${isSmall ? '4px' : '8px'})`,
          top: isSmall ? '2px' : '4px',
        }}
        animate={{
          left: `calc(${(currentIndex * 100) / STATUSES.length}% + ${isSmall ? '2px' : '4px'})`,
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />

      {/* Status buttons */}
      {STATUSES.map((status) => {
        const isSelected = displayStatus === status.value;
        return (
          <button
            key={status.value}
            type="button"
            onClick={() => handleStatusChange(status.value)}
            disabled={disabled || isUpdating}
            className={`
              relative z-10 flex-1 ${buttonPadding} rounded-md ${fontSize} font-medium
              transition-colors duration-200
              ${isSelected ? 'text-[#1C1C1E]' : 'text-[#8E8E93]'}
              active:scale-95
            `}
          >
            <span className="flex items-center justify-center gap-1">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: status.color }}
              />
              <span className={isSmall ? 'hidden sm:inline' : ''}>
                {status.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
