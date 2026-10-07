'use client';

import './isla-booking.css';

import { ArrowRight, Check, ChevronDown, Facebook, Instagram, Music2, Plus, Search, Sparkles, X } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import type { BookingStep } from '@/libs/bookingFlow';
import { formatInstagramHandle } from '@/libs/instagramHandle';
import type { BookingExperience } from '@/types/salonPolicy';

const ASSETS = '/isla';

/** Custom presentation commissioned for Isla; every booking action remains canonical. */
export function isIslaBookingPage(salonSlug: string | null | undefined) {
  return salonSlug === 'isla-nail-studio';
}

export function IslaCategoryIcon({ category }: { category: string }) {
  return (
    <svg viewBox="0 0 24 24" className="isla-icon" aria-hidden="true">
      {category === 'manicure'
        ? <path d="M8 21c-3-2-4-4-4-7V7.5a1.4 1.4 0 0 1 2.8 0V12M7 8V4a1.4 1.4 0 0 1 2.8 0v7M10 6V2.8a1.4 1.4 0 0 1 2.8 0V11M13 6V4a1.4 1.4 0 0 1 2.8 0v10l2.1-2.7a1.5 1.5 0 0 1 2.3 1.9L16 19v2" />
        : category === 'pedicure'
          ? (
              <>
                <path d="M7 19c-2-2-2-5 0-7 2-2 4-2 5-5 1-2 4-2 5 0 1 3 0 4-2 7-2 2-2 5-4 6-1 .8-3 .5-4-1Z" />
                <ellipse cx="15.2" cy="3.8" rx="1.9" ry="2.2" />
                <path d="M12 3.5v1M9.5 5v1M7.5 7v1" />
              </>
            )
          : <><path d="M9 3h6v6H9zM8 10h8a1 1 0 0 1 1 1v9H7v-9a1 1 0 0 1 1-1ZM10 13h4M10 16h4" /></>}
    </svg>
  );
}

