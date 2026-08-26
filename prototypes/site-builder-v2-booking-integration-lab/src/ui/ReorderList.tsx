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
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import type { SectionInstance } from '../model/types';
import { keepEscapeInsideActiveControl } from './dialog-events';

const getSectionLabel = (section: SectionInstance): string =>
  section.sectionType === 'booking' ? 'Booking' : section.label;

const getSectionDescription = (section: SectionInstance): string =>
  section.sectionType === 'booking'
    ? `Keeps booking available${section.visible ? '' : ' · hidden'}`
    : `${section.size}${section.visible ? '' : ' · hidden'}`;

type ReorderListProps = {
  onActivateSection?: (section: SectionInstance) => void;
  onAnnounce: (message: string) => void;
  onDragReorder: (sectionId: string, position: number) => void;
  onMoveDown: (section: SectionInstance) => void;
  onMoveToPosition: (section: SectionInstance, position: number) => void;
  onMoveUp: (section: SectionInstance) => void;
  selectedSectionId: string;
  sections: SectionInstance[];
};

type SortableSectionRowProps = {
  index: number;
  onActivateSection?: (section: SectionInstance) => void;
  onAnnounce: (message: string) => void;
  onMoveDown: (section: SectionInstance) => void;
  onMoveToPosition: (section: SectionInstance, position: number) => void;
  onMoveUp: (section: SectionInstance) => void;
  section: SectionInstance;
  selected: boolean;
  total: number;
};

type PositionInputProps = {
  index: number;
  onAnnounce: (message: string) => void;
  onMove: (position: number) => void;
  sectionId: string;
  sectionLabel: string;
  total: number;
};

