import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';

import { BookingLayout } from './BookingLayouts';
import { Handoff } from './Handoff';
import { SelectedSummary } from './SelectedSummary';
import { ServiceDetail } from './ServiceDetail';
import {
  createEmptyBookingSession,
  createMenuFixture,
  normalizeBookingSelection,
  normalizeSessionForLayoutChange,
  summarizeSelection,
  toggleSelectionAddOn,
} from './helpers';
import { BOOKING_LAYOUT_META } from './layout-meta';
import { bookingTokenStyles } from './presentation';
import type {
  BookingSessionState,
  BookingSectionPresentationSettings,
  BookingTokenPresetId,
  MockMenuFixture,
  MockService,
  ServiceCategory,
} from './types';

import './booking.css';

export const DEFAULT_BOOKING_FIXTURE = createMenuFixture();
const EDITOR_BOOKING_SESSION = createEmptyBookingSession();

const sameAddOnSelection = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length && left.every(id => right.includes(id));

export type BookingSessionUpdater = Dispatch<SetStateAction<BookingSessionState>>;

export type BookingSectionRendererProps = {
  fixture?: MockMenuFixture;
  mode: 'edit' | 'preview';
  onOwnerSelect?: () => void;
  overlayHost?: HTMLElement | null;
  summaryHost?: HTMLElement | null;
  presentationSettings: BookingSectionPresentationSettings;
  previewViewport?: 'desktop' | 'tablet' | 'mobile';
  session: BookingSessionState;
  tokenPreset?: BookingTokenPresetId;
  onSessionChange: BookingSessionUpdater;
};

