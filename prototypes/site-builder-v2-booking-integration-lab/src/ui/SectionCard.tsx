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

import { getSectionRegistryEntry, isLibrarySection } from '../model/section-library/registry';
import type { NonEngineSectionInstance, PageDocument } from '../model/types';

type SectionCardProps = {
  page: PageDocument;
  section: NonEngineSectionInstance;
  selected: boolean;
  onEdit: (section: NonEngineSectionInstance) => void;
  onEnterReorder: () => void;
  onMove: (section: NonEngineSectionInstance) => void;
  onRemove: (section: NonEngineSectionInstance) => void;
  onSelect: (section: NonEngineSectionInstance) => void;
  onToggleVisible: (section: NonEngineSectionInstance) => void;
};

export function SectionCard({
  page,
  section,
  selected,
  onEdit,
  onEnterReorder,
  onMove,
  onRemove,
  onSelect,
  onToggleVisible,
}: SectionCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const placeholder = isLibrarySection(section) ? null : section;
  const library = isLibrarySection(section) ? section : null;
  const entry = library ? getSectionRegistryEntry(library.sectionType) : null;
  const sizeClass = placeholder ? placeholder.size : 'medium';
  const badge = placeholder
    ? placeholder.size
    : library && 'preset' in library.settings
      ? String(library.settings.preset).replaceAll('_', ' ')
      : entry?.category ?? 'section';
  const note = placeholder
    ? placeholder.placeholderSettings.note
    : entry?.description ?? '';
  const numberMark = placeholder
    ? placeholder.label.replace('Section ', '')
    : (entry?.label ?? section.label).slice(0, 2).toUpperCase();
  useEffect(() => {
    if (!selected) {
      setMenuOpen(false);
    }
  }, [selected]);

  return (
    <article
      aria-label={`${section.label} on ${page.name}`}
      className={`section-card section-card--${sizeClass}${selected ? ' is-selected' : ''}${section.visible ? '' : ' is-hidden'} section-card--final-hybrid`}
      data-section-id={section.id}
      data-section-instance-id={section.id}
      data-section-label={section.label}
      data-section-type={section.sectionType}
      role="listitem"
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('button, input, select, textarea, a')) {
          onSelect(section);
        }
      }}
    >
      <button aria-pressed={selected} className="section-card__select-surface" type="button" onClick={() => onSelect(section)}>
        <span className="section-card__topline">
          <span className="section-card__identity">
            <span className="section-card__number" aria-hidden="true">{numberMark}</span>
            <span>
              <strong className="section-card__title">{section.label}</strong>
              <span className="section-card__description">{note}</span>
            </span>
          </span>
          <span className="section-card__badges">
            <span className="size-badge">{badge}</span>
            {!section.visible ? <span className="hidden-badge"><EyeOff aria-hidden="true" size={14} /> Hidden</span> : null}
          </span>
        </span>
      </button>

      {placeholder?.placeholderSettings.note ? <p className="section-card__note">“{placeholder.placeholderSettings.note}”</p> : null}
      <div className="placeholder-grid" aria-hidden="true"><span /><span /><span /></div>

      <div aria-label={`Quick actions for ${section.label}`} className="section-context-toolbar">
        <span aria-hidden="true" className="section-context-toolbar__label">{section.label}</span>
        <button aria-label={`Reorder ${section.label}`} type="button" onClick={onEnterReorder}>
          <GripVertical aria-hidden="true" size={16} /><span>Reorder</span>
        </button>
        <button type="button" onClick={() => onEdit(section)}><Pencil aria-hidden="true" size={16} /> Edit</button>
        <button className="section-context-toolbar__move" type="button" onClick={() => onMove(section)}><Move aria-hidden="true" size={16} /> Move</button>
        <button
          aria-expanded={menuOpen}
          aria-label={`More actions for ${section.label}`}
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
            <button type="button" onClick={() => { onMove(section); setMenuOpen(false); }}><Move aria-hidden="true" size={16} /> Move section</button>
            <button className="danger-quiet" type="button" onClick={() => { onRemove(section); setMenuOpen(false); }}><Trash2 aria-hidden="true" size={16} /> Remove from this page</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
