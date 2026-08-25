import './concept-foundation.css';

import { EDITOR_CONCEPTS, type EditorConceptId } from './types';

type ConceptSwitcherProps = {
  activeConceptId: EditorConceptId;
  className?: string;
  onChange: (id: EditorConceptId) => void;
  onOpenGallery: () => void;
};

export function ConceptSwitcher({
  activeConceptId,
  className = '',
  onChange,
  onOpenGallery,
}: ConceptSwitcherProps) {
  return (
    <div
      aria-label="Editor UI concepts"
      className={`editor-concept-switcher ${className}`.trim()}
      data-testid="editor-concept-switcher"
      role="group"
    >
      <span className="editor-concept-switcher__label">UI concept</span>
      <div className="editor-concept-switcher__choices">
        {EDITOR_CONCEPTS.map((concept) => (
          <button
            key={concept.id}
            aria-label={concept.label}
            aria-pressed={activeConceptId === concept.id}
            className="editor-concept-switcher__choice"
            type="button"
            onClick={() => onChange(concept.id)}
          >
            <span className="editor-concept-switcher__full-label">{concept.label}</span>
            <span aria-hidden="true" className="editor-concept-switcher__short-label">{concept.number}</span>
          </button>
        ))}
      </div>
      <button className="editor-concept-switcher__gallery" type="button" onClick={onOpenGallery}>
        Open UI concept gallery
      </button>
    </div>
  );
}
