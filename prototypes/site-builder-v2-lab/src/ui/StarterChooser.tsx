import { useRef } from 'react';

import type { OriginStarter } from '../model/types';

type StarterChooserProps = {
  onChoose: (starter: OriginStarter) => void;
  onImport?: (file: File) => void;
};

type StarterDefinition = {
  badge: string;
  description: string;
  id: OriginStarter;
  name: string;
  preview: readonly number[];
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

function WireframePreview({ starter }: { starter: StarterDefinition }) {
  return (
    <div className={`starter-wireframe starter-wireframe--${starter.id}`} aria-hidden="true">
      <div className="starter-wireframe__top" />
      <div className="starter-wireframe__body">
        {starter.preview.map((height, index) => (
          <span key={`${starter.id}-${index}`} style={{ height }} />
        ))}
      </div>
    </div>
  );
}

export function StarterChooser({ onChoose, onImport }: StarterChooserProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  return (
    <main className="starter-screen">
      <div className="starter-screen__brand">
        <span className="brand-mark" aria-hidden="true">L</span>
        <span>Luster</span>
        <span className="lab-pill">Site Builder V2 Lab</span>
      </div>
      <section className="starter-screen__content" aria-labelledby="starter-title">
        <p className="eyebrow">Universal website builder</p>
        <h1 id="starter-title">Choose your starting point</h1>
        <p className="starter-screen__intro">
          Start simple or begin with a full website. You can add sections and pages anytime without rebuilding your services.
        </p>
        <div className="starter-grid">
          {STARTERS.map((starter) => (
            <button
              key={starter.id}
              className="starter-card"
              type="button"
              onClick={() => onChoose(starter.id)}
            >
              <WireframePreview starter={starter} />
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
      <p className="lab-disclaimer">Mock data only · Saved in this browser · Not connected to Production</p>
    </main>
  );
}
