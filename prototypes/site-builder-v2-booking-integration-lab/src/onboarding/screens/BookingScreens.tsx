import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { Dialog } from '../../ui/Dialog';
import { StarterChoiceGrid } from '../../ui/StarterChooser';
import {
  ChoiceGroup,
  focusFirstInvalidControl,
  TextField,
  ValidationSummary,
  type ChoiceOption,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { SCREEN_METADATA } from '../copy';
import { bookingPreferencesPort } from '../integrations/adapters/booking-preferences';
import { serviceMenuPort } from '../integrations/adapters/service-menu';
import type {
  DepositAmountChoice,
  DepositDraft,
  DepositMode,
  MinimumNoticeChoice,
  MinimumNoticeUnit,
} from '../integrations/contracts/booking-preferences';
import type {
  ServiceMenuItem,
  ServiceMenuSelectionDraft,
} from '../integrations/contracts/service-menu';
import { getPublicLocationPreview } from '../model/location';
import { getDepositPolicyMode } from '../model/policies';
import type {
  BookingPreferencesDraft,
  BusinessProfileDraft,
  LocationDraft,
  NewClientStatus,
  StarterId,
  VisitMode,
} from '../model/types';

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

const DEPOSIT_MODE_OPTIONS: readonly ChoiceOption<DepositMode>[] = [
  { label: 'No deposit', value: 'none' },
  { label: 'Same deposit for every service', value: 'fixed' },
];

const MINIMUM_NOTICE_LABELS: Record<MinimumNoticeChoice, string> = {
  'preset:0': 'No minimum notice',
  'preset:120': '2 hours',
  'preset:240': '4 hours',
  'preset:480': '8 hours',
  'preset:720': '12 hours',
  'preset:1440': '1 day',
  'preset:2880': '2 days',
  'preset:4320': '3 days',
  custom: 'Custom amount',
};

const minimumNoticeOptions = Object.entries(MINIMUM_NOTICE_LABELS) as Array<[
  MinimumNoticeChoice,
  string,
]>;

const DEPOSIT_AMOUNT_LABELS = Object.fromEntries([
  ...bookingPreferencesPort.depositAmountPresets.map((amountCents) => [
    `preset:${amountCents}`,
    `$${amountCents / 100}`,
  ]),
  ['custom', 'Custom amount'],
]) as Record<DepositAmountChoice, string>;

const formatMinimumNotice = (minimumNoticeMinutes: number): string => {
  const choice = bookingPreferencesPort.getMinimumNoticeChoice(minimumNoticeMinutes);
  if (choice !== 'custom') return MINIMUM_NOTICE_LABELS[choice];
  const { amount, unit } = bookingPreferencesPort.getCustomMinimumNoticeInput(
    minimumNoticeMinutes,
  );
  if (!amount) return 'No minimum notice';
  const numericAmount = Number(amount);
  const singular = numericAmount === 1;
  return `${amount} ${singular ? unit.slice(0, -1) : unit}`;
};

type ServiceLibraryDialogProps = {
  activeCategoryId: string;
  onActiveCategoryChange: (categoryId: string) => void;
  onClose: () => void;
  onServiceMenuChange: (draft: ServiceMenuSelectionDraft) => void;
  open: boolean;
  serviceMenu: ServiceMenuSelectionDraft;
};

function ServiceLibraryDialog({
  activeCategoryId,
  onActiveCategoryChange,
  onClose,
  onServiceMenuChange,
  open,
  serviceMenu,
}: ServiceLibraryDialogProps) {
  const selectedIds = new Set(
    serviceMenuPort.normalizeSelection(serviceMenu).selectedServiceIds,
  );
  const libraryServices = serviceMenuPort.getLibraryServices().filter(
    ({ categoryId }) => activeCategoryId === 'all' || categoryId === activeCategoryId,
  );

  return (
    <Dialog
      description="Add services from the existing nail-service Library. Prices and durations are shown before you add anything."
      onClose={onClose}
      open={open}
      title="Service Library"
      variant="section-library"
    >
      <label className="onboarding-select-field">
        <span>Category</span>
        <select
          value={activeCategoryId}
          onChange={(event) => onActiveCategoryChange(event.target.value)}
        >
          <option value="all">All services</option>
          {serviceMenuPort.getCategories().map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </label>
      <ul className="onboarding-review-list" aria-label="Library services">
        {libraryServices.map((service) => {
          const selected = selectedIds.has(service.id);
          return (
            <li key={service.id}>
              <span>
                <strong>{service.name}</strong>
                <small>
                  {service.categoryLabel}
                  {' · '}
                  {service.durationLabel}
                  {' · '}
                  {service.priceLabel}
                </small>
              </span>
              <button
                aria-pressed={selected}
                type="button"
                onClick={() => onServiceMenuChange(
                  serviceMenuPort.setServiceSelected(serviceMenu, service.id, !selected),
                )}
              >
                {selected ? 'Remove' : 'Add service'}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onClose}>Done</button>
    </Dialog>
  );
}

type BookingPreferencesScreenProps = {
  onBack: () => void;
  onBookingPreferencesChange: (patch: Partial<BookingPreferencesDraft>) => void;
  onContinue: () => void;
  onDepositChange: (deposit: DepositDraft) => void;
  onServiceMenuChange: (draft: ServiceMenuSelectionDraft) => void;
  onValidationFailure?: (fieldIds: string[]) => void;
  previewTimestamp?: string;
  profile: BusinessProfileDraft;
};

export function BookingPreferencesScreen({
  onBack,
  onBookingPreferencesChange,
  onContinue,
  onDepositChange,
  onServiceMenuChange,
  onValidationFailure,
  previewTimestamp = '2026-08-27T18:30:00.000Z',
  profile,
}: BookingPreferencesScreenProps) {
  const copy = SCREEN_METADATA.booking_preferences;
  const formId = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceLibraryOpen, setServiceLibraryOpen] = useState(false);
  const [activeServiceCategoryId, setActiveServiceCategoryId] = useState('all');
  const [editingCustomNotice, setEditingCustomNotice] = useState(false);
  const initialCustomNotice = bookingPreferencesPort.getCustomMinimumNoticeInput(
    profile.bookingPreferences.minimumNoticeMinutes,
  );
  const [customNoticeAmount, setCustomNoticeAmount] = useState(initialCustomNotice.amount);
  const [customNoticeUnit, setCustomNoticeUnit] = useState<MinimumNoticeUnit>(
    initialCustomNotice.unit,
  );
  const [editingCustomDeposit, setEditingCustomDeposit] = useState(false);
  const [customDepositAmount, setCustomDepositAmount] = useState(() =>
    profile.policies.deposits.amountCents === null
      ? ''
      : String(profile.policies.deposits.amountCents / 100));
  const preferences = profile.bookingPreferences;
  const selectedServices = serviceMenuPort.getSelectedServices(profile.serviceMenu);
  const selectedService = selectedServices[0];
  const storedNoticeChoice = bookingPreferencesPort.getMinimumNoticeChoice(
    preferences.minimumNoticeMinutes,
  );
  const noticeChoice = editingCustomNotice ? 'custom' : storedNoticeChoice;
  const storedDepositAmountChoice = bookingPreferencesPort.getDepositAmountChoice(
    profile.policies.deposits.amountCents,
  );
  const depositAmountChoice = editingCustomDeposit
    ? 'custom'
    : storedDepositAmountChoice;
  const availabilityPreview = bookingPreferencesPort.getAvailabilityPreview(
    preferences.minimumNoticeMinutes,
    previewTimestamp,
  );
  const firstBookableTime = availabilityPreview.bookableTimes[0] ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!preferences.visitMode) nextErrors.visitMode = 'Choose how clients can visit you.';
    if (!preferences.newClientStatus) nextErrors.newClientStatus = 'Choose your new-client status.';
    if (noticeChoice === 'custom'
      && bookingPreferencesPort.normalizeCustomMinimumNotice(
        customNoticeAmount,
        customNoticeUnit,
      ) === null) {
      nextErrors.customNoticeAmount = 'Enter a custom notice amount greater than zero.';
    }
    if (profile.policies.deposits.mode === 'fixed'
      && depositAmountChoice === 'custom'
      && bookingPreferencesPort.normalizeCustomDepositAmount(customDepositAmount) === null) {
      nextErrors.customDepositAmount = 'Enter a custom deposit amount greater than zero.';
    }
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
            legend="How do you accept clients?"
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
            legend="Are you accepting new clients?"
            name="new-client-status"
            options={NEW_CLIENT_STATUSES}
            value={preferences.newClientStatus}
            onChange={(newClientStatus) => {
              setErrors((current) => ({ ...current, newClientStatus: '' }));
              onBookingPreferencesChange({ newClientStatus });
            }}
          />
          <section aria-labelledby="service-menu-heading" className="onboarding-service-menu-card">
            <div>
              <h2 id="service-menu-heading">Your service menu is ready</h2>
              <p>
                We added popular nail services to get you started. Remove anything you don’t
                offer. You can change prices, durations, deposits, add-ons and photos anytime.
              </p>
            </div>
            <p aria-live="polite"><strong>{selectedServices.length}</strong> selected</p>
            {selectedServices.length > 0 ? (
              <ul className="onboarding-service-menu-sample" aria-label="Sample of selected services">
                {selectedServices.slice(0, 4).map((service: ServiceMenuItem) => (
                  <li key={service.id}>
                    <span>
                      <strong>{service.name}</strong>
                      <small>
                        {service.categoryLabel}
                        {' · '}
                        {service.durationLabel}
                        {' · '}
                        {service.priceLabel}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p>No services selected yet.</p>}
            <div className="onboarding-inline-actions">
              <button type="button" onClick={() => setServiceLibraryOpen(true)}>
                Review services
              </button>
              <button
                type="button"
                onClick={() => onServiceMenuChange({
                  ...profile.serviceMenu,
                  reviewed: true,
                })}
              >
                Looks good
              </button>
            </div>
            {profile.serviceMenu.reviewed
              ? <p role="status">Service menu reviewed. You can change it anytime.</p>
              : null}
            <small>You can change prices, durations, add-ons and service photos later.</small>
          </section>
          <label className="onboarding-select-field">
            <span>How much notice do you need before an appointment?</span>
            <select
              value={noticeChoice}
              onChange={(event) => {
                const choice = event.target.value as MinimumNoticeChoice;
                if (choice === 'custom') {
                  setEditingCustomNotice(true);
                  setErrors((current) => ({ ...current, customNoticeAmount: '' }));
                  return;
                }
                setEditingCustomNotice(false);
                setErrors((current) => ({ ...current, customNoticeAmount: '' }));
                onBookingPreferencesChange({
                  minimumNoticeMinutes: Number(choice.replace('preset:', '')),
                });
              }}
            >
              {minimumNoticeOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {noticeChoice === 'custom' ? (
            <div className="onboarding-inline-fields">
              <TextField
                error={errors.customNoticeAmount}
                inputMode="decimal"
                label="Custom amount"
                min="0"
                type="number"
                value={customNoticeAmount}
                onChange={(event) => {
                  const amount = event.target.value;
                  setCustomNoticeAmount(amount);
                  const minimumNoticeMinutes =
                    bookingPreferencesPort.normalizeCustomMinimumNotice(
                      amount,
                      customNoticeUnit,
                    );
                  setErrors((current) => ({
                    ...current,
                    customNoticeAmount: minimumNoticeMinutes === null
                      ? current.customNoticeAmount ?? ''
                      : '',
                  }));
                  if (minimumNoticeMinutes !== null) {
                    onBookingPreferencesChange({ minimumNoticeMinutes });
                  }
                }}
              />
              <label className="onboarding-select-field">
                <span>Unit</span>
                <select
                  value={customNoticeUnit}
                  onChange={(event) => {
                    const unit = event.target.value as MinimumNoticeUnit;
                    setCustomNoticeUnit(unit);
                    const minimumNoticeMinutes =
                      bookingPreferencesPort.normalizeCustomMinimumNotice(
                        customNoticeAmount,
                        unit,
                      );
                    if (minimumNoticeMinutes !== null) {
                      setErrors((current) => ({ ...current, customNoticeAmount: '' }));
                      onBookingPreferencesChange({ minimumNoticeMinutes });
                    }
                  }}
                >
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </label>
            </div>
          ) : null}
          <ChoiceGroup
            legend="How do you handle booking deposits?"
            name="deposit-policy-mode"
            options={DEPOSIT_MODE_OPTIONS}
            value={getDepositPolicyMode(profile.policies)}
            onChange={(mode) => {
              setErrors((current) => ({ ...current, customDepositAmount: '' }));
              onDepositChange(
                bookingPreferencesPort.updateDepositDraft(
                  profile.policies.deposits,
                  {
                    amountCents: mode === 'fixed'
                      ? profile.policies.deposits.amountCents ?? 2_000
                      : null,
                    mode,
                  },
                ),
              );
            }}
          />
          {profile.policies.deposits.mode === 'fixed' ? (
            <fieldset className="onboarding-choice-group">
              <legend>Deposit amount</legend>
              <div className="onboarding-choice-group__options">
                {(Object.entries(DEPOSIT_AMOUNT_LABELS) as Array<[
                  DepositAmountChoice,
                  string,
                ]>).map(([value, label]) => (
                  <label className="onboarding-choice" key={value}>
                    <input
                      checked={depositAmountChoice === value}
                      name="deposit-amount"
                      type="radio"
                      value={value}
                      onChange={() => {
                        if (value === 'custom') {
                          setEditingCustomDeposit(true);
                          setErrors((current) => ({ ...current, customDepositAmount: '' }));
                          return;
                        }
                        setEditingCustomDeposit(false);
                        setErrors((current) => ({ ...current, customDepositAmount: '' }));
                        onDepositChange(bookingPreferencesPort.updateDepositDraft(
                          profile.policies.deposits,
                          { amountCents: Number(value.replace('preset:', '')) },
                        ));
                      }}
                    />
                    <span><strong>{label}</strong></span>
                  </label>
                ))}
              </div>
              {depositAmountChoice === 'custom' ? (
                <TextField
                  error={errors.customDepositAmount}
                  inputMode="decimal"
                  label="Custom deposit amount"
                  min="0"
                  step="0.01"
                  type="number"
                  value={customDepositAmount}
                  onChange={(event) => {
                    const amount = event.target.value;
                    setCustomDepositAmount(amount);
                    const amountCents =
                      bookingPreferencesPort.normalizeCustomDepositAmount(amount);
                    setErrors((current) => ({
                      ...current,
                      customDepositAmount: amountCents === null
                        ? current.customDepositAmount ?? ''
                        : '',
                    }));
                    if (amountCents !== null) {
                      onDepositChange(bookingPreferencesPort.updateDepositDraft(
                        profile.policies.deposits,
                        { amountCents },
                      ));
                    }
                  }}
                />
              ) : null}
            </fieldset>
          ) : null}
        </form>
        <div className="onboarding-booking-preview-column">
          <aside aria-label="Booking connection status" className="onboarding-booking-status-card">
            <h2>Your Booking settings are connected</h2>
            <dl>
              <div><dt>Services</dt><dd>{selectedServices.length} selected</dd></div>
              <div><dt>Prices and durations</dt><dd>{selectedServices.length > 0 ? 'Ready' : 'Choose services'}</dd></div>
              <div><dt>Minimum notice</dt><dd>{formatMinimumNotice(preferences.minimumNoticeMinutes)}</dd></div>
              <div><dt>Deposits</dt><dd>{profile.policies.deposits.mode === 'fixed'
                ? profile.policies.deposits.amountCents === null
                  ? 'Fixed amount to finish'
                  : `$${profile.policies.deposits.amountCents / 100} for every service`
                : 'No deposit'}</dd></div>
              <div>
                <dt>Earliest bookable time</dt>
                <dd>{firstBookableTime?.label ?? 'No times in this preview window'}</dd>
              </div>
            </dl>
            <p>Your customer preview updates as you make these choices.</p>
          </aside>
          <aside aria-label="Customer booking information preview" className="onboarding-booking-info-preview">
            {visitModeLabel ? <strong>{visitModeLabel}</strong> : null}
            {acceptingLabel ? <span>{acceptingLabel}</span> : null}
            <span>{formatMinimumNotice(preferences.minimumNoticeMinutes)} notice</span>
            <div
              aria-label="Bookable appointment times after minimum notice"
              className="onboarding-booking-time-preview"
              data-availability-source={availabilityPreview.source}
            >
              <small>Available times after your notice</small>
              {availabilityPreview.bookableTimes.length > 0 ? (
                <div>
                  {availabilityPreview.bookableTimes.slice(0, 3).map((time) => (
                    <span data-bookable-time={time.startsAt} key={time.id}>{time.label}</span>
                  ))}
                </div>
              ) : <span>No times in this preview window</span>}
            </div>
            {selectedService ? (
              <div className="onboarding-booking-info-preview__service">
                <small>First service</small>
                <strong>{selectedService.name}</strong>
                <span>
                  {selectedService.durationLabel}
                  {' · '}
                  {selectedService.priceLabel}
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
      <ServiceLibraryDialog
        activeCategoryId={activeServiceCategoryId}
        onActiveCategoryChange={setActiveServiceCategoryId}
        onClose={() => setServiceLibraryOpen(false)}
        onServiceMenuChange={onServiceMenuChange}
        open={serviceLibraryOpen}
        serviceMenu={profile.serviceMenu}
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
