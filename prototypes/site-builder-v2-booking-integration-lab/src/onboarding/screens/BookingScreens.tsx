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
import { DEFAULT_PREVIEW_TIMESTAMP } from '../model/defaults';
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
  onClose: () => void;
  onServiceMenuChange: (draft: ServiceMenuSelectionDraft) => void;
  open: boolean;
  serviceMenu: ServiceMenuSelectionDraft;
};

function ServiceLibraryDialog({
  onClose,
  onServiceMenuChange,
  open,
  serviceMenu,
}: ServiceLibraryDialogProps) {
  const [activeTab, setActiveTab] = useState<'services' | 'add_ons'>('services');
  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const selectedIds = new Set(
    serviceMenuPort.normalizeSelection(serviceMenu).selectedServiceIds,
  );
  const selectedAddOnIds = new Set(
    serviceMenuPort.normalizeSelection(serviceMenu).selectedAddOnIds ?? [],
  );
  const allItems = activeTab === 'services'
    ? serviceMenuPort.getLibraryServices().filter(({ categoryId }) => categoryId !== 'add_ons')
    : serviceMenuPort.getLibraryAddOns();
  const libraryItems = allItems.filter((item) => (
    (activeCategoryId === 'all' || item.categoryId === activeCategoryId)
      && (!normalizedSearch || item.name.toLocaleLowerCase().includes(normalizedSearch))
  ));
  const serviceCategories = serviceMenuPort.getCategories().filter(({ id }) => id !== 'add_ons');
  const addOnCategories = Array.from(new Map(
    serviceMenuPort.getLibraryAddOns().map(({ categoryId, categoryLabel }) => [
      categoryId,
      { id: categoryId, label: categoryLabel },
    ]),
  ).values());
  const selectedServiceCount = selectedIds.size;
  const selectedAddOnCount = selectedAddOnIds.size;

  return (
    <Dialog
      description="Remove anything you don’t offer or add services from the library. You can change prices and durations later."
      onClose={onClose}
      open={open}
      title="Choose your services"
      variant="section-library"
    >
      <div className="onboarding-service-library">
        <label className="onboarding-service-library__search">
          <span className="visually-hidden">Search services</span>
          <span aria-hidden="true">⌕</span>
          <input
            placeholder="Search services"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <div aria-label="Service library type" className="onboarding-service-library__tabs" role="tablist">
          <button
            aria-selected={activeTab === 'services'}
            role="tab"
            type="button"
            onClick={() => { setActiveTab('services'); setActiveCategoryId('all'); }}
          >
            Services
          </button>
          <button
            aria-selected={activeTab === 'add_ons'}
            role="tab"
            type="button"
            onClick={() => { setActiveTab('add_ons'); setActiveCategoryId('all'); }}
          >
            Add-ons
          </button>
        </div>
        <div aria-label={`${activeTab === 'services' ? 'Service' : 'Add-on'} categories`} className="onboarding-service-library__chips">
          <button
            aria-pressed={activeCategoryId === 'all'}
            type="button"
            onClick={() => setActiveCategoryId('all')}
          >
            {activeTab === 'services' ? 'All' : 'All add-ons'}
          </button>
          {(activeTab === 'services' ? serviceCategories : addOnCategories).map(({ id, label }) => (
            <button
              aria-pressed={activeCategoryId === id}
              key={id}
              type="button"
              onClick={() => setActiveCategoryId(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <ul className="onboarding-service-library__list" aria-label={activeTab === 'services' ? 'Library services' : 'Library add-ons'}>
        {libraryItems.map((item) => {
          const selected = item.itemKind === 'service'
            ? selectedIds.has(item.id)
            : selectedAddOnIds.has(item.id);
          return (
            <li className={selected ? 'is-selected' : undefined} key={item.id}>
              {item.imageSrc ? (
                <img alt={item.imageAlt ?? ''} src={item.imageSrc} />
              ) : (
                <span aria-hidden="true" className="onboarding-service-library__icon">
                  {item.itemKind === 'add_on' ? '✦' : 'LN'}
                </span>
              )}
              <span className="onboarding-service-library__item-copy">
                <strong>{item.name}</strong>
                <small>{item.categoryLabel} · {item.durationLabel}</small>
                <b>{item.priceLabel}</b>
              </span>
              <button
                aria-label={`${selected ? 'Remove' : 'Add'} ${item.name}`}
                aria-pressed={selected}
                type="button"
                onClick={() => onServiceMenuChange(
                  item.itemKind === 'service'
                    ? serviceMenuPort.setServiceSelected(serviceMenu, item.id, !selected)
                    : serviceMenuPort.setAddOnSelected(serviceMenu, item.id, !selected),
                )}
              >
                {selected ? '✓ Added' : '＋ Add'}
              </button>
            </li>
          );
        })}
        </ul>
        {libraryItems.length === 0 ? (
          <p className="onboarding-service-library__empty">No matching {activeTab === 'services' ? 'services' : 'add-ons'}.</p>
        ) : null}
        <footer className="onboarding-service-library__footer">
          <span aria-live="polite">
            <strong>{selectedServiceCount} {selectedServiceCount === 1 ? 'service' : 'services'} selected</strong>
            {selectedAddOnCount > 0 ? <small>{selectedAddOnCount} add-on{selectedAddOnCount === 1 ? '' : 's'} added</small> : null}
          </span>
          <button type="button" onClick={onClose}>Done</button>
        </footer>
      </div>
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
  previewTimestamp = DEFAULT_PREVIEW_TIMESTAMP,
  profile,
}: BookingPreferencesScreenProps) {
  const copy = SCREEN_METADATA.booking_preferences;
  const formId = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceLibraryOpen, setServiceLibraryOpen] = useState(false);
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
        <p className="onboarding-screen-status">Required step</p>
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
                offer. You can change prices, durations, add-ons and photos later.
              </p>
            </div>
            <p aria-live="polite" className="onboarding-service-menu-count">
              <strong>{selectedServices.length} {selectedServices.length === 1 ? 'service' : 'services'} on your menu</strong>
              {selectedServices.length > 6 ? <span> · showing 6</span> : null}
            </p>
            {selectedServices.length > 0 ? (
              <ul className="onboarding-service-menu-sample" aria-label="Selected services">
                {selectedServices.slice(0, 6).map((service: ServiceMenuItem) => (
                  <li key={service.id}>
                    {service.imageSrc ? <img alt={service.imageAlt ?? ''} src={service.imageSrc} /> : <span aria-hidden="true" className="onboarding-service-menu-sample__icon">LN</span>}
                    <span className="onboarding-service-menu-sample__copy">
                      <strong>{service.name}</strong>
                      <small>{service.categoryLabel} · {service.durationLabel}</small>
                    </span>
                    <b>{service.priceLabel}</b>
                  </li>
                ))}
              </ul>
            ) : <p>No services selected yet.</p>}
            {selectedServices.length > 6 ? (
              <button className="onboarding-service-menu-card__more" type="button" onClick={() => setServiceLibraryOpen(true)}>
                See the other {selectedServices.length - 6}
              </button>
            ) : null}
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
                Continue with these {selectedServices.length} {selectedServices.length === 1 ? 'service' : 'services'}
              </button>
            </div>
            {profile.serviceMenu.reviewed
              ? <p role="status">Service menu reviewed. You can change it anytime.</p>
              : null}
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
        <p className="onboarding-screen-status">Required step</p>
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
      <footer
        aria-label="Onboarding actions"
        className="sticky-onboarding-actions sticky-onboarding-actions--back-only"
      >
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
