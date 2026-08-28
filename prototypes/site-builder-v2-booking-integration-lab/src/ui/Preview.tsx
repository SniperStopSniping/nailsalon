import { Menu } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  BookingSectionRenderer,
  type BookingSessionUpdater,
} from '../booking/BookingSectionRenderer';
import type {
  BookingSessionState,
  BookingTokenPresetId,
  MockMenuFixture,
} from '../booking/types';
import { useCustomDesignAssetMap } from '../custom-design/integration/CustomDesignAssetProvider';
import { CustomDesignCustomerPreview } from '../custom-design/integration/CustomDesignSectionCard';
import {
  createHostedCustomDesignActionResolver,
  type CustomDesignDocumentNavigationTarget,
} from '../custom-design/integration/document-actions';
import { getStarterDocumentOutline } from '../model/starters';
import type { PageDocument, SiteBuilderDocument } from '../model/types';
import type { PublicContactAction } from '../onboarding/model/contact';
import type { PublicDirectionsAction } from '../onboarding/model/location';
import { toCustomDesignOwnerAssetMap } from './custom-design-adapters';

export type ClientBusinessMetadata = {
  contacts: readonly PublicContactAction[];
  currentHoursStatusLabel?: string;
  directions: PublicDirectionsAction | null;
  location: {
    detail: string | null;
    primary: string;
  };
  weeklyHours: readonly { hours: string; label: string }[];
};

type PreviewProps = {
  activePage: PageDocument;
  bookingFixture: MockMenuFixture;
  bookingSession: BookingSessionState;
  businessMetadata?: ClientBusinessMetadata;
  document: SiteBuilderDocument;
  onBookingSessionChange: BookingSessionUpdater;
  onNavigate: (pageId: string) => void;
  stageId?: string;
  tokenPreset: BookingTokenPresetId;
  viewport: 'desktop' | 'tablet' | 'mobile';
};

