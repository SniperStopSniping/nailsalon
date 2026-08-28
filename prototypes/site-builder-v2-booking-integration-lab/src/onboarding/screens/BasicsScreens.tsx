import { useId, useState, type FormEvent } from 'react';

import { SCREEN_METADATA } from '../copy';
import {
  contactMethodHasValue,
  getAvailableContactMethods,
  getCoherentPreferredContact,
  getPublicContactPreview,
} from '../model/contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
  getWeeklyHoursSetupSummary,
  hasConfiguredWeeklyHours,
  isValidOpenHoursDay,
} from '../model/hours';
import { getPublicLocationPreview } from '../model/location';
import type {
  AddressVisibility,
  BusinessProfileDraft,
  BusinessStructure,
  DayHoursDraft,
  LocationType,
  PreferredContactMethod,
  Weekday,
} from '../model/types';
import {
  ChoiceGroup,
  CollapsibleFormCard,
  focusFirstInvalidControl,
  ImageUploadField,
  NativeSwitch,
  TextAreaField,
  TextField,
  ValidationSummary,
  type ChoiceOption,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';

type ProfilePatch = Partial<BusinessProfileDraft>;

type SharedBasicsScreenProps = {
  onBack: () => void;
  onProfileChange: (patch: ProfilePatch) => void;
  profile: BusinessProfileDraft;
};

const BUSINESS_STRUCTURES: readonly ChoiceOption<BusinessStructure>[] = [
  { label: 'Solo nail tech', value: 'solo' },
  { label: 'Team or multi-tech salon', value: 'multi_tech' },
];

const CONTACT_METHODS: readonly ChoiceOption<PreferredContactMethod>[] = [
  { label: 'Text', value: 'text' },
  { label: 'Call', value: 'call' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Email', value: 'email' },
];

const LOCATION_TYPES: readonly ChoiceOption<LocationType>[] = [
  { label: 'Home studio', value: 'home_studio' },
  { label: 'Salon suite', value: 'salon_suite' },
  { label: 'Traditional salon', value: 'traditional_salon' },
  { label: 'Mobile service', value: 'mobile_service' },
];

const ADDRESS_VISIBILITY: readonly ChoiceOption<AddressVisibility>[] = [
  { label: 'Show publicly', value: 'public' },
  { label: 'Show after booking', value: 'after_booking' },
  { label: 'Do not show', value: 'hidden' },
];

const WEEKDAYS: readonly { id: Weekday; label: string }[] = [
  { id: 'monday', label: 'Monday' },
  { id: 'tuesday', label: 'Tuesday' },
  { id: 'wednesday', label: 'Wednesday' },
  { id: 'thursday', label: 'Thursday' },
  { id: 'friday', label: 'Friday' },
  { id: 'saturday', label: 'Saturday' },
  { id: 'sunday', label: 'Sunday' },
];

function initialsFor(profile: BusinessProfileDraft): string {
  const source = profile.ownerName.trim() || profile.businessName.trim() || 'Luster';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function businessStructureLabel(value: BusinessStructure | null): string {
  return BUSINESS_STRUCTURES.find((option) => option.value === value)?.label
    ?? 'Business structure';
}

type BusinessScreenProps = SharedBasicsScreenProps & {
  onContinue: () => void;
  onValidationFailure?: (fieldIds: string[]) => void;
};

export function BusinessScreen({
  onBack,
  onContinue,
  onProfileChange,
  onValidationFailure,
  profile,
}: BusinessScreenProps) {
  const copy = SCREEN_METADATA.business;
  const formId = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!profile.businessName.trim()) nextErrors.businessName = 'Add your business or salon name.';
    if (!profile.ownerName.trim()) nextErrors.ownerName = 'Add your name.';
    if (!profile.businessStructure) {
      nextErrors.businessStructure = 'Choose who you’re setting Luster up for.';
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

  return (
    <section aria-labelledby="business-screen-heading" className="onboarding-screen onboarding-business-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Essential</p>
        <h1 id="business-screen-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <form id={formId} noValidate onSubmit={submit}>
          <ValidationSummary errors={errors} />
          <TextField
            autoComplete="organization"
            error={errors.businessName}
            label="Business or salon name"
            required
            value={profile.businessName}
            onChange={(event) => {
              setErrors((current) => ({ ...current, businessName: '' }));
              onProfileChange({ businessName: event.target.value });
            }}
          />
          <TextField
            autoComplete="name"
            error={errors.ownerName}
            label="Your name"
            required
            value={profile.ownerName}
            onChange={(event) => {
              setErrors((current) => ({ ...current, ownerName: '' }));
              onProfileChange({ ownerName: event.target.value });
            }}
          />
          <ChoiceGroup
            error={errors.businessStructure}
            legend="Who are you setting Luster up for?"
            name="business-structure"
            options={BUSINESS_STRUCTURES}
            value={profile.businessStructure}
            onChange={(businessStructure) => {
              setErrors((current) => ({ ...current, businessStructure: '' }));
              onProfileChange({ businessStructure });
            }}
          />
        </form>
        <aside aria-label="Business information preview" className="business-preview-card">
          <span aria-hidden="true" className="business-preview-card__mark">
            {initialsFor(profile)}
          </span>
          <p>{profile.businessName.trim() || 'Your business name'}</p>
          <strong>{profile.ownerName.trim() || 'Your name'}</strong>
          <span>{businessStructureLabel(profile.businessStructure)}</span>
        </aside>
      </div>
      <StickyOnboardingActions
        formId={formId}
        onBack={onBack}
        primaryLabel={copy.primaryAction}
      />
    </section>
  );
}

type PhotoSocialScreenProps = SharedBasicsScreenProps & {
  onContinue: () => void;
  onLogoSelected: (file: File) => void;
  onProfilePhotoSelected: (file: File) => void;
  onSkipPhoto: () => void;
};

export function PhotoSocialScreen({
  onBack,
  onContinue,
  onLogoSelected,
  onProfileChange,
  onProfilePhotoSelected,
  onSkipPhoto,
  profile,
}: PhotoSocialScreenProps) {
  const copy = SCREEN_METADATA.photo_social;
  const profileImage = profile.profilePhoto?.previewUrl;

  return (
    <section aria-labelledby="photo-social-heading" className="onboarding-screen onboarding-photo-social-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Optional</p>
        <h1 id="photo-social-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <div className="onboarding-form-stack">
          <ImageUploadField
            currentLabel={profile.profilePhoto?.fileName}
            label="Profile photo (optional)"
            onRemove={() => onProfileChange({ profilePhoto: undefined })}
            onSelect={onProfilePhotoSelected}
          />
          <ImageUploadField
            currentLabel={profile.logo?.fileName}
            label="Logo (optional)"
            onRemove={() => onProfileChange({ logo: undefined })}
            onSelect={onLogoSelected}
          />
          <TextField
            autoComplete="off"
            hint="You can enter @yourstudio or yourstudio."
            label="Instagram handle (optional)"
            value={profile.instagram}
            onChange={(event) => onProfileChange({ instagram: event.target.value })}
          />
          <ChoiceGroup
            legend="Preferred contact method"
            name="preferred-contact"
            options={CONTACT_METHODS}
            value={profile.preferredContact}
            onChange={(preferredContact) => onProfileChange({
              clientContact: preferredContact === 'call'
                ? { ...profile.clientContact, callEnabled: true }
                : preferredContact === 'text'
                  ? { ...profile.clientContact, textEnabled: true }
                  : profile.clientContact,
              preferredContact,
            })}
          />
        </div>
        <aside aria-label="Profile preview" className="onboarding-profile-preview">
          {profileImage ? (
            <img alt={profile.profilePhoto?.altText || `${profile.ownerName || 'Owner'} profile`} src={profileImage} />
          ) : (
            <span aria-label="Profile photo placeholder" className="onboarding-profile-preview__initials">
              {initialsFor(profile)}
            </span>
          )}
          <strong>{profile.ownerName || 'Your name'}</strong>
          <span>{profile.businessName || 'Your business'}</span>
          {profile.instagram.trim() ? <span>{profile.instagram.trim()}</span> : null}
        </aside>
      </div>
      <StickyOnboardingActions
        onBack={onBack}
        onPrimary={onContinue}
        onSkip={onSkipPhoto}
        primaryLabel={copy.primaryAction}
        skipLabel={copy.secondaryAction}
      />
    </section>
  );
}

type LocationCardId = 'location' | 'contact' | 'hours';

type LocationContactScreenProps = SharedBasicsScreenProps & {
  onContinue: () => void;
  onSkipHours: () => void;
  onValidationFailure?: (fieldIds: string[]) => void;
  previewTimestamp: string;
};

export function LocationContactScreen({
  onBack,
  onContinue,
  onProfileChange,
  onSkipHours,
  onValidationFailure,
  previewTimestamp,
  profile,
}: LocationContactScreenProps) {
  const copy = SCREEN_METADATA.location_contact;
  const formId = useId();
  const contactErrorId = `${formId}-contact-error`;
  const [openCard, setOpenCard] = useState<LocationCardId>('location');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateLocation = (patch: Partial<BusinessProfileDraft['location']>) => {
    onProfileChange({ location: { ...profile.location, ...patch } });
  };
  const updateDay = (day: Weekday, patch: Partial<DayHoursDraft>) => {
    const days = {
      ...profile.hours.days,
      [day]: { ...profile.hours.days[day], ...patch },
    };
    onProfileChange({
      hours: {
        ...profile.hours,
        days,
        setupState: hasConfiguredWeeklyHours({ ...profile.hours, days })
          ? 'configured'
          : 'unset',
      },
    });
  };
  const availableContactMethods = getAvailableContactMethods(profile);
  const hasAnyContact = availableContactMethods.length > 0;
  const hasCoherentPreferredContact = contactMethodHasValue(
    profile,
    profile.preferredContact,
  );
  const availableContactOptions = CONTACT_METHODS.filter(({ value }) =>
    availableContactMethods.includes(value));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!profile.location.cityOrArea.trim()) {
      nextErrors.cityOrArea = 'Add a city or general service area.';
    }
    if (!profile.bookingOnlyContact && !hasAnyContact) {
      nextErrors.contact = 'Add at least one public contact method, or choose Booking only.';
    } else if (
      !profile.bookingOnlyContact
      && !hasCoherentPreferredContact
    ) {
      nextErrors.preferredContact = 'Choose a preferred method that has contact information.';
    }
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      setOpenCard(nextErrors.cityOrArea ? 'location' : 'contact');
      onValidationFailure?.(failedFields);
      focusFirstInvalidControl(event.currentTarget);
      return;
    }
    onContinue();
  };

  const locationSummary = profile.location.cityOrArea.trim()
    || 'Add your general area';
  const contactSummary = profile.bookingOnlyContact
    ? 'Clients use Booking only'
    : hasCoherentPreferredContact && profile.preferredContact
      ? `Preferred: ${CONTACT_METHODS.find(({ value }) => value === profile.preferredContact)?.label}`
      : 'Add a public contact method';
  const hoursSummary = getWeeklyHoursSetupSummary(profile.hours);
  const hoursStatus = getWeeklyHoursPreviewStatus(profile.hours, previewTimestamp);

  const publicLocation = getPublicLocationPreview(profile.location);
  const publicContact = getPublicContactPreview(profile);
  const publicWeeklyHours = getPublicWeeklyHours(profile.hours);
  const hasConfiguredHours = hasConfiguredWeeklyHours(profile.hours);

  return (
    <section aria-labelledby="location-contact-heading" className="onboarding-screen onboarding-location-contact-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Essential</p>
        <h1 id="location-contact-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <form id={formId} noValidate onSubmit={submit}>
          <ValidationSummary errors={errors} />
          <CollapsibleFormCard
            completed={Boolean(profile.location.cityOrArea.trim())}
            id="onboarding-location-card"
            open={openCard === 'location'}
            summary={locationSummary}
            title="Location"
            onToggle={() => setOpenCard('location')}
          >
            <TextField
              autoComplete="address-level2"
              error={errors.cityOrArea}
              label="City or general service area"
              required
              value={profile.location.cityOrArea}
              onChange={(event) => {
                setErrors((current) => ({ ...current, cityOrArea: '' }));
                updateLocation({ cityOrArea: event.target.value });
              }}
            />
            <TextField
              autoComplete="street-address"
              label="Exact address (optional)"
              value={profile.location.exactAddress}
              onChange={(event) => updateLocation({ exactAddress: event.target.value })}
            />
            <ChoiceGroup
              legend="Where do you see clients?"
              name="location-type"
              options={LOCATION_TYPES}
              value={profile.location.locationType}
              onChange={(locationType) => updateLocation({ locationType })}
            />
            <ChoiceGroup
              legend="Address visibility"
              name="address-visibility"
              options={ADDRESS_VISIBILITY}
              value={profile.location.addressVisibility}
              onChange={(addressVisibility) => updateLocation({ addressVisibility })}
            />
            <NativeSwitch
              checked={profile.location.allowGeneralAreaDirections}
              description={profile.location.addressVisibility !== 'public'
                ? 'Directions stay hidden unless your location is public.'
                : profile.location.exactAddress.trim()
                  ? 'Directions use your public exact address.'
                  : 'Allow a Directions action to your city or general service area.'}
              disabled={profile.location.addressVisibility !== 'public'
                || Boolean(profile.location.exactAddress.trim())}
              label="Allow directions to my general service area"
              onChange={(allowGeneralAreaDirections) => updateLocation({
                allowGeneralAreaDirections,
              })}
            />
            <TextField
              label="Parking (optional)"
              value={profile.location.parking}
              onChange={(event) => updateLocation({ parking: event.target.value })}
            />
            <TextAreaField
              label="Entrance instructions (optional)"
              value={profile.location.entranceInstructions}
              onChange={(event) => updateLocation({ entranceInstructions: event.target.value })}
            />
            <TextField
              label="Transit information (optional)"
              value={profile.location.transitInformation}
              onChange={(event) => updateLocation({ transitInformation: event.target.value })}
            />
          </CollapsibleFormCard>

          <CollapsibleFormCard
            completed={profile.bookingOnlyContact || hasCoherentPreferredContact}
            id="onboarding-contact-card"
            open={openCard === 'contact'}
            summary={contactSummary}
            title="Contact"
            onToggle={() => setOpenCard('contact')}
          >
            <NativeSwitch
              checked={profile.bookingOnlyContact}
              description="Your website guides clients to Booking and keeps saved contact details private."
              label="Clients should use Booking only"
              onChange={(bookingOnlyContact) => {
                setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                onProfileChange({
                  bookingOnlyContact,
                  preferredContact: bookingOnlyContact
                    ? profile.preferredContact
                    : getCoherentPreferredContact(profile),
                });
              }}
            />
            <TextField
              autoComplete="tel"
              label="Client contact number"
              type="tel"
              value={profile.clientContact.primaryNumber}
              onChange={(event) => {
                setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                onProfileChange({
                  clientContact: {
                    ...profile.clientContact,
                    primaryNumber: event.target.value,
                  },
                });
              }}
            />
            <fieldset
              aria-describedby={errors.contact ? contactErrorId : undefined}
              aria-invalid={errors.contact ? 'true' : undefined}
              className="onboarding-contact-uses"
            >
              <legend>Clients can:</legend>
              <NativeSwitch
                checked={profile.clientContact.callEnabled}
                description="Use the client contact number for calls."
                label="Call this number"
                onChange={(callEnabled) => {
                  setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                  const clientContact = { ...profile.clientContact, callEnabled };
                  const nextProfile = { ...profile, clientContact };
                  onProfileChange({
                    clientContact,
                    preferredContact: callEnabled && !profile.preferredContact
                      ? 'call'
                      : getCoherentPreferredContact(nextProfile),
                  });
                }}
              />
              <NativeSwitch
                checked={profile.clientContact.textEnabled}
                description="Use the client contact number for text messages."
                label="Text this number"
                onChange={(textEnabled) => {
                  setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                  const clientContact = { ...profile.clientContact, textEnabled };
                  const nextProfile = { ...profile, clientContact };
                  onProfileChange({
                    clientContact,
                    preferredContact: textEnabled && !profile.preferredContact
                      ? 'text'
                      : getCoherentPreferredContact(nextProfile),
                  });
                }}
              />
            </fieldset>
            {profile.clientContact.textEnabled ? (
              <NativeSwitch
                checked={profile.clientContact.useDifferentTextNumber}
                description="Keep calls on the primary number and route texts somewhere else."
                label="Use a different number for text messages"
                onChange={(useDifferentTextNumber) => {
                  setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                  onProfileChange({
                    clientContact: { ...profile.clientContact, useDifferentTextNumber },
                  });
                }}
              />
            ) : null}
            {profile.clientContact.textEnabled
              && profile.clientContact.useDifferentTextNumber ? (
                <TextField
                  autoComplete="tel"
                  label="Text message number"
                  type="tel"
                  value={profile.clientContact.differentTextNumber}
                  onChange={(event) => {
                    setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                    onProfileChange({
                      clientContact: {
                        ...profile.clientContact,
                        differentTextNumber: event.target.value,
                      },
                    });
                  }}
                />
              ) : null}
            <TextField
              autoComplete="email"
              label="Email (optional)"
              type="email"
              value={profile.email}
              onChange={(event) => {
                setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                onProfileChange({ email: event.target.value });
              }}
            />
            <TextField
              label="Instagram"
              value={profile.instagram}
              onChange={(event) => {
                setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                onProfileChange({ instagram: event.target.value });
              }}
            />
            {!profile.bookingOnlyContact && availableContactOptions.length > 0 ? (
              <ChoiceGroup
                error={errors.preferredContact}
                legend="Preferred public contact method"
                name="public-contact-method"
                options={availableContactOptions}
                value={profile.preferredContact}
                onChange={(preferredContact) => {
                  setErrors((current) => ({ ...current, preferredContact: '' }));
                  onProfileChange({ preferredContact });
                }}
              />
            ) : null}
            {!profile.bookingOnlyContact && errors.preferredContact
              && availableContactOptions.length === 0 ? (
                <p className="onboarding-field__error">
                  {errors.preferredContact}
                </p>
              ) : null}
            {errors.contact ? (
              <p className="onboarding-field__error" id={contactErrorId}>
                {errors.contact}
              </p>
            ) : null}
          </CollapsibleFormCard>

          <CollapsibleFormCard
            completed={profile.hours.setupState === 'configured' && hasConfiguredHours}
            id="onboarding-hours-card"
            open={openCard === 'hours'}
            summary={hoursSummary}
            title="Hours"
            onToggle={() => setOpenCard('hours')}
          >
            <NativeSwitch
              checked={profile.hours.showOnSite}
              description={profile.hours.setupState === 'configured' && hasConfiguredHours
                ? profile.hours.showOnSite
                  ? 'Your current open or closed status appears in connected previews.'
                  : 'Not shown on your site'
                : 'Add hours before showing a public status.'}
              disabled={profile.hours.setupState !== 'configured' || !hasConfiguredHours}
              label="Show hours on my website"
              onChange={(showOnSite) => onProfileChange({
                hours: { ...profile.hours, showOnSite },
              })}
            />
            <div className="onboarding-hours-grid">
              {WEEKDAYS.map(({ id, label }) => {
                const day = profile.hours.days[id];
                return (
                  <fieldset className="onboarding-hours-day" key={id}>
                    <legend>{label}</legend>
                    <label>
                      <input
                        checked={day.closed}
                        type="checkbox"
                        onChange={(event) => updateDay(id, { closed: event.target.checked })}
                      />
                      Closed
                    </label>
                    <label>
                      Opens
                      <input
                        aria-label={`${label} opens`}
                        disabled={day.closed}
                        type="time"
                        value={day.open}
                        onChange={(event) => updateDay(id, { open: event.target.value })}
                      />
                    </label>
                    <label>
                      Closes
                      <input
                        aria-label={`${label} closes`}
                        disabled={day.closed}
                        type="time"
                        value={day.close}
                        onChange={(event) => updateDay(id, { close: event.target.value })}
                      />
                    </label>
                  </fieldset>
                );
              })}
            </div>
            <div className="onboarding-inline-actions">
              <button
                disabled={!isValidOpenHoursDay(profile.hours.days.monday)}
                type="button"
                onClick={() => {
                  const monday = profile.hours.days.monday;
                  onProfileChange({
                    hours: {
                      ...profile.hours,
                      days: {
                        ...profile.hours.days,
                        friday: { ...monday },
                        monday: { ...monday },
                        thursday: { ...monday },
                        tuesday: { ...monday },
                        wednesday: { ...monday },
                      },
                      setupState: 'configured',
                    },
                  });
                }}
              >
                Copy Monday to weekdays
              </button>
              <button
                type="button"
                onClick={() => {
                  onProfileChange({
                    hours: { ...profile.hours, setupState: 'skipped' },
                  });
                  onSkipHours();
                }}
              >
                Skip hours for now
              </button>
            </div>
          </CollapsibleFormCard>
        </form>

        <aside aria-label="Location and contact preview" className="onboarding-location-preview">
          <p className="onboarding-preview-eyebrow">Visit us</p>
          <strong>{publicLocation.primary || 'Your general area'}</strong>
          {publicLocation.detail ? <span>{publicLocation.detail}</span> : null}
          {profile.bookingPreferences.visitMode ? (
            <span>
              {profile.bookingPreferences.visitMode === 'appointment_only'
                ? 'Appointment only'
                : profile.bookingPreferences.visitMode === 'walk_ins_only'
                  ? 'Walk-ins only'
                  : 'Appointments and walk-ins'}
            </span>
          ) : null}
          {hoursStatus ? <span>{hoursStatus.label}</span> : null}
          {publicWeeklyHours.length > 0 ? (
            <dl aria-label="Weekly hours" className="onboarding-compact-hours">
              {publicWeeklyHours.map((day) => (
                <div key={day.weekday}><dt>{day.label}</dt><dd>{day.hours}</dd></div>
              ))}
            </dl>
          ) : null}
          {publicContact ? <span>{publicContact.detail}</span> : null}
          <div className="onboarding-location-preview__actions">
            {publicLocation.directionsTarget ? <button type="button">Directions</button> : null}
            {publicContact ? <button type="button">{publicContact.actionLabel}</button> : null}
          </div>
        </aside>
      </div>
      <StickyOnboardingActions
        formId={formId}
        onBack={onBack}
        primaryLabel={copy.primaryAction}
      />
    </section>
  );
}
