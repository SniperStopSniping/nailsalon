import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { CANONICAL_SERVICES } from '../../booking/data';
import { summarizeSelection } from '../../booking/helpers';
import { StarterChoiceGrid } from '../../ui/StarterChooser';
import { SCREEN_METADATA } from '../copy';
import {
  getDepositPolicyMode,
  type DepositPolicyMode,
} from '../model/policies';
import { getPublicLocationPreview } from '../model/location';
import type {
  AdvanceNotice,
  BookingPreferencesDraft,
  BusinessProfileDraft,
  LocationDraft,
  NewClientStatus,
  StarterId,
  VisitMode,
} from '../model/types';
import {
  ChoiceGroup,
  focusFirstInvalidControl,
  TextField,
  ValidationSummary,
  type ChoiceOption,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';

const VISIT_MODES: readonly ChoiceOption<VisitMode>[] = [
  { label: 'Appointment only', value: 'appointment_only' },
  { label: 'Walk-ins only', value: 'walk_ins_only' },
  { label: 'Appointments and walk-ins', value: 'appointments_and_walk_ins' },
];

const NEW_CLIENT_STATUSES: readonly ChoiceOption<NewClientStatus>[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: 'Ask me first', value: 'ask_first' },
  { label: 'Waitlist only', value: 'waitlist_only' },
];

const ADVANCE_NOTICE_OPTIONS: readonly ChoiceOption<AdvanceNotice>[] = [
  { label: 'Same day', value: 'same_day' },
  { label: '24 hours', value: '24_hours' },
  { label: '48 hours', value: '48_hours' },
  { label: 'Custom', value: 'custom' },
];

const DEPOSIT_MODE_OPTIONS: readonly ChoiceOption<DepositPolicyMode>[] = [
  { label: 'Yes', value: 'generally_required' },
  { label: 'No', value: 'none' },
  {
    description: 'Booking keeps the deposit details for each service.',
    label: 'Depends on the service',
    value: 'depends_on_service',
  },
];

const CANONICAL_FEATURED_SELECTION = summarizeSelection({
  addOnIds: ['addon-french'],
  serviceId: 'svc-manicure-russian',
});

type BookingPreferencesScreenProps = {
  onBack: () => void;
  onBookingPreferencesChange: (patch: Partial<BookingPreferencesDraft>) => void;
  onContinue: () => void;
  onDepositModeChange: (mode: DepositPolicyMode) => void;
  onValidationFailure?: (fieldIds: string[]) => void;
  profile: BusinessProfileDraft;
};

