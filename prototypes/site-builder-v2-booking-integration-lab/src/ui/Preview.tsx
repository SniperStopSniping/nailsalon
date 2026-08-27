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
import { resolveCustomDesignDocumentAction } from '../custom-design/integration/document-actions';
import type { ResolveCustomDesignAction } from '../custom-design/components/view-types';
import type { PageDocument, SiteBuilderDocument } from '../model/types';
import { toCustomDesignOwnerAssetMap } from './custom-design-adapters';

type PreviewProps = {
  activePage: PageDocument;
  bookingFixture: MockMenuFixture;
  bookingSession: BookingSessionState;
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
  const visibleSections = activePage.sections.filter((section) => section.visible);
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

  const resolveCustomDesignPreviewAction: ResolveCustomDesignAction = useCallback((
    action,
    source,
  ) => {
    const effectiveAction = action
      ?? (source.type === 'cta' && source.cta.type === 'book_now'
        ? { type: 'start_booking' as const }
        : null);
    if (!effectiveAction) return { status: 'unresolved', reason: 'invalid_destination' };
    const resolution = resolveCustomDesignDocumentAction(effectiveAction, {
      activePageId: activePage.id,
      document,
    });
    if (resolution.status !== 'resolved' || !resolution.documentTarget) {
      return resolution;
    }
    const target = resolution.documentTarget;
    return {
      status: 'button',
      onActivate: (event) => {
        event.preventDefault();
        if (target.relationship === 'same_page') {
          scrollToDocumentTarget(target.sectionId);
          return;
        }
        pendingDocumentTargetRef.current = {
          pageId: target.pageId,
          ...(target.sectionId ? { sectionId: target.sectionId } : {}),
        };
        onNavigate(target.pageId);
      },
    };
  }, [activePage.id, document, onNavigate, scrollToDocumentTarget]);

  return (
    <div className={`preview-stage preview-stage--${viewport}`} data-testid="preview-stage" id={stageId}>
      <div className="preview-frame" data-preview-viewport={viewport}>
        <div
          ref={setClientSiteHost}
          className={`client-site${bookingSession.selection.serviceId ? ' has-booking-selection' : ''}`}
        >
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
                  <h3>{section.label}</h3>
                  <span>Future section · {section.size}</span>
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
