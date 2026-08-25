import { Eye, EyeOff, MousePointer2, Move, Pencil, Trash2 } from 'lucide-react';

import type { PageDocument, SectionInstance } from '../model/types';

type SectionCardProps = {
  page: PageDocument;
  section: SectionInstance;
  selected: boolean;
  onEdit: (section: SectionInstance) => void;
  onMove: (section: SectionInstance) => void;
  onRemove: (section: SectionInstance) => void;
  onSelect: (section: SectionInstance) => void;
  onToggleVisible: (section: SectionInstance) => void;
};

export function SectionCard({
  page,
  section,
  selected,
  onEdit,
  onMove,
  onRemove,
  onSelect,
  onToggleVisible,
}: SectionCardProps) {
  const protectedSection = section.sectionType === 'booking_access';

  return (
    <article
      aria-label={`${section.label} on ${page.name}`}
      className={`section-card section-card--${section.size}${selected ? ' is-selected' : ''}${section.visible ? '' : ' is-hidden'}`}
      data-section-id={section.id}
      data-section-instance-id={section.id}
      data-section-label={section.label}
      role="listitem"
    >
      <div className="section-card__topline">
        <div className="section-card__identity">
          <span className="section-card__number" aria-hidden="true">{protectedSection ? 'BA' : section.label.replace('Section ', '')}</span>
          <div>
            <h3>{section.label}</h3>
            <p>{protectedSection ? 'Protected booking path placeholder' : 'Content and settings will be designed later.'}</p>
          </div>
        </div>
        <div className="section-card__badges">
          <span className="size-badge">{section.size}</span>
          {!section.visible ? <span className="hidden-badge"><EyeOff aria-hidden="true" size={14} /> Hidden</span> : null}
          {protectedSection ? <span className="protected-badge">Protected</span> : null}
        </div>
      </div>
      {section.placeholderSettings.note ? <p className="section-card__note">“{section.placeholderSettings.note}”</p> : null}
      {protectedSection ? (
        <div className="booking-placeholder">
          <strong>Booking access</strong>
          <span>Protected — every published site needs at least one path to booking.</span>
        </div>
      ) : (
        <div className="placeholder-grid" aria-hidden="true"><span /><span /><span /></div>
      )}
      <div className="section-card__actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => onSelect(section)}><MousePointer2 aria-hidden="true" size={16} /> Select</button>
        <button type="button" onClick={() => onEdit(section)}><Pencil aria-hidden="true" size={16} /> Edit</button>
        <button type="button" onClick={() => onToggleVisible(section)}>
          {section.visible ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
          {section.visible ? 'Hide' : 'Show'}
        </button>
        <button type="button" onClick={() => onMove(section)}><Move aria-hidden="true" size={16} /> Move</button>
        <button type="button" className="danger-quiet" onClick={() => onRemove(section)}><Trash2 aria-hidden="true" size={16} /> Remove from this page</button>
      </div>
    </article>
  );
}
