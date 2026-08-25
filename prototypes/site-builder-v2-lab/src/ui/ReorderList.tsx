import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, MoveRight } from 'lucide-react';
import { useState } from 'react';

import type { SectionInstance } from '../model/types';

type ReorderListProps = {
  onAnnounce: (message: string) => void;
  onDragReorder: (sectionId: string, position: number) => void;
  onMoveDown: (section: SectionInstance) => void;
  onMovePage: (section: SectionInstance) => void;
  onMoveUp: (section: SectionInstance) => void;
  onOpenPosition: (section: SectionInstance) => void;
  sections: SectionInstance[];
};

type SortableSectionRowProps = {
  index: number;
  onMoveDown: (section: SectionInstance) => void;
  onMovePage: (section: SectionInstance) => void;
  onMoveUp: (section: SectionInstance) => void;
  onOpenPosition: (section: SectionInstance) => void;
  section: SectionInstance;
  total: number;
};

function SectionRowContent({
  attributes,
  index,
  listeners,
  onMoveDown,
  onMovePage,
  onMoveUp,
  onOpenPosition,
  section,
  total,
}: SortableSectionRowProps & {
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
}) {
  return (
    <>
      <button
        className="position-button"
        type="button"
        aria-label={`Move ${section.label} by number, current position ${index + 1}`}
        onClick={() => onOpenPosition(section)}
      >
        {index + 1}
      </button>
      <div className="reorder-row__label">
        <strong>{section.label}</strong>
        <span>{section.size}{section.visible ? '' : ' · hidden'}</span>
      </div>
      {section.sectionType === 'booking_access' ? <span className="protected-badge">Protected</span> : null}
      <div className="reorder-row__buttons" aria-label={`Movement options for ${section.label}`}>
        <button className="icon-button" type="button" aria-label={`Move ${section.label} up`} disabled={index === 0} onClick={() => onMoveUp(section)}>
          <ArrowUp aria-hidden="true" size={18} />
        </button>
        <button className="icon-button" type="button" aria-label={`Move ${section.label} down`} disabled={index === total - 1} onClick={() => onMoveDown(section)}>
          <ArrowDown aria-hidden="true" size={18} />
        </button>
        <button className="icon-button" type="button" aria-label={`Move ${section.label} to another page`} onClick={() => onMovePage(section)}>
          <MoveRight aria-hidden="true" size={18} />
        </button>
      </div>
      <button
        className="drag-handle"
        type="button"
        aria-label={`Drag ${section.label}. Use arrow keys after lifting with Space.`}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" size={22} />
      </button>
    </>
  );
}

function SortableSectionRow(props: SortableSectionRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.section.id });

  return (
    <div
      ref={setNodeRef}
      className={`reorder-row${isDragging ? ' is-dragging' : ''}`}
      data-section-id={props.section.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <SectionRowContent
        {...props}
        attributes={attributes as unknown as Record<string, unknown>}
        listeners={listeners as unknown as Record<string, unknown>}
      />
    </div>
  );
}

export function ReorderList({
  onAnnounce,
  onDragReorder,
  onMoveDown,
  onMovePage,
  onMoveUp,
  onOpenPosition,
  sections,
}: ReorderListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(mouseSensor, touchSensor, keyboardSensor);
  const activeSection = sections.find((section) => section.id === activeId) ?? null;

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) {
      return;
    }

    const fromIndex = sections.findIndex((section) => section.id === active.id);
    const toIndex = sections.findIndex((section) => section.id === over.id);
    const section = sections[fromIndex];
    if (!section || toIndex < 0) {
      return;
    }

    onDragReorder(section.id, toIndex + 1);
    onAnnounce(`${section.label} moved to position ${toIndex + 1} of ${sections.length}.`);
  };

  return (
    <DndContext
      accessibility={{
        announcements: {
          onDragCancel({ active }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            return section ? `Moving ${section.label} was cancelled.` : 'Movement cancelled.';
          },
          onDragEnd({ active, over }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            if (!over || active.id === over.id) {
              return section ? `${section.label} was not moved.` : 'Section was not moved.';
            }
            const position = over ? sections.findIndex((candidate) => candidate.id === over.id) + 1 : 0;
            return section && position > 0
              ? `${section.label} moved to position ${position} of ${sections.length}.`
              : 'Section was not moved.';
          },
          onDragOver({ active, over }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            const position = over ? sections.findIndex((candidate) => candidate.id === over.id) + 1 : 0;
            return section && position > 0 ? `${section.label} is over position ${position} of ${sections.length}.` : undefined;
          },
          onDragStart({ active }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            const position = sections.findIndex((candidate) => candidate.id === active.id) + 1;
            return section ? `Picked up ${section.label}, position ${position} of ${sections.length}.` : undefined;
          },
        },
        screenReaderInstructions: {
          draggable: 'Press Space to pick up a section. Use arrow keys to move it, then press Space again to place it or Escape to cancel.',
        },
      }}
      autoScroll
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <SortableContext items={sections.map((section) => section.id)} strategy={verticalListSortingStrategy}>
        <div className="reorder-list" data-testid="reorder-list">
          {sections.map((section, index) => (
            <SortableSectionRow
              key={section.id}
              index={index}
              onMoveDown={onMoveDown}
              onMovePage={onMovePage}
              onMoveUp={onMoveUp}
              onOpenPosition={onOpenPosition}
              section={section}
              total={sections.length}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeSection ? (
          <div className="reorder-row reorder-row--overlay">
            <span className="position-button" aria-hidden="true">{sections.findIndex((section) => section.id === activeSection.id) + 1}</span>
            <div className="reorder-row__label"><strong>{activeSection.label}</strong><span>{activeSection.size}</span></div>
            <GripVertical aria-hidden="true" size={22} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
