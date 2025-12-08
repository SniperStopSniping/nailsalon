'use client';

import { forwardRef } from 'react';
import { ChevronRight, Star, GripVertical } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

export interface StaffCardData {
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
}

interface StaffCardProps {
  staff: StaffCardData;
  isLast: boolean;
  onClick: () => void;
  isDraggable?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
}

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

export const StaffCard = forwardRef<HTMLDivElement, StaffCardProps>(function StaffCard(
  { staff, isLast, onClick, isDraggable = false, dragHandleProps, isDragging = false },
  ref
) {
  const initials = staff.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const skillBadge = getSkillBadge(staff.skillLevel);
  const hasStats = staff.stats.today.appointments > 0 || staff.stats.today.revenue > 0;

  return (
    <div
      ref={ref}
      className={`
        flex items-center min-h-[76px] transition-colors
        ${!staff.isActive ? 'opacity-60' : ''}
        ${isDragging ? 'bg-gray-50 shadow-lg rounded-lg z-50' : ''}
      `}
    >
      {/* Drag Handle */}
      {isDraggable && (
        <div
          {...dragHandleProps}
          className="pl-2 pr-1 py-4 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="w-5 h-5 text-[#C7C7CC]" />
        </div>
      )}

      {/* Clickable Content */}
      <div
        className={`flex-1 flex items-center active:bg-gray-50 cursor-pointer ${isDraggable ? 'pl-1' : 'pl-4'}`}
        onClick={onClick}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
        {staff.avatarUrl ? (
          <img
            src={staff.avatarUrl}
            alt={staff.name}
            className="w-14 h-14 rounded-full object-cover mr-3"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb] flex items-center justify-center text-white text-[17px] font-bold mr-3 shadow-sm">
            {initials}
          </div>
        )}
        {/* Status indicator dot */}
        <div
          className={`absolute bottom-0 right-2 w-4 h-4 rounded-full border-2 border-white ${getStatusColor(staff.currentStatus)}`}
        />
      </div>

      {/* Content */}
      <div
        className={`flex-1 flex items-center justify-between pr-4 py-3 ${!isLast ? 'border-b border-gray-100' : ''}`}
      >
        <div className="min-w-0 flex-1">
          {/* Name + Role */}
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-semibold text-[#1C1C1E] truncate">
              {staff.name}
            </span>
            {!staff.isActive && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] font-semibold rounded">
                INACTIVE
              </span>
            )}
          </div>

          {/* Status + Skill */}
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getStatusPillClasses(staff.currentStatus)}`}
            >
              {getStatusLabel(staff.currentStatus)}
            </span>
            {skillBadge && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${skillBadge.className}`}
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
            <div className="flex items-center gap-1 mt-1">
              <Star className="w-3 h-3 text-[#FFD60A] fill-[#FFD60A]" />
              <span className="text-[11px] font-medium text-[#1C1C1E]">
                {staff.rating.toFixed(1)}
              </span>
              <span className="text-[10px] text-[#8E8E93]">
                ({staff.reviewCount})
              </span>
            </div>
          )}
        </div>

          {/* Stats + Chevron */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasStats && (
              <div className="text-right mr-1">
                <div className="text-[14px] font-semibold text-[#34C759]">
                  {formatCurrency(staff.stats.today.revenue)}
                </div>
                <div className="text-[11px] text-[#8E8E93]">
                  {staff.stats.today.appointments} today
                </div>
              </div>
            )}
            <ChevronRight className="w-4 h-4 text-[#C7C7CC]" />
          </div>
        </div>
      </div>
    </div>
  );
});