export function BookingPreferencesScreen({
  onBack,
  onBookingPreferencesChange,
  onContinue,
  onDepositModeChange,
  onValidationFailure,
  profile,
}: BookingPreferencesScreenProps) {
  const copy = SCREEN_METADATA.booking_preferences;
  const formId = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preferences = profile.bookingPreferences;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!preferences.visitMode) nextErrors.visitMode = 'Choose how clients can visit you.';
    if (!preferences.newClientStatus) nextErrors.newClientStatus = 'Choose your new-client status.';
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      onValidationFailure?.(failedFields);
      focusFirstInvalidControl(event.currentTarget);
      return;
    }
    onContinue();
  };

  const visitModeLabel = VISIT_MODES.find(({ value }) => value === preferences.visitMode)?.label;
  const acceptingLabel = preferences.newClientStatus === 'yes'
    ? 'New clients welcome'
    : preferences.newClientStatus === 'waitlist_only'
      ? 'Waitlist only'
      : preferences.newClientStatus === 'ask_first'
        ? 'Ask before booking'
        : preferences.newClientStatus === 'no'
          ? 'Not accepting new clients'
          : null;

  return (
    <section aria-labelledby="booking-preferences-heading" className="onboarding-screen onboarding-booking-preferences-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Essential</p>
        <h1 id="booking-preferences-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <form id={formId} noValidate onSubmit={submit}>
          <ValidationSummary errors={errors} />
          <ChoiceGroup
            error={errors.visitMode}
            legend="How do clients visit you?"
            name="visit-mode"
            options={VISIT_MODES}
            value={preferences.visitMode}
            onChange={(visitMode) => {
              setErrors((current) => ({ ...current, visitMode: '' }));
              onBookingPreferencesChange({ visitMode });
            }}
          />
          <ChoiceGroup
            error={errors.newClientStatus}
            legend="Accepting new clients"
            name="new-client-status"
            options={NEW_CLIENT_STATUSES}
            value={preferences.newClientStatus}
            onChange={(newClientStatus) => {
              setErrors((current) => ({ ...current, newClientStatus: '' }));
              onBookingPreferencesChange({ newClientStatus });
            }}
          />
          <ChoiceGroup
            legend="Preferred advance notice"
            name="advance-notice"
            options={ADVANCE_NOTICE_OPTIONS}
            value={preferences.advanceNotice}
            onChange={(advanceNotice) => onBookingPreferencesChange({ advanceNotice })}
          />
          {preferences.advanceNotice === 'custom' ? (
            <TextField
              label="Custom advance notice"
              value={preferences.customAdvanceNotice}
              onChange={(event) => onBookingPreferencesChange({ customAdvanceNotice: event.target.value })}
            />
          ) : null}
          <ChoiceGroup
            legend="Do you generally require a deposit?"
            name="deposit-policy-mode"
            options={DEPOSIT_MODE_OPTIONS}
            value={getDepositPolicyMode(profile.policies)}
            onChange={onDepositModeChange}
          />
        </form>
        <div className="onboarding-booking-preview-column">
          <aside aria-label="Booking connection status" className="onboarding-booking-status-card">
            <h2>Your booking details are ready</h2>
            <dl>
              <div><dt>Services</dt><dd>{CANONICAL_SERVICES.length} ready</dd></div>
              <div><dt>Prices</dt><dd>Ready</dd></div>
              <div><dt>Availability source</dt><dd>Connected</dd></div>
              <div><dt>Book button</dt><dd>Ready</dd></div>
            </dl>
            <p>You won’t need to re-enter services, prices, or durations.</p>
          </aside>
          <aside aria-label="Customer booking information preview" className="onboarding-booking-info-preview">
            {visitModeLabel ? <strong>{visitModeLabel}</strong> : null}
            {acceptingLabel ? <span>{acceptingLabel}</span> : null}
            {preferences.advanceNotice ? (
              <span>
                {preferences.advanceNotice === 'custom'
                  ? preferences.customAdvanceNotice || 'Custom booking notice'
                  : `${preferences.advanceNotice.replace('_', ' ')} notice`}
              </span>
            ) : null}
            {CANONICAL_FEATURED_SELECTION ? (
              <div className="onboarding-booking-info-preview__service">
                <small>Featured service</small>
                <strong>
                  {CANONICAL_FEATURED_SELECTION.service.name}
                  {' + '}
                  {CANONICAL_FEATURED_SELECTION.addOns.map(({ name }) => name).join(', ')}
                </strong>
                <span>
                  {CANONICAL_FEATURED_SELECTION.durationLabel}
                  {' · '}
                  {CANONICAL_FEATURED_SELECTION.price.label}
                </span>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
      <StickyOnboardingActions
        formId={formId}
        onBack={onBack}
        primaryLabel={copy.primaryAction}
      />
    </section>
  );
}

type StartingPointScreenProps = {
  businessName: string;
  location?: LocationDraft;
  onBack: () => void;
  onChooseStarter: (starter: StarterId) => void;
  ownerName?: string;
  portraitUrl?: string;
  reducedMotion?: boolean;
  selectedStarter: StarterId | null;
};

export function StartingPointScreen({
  businessName,
  location,
  onBack,
  onChooseStarter,
  ownerName,
  portraitUrl,
  reducedMotion = false,
  selectedStarter,
}: StartingPointScreenProps) {
  const copy = SCREEN_METADATA.starter;
  const publicLocation = location ? getPublicLocationPreview(location).primary : '';

  return (
    <section aria-labelledby="starting-point-heading" className="onboarding-screen onboarding-starter-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Essential</p>
        <h1 id="starting-point-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-starter-grid">
        <StarterChoiceGrid
          businessName={businessName.trim() || 'Your business'}
          onChoose={onChooseStarter}
          ownerName={ownerName}
          portraitUrl={portraitUrl}
          publicLocation={publicLocation}
          reducedMotion={reducedMotion}
          selectedStarter={selectedStarter}
        />
      </div>
      <footer aria-label="Onboarding actions" className="sticky-onboarding-actions">
        <button type="button" onClick={onBack}>Back</button>
      </footer>
    </section>
  );
}

export { StartingPointScreen as StarterScreen };

type StartingPreviewScreenProps = {
  onBack: () => void;
  onContinue: () => void;
  onOpenPreview: () => void;
  preview: ReactNode;
  profile: BusinessProfileDraft;
  starter: StarterId;
};

const STARTER_LABELS: Record<StarterId, string> = {
  multi_page: 'Multi-page website',
  one_page: 'One-page website',
  quick_book: 'Quick Book',
};

export function StartingPreviewScreen({
  onBack,
  onContinue,
  onOpenPreview,
  preview,
  profile,
  starter,
}: StartingPreviewScreenProps) {
  const copy = SCREEN_METADATA.starting_preview;

  return (
    <section aria-labelledby="starting-preview-heading" className="onboarding-screen onboarding-starting-preview-screen">
      <header className="onboarding-screen__heading">
        <h1 id="starting-preview-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-starting-preview__summary">
        <span>{STARTER_LABELS[starter]}</span>
        <strong>{profile.businessName || 'Your business'}</strong>
        {profile.location.cityOrArea ? <span>{profile.location.cityOrArea}</span> : null}
      </div>
      <section
        aria-label={`${profile.businessName || 'Your business'} starting website preview`}
        className="onboarding-starting-preview__canvas"
      >
        {preview}
      </section>
      <StickyOnboardingActions
        onBack={onBack}
        onPrimary={onContinue}
        onSkip={onOpenPreview}
        primaryLabel={copy.primaryAction}
        skipLabel={copy.secondaryAction}
      />
    </section>
  );
}