export function BookingSectionRenderer({
  fixture = DEFAULT_BOOKING_FIXTURE,
  mode,
  onOwnerSelect,
  overlayHost = null,
  summaryHost = null,
  presentationSettings,
  previewViewport = 'desktop',
  session,
  tokenPreset = 'warm',
  onSessionChange,
}: BookingSectionRendererProps) {
  const previousLayoutRef = useRef(presentationSettings.layout);
  const customerRegionRef = useRef<HTMLDivElement>(null);
  const [optionWarningOpen, setOptionWarningOpen] = useState(false);
  const displaySession = mode === 'edit' ? EDITOR_BOOKING_SESSION : session;
  const serviceById = useMemo(
    () => new Map(fixture.services.map(service => [service.id, service])),
    [fixture.services],
  );
  const selectedSummary = useMemo(
    () => summarizeSelection(
      displaySession.selection,
      fixture.services,
      fixture.addOns,
    ),
    [displaySession.selection, fixture.addOns, fixture.services],
  );
  const tokenStyles = useMemo(
    () => bookingTokenStyles(tokenPreset) as CSSProperties,
    [tokenPreset],
  );
  const detailService = displaySession.detailServiceId
    ? serviceById.get(displaySession.detailServiceId) ?? null
    : null;
  const committedDetailAddOns = detailService && session.selection.serviceId === detailService.id
    ? session.selection.addOnIds
    : [];
  const optionDraftDirty = detailService !== null && !sameAddOnSelection(
    committedDetailAddOns,
    session.draftAddOnIds,
  );

  useEffect(() => {
    if (previousLayoutRef.current === presentationSettings.layout) {
      return;
    }
    previousLayoutRef.current = presentationSettings.layout;
    onSessionChange(current => normalizeSessionForLayoutChange(current));
  }, [onSessionChange, presentationSettings.layout]);

  const updateQuery = useCallback((query: string) => {
    onSessionChange(current => ({ ...current, query }));
  }, [onSessionChange]);

  const updateCategory = useCallback((activeCategory: ServiceCategory | 'all') => {
    onSessionChange(current => ({ ...current, activeCategory, query: '' }));
  }, [onSessionChange]);

  const openDetails = useCallback((service: MockService) => {
    setOptionWarningOpen(false);
    onSessionChange(current => ({
      ...current,
      detailServiceId: service.id,
      draftAddOnIds: current.selection.serviceId === service.id
        ? [...current.selection.addOnIds]
        : [],
      handoffOpen: false,
    }));
  }, [onSessionChange]);

  const closeDetails = useCallback(() => {
    setOptionWarningOpen(false);
    onSessionChange(current => ({
      ...current,
      detailServiceId: null,
      draftAddOnIds: [],
    }));
  }, [onSessionChange]);

  const requestCloseDetails = useCallback(() => {
    if (optionDraftDirty) {
      setOptionWarningOpen(true);
      return;
    }
    closeDetails();
  }, [closeDetails, optionDraftDirty]);

  const toggleDraftAddOn = useCallback((service: MockService, addOnId: string) => {
    onSessionChange(current => {
      const next = toggleSelectionAddOn(
        { serviceId: service.id, addOnIds: current.draftAddOnIds },
        addOnId,
        fixture.services,
        fixture.addOns,
      );
      return { ...current, draftAddOnIds: next.addOnIds };
    });
  }, [fixture.addOns, fixture.services, onSessionChange]);

  const commitService = useCallback((service: MockService, continueToHandoff: boolean) => {
    setOptionWarningOpen(false);
    onSessionChange(current => ({
      ...current,
      selection: normalizeBookingSelection(
        { serviceId: service.id, addOnIds: current.draftAddOnIds },
        fixture.services,
        fixture.addOns,
      ),
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: continueToHandoff,
    }));
  }, [fixture.addOns, fixture.services, onSessionChange]);

  const deselectService = useCallback((service: MockService) => {
    setOptionWarningOpen(false);
    onSessionChange(current => ({
      ...current,
      selection: current.selection.serviceId === service.id
        ? { serviceId: null, addOnIds: [] }
        : current.selection,
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: false,
    }));
  }, [onSessionChange]);

  const continueFromSummary = useCallback(() => {
    if (!selectedSummary) {
      return;
    }
    onSessionChange(current => ({ ...current, handoffOpen: true }));
  }, [onSessionChange, selectedSummary]);

  const closeHandoff = useCallback(() => {
    onSessionChange(current => ({ ...current, handoffOpen: false }));
  }, [onSessionChange]);

  const customerSummary = mode === 'preview' && selectedSummary ? (
    <div
      className="booking-preview-summary"
      data-body-scale={presentationSettings.bodyScale}
      data-heading-scale={presentationSettings.headingScale}
      data-preview-viewport={previewViewport}
      data-spacing={presentationSettings.spacing}
      data-typography={presentationSettings.typographyPreset}
      style={tokenStyles}
    >
      <SelectedSummary
        summary={selectedSummary}
        onChange={() => openDetails(selectedSummary.service)}
        onContinue={continueFromSummary}
      />
    </div>
  ) : null;

  const customerOverlays = mode === 'preview' ? (
    <div
      className="booking-preview-overlays"
      data-body-scale={presentationSettings.bodyScale}
      data-heading-scale={presentationSettings.headingScale}
      data-preview-viewport={previewViewport}
      data-spacing={presentationSettings.spacing}
      data-typography={presentationSettings.typographyPreset}
      style={tokenStyles}
    >
      <ServiceDetail
        draftAddOnIds={session.draftAddOnIds}
        fixture={fixture}
        selection={session.selection}
        service={detailService}
        onClose={requestCloseDetails}
        onContinue={service => commitService(service, true)}
        onDeselect={deselectService}
        onDiscardChanges={closeDetails}
        onDismissDirtyWarning={() => setOptionWarningOpen(false)}
        onKeepBrowsing={service => commitService(service, false)}
        onSaveChanges={service => commitService(service, false)}
        onSelect={service => commitService(service, false)}
        onToggleAddOn={toggleDraftAddOn}
        showDirtyWarning={optionWarningOpen}
      />
      <Handoff
        open={session.handoffOpen}
        summary={selectedSummary}
        onClose={closeHandoff}
      />
    </div>
  ) : null;

  return (
    <div
      className="luster-booking"
      data-booking-mode={mode}
      data-booking-token-preset={tokenPreset}
      data-typography={presentationSettings.typographyPreset}
      data-heading-scale={presentationSettings.headingScale}
      data-body-scale={presentationSettings.bodyScale}
      data-testid={`booking-section-${mode}`}
      style={tokenStyles}
      onClickCapture={mode === 'edit' ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOwnerSelect?.();
      } : undefined}
    >
      <div
        ref={customerRegionRef}
        className="booking-customer-region"
        aria-label={mode === 'edit'
          ? `Booking menu preview — ${fixture.services.length} services, ${BOOKING_LAYOUT_META[presentationSettings.layout].label}. Not interactive while editing.`
          : undefined}
        role={mode === 'edit' ? 'group' : undefined}
      >
        <div
          className="booking-surface"
          data-booking-renderer="shared-booking-section"
          data-layout={presentationSettings.layout}
          data-typography={presentationSettings.typographyPreset}
          data-heading-scale={presentationSettings.headingScale}
          data-body-scale={presentationSettings.bodyScale}
          data-has-selection={mode === 'preview' && selectedSummary ? 'true' : 'false'}
          data-spacing={presentationSettings.spacing}
          aria-label={`${BOOKING_LAYOUT_META[presentationSettings.layout].label} booking menu`}
        >
          <BookingLayout
            layout={presentationSettings.layout}
            fixture={fixture}
            settings={presentationSettings}
            selection={displaySession.selection}
            activeCategory={displaySession.activeCategory}
            query={displaySession.query}
            onCategoryChange={updateCategory}
            onOpenDetails={openDetails}
            onQueryChange={updateQuery}
            readOnly={mode === 'edit'}
          />
        </div>
      </div>

      {customerOverlays
        ? overlayHost
          ? createPortal(customerOverlays, overlayHost)
          : customerOverlays
        : null}
      {customerSummary
        ? summaryHost
          ? createPortal(customerSummary, summaryHost)
          : overlayHost
            ? createPortal(customerSummary, overlayHost)
            : customerSummary
        : null}
    </div>
  );
}
