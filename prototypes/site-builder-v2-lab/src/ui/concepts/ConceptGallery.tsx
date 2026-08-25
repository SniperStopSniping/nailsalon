import './concept-foundation.css';

import { EDITOR_CONCEPTS, type EditorConcept, type EditorConceptId } from './types';

type ConceptGalleryProps = {
  activeConceptId: EditorConceptId;
  onClose?: () => void;
  onOpenConcept: (id: EditorConceptId) => void;
  onUseSameSiteState?: (id: EditorConceptId) => void;
};

function MiniSiteSections() {
  return (
    <div className="concept-mini-site__sections">
      <span className="concept-mini-site__hero"><i>Salon name</i><b>Book now</b></span>
      <span><i>Section 02</i></span>
      <span><i>Booking access</i></span>
    </div>
  );
}

function DesktopConceptPreview({ concept }: { concept: EditorConcept }) {
  return (
    <div className="concept-mini concept-mini--desktop" aria-hidden="true">
      <div className="concept-mini__topbar">
        <span className="concept-mini__brand">L</span>
        <span />
        <i />
        <i />
        <i />
      </div>
      <div className="concept-mini__workspace">
        <div className="concept-mini__rail">
          <b />
          <span />
          <span />
          <span />
        </div>
        <div className="concept-mini__stage">
          <div className="concept-mini__floating-tools"><span /><span /><span /></div>
          <div className="concept-mini-site">
            <div className="concept-mini-site__nav"><b>Studio Luster</b><i /><i /><i /></div>
            <MiniSiteSections />
            <div className="concept-mini-site__selection"><span>Edit</span><span>•••</span></div>
          </div>
        </div>
        <div className="concept-mini__drawer">
          <b />
          <span />
          <span />
        </div>
      </div>
      <span className="concept-mini__caption">{concept.shellPattern}</span>
    </div>
  );
}

function MobileConceptPreview({ concept }: { concept: EditorConcept }) {
  return (
    <div className="concept-mini concept-mini--mobile" aria-hidden="true">
      <div className="concept-mini__phone-top"><b>Luster</b><span>Home⌄</span><i>•••</i></div>
      <div className="concept-mini-site concept-mini-site--phone">
        <div className="concept-mini-site__nav"><b>Studio Luster</b><i /></div>
        <MiniSiteSections />
      </div>
      <div className="concept-mini__phone-actions"><span>Edit</span><span>Move</span><span>More</span></div>
      <b className="concept-mini__phone-add">+ Add section</b>
      <span className="concept-mini__caption">{concept.mobilePattern}</span>
    </div>
  );
}

function ConceptGalleryCard({
  activeConceptId,
  concept,
  onOpenConcept,
  onUseSameSiteState,
}: {
  activeConceptId: EditorConceptId;
  concept: EditorConcept;
  onOpenConcept: (id: EditorConceptId) => void;
  onUseSameSiteState?: (id: EditorConceptId) => void;
}) {
  const isActive = activeConceptId === concept.id;

  return (
    <article
      className={`concept-gallery-card ${concept.className}${isActive ? ' concept-gallery-card--active' : ''}`}
      data-concept-id={concept.id}
    >
      <header className="concept-gallery-card__header">
        <div>
          <p>Concept {concept.number}</p>
          <h2>{concept.label}</h2>
        </div>
        {isActive ? <span className="concept-gallery-card__current">Current concept</span> : null}
      </header>
      <p className="concept-gallery-card__description">{concept.description}</p>
      <div className="concept-gallery-card__previews">
        <DesktopConceptPreview concept={concept} />
        <MobileConceptPreview concept={concept} />
      </div>
      <dl className="concept-gallery-card__details">
        <div><dt>Character</dt><dd>{concept.character}</dd></div>
        <div><dt>Palette</dt><dd>{concept.palette}</dd></div>
      </dl>
      <div className="concept-gallery-card__actions">
        <button className="concept-gallery-card__open" type="button" onClick={() => onOpenConcept(concept.id)}>
          Open concept
        </button>
        {onUseSameSiteState ? (
          <button className="concept-gallery-card__same-state" type="button" onClick={() => onUseSameSiteState(concept.id)}>
            Use same site state
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function ConceptGallery({
  activeConceptId,
  onClose,
  onOpenConcept,
  onUseSameSiteState,
}: ConceptGalleryProps) {
  return (
    <section className="ui-concept-gallery" aria-labelledby="ui-concept-gallery-title">
      <header className="ui-concept-gallery__hero">
        <div>
          <p className="ui-concept-gallery__eyebrow">Luster Site Builder V2 Lab</p>
          <h1 id="ui-concept-gallery-title">UI Concept Gallery</h1>
          <p>Five editor-shell directions using the same site, pages, sections, and history.</p>
        </div>
        {onClose ? <button type="button" onClick={onClose}>Return to editor</button> : null}
      </header>
      <div className="ui-concept-gallery__notice" role="note">
        Switching concepts changes presentation only. Your current site state stays exactly as it is.
      </div>
      <div className="ui-concept-gallery__grid">
        {EDITOR_CONCEPTS.map((concept) => (
          <ConceptGalleryCard
            key={concept.id}
            activeConceptId={activeConceptId}
            concept={concept}
            onOpenConcept={onOpenConcept}
            onUseSameSiteState={onUseSameSiteState}
          />
        ))}
      </div>
    </section>
  );
}
