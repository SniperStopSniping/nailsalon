import { useRef } from 'react';
import type { ReactNode } from 'react';

import type { OriginStarter } from '../model/types';
import type { EditorConceptId } from './concepts/types';

import './starter-concepts.css';

type StarterChooserProps = {
  concept: EditorConceptId;
  headerSlot?: ReactNode;
  onChoose: (starter: OriginStarter) => void;
  onImport?: (file: File) => void;
  onOpenGallery: () => void;
};

type StarterDefinition = {
  badge: string;
  description: string;
  id: OriginStarter;
  name: string;
  preview: readonly number[];
};

type ConceptNumber = 1 | 2 | 3 | 4 | 5;

const CONCEPT_NUMBER_BY_ID: Record<EditorConceptId, ConceptNumber> = {
  canvas_first: 1,
  dark_studio: 2,
  inline_editor: 5,
  mobile_first: 3,
  split_workspace: 4,
};

const STARTERS: readonly StarterDefinition[] = [
  {
    badge: 'Starts with 3 sections',
    description: 'Start with a fast, booking-focused page.',
    id: 'quick_book',
    name: 'Quick Book',
    preview: [26, 44, 32],
  },
  {
    badge: 'Starts with 6 sections',
    description: 'Start with a complete scrolling salon website.',
    id: 'one_page',
    name: 'One-page website',
    preview: [48, 35, 35, 47, 25, 30],
  },
  {
    badge: 'Starts with 5 pages',
    description: 'Start with separate pages and a navigation menu.',
    id: 'multi_page',
    name: 'Multi-page website',
    preview: [32, 42, 26, 35, 28],
  },
] as const;

const MINIATURE_COPY: Record<OriginStarter, {
  eyebrow: string;
  heading: string;
  nav: string;
}> = {
  quick_book: {
    eyebrow: 'Appointments available',
    heading: 'Fresh nails, one tap away.',
    nav: 'Services · Book',
  },
  one_page: {
    eyebrow: 'The nail room',
    heading: 'Details made personal.',
    nav: 'About · Work · Services',
  },
  multi_page: {
    eyebrow: 'Luster Studio',
    heading: 'Your salon, beautifully online.',
    nav: 'Home · Services · Gallery · About',
  },
};

function ConceptPreview({ concept, starter }: { concept: ConceptNumber; starter: StarterDefinition }) {
  const miniature = MINIATURE_COPY[starter.id];

  return (
    <div
      className={`starter-preview starter-preview--${starter.id} starter-preview--concept-${concept}`}
      aria-hidden="true"
    >
      <div className="starter-preview__browser">
        <div className="starter-preview__browser-dot-row">
          <i />
          <i />
          <i />
        </div>
        <div className="starter-preview__site-nav">
          <span>Luster</span>
          <small>{miniature.nav}</small>
          <b>Book</b>
        </div>
        <div className="starter-preview__salon-hero">
          <span className="starter-preview__portrait" />
          <div>
            <small>{miniature.eyebrow}</small>
            <strong>{miniature.heading}</strong>
            <span className="starter-preview__book">Book an appointment</span>
          </div>
        </div>
        <div className="starter-preview__salon-content">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="starter-preview__wireframe">
        <div className="starter-preview__wireframe-top" />
        <div className="starter-preview__wireframe-body">
          {starter.preview.map((height, index) => (
            <span key={`${starter.id}-${index}`} style={{ height }} />
          ))}
        </div>
      </div>

      <div className="starter-preview__structure">
        <div className="starter-preview__structure-rail">
          <strong>Pages</strong>
          <span className="is-active">Home</span>
          {starter.id === 'multi_page' ? (
            <>
              <span>Services</span>
              <span>Gallery</span>
            </>
          ) : null}
        </div>
        <div className="starter-preview__structure-canvas">
          {starter.preview.slice(0, starter.id === 'one_page' ? 5 : 3).map((height, index) => (
            <span key={`structure-${starter.id}-${index}`} style={{ minHeight: Math.max(24, height) }}>
              {String(index + 1).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      <span className="starter-preview__phone-home" />
    </div>
  );
}

function ConceptRail({ concept }: { concept: ConceptNumber }) {
  return (
    <aside className="starter-concept-rail" aria-hidden={concept !== 4}>
      <span className="starter-concept-rail__kicker">Start a site</span>
      <strong>Choose a structure</strong>
      <p>Every option opens the same flexible editor.</p>
      <div className="starter-concept-rail__steps">
        <span className="is-current"><b>1</b> Starting point</span>
        <span><b>2</b> Build your site</span>
        <span><b>3</b> Preview</span>
      </div>
      <span className="starter-concept-rail__note">You can change the structure anytime.</span>
    </aside>
  );
}

export function StarterChooser({ concept, headerSlot, onChoose, onImport, onOpenGallery }: StarterChooserProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const conceptNumber = CONCEPT_NUMBER_BY_ID[concept];

  return (
    <main className={`starter-screen starter-screen--concept-${conceptNumber}`} data-editor-concept={concept}>
      <header className="starter-screen__brand">
        <div className="starter-screen__identity">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="starter-screen__wordmark">Luster</span>
          <span className="lab-pill">Site Builder V2 Lab</span>
        </div>
        <div className="starter-screen__header-actions">
          {headerSlot}
          {headerSlot ? null : (
            <button className="starter-screen__gallery-button" type="button" onClick={onOpenGallery}>
              <span aria-hidden="true">▦</span>
              UI Concept Gallery
            </button>
          )}
        </div>
      </header>

      <div className="starter-screen__workspace">
        <ConceptRail concept={conceptNumber} />
        <section className="starter-screen__content" aria-labelledby="starter-title">
          <p className="eyebrow">Universal website builder</p>
          <h1 id="starter-title">Choose your starting point</h1>
          <p className="starter-screen__intro">
            Start simple or begin with a full website. You can add sections and pages anytime without rebuilding your services.
          </p>
          <div className="starter-grid">
            {STARTERS.map((starter, index) => (
              <button
                key={starter.id}
                className="starter-card"
                type="button"
                onClick={() => onChoose(starter.id)}
              >
                <span className="starter-card__index" aria-hidden="true">0{index + 1}</span>
                <ConceptPreview concept={conceptNumber} starter={starter} />
                <span className="starter-card__copy">
                  <span className="starter-card__title">{starter.name}</span>
                  <span className="starter-card__description">{starter.description}</span>
                  <span className="starter-card__badge">{starter.badge}</span>
                  <span className="starter-card__action">Use this starting point <span aria-hidden="true">→</span></span>
                </span>
              </button>
            ))}
          </div>
          <p className="starter-screen__freedom">You can turn any starting point into any kind of site later.</p>
          {onImport ? (
            <div className="starter-screen__import">
              <span>Already have a Lab backup?</span>
              <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>Import JSON</button>
              <input
                ref={importInputRef}
                accept="application/json,.json"
                aria-label="Import site JSON file"
                className="visually-hidden"
                tabIndex={-1}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImport(file);
                  event.target.value = '';
                }}
              />
            </div>
          ) : null}
        </section>
      </div>
      <p className="lab-disclaimer">Mock data only · Saved in this browser · Not connected to Production</p>
    </main>
  );
}