function IslaProgress({ flow }: { flow: BookingStep[] }) {
  const labels: Record<BookingStep, string> = { service: 'Service', tech: 'Artist', time: 'Time', confirm: 'Confirm' };
  return (
    <nav className="isla-progress" aria-label="Booking progress">
      <ol>
        {flow.map((step, index) => (
          <Fragment key={step}>
            {index > 0 && <li className="isla-progress-rule" aria-hidden="true" />}
            <li aria-current={step === 'service' ? 'step' : undefined}>
              <span className="isla-step-number">{index + 1}</span>
              <span>{labels[step]}</span>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

export function IslaServiceCard({ id, name, description, image, duration, price, selected, expanded, disabled, badge, onSelect }: {
  id: string;
  name: string;
  description: string;
  image: ReactNode;
  duration: string;
  price: string;
  selected: boolean;
  expanded: boolean;
  disabled: boolean;
  badge?: string | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="isla-service"
      data-testid={`service-card-${id}`}
      data-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
      aria-expanded={expanded}
      aria-controls={expanded ? `service-details-${id}` : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {image && <span className="isla-service-photo">{image}</span>}
      <span className="isla-service-copy">
        {badge && <span className="isla-service-badge">{badge}</span>}
        <span className="isla-service-name">{name}</span>
        <span className="isla-service-description">{description}</span>
        <span className="isla-service-meta">
          <span>{duration}</span>
          <span aria-hidden="true">·</span>
          <strong>{price}</strong>
        </span>
      </span>
      <span className="isla-pick" aria-hidden="true">{selected ? <Check /> : <Plus />}</span>
      {selected && <span className="sr-only">Added to your booking</span>}
    </button>
  );
}

export function IslaBookingPage({ children, continueBar, flow, manageHref, policy, socialLinks, moreCount, categoryLabel, onShowMore, onSearch }: {
  children: ReactNode;
  continueBar: ReactNode;
  flow: BookingStep[];
  manageHref: string;
  policy: { title: string; text: string } | null;
  socialLinks: BookingExperience['socialLinks'];
  moreCount: number;
  categoryLabel: string;
  onShowMore: () => void;
  onSearch: () => void;
}) {
  const [policyOpen, setPolicyOpen] = useState(false);
  const configuredSocials = [
    { name: 'Instagram', label: formatInstagramHandle(socialLinks.instagram) ?? 'Instagram', href: socialLinks.instagram, Icon: Instagram },
    { name: 'Facebook', label: 'Facebook', href: socialLinks.facebook, Icon: Facebook },
    { name: 'TikTok', label: 'TikTok', href: socialLinks.tiktok, Icon: Music2 },
  ].filter(social => social.href);
  return (
    <div className="isla-shell">
      <header className="isla-navigation">
        <img className="isla-logo" src={`${ASSETS}/isla-logo-original.jpg`} alt="Isla Nail Studio" width="145" height="96" />
        <nav className="isla-navigation-links" aria-label="Studio links">
          <a className="isla-manage" href={manageHref}>Manage my booking</a>
          {socialLinks.instagram && <a className="isla-instagram" href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" aria-label="Isla Nail Studio on Instagram"><Instagram aria-hidden="true" /></a>}
        </nav>
      </header>
      <div className="isla-main-grid">
        <section className="isla-hero" aria-label="Welcome to Isla">
          <img className="isla-palm" src={`${ASSETS}/palm-frond.svg`} alt="" aria-hidden="true" width="185" height="202" />
          <div className="isla-eyebrow">A LITTLE TIME FOR YOU</div>
          <h1 className="isla-headline">
            Your next
            <br />
            <em>beautiful</em>
            {' '}
            set.
          </h1>
          <p className="isla-supporting-copy">
            Thoughtful nail care. Beautiful detail.
            <br />
            Your service. Your moment.
          </p>
          <p className="isla-editorial-note">
            <span>More</span>
            <span>than nails.</span>
            <span>A moment.</span>
            <i aria-hidden="true" />
          </p>
          <figure className="isla-photograph">
            <div className="isla-photograph-frame"><img src={`${ASSETS}/gel-x.jpg`} alt="Both hands showing Isla’s pink manicure with white French tips" width="800" height="600" fetchPriority="high" /></div>
            <figcaption className="isla-editorial-card">
              <span>THE ISLA TOUCH</span>
              <strong>
                Care in every
                <br />
                detail.
              </strong>
            </figcaption>
          </figure>
          <div className="isla-studio-note">
            <Sparkles aria-hidden="true" />
            <div>
              <h2>Your own little escape.</h2>
              <p>
                Gel-X, BIAB, Russian manicures and pedicures.
                <br />
                Clean, detailed nail work, with care.
              </p>
            </div>
          </div>
        </section>
        <section className="isla-booking" aria-labelledby="isla-services-title">
          <IslaProgress flow={flow} />
          <div className="isla-booking-heading">
            <h2 id="isla-services-title">Choose your service.</h2>
            <button type="button" className="isla-search-toggle" aria-label="Search services" onClick={onSearch}><Search aria-hidden="true" /></button>
          </div>
          <p className="isla-booking-description">Choose a service. Add the little extras next.</p>
          <div className="isla-menu">{children}</div>
          {moreCount > 0 && (
            <button type="button" className="isla-more-services" onClick={onShowMore}>
              {moreCount}
              {' '}
              more
              {' '}
              {categoryLabel.toLowerCase()}
              {' '}
              {moreCount === 1 ? 'service' : 'services'}
              <ChevronDown aria-hidden="true" />
            </button>
          )}
          <p className="isla-addon-note">
            <Sparkles aria-hidden="true" />
            <span>
              Make it your own. Available extras appear
              <br />
              after you choose your service.
            </span>
          </p>
          <div className="isla-order">{continueBar}</div>
        </section>
      </div>
      <section className="isla-gallery" aria-labelledby="isla-gallery-title">
        <div className="isla-gallery-heading">
          <div>
            <p className="isla-small-caps">FROM THE STUDIO</p>
            <h2 id="isla-gallery-title">An Isla moment.</h2>
          </div>
          {configuredSocials.length > 0 && (
            <nav className="isla-studio-socials" aria-label="Salon social links">
              {configuredSocials.map(({ name, label, href, Icon }) => (
                <a key={name} href={href ?? undefined} className="isla-instagram-link" target="_blank" rel="noopener noreferrer" aria-label={`Isla Nail Studio on ${name}`}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  <ArrowRight aria-hidden="true" />
                </a>
              ))}
            </nav>
          )}
        </div>
        <div className="isla-gallery-grid">
          {[
            ['gel-manicure.jpg', 'Soft colour.', 'Soft pink gel manicure photographed at Isla'],
            ['gel-x.jpg', 'Beautiful shape.', 'Isla Gel-X extension service photograph'],
            ['builder-gel.jpg', 'Every little detail.', 'Isla builder-gel nail service photograph'],
          ].map(([src, caption, alt]) => (
            <figure key={src}>
              <img src={`${ASSETS}/${src}`} alt={alt} loading="lazy" width="600" height="600" />
              <figcaption>{caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <footer className="isla-footer">
        <div>
          <p className="isla-brand-name">Isla Nail Studio</p>
          <p>Made for your moment.</p>
        </div>
        <nav aria-label="Booking links">
          {policy && <button type="button" onClick={() => setPolicyOpen(true)}>Booking policies</button>}
          <a href={manageHref}>Manage my booking</a>
          <span className="isla-powered">Booking powered by Luster</span>
        </nav>
      </footer>
      <DialogShell isOpen={policyOpen} onClose={() => setPolicyOpen(false)} maxWidthClassName="max-w-md">
        <section className="isla-policy" role="dialog" aria-modal="true" aria-labelledby="isla-policy-title">
          <header>
            <h2 id="isla-policy-title">{policy?.title || 'Booking policies'}</h2>
            <button type="button" onClick={() => setPolicyOpen(false)} aria-label="Close booking policies"><X /></button>
          </header>
          <p>{policy?.text}</p>
        </section>
      </DialogShell>
    </div>
  );
}