function PositionInput({
  index,
  onAnnounce,
  onMove,
  sectionId,
  sectionLabel,
  total,
}: PositionInputProps) {
  const currentPosition = index + 1;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [value, setValue] = useState(String(currentPosition));

  useEffect(() => {
    setValue(String(currentPosition));
    setError('');
  }, [currentPosition]);

  const restore = () => {
    setValue(String(currentPosition));
    setError('');
  };

  const commitOnEnter = () => {
    const position = Number(value);
    if (!Number.isInteger(position) || position < 1 || position > total) {
      const message = `Enter a position from 1 to ${total}.`;
      setError(message);
      onAnnounce(message);
      return;
    }
    setError('');
    if (position === currentPosition) {
      setValue(String(currentPosition));
      return;
    }
    onMove(position);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitOnEnter();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      restore();
      event.currentTarget.closest<HTMLElement>('.reorder-row')?.focus();
    }
  };

  const errorId = `position-error-${sectionId}`;

  return (
    <label className="position-input">
      <span className="visually-hidden">Position for {sectionLabel}</span>
      <input
        ref={inputRef}
        aria-describedby={error ? errorId : 'move-position-help'}
        aria-invalid={error ? 'true' : undefined}
        aria-label={`Position for ${sectionLabel}`}
        data-position-input={sectionId}
        inputMode="numeric"
        max={total}
        min={1}
        type="number"
        value={value}
        onBlur={restore}
        onChange={(event) => {
          setValue(event.target.value);
          setError('');
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
      />
      {error ? <span className="position-input__error" id={errorId} role="status">{error}</span> : null}
    </label>
  );
}

function SectionRowContent({
  attributes,
  index,
  listeners,
  onActivateSection,
  onAnnounce,
  onMoveDown,
  onMoveToPosition,
  onMoveUp,
  section,
  selected,
  total,
}: SortableSectionRowProps & {
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
}) {
  const sectionLabel = getSectionLabel(section);
  const onlySection = total < 2;
  const first = index === 0;
  const last = index === total - 1;

  if (onlySection) {
    return (
      <>
        <span aria-hidden="true" className="position-button">1</span>
        <div className="reorder-row__label">
          <strong>{sectionLabel}</strong>
          <span>{getSectionDescription(section)} · Only section</span>
        </div>
        {section.sectionType === 'booking' ? <span className="protected-badge">Always bookable</span> : null}
      </>
    );
  }

  return (
    <>
      <PositionInput
        index={index}
        onAnnounce={onAnnounce}
        onMove={(position) => onMoveToPosition(section, position)}
        sectionId={section.id}
        sectionLabel={sectionLabel}
        total={total}
      />
      <button
        aria-pressed={selected}
        className="reorder-row__select"
        type="button"
        onClick={() => onActivateSection?.(section)}
      >
        <span className="reorder-row__label">
          <strong>{sectionLabel}</strong>
          <span>{getSectionDescription(section)}{selected ? ' · Moving' : ''}</span>
        </span>
        <span className="visually-hidden">
          {selected ? ' Selected' : ` Select ${sectionLabel} for cross-page movement`}
        </span>
      </button>
      {section.sectionType === 'booking' ? <span className="protected-badge">Always bookable</span> : null}
      <div className="reorder-row__buttons" aria-label={`Movement options for ${sectionLabel}`}>
        <button
          aria-disabled={first ? 'true' : 'false'}
          aria-label={first ? `Move ${sectionLabel} up, unavailable — already first` : `Move ${sectionLabel} up`}
          className="icon-button"
          type="button"
          onClick={() => {
            if (!first) onMoveUp(section);
          }}
        >
          <ArrowUp aria-hidden="true" size={18} />
        </button>
        <button
          aria-disabled={last ? 'true' : 'false'}
          aria-label={last ? `Move ${sectionLabel} down, unavailable — already last` : `Move ${sectionLabel} down`}
          className="icon-button"
          type="button"
          onClick={() => {
            if (!last) onMoveDown(section);
          }}
        >
          <ArrowDown aria-hidden="true" size={18} />
        </button>
      </div>
      <button
        aria-label={`Drag ${sectionLabel}. Use arrow keys after lifting with Space.`}
        className="drag-handle"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" size={22} />
      </button>
    </>
  );
}

function SortableSectionRow(props: SortableSectionRowProps) {
  const onlySection = props.total < 2;
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.section.id, disabled: onlySection });

  return (
    <div
      ref={setNodeRef}
      aria-current={props.selected ? 'true' : undefined}
      className={`reorder-row${isDragging ? ' is-dragging' : ''}${props.selected ? ' is-target' : ''}${onlySection ? ' is-static' : ''}`}
      data-move-target-row={props.selected ? 'true' : undefined}
      data-section-id={props.section.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      tabIndex={props.selected ? 0 : -1}
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
  onActivateSection,
  onAnnounce,
  onDragReorder,
  onMoveDown,
  onMoveToPosition,
  onMoveUp,
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
    if (typeof navigator.vibrate === 'function') navigator.vibrate(12);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const fromIndex = sections.findIndex((section) => section.id === active.id);
    const toIndex = sections.findIndex((section) => section.id === over.id);
    const section = sections[fromIndex];
    if (!section || toIndex < 0) return;
    onDragReorder(section.id, toIndex + 1);
    onAnnounce(`${getSectionLabel(section)} moved to position ${toIndex + 1} of ${sections.length}.`);
  };

  return (
    <DndContext
      accessibility={{
        announcements: {
          onDragCancel({ active }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            return section ? `Moving ${getSectionLabel(section)} was cancelled.` : 'Movement cancelled.';
          },
          onDragEnd({ active, over }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            if (!over || active.id === over.id) return section ? `${getSectionLabel(section)} was not moved.` : 'Section was not moved.';
            const position = sections.findIndex((candidate) => candidate.id === over.id) + 1;
            return section && position > 0 ? `${getSectionLabel(section)} moved to position ${position} of ${sections.length}.` : 'Section was not moved.';
          },
          onDragOver({ active, over }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            const position = over ? sections.findIndex((candidate) => candidate.id === over.id) + 1 : 0;
            return section && position > 0 ? `${getSectionLabel(section)} is over position ${position} of ${sections.length}.` : undefined;
          },
          onDragStart({ active }) {
            const section = sections.find((candidate) => candidate.id === active.id);
            const position = sections.findIndex((candidate) => candidate.id === active.id) + 1;
            return section ? `Picked up ${getSectionLabel(section)}, position ${position} of ${sections.length}.` : undefined;
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
          className="reorder-list reorder-list--editable-positions"
          data-testid="reorder-list"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && activeId) {
              keepEscapeInsideActiveControl(event.nativeEvent);
            }
          }}
        >
          {sections.map((section, index) => (
            <SortableSectionRow
              key={section.id}
              index={index}
              onActivateSection={onActivateSection}
              onAnnounce={onAnnounce}
              onMoveDown={onMoveDown}
              onMoveToPosition={onMoveToPosition}
              onMoveUp={onMoveUp}
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
            <span aria-hidden="true" className="position-button">{sections.findIndex((section) => section.id === activeSection.id) + 1}</span>
            <div className="reorder-row__label"><strong>{getSectionLabel(activeSection)}</strong><span>{getSectionDescription(activeSection)}</span></div>
            <GripVertical aria-hidden="true" size={22} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
