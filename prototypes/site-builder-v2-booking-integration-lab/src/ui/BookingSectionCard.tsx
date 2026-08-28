import { EyeOff } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  BookingSectionRenderer,
  type BookingSessionUpdater,
} from '../booking/BookingSectionRenderer';
import { BOOKING_LAYOUT_META } from '../booking/layout-meta';
import type {
  BookingSessionState,
  BookingTokenPresetId,
  MockMenuFixture,
} from '../booking/types';
import type { BookingSectionInstance, PageDocument } from '../model/types';

export type BookingCollapseReport = {
  collapsed: boolean;
  collapseHeight: number;
  isLong: boolean;
};

type BookingSectionCardProps = {
  collapseOverride?: boolean;
  fixture: MockMenuFixture;
  onCollapseChange?: (collapsed: boolean) => void;
  onCollapseReport?: (report: BookingCollapseReport) => void;
  onEdit: (section: BookingSectionInstance) => void;
  onEnterReorder: () => void;
  onMove: (section: BookingSectionInstance) => void;
  onRemove: (section: BookingSectionInstance) => void;
  onSelect: (section: BookingSectionInstance) => void;
  onSessionChange: BookingSessionUpdater;
  onToggleVisible: (section: BookingSectionInstance) => void;
  page: PageDocument;
  section: BookingSectionInstance;
  selected: boolean;
  session: BookingSessionState;
  tokenPreset: BookingTokenPresetId;
};

export function BookingSectionCard({
  collapseOverride,
  fixture,
  onCollapseChange,
  onCollapseReport,
  onSelect,
  onSessionChange,
  page,
  section,
  selected,
  session,
  tokenPreset,
}: BookingSectionCardProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() => Math.max(320, window.innerHeight - 82));
  const layoutMeta = BOOKING_LAYOUT_META[section.settings.layout];
  const isLong = naturalHeight > viewportHeight * 3;
  const collapsed = collapseOverride ?? isLong;
  const collapseHeight = Math.min(viewportHeight * 2, 1200);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const measure = () => {
      const topbar = document.querySelector<HTMLElement>('.final-topbar');
      const available = Math.max(320, window.innerHeight - (topbar?.getBoundingClientRect().bottom ?? 82));
      setViewportHeight(available);
      setNaturalHeight(content.scrollHeight);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(content);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [fixture.menuSize, section.settings]);

  useEffect(() => {
    onCollapseReport?.({ collapsed, collapseHeight, isLong });
  }, [collapseHeight, collapsed, isLong, onCollapseReport]);

  const toggleCollapse = () => onCollapseChange?.(!collapsed);

  return (
    <article
      aria-label={`Booking on ${page.name}`}
      className={`section-card section-card--booking${selected ? ' is-selected' : ''}${section.visible ? '' : ' is-hidden'} section-card--final-hybrid`}
      data-booking-editor-collapsed={collapsed ? 'true' : 'false'}
      data-section-id={section.id}
      data-section-instance-id={section.id}
      data-section-label="Booking"
      data-section-type="booking"
      role="listitem"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('button, input, select, textarea, a')) onSelect(section);
      }}
    >
      <button
        aria-pressed={selected}
        className="section-card__select-surface section-card__select-surface--booking"
        type="button"
        onClick={() => onSelect(section)}
      >
        <span className="section-card__topline">
          <span className="section-card__identity">
            <span className="section-card__number" aria-hidden="true">B</span>
            <span>
              <strong className="section-card__title">Booking</strong>
              <span className="section-card__description">
                {layoutMeta.label} · {fixture.services.length} services
              </span>
            </span>
          </span>
          <span className="section-card__badges">
            <span className="size-badge">{layoutMeta.shortLabel}</span>
            {!section.visible ? (
              <span className="hidden-badge"><EyeOff aria-hidden="true" size={14} /> Hidden</span>
            ) : null}
            <span className="protected-badge">Always bookable</span>
          </span>
        </span>
      </button>

      <div
        aria-expanded={!collapsed}
        aria-label="Booking editor preview"
        className={`booking-editor-preview${collapsed ? ' is-collapsed' : ''}`}
        id={`booking-preview-${section.id}`}
        style={collapsed ? { maxHeight: `${collapseHeight}px` } : undefined}
      >
        <div ref={contentRef} className="booking-editor-preview__measure">
          <BookingSectionRenderer
            fixture={fixture}
            mode="edit"
            onOwnerSelect={() => {
              if (!selected) onSelect(section);
            }}
            presentationSettings={section.settings}
            session={session}
            tokenPreset={tokenPreset}
            onSessionChange={onSessionChange}
          />
        </div>
        {collapsed ? <div aria-hidden="true" className="booking-editor-preview__fade" /> : null}
        {collapsed ? (
          <button className="booking-editor-preview__edge-toggle" type="button" onClick={toggleCollapse}>
            Show full preview
          </button>
        ) : null}
      </div>
      {isLong ? (
        <button
          aria-controls={`booking-preview-${section.id}`}
          aria-expanded={!collapsed}
          className="booking-editor-preview__toggle"
          type="button"
          onClick={toggleCollapse}
        >
          {collapsed ? 'Show full preview' : 'Collapse preview'}
        </button>
      ) : null}
    </article>
  );
}
