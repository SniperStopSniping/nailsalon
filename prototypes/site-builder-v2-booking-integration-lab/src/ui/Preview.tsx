import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  BookingSectionRenderer,
  type BookingSessionUpdater,
} from '../booking/BookingSectionRenderer';
import type {
  BookingSessionState,
  BookingTokenPresetId,
  MockMenuFixture,
} from '../booking/types';
import type { PageDocument, SiteBuilderDocument } from '../model/types';

type PreviewProps = {
  activePage: PageDocument;
  bookingFixture: MockMenuFixture;
  bookingSession: BookingSessionState;
  document: SiteBuilderDocument;
  onBookingSessionChange: BookingSessionUpdater;
  onNavigate: (pageId: string) => void;
  tokenPreset: BookingTokenPresetId;
  viewport: 'desktop' | 'tablet' | 'mobile';
};

export function Preview({
  activePage,
  bookingFixture,
  bookingSession,
  document,
  onBookingSessionChange,
  onNavigate,
  tokenPreset,
  viewport,
}: PreviewProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  useEffect(() => setMobileNavigationOpen(false), [activePage.id, viewport]);
  const navigationItems = [...document.navigation.items]
    .sort((left, right) => left.order - right.order)
    .filter((item) => {
      const page = document.pages.find((candidate) => candidate.id === item.pageId);
      return page?.visible && page.visibleInNavigation;
    });
  const visibleSections = activePage.sections.filter((section) => section.visible);

  return (
    <div className={`preview-stage preview-stage--${viewport}`} data-testid="preview-stage">
      <div className="client-site">
        <header className="client-header">
          <div className="client-brand"><span>L</span><strong>{document.siteName}</strong></div>
          {document.navigation.enabled ? (
            <nav aria-label="Preview site navigation" className={mobileNavigationOpen ? 'is-open' : undefined}>
              {navigationItems.map((item) => (
                <button
                  key={item.id}
                  aria-current={item.pageId === activePage.id ? 'page' : undefined}
                  type="button"
                  onClick={() => { onNavigate(item.pageId); setMobileNavigationOpen(false); }}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          ) : <span className="client-header__simple">Simple page</span>}
          {document.navigation.enabled ? (
            <button
              aria-expanded={mobileNavigationOpen}
              aria-label={mobileNavigationOpen ? 'Close site navigation' : 'Open site navigation'}
              className="client-menu-button"
              type="button"
              onClick={() => setMobileNavigationOpen((value) => !value)}
            >
              <Menu aria-hidden="true" size={22} />
            </button>
          ) : null}
        </header>
        <main className="client-page" aria-label={`${activePage.name} preview`}>
          <div className="client-page__heading">
            <span>Page</span>
            <h2>{activePage.name}</h2>
          </div>
          {visibleSections.length > 0 ? visibleSections.map((section) => {
            if (section.sectionType === 'booking') {
              return (
                <section
                  key={section.id}
                  aria-label="Booking section"
                  className="preview-section preview-section--booking"
                  data-section-id={section.id}
                  data-section-type="booking"
                >
                  <BookingSectionRenderer
                    fixture={bookingFixture}
                    mode="preview"
                    presentationSettings={section.settings}
                    session={bookingSession}
                    tokenPreset={tokenPreset}
                    onSessionChange={onBookingSessionChange}
                  />
                </section>
              );
            }

            return (
              <section
                key={section.id}
                className={`preview-section preview-section--${section.size}`}
                data-section-id={section.id}
                data-section-type={section.sectionType}
              >
                <span className="preview-section__number">{section.label.replace('Section ', '')}</span>
                <div>
                  <p>{activePage.name}</p>
                  <h3>{section.label}</h3>
                  <span>Future section · {section.size}</span>
                </div>
              </section>
            );
          }) : <p className="empty-preview">This page has no visible sections yet.</p>}
        </main>
      </div>
    </div>
  );
}
