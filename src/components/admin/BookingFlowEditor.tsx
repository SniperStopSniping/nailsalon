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
import { Check, Eye, EyeOff, GripVertical, Info, Lock, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  type BookingStep,
  DEFAULT_BOOKING_FLOW,
  getStepLabel,
  normalizeBookingFlow,
} from '@/libs/bookingFlow';

// =============================================================================
// Types
// =============================================================================

type BookingFlowEditorProps = {
  bookingFlowCustomizationEnabled: boolean;
  bookingFlow: BookingStep[] | null;
  onSave: (flow: BookingStep[]) => Promise<void>;
};

// =============================================================================
// Sortable Step Item
// =============================================================================

type SortableStepItemProps = {
  step: BookingStep;
  isLast: boolean;
  isDraggable: boolean;
  isTechStep: boolean;
  techEnabled: boolean;
  onToggleTech?: () => void;
};

function SortableStepItem({
  step,
  isLast,
  isDraggable,
  isTechStep,
  techEnabled,
  onToggleTech,
}: SortableStepItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step, disabled: !isDraggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const stepIcons: Record<BookingStep, string> = {
    service: '💅',
    tech: '👩‍🎨',
    time: '📅',
    confirm: '✅',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center bg-white px-4 py-3
        ${!isLast ? 'border-b border-gray-100' : ''}
        ${isDragging ? 'z-10 rounded-lg opacity-90 shadow-lg' : ''}
        ${isTechStep && !techEnabled ? 'opacity-50' : ''}
      `}
    >
      {/* Drag Handle */}
      <div
        {...(isDraggable ? { ...attributes, ...listeners } : {})}
        className={`mr-3 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : 'opacity-30'}`}
      >
        {isDraggable
          ? (
              <GripVertical className="size-5 text-gray-400" />
            )
          : (
              <Lock className="size-4 text-gray-300" />
            )}
      </div>

      {/* Step Icon */}
      <div className="mr-3 flex size-8 items-center justify-center rounded-full bg-gray-100 text-lg">
        {stepIcons[step]}
      </div>

      {/* Step Info */}
      <div className="flex-1">
        <div className="text-[15px] font-medium text-gray-900">
          {getStepLabel(step)}
        </div>
        {step === 'confirm' && (
          <div className="text-xs text-gray-500">Always last</div>
        )}
        {isTechStep && !techEnabled && (
          <div className="text-xs text-amber-600">Disabled - will be skipped</div>
        )}
      </div>

      {/* Tech Toggle */}
      {isTechStep && onToggleTech && (
        <button
          type="button"
          onClick={onToggleTech}
          className={`
            rounded-lg p-2 transition-colors
            ${techEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}
          `}
          title={techEnabled ? 'Click to hide technician step' : 'Click to show technician step'}
        >
          {techEnabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function BookingFlowEditor({
  bookingFlowCustomizationEnabled,
  bookingFlow,
  onSave,
}: BookingFlowEditorProps) {
  // Local state for the flow being edited
  const [localFlow, setLocalFlow] = useState<BookingStep[]>(() =>
    normalizeBookingFlow(bookingFlow),
  );
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Track if the flow has been modified
  const normalizedOriginal = normalizeBookingFlow(bookingFlow);
  const isDirty = JSON.stringify(localFlow) !== JSON.stringify(normalizedOriginal);

  // Check if tech step is enabled
  const techEnabled = localFlow.includes('tech');

  // Get draggable steps (all except confirm)
  const draggableSteps = localFlow.filter(s => s !== 'confirm');

  // Update local flow when prop changes
  useEffect(() => {
    setLocalFlow(normalizeBookingFlow(bookingFlow));
  }, [bookingFlow]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        await onSave(localFlow);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
      } catch (error) {
        console.error('Failed to save booking flow:', error);
      } finally {
        setSaving(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [localFlow, isDirty, onSave]);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeStep = active.id as string;
    const overStep = over.id as string;

    const oldIndex = draggableSteps.findIndex(s => s === activeStep);
    const newIndex = draggableSteps.findIndex(s => s === overStep);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const newDraggable = arrayMove(draggableSteps, oldIndex, newIndex);
    // Always add confirm at the end
    setLocalFlow([...newDraggable, 'confirm']);
  };

  // Toggle tech step
  const handleToggleTech = () => {
    if (techEnabled) {
      // Remove tech from flow
      setLocalFlow(localFlow.filter(s => s !== 'tech'));
    } else {
      // Add tech after service
      const serviceIndex = localFlow.indexOf('service');
      const newFlow = [...localFlow];
      newFlow.splice(serviceIndex + 1, 0, 'tech');
      setLocalFlow(newFlow);
    }
  };

  // Reset to default
  const handleReset = () => {
    setLocalFlow([...DEFAULT_BOOKING_FLOW]);
  };

  // Disabled state - show upgrade message
  if (!bookingFlowCustomizationEnabled) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
              <Info className="size-5 text-gray-400" />
            </div>
            <div>
              <div className="text-[15px] font-medium text-gray-700">
                Booking Flow Customization
              </div>
              <div className="mt-1 text-[13px] text-gray-500">
                Your current plan doesn&apos;t include booking flow customization.
                Contact support to upgrade and unlock drag-and-drop control of your booking steps.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4">
        <div className="text-[15px] font-medium text-gray-900">
          Customize Booking Flow
        </div>
        <div className="mt-0.5 text-[13px] text-gray-500">
          Drag to reorder steps. Toggle technician selection on/off.
        </div>
      </div>

      {/* Sortable List */}
      <div className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={draggableSteps}
            strategy={verticalListSortingStrategy}
          >
            {draggableSteps.map(step => (
              <SortableStepItem
                key={step}
                step={step}
                isLast={false}
                isDraggable
                isTechStep={step === 'tech'}
                techEnabled={techEnabled}
                onToggleTech={step === 'tech' ? handleToggleTech : undefined}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Confirm step - always last, not draggable */}
        <div className="flex items-center border-t border-gray-100 bg-gray-50 px-4 py-3">
          <div className="mr-3 opacity-30">
            <Lock className="size-4 text-gray-300" />
          </div>
          <div className="mr-3 flex size-8 items-center justify-center rounded-full bg-gray-100 text-lg">
            ✅
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-medium text-gray-900">
              {getStepLabel('confirm')}
            </div>
            <div className="text-xs text-gray-500">Always last</div>
          </div>
        </div>
      </div>

      {/* Actions row with Reset and auto-save status */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleReset}
          disabled={JSON.stringify(localFlow) === JSON.stringify(DEFAULT_BOOKING_FLOW)}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="size-4" />
          Reset to default
        </button>

        {/* Auto-save status indicator */}
        <div className="text-[13px]">
          {saving
            ? (
                <span className="inline-flex items-center gap-1.5 text-gray-500">
                  <div className="size-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                  Saving...
                </span>
              )
            : justSaved
              ? (
                  <span className="inline-flex items-center gap-1.5 text-green-600">
                    <Check className="size-4" />
                    Saved
                  </span>
                )
              : null}
        </div>
      </div>

      {/* Preview */}
      <div className="mt-6 border-t border-gray-100 pt-4">
        <div className="mb-2 text-[13px] font-medium text-gray-500">
          Current flow preview:
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          {localFlow.map((step, index) => (
            <span key={step} className="flex items-center gap-1">
              <span className={`
                rounded-md px-2 py-1
                ${step === 'tech' && !techEnabled ? 'bg-gray-100 text-gray-400 line-through' : 'bg-blue-50 text-blue-700'}
              `}
              >
                {getStepLabel(step)}
              </span>
              {index < localFlow.length - 1 && (
                <span className="text-gray-300">→</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
