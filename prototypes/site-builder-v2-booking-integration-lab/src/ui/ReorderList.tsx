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
import { useEffect, useState, type KeyboardEvent } from 'react';

import type { SectionInstance } from '../model/types';

const getSectionLabel = (section: SectionInstance): string =>
  section.sectionType === 'booking' ? 'Booking' : section.label;

const getSectionDescription = (section: SectionInstance): string =>
  section.sectionType === 'booking'
    ? `Protected booking section${section.visible ? '' : ' · hidden'}`
    : `${section.size}${section.visible ? '' : ' · hidden'}`;

type ReorderListProps = {
  editablePositions?: boolean;
  onAnnounce: (message: string) => void;
  onDragReorder: (sectionId: string, position: number) => void;
  onMoveDown: (section: SectionInstance) => void;
  onMovePage?: (section: SectionInstance) => void;
  onMoveToPosition?: (section: SectionInstance, position: number) => void;
  onMoveUp: (section: SectionInstance) => void;
  onOpenPosition?: (section: SectionInstance) => void;
  selectedSectionId?: string;
  sections: SectionInstance[];
};

type SortableSectionRowProps = {
  editablePositions: boolean;
  index: number;
  onMoveDown: (section: SectionInstance) => void;
  onMovePage?: (section: SectionInstance) => void;
  onMoveToPosition?: (section: SectionInstance, position: number) => void;
  onMoveUp: (section: SectionInstance) => void;
  onOpenPosition?: (section: SectionInstance) => void;
  section: SectionInstance;
  selected: boolean;
  total: number;
};

type PositionInputProps = {
  focusTarget: boolean;
  index: number;
  onMove: (position: number) => void;
  sectionLabel: string;
  total: number;
};

function PositionInput({ focusTarget, index, onMove, sectionLabel, total }: PositionInputProps) {
  const currentPosition = index + 1;
  const [value, setValue] = useState(String(currentPosition));

  useEffect(() => {
    setValue(String(currentPosition));
  }, [currentPosition]);

  const commitPosition = () => {
    const position = Number(value);
    if (!Number.isInteger(position) || position < 1 || position > total) {
      setValue(String(currentPosition));
      return;
    }
    if (position !== currentPosition) {
      onMove(position);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPosition();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setValue(String(currentPosition));
      event.currentTarget.blur();
    }
  };

  return (
    <label className="position-input">
      <span className="visually-hidden">Position for {sectionLabel}</span>
      <input
        aria-describedby="move-position-help"
        aria-label={`Position for ${sectionLabel}`}
        data-move-target-position={focusTarget ? 'true' : undefined}
        inputMode="numeric"
        max={total}
        min={1}
        type="number"
        value={value}
        onBlur={commitPosition}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </label>
  );
}

function SectionRowContent({
  attributes,
  editablePositions,
  index,
  listeners,
  onMoveDown,
  onMovePage,
  onMoveToPosition,
  onMoveUp,
  onOpenPosition,
  section,
  selected,
  total,
}: SortableSectionRowProps & {
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
}) {
  const sectionLabel = getSectionLabel(section);

  return (
    <>
      {editablePositions && onMoveToPosition ? (
        <PositionInput
          focusTarget={selected}
          index={index}
          onMove={(position) => onMoveToPosition(section, position)}
          sectionLabel={sectionLabel}
          total={total}
        />
      ) : (
        <button
          className="position-button"
          type="button"
          aria-label={`Move ${sectionLabel} by number, current position ${index + 1}`}
          onClick={() => onOpenPosition?.(section)}
        >
          {index + 1}
        </button>
      )}
      <div className="reorder-row__label">
        <strong>{sectionLabel}</strong>
        <span>{getSectionDescription(section)}{selected ? ' · Moving' : ''}</span>
      </div>
      {section.sectionType === 'booking' ? <span className="protected-badge">Protected</span> : null}
      <div className="reorder-row__buttons" aria-label={`Movement options for ${sectionLabel}`}>
        <button className="icon-button" type="button" aria-label={`Move ${sectionLabel} up`} disabled={index === 0} onClick={() => onMoveUp(section)}>
          <ArrowUp aria-hidden="true" size={18} />
        </button>
        <button className="icon-button" type="button" aria-label={`Move ${sectionLabel} down`} disabled={index === total - 1} onClick={() => onMoveDown(section)}>
          <ArrowDown aria-hidden="true" size={18} />
        </button>
        {onMovePage ? (
          <button className="icon-button" type="button" aria-label={`Move ${sectionLabel} to another page`} onClick={() => onMovePage(section)}>
            <MoveRight aria-hidden="true" size={18} />
          </button>
        ) : null}
      </div>
      <button
        className="drag-handle"
        type="button"
        aria-label={`Drag ${sectionLabel}. Use arrow keys after lifting with Space.`}
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
      className={`reorder-row${isDragging ? ' is-dragging' : ''}${props.selected ? ' is-target' : ''}`}
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
  editablePositions = false,
  onAnnounce,
  onDragReorder,
  onMoveDown,
  onMovePage,
  onMoveToPosition,
  onMoveUp,
  onOpenPosition,
  selectedSectionId,
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
        <div
          className={`reorder-list${editablePositions ? ' reorder-list--editable-positions' : ''}`}
          data-testid="reorder-list"
        >
          {sections.map((section, index) => (
            <SortableSectionRow
              key={section.id}
              editablePositions={editablePositions}
              index={index}
              onMoveDown={onMoveDown}
              onMovePage={onMovePage}
              onMoveToPosition={onMoveToPosition}
              onMoveUp={onMoveUp}
              onOpenPosition={onOpenPosition}
              section={section}
              selected={section.id === selectedSectionId}
              total={sections.length}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeSection ? (
          <div className="reorder-row reorder-row--overlay">
            <span className="position-button" aria-hidden="true">{sections.findIndex((section) => section.id === activeSection.id) + 1}</span>
            <div className="reorder-row__label"><strong>{getSectionLabel(activeSection)}</strong><span>{getSectionDescription(activeSection)}</span></div>
            <GripVertical aria-hidden="true" size={22} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
