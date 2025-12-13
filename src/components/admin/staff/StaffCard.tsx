'use client';

import { ChevronRight, GripVertical, Star } from 'lucide-react';
import { forwardRef } from 'react';

// =============================================================================
// Types
// =============================================================================

export type StaffCardData = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  skillLevel: string | null;
  currentStatus: string | null;
  isActive: boolean;
  acceptingNewClients: boolean;
  rating: number | null;
  reviewCount: number;
  stats: {
    today: {
      appointments: number;
      revenue: number;
    };
  };
};

type StaffCardProps = {
  staff: StaffCardData;
  isLast: boolean;
  onClick: () => void;
  isDraggable?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
};

// =============================================================================
// Helpers
// =============================================================================

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function getStatusColor(status: string | null): string {
  switch (status) {
    case 'available':
      return 'bg-[#34C759]';
    case 'busy':
      return 'bg-[#FF9500]';
    case 'break':
      return 'bg-[#FFCC00]';
    case 'off':
    default:
      return 'bg-[#8E8E93]';
  }
}

function getStatusLabel(status: string | null): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'busy':
      return 'Busy';
    case 'break':
      return 'On Break';
    case 'off':
      return 'Off';
    default:
      return 'Unknown';
  }
}

function getStatusPillClasses(status: string | null): string {
  switch (status) {
    case 'available':
      return 'bg-green-100 text-green-700';
    case 'busy':
      return 'bg-orange-100 text-orange-700';
    case 'break':
      return 'bg-yellow-100 text-yellow-700';
    case 'off':
    default:
      return 'bg-gray-100 text-gray-500';
  }
}

function getSkillBadge(skillLevel: string | null): { label: string; className: string } | null {
  switch (skillLevel) {
    case 'master':
      return { label: 'Master', className: 'bg-purple-100 text-purple-700' };
    case 'senior':
      return { label: 'Senior', className: 'bg-blue-100 text-blue-700' };
    case 'junior':
      return { label: 'Junior', className: 'bg-gray-100 text-gray-600' };
    default:
      return null;
  }
}

// =============================================================================
// Component
// =============================================================================

export const StaffCard = forwardRef<HTMLDivElement, StaffCardProps>((
  { staff, isLast, onClick, isDraggable = false, dragHandleProps, isDragging = false },
  ref,
) => {
  const initials = staff.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const skillBadge = getSkillBadge(staff.skillLevel);
  const hasStats = staff.stats.today.appointments > 0 || staff.stats.today.revenue > 0;

  return (
    <div
      ref={ref}
      className={`
        flex min-h-[76px] items-center transition-colors
        ${!staff.isActive ? 'opacity-60' : ''}
        ${isDragging ? 'z-50 rounded-lg bg-gray-50 shadow-lg' : ''}
      `}
    >
      {/* Drag Handle */}
      {isDraggable && (
        <div
          {...dragHandleProps}
          className="cursor-grab touch-none py-4 pl-2 pr-1 active:cursor-grabbing"
        >
          <GripVertical className="size-5 text-[#C7C7CC]" />
        </div>
      )}

      {/* Clickable Content */}
      <div
        className={`flex flex-1 cursor-pointer items-center active:bg-gray-50 ${isDraggable ? 'pl-1' : 'pl-4'}`}
        onClick={onClick}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          {staff.avatarUrl
            ? (
                <img
                  src={staff.avatarUrl}
                  alt={staff.name}
                  className="mr-3 size-14 rounded-full object-cover"
                />
              )
            : (
                <div className="mr-3 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb] text-[17px] font-bold text-white shadow-sm">
                  {initials}
                </div>
              )}
          {/* Status indicator dot */}
          <div
            className={`absolute bottom-0 right-2 size-4 rounded-full border-2 border-white ${getStatusColor(staff.currentStatus)}`}
          />
        </div>

        {/* Content */}
        <div
          className={`flex flex-1 items-center justify-between py-3 pr-4 ${!isLast ? 'border-b border-gray-100' : ''}`}
        >
          <div className="min-w-0 flex-1">
            {/* Name + Role */}
            <div className="flex items-center gap-2">
              <span className="truncate text-[17px] font-semibold text-[#1C1C1E]">
                {staff.name}
              </span>
              {!staff.isActive && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                  INACTIVE
                </span>
              )}
            </div>

            {/* Status + Skill */}
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusPillClasses(staff.currentStatus)}`}
              >
                {getStatusLabel(staff.currentStatus)}
              </span>
              {skillBadge && (
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${skillBadge.className}`}
                >
                  {skillBadge.label}
                </span>
              )}
              {!staff.acceptingNewClients && (
                <span className="text-[10px] text-[#8E8E93]">Returning only</span>
              )}
            </div>

            {/* Rating if exists */}
            {staff.rating !== null && staff.reviewCount > 0 && (
              <div className="mt-1 flex items-center gap-1">
                <Star className="size-3 fill-[#FFD60A] text-[#FFD60A]" />
                <span className="text-[11px] font-medium text-[#1C1C1E]">
                  {staff.rating.toFixed(1)}
                </span>
                <span className="text-[10px] text-[#8E8E93]">
                  (
                  {staff.reviewCount}
                  )
                </span>
              </div>
            )}
          </div>

          {/* Stats + Chevron */}
          <div className="flex shrink-0 items-center gap-2">
            {hasStats && (
              <div className="mr-1 text-right">
                <div className="text-[14px] font-semibold text-[#34C759]">
                  {formatCurrency(staff.stats.today.revenue)}
                </div>
                <div className="text-[11px] text-[#8E8E93]">
                  {staff.stats.today.appointments}
                  {' '}
                  today
                </div>
              </div>
            )}
            <ChevronRight className="size-4 text-[#C7C7CC]" />
          </div>
        </div>
      </div>
    </div>
  );
});
