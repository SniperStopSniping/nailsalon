'use client';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { useMemo } from 'react';

import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';

const HOUR_HEIGHT = 96;
const START_HOUR = 8;
const END_HOUR = 20;

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700 border-blue-500',
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-500',
  in_progress: 'bg-green-50 text-green-700 border-green-500',
  completed: 'bg-gray-50 text-gray-600 border-gray-400',
  cancelled: 'bg-red-50 text-red-600 border-red-400',
  no_show: 'bg-orange-50 text-orange-600 border-orange-400',
};

export type CalendarResource = {
  id: string;
  label: string;
};

export type CalendarAppointment = {
  id: string;
  clientName: string | null;
  startTime: string;
  endTime: string;
  status: string;
  technicianId: string | null;
  technicianName: string | null;
  serviceLabel: string;
  totalPrice: number;
  totalDurationMinutes: number;
  locationName: string | null;
  isLocked: boolean;
};

type AppointmentsDayViewProps = {
  selectedDate: Date;
  onSelectedDateChange: (date: Date) => void;
  appointments: CalendarAppointment[];
  resources: CalendarResource[];
  slotIntervalMinutes: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAppointmentSelect: (appointmentId: string) => void;
  onMoveAppointment: (args: {
    appointmentId: string;
    startTime: string;
    resourceId: string;
  }) => void | Promise<void>;
  emptyTitle: string;
  emptyDescription: string;
  allowDrag?: boolean;
  resourceLabel?: string;
  includeUnassignedResource?: boolean;
};

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getWeekDates(date: Date): Date[] {
  const weekStart = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(weekStart);
    current.setDate(weekStart.getDate() + index);
    return current;
  });
}

function formatHour(hour: number) {
  const normalized = hour > 12 ? hour - 12 : hour;
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${normalized} ${period}`;
}

function formatShortTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAppointmentTop(iso: string) {
  const date = new Date(iso);
  return (date.getHours() - START_HOUR + date.getMinutes() / 60) * HOUR_HEIGHT;
}

function getAppointmentHeight(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  return Math.max(hours * HOUR_HEIGHT - 4, 44);
}

function buildSlots(slotIntervalMinutes: number) {
  const slots: string[] = [];
  for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
    for (let minute = 0; minute < 60; minute += slotIntervalMinutes) {
      if (hour === END_HOUR && minute > 0) {
        continue;
      }
      slots.push(`${hour}:${minute.toString().padStart(2, '0')}`);
    }
  }
  return slots;
}

function buildSlotId(resourceId: string, date: Date, slotTime: string) {
  const [hour, minute] = slotTime.split(':').map(Number);
  const slotDate = new Date(date);
  slotDate.setHours(hour ?? 0, minute ?? 0, 0, 0);
  return `slot|${resourceId}|${slotDate.toISOString()}`;
}

function buildSlotTestId(resourceId: string, date: Date, slotTime: string) {
  return `calendar-slot-${resourceId}-${formatDateKey(date)}-${slotTime.replace(':', '-')}`;
}

function parseSlotId(slotId: string) {
  const [kind, resourceId, iso] = slotId.split('|');
  if (kind !== 'slot' || !resourceId || !iso) {
    return null;
  }
  return { resourceId, iso };
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function DroppableSlot({
  id,
  height,
  testId,
}: {
  id: string;
  height: number;
  testId: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      className={`border-b border-dashed border-gray-100 bg-white transition-colors ${isOver ? 'bg-blue-50/80' : ''}`}
      style={{ height }}
    />
  );
}

function DraggableAppointment({
  appointment,
  resourceId,
  onOpen,
  allowDrag,
}: {
  appointment: CalendarAppointment;
  resourceId: string;
  onOpen: () => void;
  allowDrag: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: appointment.id,
    disabled: !allowDrag,
    data: {
      appointmentId: appointment.id,
      resourceId,
    },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      data-testid={`appointment-block-${appointment.id}`}
      data-resource-id={resourceId}
      data-date-key={formatDateKey(new Date(appointment.startTime))}
      data-start-time={appointment.startTime}
      data-end-time={appointment.endTime}
      style={{
        top: getAppointmentTop(appointment.startTime),
        height: getAppointmentHeight(appointment.startTime, appointment.endTime),
        transform: CSS.Translate.toString(transform),
      }}
      className={`absolute inset-x-2 rounded-xl border-l-[3px] px-3 py-2 text-left shadow-sm transition-shadow hover:shadow-md ${STATUS_COLORS[appointment.status] ?? STATUS_COLORS.confirmed} ${isDragging ? 'z-20 opacity-80 shadow-xl' : 'z-10'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{appointment.serviceLabel}</div>
          <div className="truncate text-xs opacity-80">
            {appointment.clientName || 'Guest'}
          </div>
          <div className="mt-1 text-[11px] opacity-70">
            {formatShortTime(appointment.startTime)}
            {' '}
            -
            {' '}
            {formatShortTime(appointment.endTime)}
          </div>
        </div>

        {allowDrag && (
          <div
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
            data-testid={`appointment-drag-handle-${appointment.id}`}
            className="mt-0.5 flex size-11 items-center justify-center rounded-xl bg-white/70 text-gray-500 touch-none"
            aria-label="Drag appointment"
          >
            <GripVertical className="size-4" />
          </div>
        )}
      </div>
    </button>
  );
}

