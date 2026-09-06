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
import { Plus, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AdminSearchField } from '@/components/admin/AdminSearchField';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';
import { ListSurface } from '@/components/ui/list-surface';

import { StaffCard, type StaffCardData } from './StaffCard';
import {
  type TechnicianReviewSummary,
  useTechnicianReviews,
} from './useTechnicianReviews';

// =============================================================================
// Types
// =============================================================================

type FilterTab = 'all' | 'available' | 'busy' | 'break' | 'off' | 'inactive';

// =============================================================================
// Sortable Staff Card Wrapper
// =============================================================================

type SortableStaffCardProps = {
  staff: StaffCardData;
  reviews: TechnicianReviewSummary | null;
  isLast: boolean;
  onClick: () => void;
  isDraggable: boolean;
};

function SortableStaffCard({ staff, reviews, isLast, onClick, isDraggable }: SortableStaffCardProps) {
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
        reviews={reviews}
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
  salonSlug: string | null;
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

export function StaffListView({ salonSlug, onStaffSelect, onAddStaff }: StaffListViewProps) {
  const [staff, setStaff] = useState<StaffCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  // Status filters are team machinery. A solo owner has no team to filter, so
  // they stay folded away until asked for (the audit's solo-owner simplicity
  // note) — never removed, so an owner with a deactivated technician can still
  // reach the Inactive tab.
  const [showStatusFilters, setShowStatusFilters] = useState(false);

  // One review truth: the same rows the Reviews app counts (AG-w2-more-tools-04).
  const { byTechnician: reviewsByTechnician } = useTechnicianReviews(salonSlug);

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
  const isDraggable = activeFilter !== 'inactive' && !searchQuery && staff.length > 1;

  // A one-technician salon is the owner working alone: no drag-to-reorder, no
  // status filter rail, no plural 'team' language until there is a team.
  const isSoloRoster
    = !loading && !searchQuery && activeFilter === 'all' && staff.length === 1;
  const filtersVisible = showStatusFilters || !isSoloRoster;

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
    } catch {
      setError('Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [salonSlug, activeFilter, searchQuery]);

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
    } catch {
      // Revert on failure
      fetchStaff();
    }
  };

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // Clear search
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Search Bar */}
      <div className="px-4 py-3">
        <AdminSearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search staff..."
        />
      </div>

      {/* Solo owner: the roster is one person, so say so and keep the status
          rail out of the way until it is useful. */}
      {isSoloRoster && !showStatusFilters && (
        <div className="flex items-center justify-between gap-3 px-4 pb-3">
          <p className="text-[13px] text-[#8E8E93]" data-testid="staff-solo-note">
            It’s just you right now. Add someone when you’re ready.
          </p>
          <button
            type="button"
            onClick={() => setShowStatusFilters(true)}
            className="shrink-0 text-[13px] font-medium text-[var(--owner-accent,#8b3151)] underline underline-offset-2"
          >
            Show status filters
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className={`px-4 pb-3 ${filtersVisible ? '' : 'hidden'}`}>
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
      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {loading
          ? (
              <AsyncStatePanel
                loading
                title="Loading staff"
                description="Pulling the latest technician roster."
                className="mx-4 my-8"
              />
            )
          : error
            ? (
                <AsyncStatePanel
                  tone="error"
                  title="Unable to load staff"
                  description={error}
                  className="mx-4 my-8"
                  action={(
                    <Button type="button" variant="brandSoft" size="pillSm" onClick={fetchStaff}>
                      Try again
                    </Button>
                  )}
                />
              )
            : staff.length === 0
              ? (
                  <EmptyState
                    filter={activeFilter}
                    searchQuery={searchQuery}
                    onAddStaff={onAddStaff}
                  />
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
                      <ListSurface className="mx-4">
                        {staff.map((member, index) => (
                          <SortableStaffCard
                            key={member.id}
                            staff={member}
                            reviews={reviewsByTechnician[member.id] ?? null}
                            isLast={index === staff.length - 1}
                            onClick={() => onStaffSelect(member)}
                            isDraggable={isDraggable}
                          />
                        ))}
                      </ListSurface>
                    </SortableContext>
                  </DndContext>
                )}
      </div>

      {/* Floating Add Button */}
      <motion.button
        type="button"
        onClick={onAddStaff}
        whileTap={{ scale: 0.95 }}
        className="absolute bottom-5 right-5 z-10 flex size-14 items-center justify-center rounded-full bg-[#007AFF] shadow-lg"
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
// Empty State
// =============================================================================

function EmptyState({
  filter,
  searchQuery,
  onAddStaff,
}: {
  filter: FilterTab;
  searchQuery: string;
  onAddStaff: () => void;
}) {
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
    <AsyncStatePanel
      icon={<User className="mx-auto size-8 text-[#8E8E93]" />}
      title={title}
      description={message}
      className="mx-4 my-8"
      action={!searchQuery
        ? (
            <Button type="button" variant="brandSoft" size="pillSm" onClick={onAddStaff}>
              Add Staff
            </Button>
          )
        : undefined}
    />
  );
}