export function Preview({
  activePage,
  bookingFixture,
  bookingSession,
  businessMetadata,
  document,
  onBookingSessionChange,
  onNavigate,
  stageId,
  tokenPreset,
  viewport,
}: PreviewProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [customDesignRenderErrorAssetIds, setCustomDesignRenderErrorAssetIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const [summaryHost, setSummaryHost] = useState<HTMLDivElement | null>(null);
  const clientSiteRef = useRef<HTMLDivElement | null>(null);
  const pendingDocumentTargetRef = useRef<{
    pageId: string;
    sectionId?: string;
  } | null>(null);
  useEffect(() => setMobileNavigationOpen(false), [activePage.id, viewport]);
  const navigationItems = [...document.navigation.items]
    .sort((left, right) => left.order - right.order)
    .filter((item) => {
      const page = document.pages.find((candidate) => candidate.id === item.pageId);
      return page?.visible && page.visibleInNavigation;
    });
  const preferredContact = businessMetadata?.contacts.find((contact) => contact.preferred)
    ?? businessMetadata?.contacts[0];
  const visibleSections = activePage.sections.filter((section) => section.visible);
  const starterSectionLabels = useMemo(() => new Map(
    getStarterDocumentOutline(document).flatMap((page) => page.sections.map(
      (section) => [section.id, section.label] as const,
    )),
  ), [document]);
  const customDesignAssetIds = useMemo(() => visibleSections.flatMap((section) =>
    section.sectionType === 'custom_design'
      ? section.settings.images.map((image) => image.assetId)
      : []), [visibleSections]);
  const customDesignAssetPairs = useCustomDesignAssetMap(customDesignAssetIds);
  const customDesignAssets = useMemo(() => {
    const resolved = toCustomDesignOwnerAssetMap(customDesignAssetPairs);
    return Object.fromEntries(Object.entries(resolved).map(([assetId, asset]) => [
      assetId,
      customDesignRenderErrorAssetIds.has(assetId)
        ? { status: 'error' as const, reason: 'This design file could not be displayed.' }
        : asset,
    ]));
  }, [customDesignAssetPairs, customDesignRenderErrorAssetIds]);
  const setClientSiteHost = useCallback((element: HTMLDivElement | null) => {
    clientSiteRef.current = element;
    setSummaryHost(element);
  }, []);
  const readClientScroll = useCallback(() => ({
    x: clientSiteRef.current?.scrollLeft ?? window.scrollX,
    y: clientSiteRef.current?.scrollTop ?? window.scrollY,
  }), []);
  const scrollToDocumentTarget = useCallback((sectionId?: string) => {
    const clientSite = clientSiteRef.current;
    if (!clientSite) return;
    if (!sectionId) {
      clientSite.scrollTo({ behavior: 'smooth', left: 0, top: 0 });
      return;
    }
    const target = [...clientSite.querySelectorAll<HTMLElement>('[data-section-id]')]
      .find((candidate) => candidate.dataset.sectionId === sectionId);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    const pending = pendingDocumentTargetRef.current;
    if (!pending || pending.pageId !== activePage.id) return undefined;
    pendingDocumentTargetRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      scrollToDocumentTarget(pending.sectionId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePage.id, scrollToDocumentTarget]);

  const activateCustomDesignDocumentTarget = useCallback((
    target: CustomDesignDocumentNavigationTarget,
  ) => {
    if (target.relationship === 'same_page') {
      scrollToDocumentTarget(target.sectionId);
      return;
    }
    pendingDocumentTargetRef.current = {
      pageId: target.pageId,
      ...(target.sectionId ? { sectionId: target.sectionId } : {}),
    };
    onNavigate(target.pageId);
  }, [onNavigate, scrollToDocumentTarget]);
  const resolveCustomDesignPreviewAction = useMemo(
    () => createHostedCustomDesignActionResolver({
      activePageId: activePage.id,
      document,
    }, activateCustomDesignDocumentTarget),
    [activePage.id, activateCustomDesignDocumentTarget, document],
  );

  return (
    <div className={`preview-stage preview-stage--${viewport}`} data-testid="preview-stage" id={stageId}>
      <div className="preview-frame" data-preview-viewport={viewport}>
        <div
          ref={setClientSiteHost}
          className={`client-site${bookingSession.selection.serviceId ? ' has-booking-selection' : ''}`}
        >
        <header className="client-header">
          <div className="client-brand" title={document.siteName}>
            <span>L</span><strong>{document.siteName}</strong>
          </div>
          {businessMetadata?.currentHoursStatusLabel ? (
            <span className="client-hours-status">{businessMetadata.currentHoursStatusLabel}</span>
          ) : null}
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
        {businessMetadata ? (
          <section aria-label="Business details" className="client-business-metadata">
            {businessMetadata.location.primary ? (
              <div>
                <strong>Visit</strong>
                <span>{businessMetadata.location.primary}</span>
                {businessMetadata.location.detail ? (
                  <small>{businessMetadata.location.detail}</small>
                ) : null}
              </div>
            ) : null}
            {businessMetadata.weeklyHours.length > 0 ? (
              <div>
                <strong>Hours</strong>
                <dl>
                  {businessMetadata.weeklyHours.map((day) => (
                    <div key={day.label}><dt>{day.label}</dt><dd>{day.hours}</dd></div>
                  ))}
                </dl>
              </div>
            ) : null}
            {preferredContact ? (
              <div>
                <strong>Contact</strong>
                <span>{preferredContact.detail}</span>
              </div>
            ) : null}
            {businessMetadata.directions || businessMetadata.contacts.length > 0 ? (
              <div className="client-business-metadata__actions">
                {businessMetadata.directions ? (
                  <a
                    aria-label={businessMetadata.directions.accessibleLabel}
                    className="is-secondary"
                    href={businessMetadata.directions.href}
                    rel={businessMetadata.directions.rel}
                    target={businessMetadata.directions.target}
                  >Directions</a>
                ) : null}
                {businessMetadata.contacts.map((contact) => (
                  <a
                    className={contact.preferred ? 'is-preferred' : 'is-secondary'}
                    data-contact-method={contact.method}
                    href={contact.href}
                    key={`${contact.method}-${contact.href}`}
                    rel={contact.rel}
                    target={contact.target}
                  >
                    {contact.actionLabel}
                    {contact.preferred && contact.method !== 'booking' ? ' · Preferred' : ''}
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
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
                  id="booking"
                >
                  <BookingSectionRenderer
                    fixture={bookingFixture}
                    mode="preview"
                    presentationSettings={section.settings}
                    session={bookingSession}
                    tokenPreset={tokenPreset}
                    overlayHost={overlayHost}
                    summaryHost={summaryHost}
                    previewViewport={viewport}
                    onSessionChange={onBookingSessionChange}
                  />
                </section>
              );
            }

            if (section.sectionType === 'custom_design') {
              if (section.settings.images.length === 0) return null;
              return (
                <div
                  key={section.id}
                  className="preview-section preview-section--custom-design"
                  data-section-id={section.id}
                  data-section-type="custom_design"
                >
                  <CustomDesignCustomerPreview
                    accessibleSectionLabel="Custom Design"
                    assets={customDesignAssets}
                    getScrollPosition={readClientScroll}
                    onAssetRenderError={(assetId) => {
                      setCustomDesignRenderErrorAssetIds((current) => new Set(current).add(assetId));
                    }}
                    resolveAction={resolveCustomDesignPreviewAction}
                    settings={section.settings}
                  />
                </div>
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
                  <h3>{starterSectionLabels.get(section.id) ?? section.label}</h3>
                </div>
              </section>
            );
          }) : <p className="empty-preview">This page has no visible sections yet.</p>}
        </main>
        </div>
        <div ref={setOverlayHost} className="preview-overlay-host" data-preview-viewport={viewport} />
      </div>
    </div>
  );
}
