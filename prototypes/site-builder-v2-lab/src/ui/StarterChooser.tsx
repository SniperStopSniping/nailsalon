import { ArrowRight, CalendarDays, FileUp, Sparkles } from 'lucide-react';
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
};

const STARTERS: readonly StarterDefinition[] = [
  {
    badge: 'Starts with 3 sections',
    description: 'Fastest way to start taking bookings.',
    id: 'quick_book',
    name: 'Quick Book',
  },
  {
    badge: 'Starts with 6 sections',
    description: 'A complete scrolling salon website.',
    id: 'one_page',
    name: 'One-page website',
  },
  {
    badge: 'Starts with 5 pages',
    description: 'Separate pages with a navigation menu.',
    id: 'multi_page',
    name: 'Multi-page website',
  },
] as const;

function StarterMiniature({ starter }: { starter: OriginStarter }) {
  return (
    <div aria-hidden="true" className={`final-starter-mini final-starter-mini--${starter}`}>
      <div className="final-starter-mini__topbar">
        <span><i>L</i><b>Luster Nail Studio</b></span>
        <small>{starter === 'multi_page' ? 'Home · Services · Gallery · About' : 'Services · Work · Book'}</small>
      </div>
      <div className="final-starter-mini__hero">
        <span className="final-starter-mini__eyebrow">Toronto nail artist</span>
        <strong>{starter === 'quick_book' ? 'Beautiful nails, booked in minutes.' : 'Nails designed around you.'}</strong>
        <span className="final-starter-mini__button">Book an appointment</span>
      </div>
      {starter === 'quick_book' ? (
        <div className="final-starter-mini__booking">
          <span><b>Signature manicure</b><small>60 min</small></span>
          <span><b>Gel extensions</b><small>90 min</small></span>
          <i><CalendarDays size={12} /> Choose a service</i>
        </div>
      ) : null}
      {starter === 'one_page' ? (
        <div className="final-starter-mini__one-page">
          <span className="is-about"><b>About the studio</b></span>
          <span className="is-gallery"><i /><i /><i /></span>
          <span className="is-services"><b>Popular services</b><i /><i /></span>
          <span className="is-reviews"><b>“My nails have never looked better.”</b></span>
          <span className="is-book"><b>Ready to book?</b></span>
        </div>
      ) : null}
      {starter === 'multi_page' ? (
        <div className="final-starter-mini__pages">
          <span className="is-current"><b>Home</b><small>Welcome and featured work</small></span>
          <span><b>Services</b><small>Treatments and booking</small></span>
          <span><b>Gallery</b><small>Recent nail art</small></span>
          <span><b>About</b><small>Your story</small></span>
          <span><b>Contact</b><small>Location and hours</small></span>
        </div>
      ) : null}
    </div>
  );
}

export function StarterChooser({ onChoose, onImport }: StarterChooserProps) {
  const importInputRef = useRef<HTMLInputElement>(null);

  return (
    <main className="final-starter-screen">
      <header className="final-starter-header">
        <a aria-label="Luster" className="final-starter-header__brand" href="#starter-title">
          <span aria-hidden="true">L</span><strong>Luster</strong>
        </a>
        <span className="final-starter-header__lab"><Sparkles aria-hidden="true" size={15} /> Site Builder Lab</span>
      </header>

      <section className="final-starter-content" aria-labelledby="starter-title">
        <p className="final-starter-kicker">Start here. Change anything later.</p>
        <h1 id="starter-title">Choose your starting point</h1>
        <p className="final-starter-intro">
          Start simple or begin with a full website. You can add sections and pages anytime.
        </p>

        <div className="final-starter-grid">
          {STARTERS.map((starter) => (
            <button className="final-starter-card" key={starter.id} type="button" onClick={() => onChoose(starter.id)}>
              <StarterMiniature starter={starter.id} />
              <span className="final-starter-card__copy">
                <span><strong>{starter.name}</strong><small>{starter.description}</small></span>
                <span className="final-starter-card__badge">{starter.badge}</span>
                <span className="final-starter-card__action">Choose this start <ArrowRight aria-hidden="true" size={18} /></span>
              </span>
            </button>
          ))}
        </div>

        <div className="final-starter-reassurance">
          <strong>You can turn any starting point into any kind of site later.</strong>
          <span>The same editor and section library are available from every option.</span>
        </div>

        {onImport ? (
          <div className="final-starter-import">
            <span>Have a Lab backup?</span>
            <button type="button" onClick={() => importInputRef.current?.click()}><FileUp aria-hidden="true" size={17} /> Import JSON</button>
            <input
              ref={importInputRef}
              accept="application/json,.json"
              aria-label="Import site JSON file"
              className="visually-hidden"
              tabIndex={-1}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImport(file);
                }
                event.target.value = '';
              }}
            />
          </div>
        ) : null}
      </section>

      <p className="final-starter-disclaimer">Mock data only · Saved in this browser · Not connected to Production</p>
    </main>
  );
}
