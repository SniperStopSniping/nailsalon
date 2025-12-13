'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { Plus, Search, User, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

import { StaffCard, type StaffCardData } from './StaffCard';

// =============================================================================
// Types
// =============================================================================

type FilterTab = 'all' | 'available' | 'busy' | 'break' | 'off' | 'inactive';

// =============================================================================
// Sortable Staff Card Wrapper
// =============================================================================

type SortableStaffCardProps = {
  staff: StaffCardData;
  isLast: boolean;
  onClick: () => void;
  isDraggable: boolean;
};

function SortableStaffCard({ staff, isLast, onClick, isDraggable }: SortableStaffCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: staff.id, disabled: !isDraggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <StaffCard
        staff={staff}
        isLast={isLast}
        onClick={onClick}
        isDraggable={isDraggable}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

type StaffListViewProps = {
  onStaffSelect: (staff: StaffCardData) => void;
  onAddStaff: () => void;
};

// =============================================================================
// Filter Tabs
// =============================================================================

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'busy', label: 'Busy' },
  { value: 'break', label: 'Break' },
  { value: 'off', label: 'Off' },
  { value: 'inactive', label: 'Inactive' },
];

// =============================================================================
// Component
// =============================================================================

export function StaffListView({ onStaffSelect, onAddStaff }: StaffListViewProps) {
  const { salonSlug } = useSalon();
  const [staff, setStaff] = useState<StaffCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Only allow dragging in active staff views (not inactive, not searching)
  const isDraggable = activeFilter !== 'inactive' && !searchQuery;

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !salonSlug) {
      return;
    }

    const oldIndex = staff.findIndex(s => s.id === active.id);
    const newIndex = staff.findIndex(s => s.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Optimistically update local state
    const newStaff = arrayMove(staff, oldIndex, newIndex);
    setStaff(newStaff);

    // Build reorder payload with new displayOrder values
    const reorderPayload = newStaff.map((s, index) => ({
      id: s.id,
      displayOrder: index,
    }));

    try {
      const response = await fetch('/api/admin/technicians/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          technicians: reorderPayload,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save order');
      }
    } catch (err) {
      console.error('Error saving order:', err);
      // Revert on failure
      fetchStaff();
    }
  };

  // Fetch staff data
  const fetchStaff = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Determine status filter
      const status = activeFilter === 'inactive' ? 'inactive' : 'active';
      const currentStatus = ['available', 'busy', 'break', 'off'].includes(activeFilter)
        ? activeFilter
        : undefined;

      const params = new URLSearchParams({
        salonSlug,
        status,
        ...(currentStatus && { currentStatus }),
        ...(searchQuery && { search: searchQuery }),
      });

      const response = await fetch(`/api/admin/technicians?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch staff');
      }

      const result = await response.json();
      setStaff(result.data?.technicians ?? []);
    } catch (err) {
      console.error('Error fetching staff:', err);
      setError('Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [salonSlug, activeFilter, searchQuery]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search Bar */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8E8E93]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search staff..."
            className="w-full rounded-xl bg-[#E5E5EA] px-10 py-2.5 text-[15px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-[#8E8E93]"
            >
              <X className="size-3 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-4 pb-3">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {FILTER_TABS.map((tab) => {
            const isActive = activeFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveFilter(tab.value)}
                className={`
                  shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium
                  transition-colors
                  ${
              isActive
                ? 'bg-[#007AFF] text-white'
                : 'bg-[#E5E5EA] text-[#8E8E93]'
              }
                `}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-20">
        {loading
          ? (
              <LoadingSkeleton />
            )
          : error
            ? (
                <ErrorState message={error} onRetry={fetchStaff} />
              )
            : staff.length === 0
              ? (
                  <EmptyState filter={activeFilter} searchQuery={searchQuery} />
                )
              : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={staff.map(s => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="mx-4 overflow-hidden rounded-[12px] bg-white shadow-sm">
                        {staff.map((member, index) => (
                          <SortableStaffCard
                            key={member.id}
                            staff={member}
                            isLast={index === staff.length - 1}
                            onClick={() => onStaffSelect(member)}
                            isDraggable={isDraggable}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
      </div>

      {/* Floating Add Button */}
      <motion.button
        type="button"
        onClick={onAddStaff}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-24 right-5 flex size-14 items-center justify-center rounded-full bg-[#007AFF] shadow-lg"
        style={{
          boxShadow: '0 4px 20px rgba(0, 122, 255, 0.4)',
        }}
      >
        <Plus className="size-6 text-white" />
      </motion.button>
    </div>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton() {
  return (
    <div className="mx-4 animate-pulse overflow-hidden rounded-[12px] bg-white shadow-sm">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="flex items-center p-4">
          <div className="mr-3 size-14 rounded-full bg-gray-200" />
          <div className="flex-1">
            <div className="mb-2 h-4 w-32 rounded bg-gray-200" />
            <div className="h-3 w-20 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Empty State
// =============================================================================

function EmptyState({ filter, searchQuery }: { filter: FilterTab; searchQuery: string }) {
  let title = 'No Staff Members';
  let message = 'Add staff members to manage your team';

  if (searchQuery) {
    title = 'No Results';
    message = `No staff found matching "${searchQuery}"`;
  } else if (filter !== 'all') {
    const filterLabel = FILTER_TABS.find(t => t.value === filter)?.label ?? filter;
    title = `No ${filterLabel} Staff`;
    message = `No staff members are currently ${filter}`;
  }

  return (
    <div className="flex flex-col items-center justify-center px-8 py-20">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#F2F2F7]">
        <User className="size-8 text-[#8E8E93]" />
      </div>
      <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">{title}</h3>
      <p className="text-center text-[15px] text-[#8E8E93]">{message}</p>
    </div>
  );
}

// =============================================================================
// Error State
// =============================================================================

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-red-100">
        <X className="size-8 text-red-500" />
      </div>
      <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">Error</h3>
      <p className="mb-4 text-center text-[15px] text-[#8E8E93]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-[#007AFF] px-4 py-2 text-[15px] font-medium text-white"
      >
        Try Again
      </button>
    </div>
  );
}
