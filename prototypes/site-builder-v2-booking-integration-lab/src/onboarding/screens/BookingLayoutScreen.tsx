import { CheckCircle2 } from 'lucide-react';

import { BOOKING_LAYOUT_META } from '../../booking/layout-meta';
import { BookingSettingsPanel } from '../../booking/SettingsPanel';
import { withoutFeaturedServicesRail } from '../../booking/presentation';
import type { BookingSectionPresentationSettings } from '../../booking/types';
import type { SiteBuilderDocument } from '../../model/types';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { useFeedback } from '../feedback/useFeedback';
import type { OnboardingLabState } from '../model/types';
import { OnboardingSitePreview } from '../preview/OnboardingSitePreview';

type BookingLayoutScreenProps = {
  document: SiteBuilderDocument | null;
  onBack: () => void;
  onChange: (sectionId: string, settings: BookingSectionPresentationSettings) => void;
  onContinue: () => void;
  onFullPreview: () => void;
  state: OnboardingLabState;
};

const findBookingSection = (document: SiteBuilderDocument | null) => document?.pages
  .flatMap(page => page.sections)
  .find(section => section.sectionType === 'booking') ?? null;

export function BookingLayoutScreen({
  document,
  onBack,
  onChange,
  onContinue,
  onFullPreview,
  state,
}: BookingLayoutScreenProps) {
  const feedback = useFeedback();
  const booking = findBookingSection(document);
  const selectedLayout = booking?.sectionType === 'booking'
    ? BOOKING_LAYOUT_META[booking.settings.layout]
    : null;

  return (
    <div
      className="onboarding-screen onboarding-screen--booking-layout"
      data-booking-layout-screen="true"
      data-screen="booking_layout"
    >
      <header className="onboarding-screen-heading">
        <span className="onboarding-screen-status">Step 11 — Booking layout</span>
        <h1>Choose how clients browse your services</h1>
        <p>
          Pick the menu that feels easiest for your clients. Your services, prices,
          durations and add-ons stay exactly the same.
        </p>
      </header>

      {booking?.sectionType === 'booking' ? (
        <section
          aria-labelledby="booking-layout-options-heading"
          className="onboarding-booking-layout-options"
        >
          <div className="onboarding-booking-layout-options__heading">
            <span>
              <small>BOOKING MENU</small>
              <h2 id="booking-layout-options-heading">Choose one layout</h2>
            </span>
            <strong><CheckCircle2 aria-hidden="true" size={17} /> {selectedLayout?.label}</strong>
          </div>
          <BookingSettingsPanel
            allowFeaturedServices={false}
            layoutOnly
            onChange={(settings) => {
              feedback.send({ kind: 'selection' });
              onChange(booking.id, withoutFeaturedServicesRail(settings));
            }}
            settings={booking.settings}
            showIntro={false}
          />
        </section>
      ) : (
        <p className="onboarding-booking-layout-error" role="alert">
          Your booking menu is still being prepared. Go back and confirm at least one service.
        </p>
      )}

      {booking?.sectionType === 'booking' ? (
        <section
          aria-labelledby="booking-layout-live-preview-heading"
          className="onboarding-designer-preview onboarding-booking-layout-preview"
        >
          <div className="onboarding-booking-layout-preview__heading">
            <span>
              <small>LIVE CUSTOMER PREVIEW</small>
              <h2 id="booking-layout-live-preview-heading">Your real services in this layout</h2>
            </span>
            <strong>{selectedLayout?.shortLabel}</strong>
          </div>
          <OnboardingSitePreview
            document={document}
            includeOptionalSections
            initialTarget="booking"
            interactionMode="interactive"
            label={`Booking layout preview: ${selectedLayout?.label ?? 'Booking menu'}`}
            quickBookPhase="final"
            state={state}
          />
          <button className="onboarding-full-preview-button" type="button" onClick={onFullPreview}>
            View full preview
          </button>
        </section>
      ) : null}

      <p className="onboarding-booking-layout-reassurance">
        You can change this layout anytime without rebuilding your service menu.
      </p>
      <StickyOnboardingActions
        primaryDisabled={!booking}
        primaryFirst
        primaryLabel="Use this booking layout"
        onBack={onBack}
        onPrimary={onContinue}
      />
    </div>
  );
}
