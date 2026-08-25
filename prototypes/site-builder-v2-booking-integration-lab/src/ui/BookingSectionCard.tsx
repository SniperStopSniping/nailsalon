import {
  Eye,
  EyeOff,
  GripVertical,
  MoreHorizontal,
  Move,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

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

type BookingSectionCardProps = {
  fixture: MockMenuFixture;
  page: PageDocument;
  section: BookingSectionInstance;
  selected: boolean;
  session: BookingSessionState;
  tokenPreset: BookingTokenPresetId;
  onEdit: (section: BookingSectionInstance) => void;
  onEnterReorder: () => void;
  onMove: (section: BookingSectionInstance) => void;
  onRemove: (section: BookingSectionInstance) => void;
  onSelect: (section: BookingSectionInstance) => void;
  onSessionChange: BookingSessionUpdater;
  onToggleVisible: (section: BookingSectionInstance) => void;
};

export function BookingSectionCard({
  fixture,
  page,
  section,
  selected,
  session,
  tokenPreset,
  onEdit,
  onEnterReorder,
  onMove,
  onRemove,
  onSelect,
  onSessionChange,
  onToggleVisible,
}: BookingSectionCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(fixture.menuSize === 'stress_100');
  const layoutMeta = BOOKING_LAYOUT_META[section.settings.layout];

  useEffect(() => {
    if (!selected) {
      setMenuOpen(false);
    }
  }, [selected]);

  useEffect(() => {
    if (fixture.menuSize === 'stress_100') {
      setCollapsed(true);
    }
  }, [fixture.menuSize]);

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
        if (!target.closest('.section-context-toolbar, button, input, select, textarea, a')) {
          onSelect(section);
        }
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
                {layoutMeta.label} · {fixture.services.length} mock services
              </span>
            </span>
          </span>
          <span className="section-card__badges">
            <span className="size-badge">{layoutMeta.shortLabel}</span>
            {!section.visible ? (
              <span className="hidden-badge"><EyeOff aria-hidden="true" size={14} /> Hidden</span>
            ) : null}
            <span className="protected-badge">Protected</span>
          </span>
        </span>
      </button>

      <div className={`booking-editor-preview${collapsed ? ' is-collapsed' : ''}`}>
        <BookingSectionRenderer
          fixture={fixture}
          mode="edit"
          presentationSettings={section.settings}
          session={session}
          tokenPreset={tokenPreset}
          onSessionChange={onSessionChange}
        />
        {collapsed ? <div aria-hidden="true" className="booking-editor-preview__fade" /> : null}
      </div>
      <button
        className="booking-editor-preview__toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? 'Show full Booking preview' : 'Collapse Booking preview'}
      </button>

      <div aria-label="Quick actions for Booking" className="section-context-toolbar">
        <span aria-hidden="true" className="section-context-toolbar__label">Booking</span>
        <button aria-label="Reorder Booking" type="button" onClick={onEnterReorder}>
          <GripVertical aria-hidden="true" size={16} /><span>Reorder</span>
        </button>
        <button type="button" onClick={() => onEdit(section)}>
          <Pencil aria-hidden="true" size={16} /> Edit
        </button>
        <button className="section-context-toolbar__move" type="button" onClick={() => onMove(section)}>
          <Move aria-hidden="true" size={16} /> Move
        </button>
        <button
          aria-expanded={menuOpen}
          aria-label="More actions for Booking"
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreHorizontal aria-hidden="true" size={18} /><span className="section-context-toolbar__more-label">More</span>
        </button>
        {menuOpen ? (
          <div className="section-more-menu">
            <button type="button" onClick={() => { onToggleVisible(section); setMenuOpen(false); }}>
              {section.visible ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              {section.visible ? 'Hide section' : 'Show section'}
            </button>
            <button type="button" onClick={() => { onMove(section); setMenuOpen(false); }}>
              <Move aria-hidden="true" size={16} /> Move section
            </button>
            <button className="danger-quiet" type="button" onClick={() => { onRemove(section); setMenuOpen(false); }}>
              <Trash2 aria-hidden="true" size={16} /> Remove from this page
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
