import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { BookingLayout } from './BookingLayouts';
import { Handoff } from './Handoff';
import { SelectedSummary } from './SelectedSummary';
import { ServiceDetail } from './ServiceDetail';
import {
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

export type BookingSessionUpdater = Dispatch<SetStateAction<BookingSessionState>>;

export type BookingSectionRendererProps = {
  fixture?: MockMenuFixture;
  mode: 'edit' | 'preview';
  presentationSettings: BookingSectionPresentationSettings;
  session: BookingSessionState;
  tokenPreset?: BookingTokenPresetId;
  onSessionChange: BookingSessionUpdater;
};

export function BookingSectionRenderer({
  fixture = DEFAULT_BOOKING_FIXTURE,
  mode,
  presentationSettings,
  session,
  tokenPreset = 'warm',
  onSessionChange,
}: BookingSectionRendererProps) {
  const previousLayoutRef = useRef(presentationSettings.layout);
  const customerRegionRef = useRef<HTMLDivElement>(null);
  const serviceById = useMemo(
    () => new Map(fixture.services.map(service => [service.id, service])),
    [fixture.services],
  );
  const selectedSummary = useMemo(
    () => summarizeSelection(
      session.selection,
      fixture.services,
      fixture.addOns,
    ),
    [fixture.addOns, fixture.services, session.selection],
  );
  const tokenStyles = useMemo(
    () => bookingTokenStyles(tokenPreset) as CSSProperties,
    [tokenPreset],
  );
  const detailService = session.detailServiceId
    ? serviceById.get(session.detailServiceId) ?? null
    : null;

  useEffect(() => {
    if (previousLayoutRef.current === presentationSettings.layout) {
      return;
    }
    previousLayoutRef.current = presentationSettings.layout;
    onSessionChange(current => normalizeSessionForLayoutChange(current));
  }, [onSessionChange, presentationSettings.layout]);

  useEffect(() => {
    const region = customerRegionRef.current;
    if (!region) {
      return;
    }
    if (mode === 'edit') {
      region.setAttribute('inert', '');
    } else {
      region.removeAttribute('inert');
    }
  }, [mode]);

  const updateQuery = useCallback((query: string) => {
    onSessionChange(current => ({ ...current, query }));
  }, [onSessionChange]);

  const updateCategory = useCallback((activeCategory: ServiceCategory | 'all') => {
    onSessionChange(current => ({ ...current, activeCategory }));
  }, [onSessionChange]);

  const openDetails = useCallback((service: MockService) => {
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
    onSessionChange(current => ({
      ...current,
      detailServiceId: null,
      draftAddOnIds: [],
    }));
  }, [onSessionChange]);

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
    >
      <div
        ref={customerRegionRef}
        className="booking-customer-region"
        aria-hidden={mode === 'edit' ? 'true' : undefined}
      >
        <div
          className="booking-surface"
          data-booking-renderer="shared-booking-section"
          data-layout={presentationSettings.layout}
          data-typography={presentationSettings.typographyPreset}
          data-heading-scale={presentationSettings.headingScale}
          data-body-scale={presentationSettings.bodyScale}
          data-spacing={presentationSettings.spacing}
          aria-label={`${BOOKING_LAYOUT_META[presentationSettings.layout].label} booking menu`}
        >
          <BookingLayout
            layout={presentationSettings.layout}
            fixture={fixture}
            settings={presentationSettings}
            selection={session.selection}
            activeCategory={session.activeCategory}
            query={session.query}
            onCategoryChange={updateCategory}
            onOpenDetails={openDetails}
            onQueryChange={updateQuery}
          />
          {selectedSummary ? (
            <SelectedSummary
              summary={selectedSummary}
              onChange={() => openDetails(selectedSummary.service)}
              onContinue={continueFromSummary}
            />
          ) : null}
        </div>
      </div>

      {mode === 'preview' ? (
        <>
          <ServiceDetail
            draftAddOnIds={session.draftAddOnIds}
            fixture={fixture}
            selection={session.selection}
            service={detailService}
            onClose={closeDetails}
            onContinue={service => commitService(service, true)}
            onDeselect={deselectService}
            onSelect={service => commitService(service, false)}
            onToggleAddOn={toggleDraftAddOn}
          />
          <Handoff
            open={session.handoffOpen}
            summary={selectedSummary}
            onClose={closeHandoff}
          />
        </>
      ) : null}
    </div>
  );
}