export function AppointmentsDayView({
  selectedDate,
  onSelectedDateChange,
  appointments,
  resources,
  slotIntervalMinutes,
  loading,
  error,
  onRetry,
  onAppointmentSelect,
  onMoveAppointment,
  emptyTitle,
  emptyDescription,
  allowDrag = true,
  resourceLabel = 'Team',
  includeUnassignedResource = true,
}: AppointmentsDayViewProps) {
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const dayAppointments = useMemo(() => appointments.filter((appointment) => {
    const start = new Date(appointment.startTime);
    return isSameDay(start, selectedDate);
  }), [appointments, selectedDate]);
  const slots = useMemo(() => buildSlots(slotIntervalMinutes), [slotIntervalMinutes]);

  const resourcesToRender = useMemo(() => {
    const list = resources.length > 0 ? [...resources] : [];
    if (includeUnassignedResource && !list.some(resource => resource.id === 'unassigned')) {
      list.push({ id: 'unassigned', label: 'Unassigned' });
    }
    return list;
  }, [includeUnassignedResource, resources]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const currentTimeTop = useMemo(() => {
    if (!isSameDay(selectedDate, new Date())) {
      return null;
    }
    const now = new Date();
    return (now.getHours() - START_HOUR + now.getMinutes() / 60) * HOUR_HEIGHT;
  }, [selectedDate]);

  const appointmentsByResource = useMemo(() => {
    const grouped = new Map<string, CalendarAppointment[]>();
    for (const resource of resourcesToRender) {
      grouped.set(resource.id, []);
    }
    for (const appointment of dayAppointments) {
      const resourceId = appointment.technicianId ?? 'unassigned';
      const existing = grouped.get(resourceId) ?? [];
      existing.push(appointment);
      grouped.set(resourceId, existing);
    }
    for (const items of grouped.values()) {
      items.sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime());
    }
    return grouped;
  }, [dayAppointments, resourcesToRender]);

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (!overId || typeof overId !== 'string') {
      return;
    }

    const activeData = event.active.data.current as { appointmentId?: string; resourceId?: string } | undefined;
    const slot = parseSlotId(overId);
    if (!slot || !activeData?.appointmentId || !activeData.resourceId) {
      return;
    }

    if (slot.resourceId !== activeData.resourceId) {
      return;
    }

    onMoveAppointment({
      appointmentId: activeData.appointmentId,
      resourceId: slot.resourceId,
      startTime: slot.iso,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}
            </div>
            <div className="text-xs text-gray-500">
              {selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = new Date(selectedDate);
                next.setDate(selectedDate.getDate() - 7);
                onSelectedDateChange(next);
              }}
              className="rounded-full border border-gray-200 p-2 text-gray-500"
              aria-label="Previous week"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const next = new Date(selectedDate);
                next.setDate(selectedDate.getDate() + 7);
                onSelectedDateChange(next);
              }}
              className="rounded-full border border-gray-200 p-2 text-gray-500"
              aria-label="Next week"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {weekDates.map((date) => {
            const isSelected = isSameDay(date, selectedDate);
            const isToday = isSameDay(date, new Date());
            const dateKey = formatDateKey(date);
            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => onSelectedDateChange(date)}
                data-testid={`calendar-day-${dateKey}`}
                data-selected={isSelected ? 'true' : 'false'}
                aria-pressed={isSelected}
                className={`flex h-12 min-w-11 flex-col items-center justify-center rounded-full px-2 text-[13px] font-medium transition-colors ${isSelected ? 'bg-black text-white' : isToday ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                <span className="text-[10px]">
                  {date.toLocaleDateString('en-US', { weekday: 'narrow' })}
                </span>
                <span>{date.getDate()}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="p-4">
          <AsyncStatePanel
            loading
            title="Loading appointments"
            description="Pulling the latest day schedule."
          />
        </div>
      ) : error ? (
        <div className="p-4">
          <AsyncStatePanel
            tone="error"
            title="Unable to load appointments"
            description={error}
            action={(
              <Button type="button" variant="brandSoft" size="pillSm" onClick={onRetry}>
                Try again
              </Button>
            )}
          />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="min-h-0 flex-1 overflow-auto">
            {dayAppointments.length === 0 && (
              <div className="p-4">
                <AsyncStatePanel
                  title={emptyTitle}
                  description={emptyDescription}
                />
              </div>
            )}

            <div className="min-w-max px-4 pb-24 pt-3">
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `64px repeat(${resourcesToRender.length}, minmax(220px, 1fr))` }}
              >
                <div />
                {resourcesToRender.map(resource => (
                  <div
                    key={resource.id}
                    data-testid={`calendar-resource-${resource.id}`}
                    className="sticky top-0 z-20 rounded-2xl border border-gray-100 bg-white/95 px-3 py-2 text-left backdrop-blur"
                  >
                    <div className="text-xs font-medium uppercase tracking-[0.08em] text-gray-400">
                      {resourceLabel}
                    </div>
                    <div className="truncate text-sm font-semibold text-gray-900">{resource.label}</div>
                  </div>
                ))}

                <div className="relative">
                  {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, index) => {
                    const hour = START_HOUR + index;
                    return (
                      <div key={hour} className="h-24 pr-3 text-right text-[11px] font-medium text-gray-400">
                        {formatHour(hour)}
                      </div>
                    );
                  })}
                </div>

                {resourcesToRender.map(resource => (
                  <div key={resource.id} className="relative rounded-2xl border border-gray-100 bg-white">
                    <div className="relative">
                      {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, index) => (
                        <div key={index} className="h-24 border-t border-gray-100 first:border-t-0">
                          <div className="h-12 border-b border-dashed border-gray-50" />
                        </div>
                      ))}

                      <div className="absolute inset-0">
                        {slots.map((slot) => (
                          <DroppableSlot
                            key={`${resource.id}-${slot}`}
                            id={buildSlotId(resource.id, selectedDate, slot)}
                            testId={buildSlotTestId(resource.id, selectedDate, slot)}
                            height={HOUR_HEIGHT * (slotIntervalMinutes / 60)}
                          />
                        ))}
                      </div>

                      {typeof currentTimeTop === 'number' && currentTimeTop >= 0 && currentTimeTop <= ((END_HOUR - START_HOUR) * HOUR_HEIGHT) && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-0"
                          style={{ top: currentTimeTop }}
                        >
                          <div className="relative h-[2px] bg-red-500">
                            <div className="absolute -left-1.5 -top-1 size-2 rounded-full bg-red-500" />
                          </div>
                        </div>
                      )}

                      <div className="absolute inset-0">
                        {(appointmentsByResource.get(resource.id) ?? []).map((appointment) => (
                          <DraggableAppointment
                            key={appointment.id}
                            appointment={appointment}
                            resourceId={resource.id}
                            allowDrag={allowDrag && !appointment.isLocked && !['completed', 'cancelled', 'no_show'].includes(appointment.status)}
                            onOpen={() => onAppointmentSelect(appointment.id)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DndContext>
      )}
    </div>
  );
}
