import { useId, useMemo, useState, type FormEvent } from 'react';

import { SCREEN_METADATA } from '../copy';
import type {
  AddressVisibility,
  BusinessProfileDraft,
  BusinessType,
  DayHoursDraft,
  LocationType,
  PreferredContactMethod,
  Weekday,
} from '../model/types';
import {
  ChoiceGroup,
  CollapsibleFormCard,
  ImageUploadField,
  NativeSwitch,
  TextAreaField,
  TextField,
  type ChoiceOption,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';

type ProfilePatch = Partial<BusinessProfileDraft>;

type SharedBasicsScreenProps = {
  onBack: () => void;
  onProfileChange: (patch: ProfilePatch) => void;
  profile: BusinessProfileDraft;
};

const BUSINESS_TYPES: readonly ChoiceOption<BusinessType>[] = [
  { label: 'Solo nail tech', value: 'solo' },
  { label: 'Home studio', value: 'home_studio' },
  { label: 'Salon suite', value: 'salon_suite' },
  { label: 'Traditional salon', value: 'traditional_salon' },
  { label: 'Mobile nail tech', value: 'mobile' },
  { label: 'Multi-tech salon', value: 'multi_tech' },
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

function businessTypeLabel(value: BusinessType | null): string {
  return BUSINESS_TYPES.find((option) => option.value === value)?.label ?? 'Business type';
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
    if (!profile.businessType) nextErrors.businessType = 'Choose the business type that fits best.';
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      onValidationFailure?.(failedFields);
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
            error={errors.businessType}
            legend="Business type"
            name="business-type"
            options={BUSINESS_TYPES}
            value={profile.businessType}
            onChange={(businessType) => {
              setErrors((current) => ({ ...current, businessType: '' }));
              onProfileChange({ businessType });
            }}
          />
        </form>
        <aside aria-label="Business information preview" className="business-preview-card">
          <span aria-hidden="true" className="business-preview-card__mark">
            {initialsFor(profile)}
          </span>
          <p>{profile.businessName.trim() || 'Your business name'}</p>
          <strong>{profile.ownerName.trim() || 'Your name'}</strong>
          <span>{businessTypeLabel(profile.businessType)}</span>
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
            hint="You can enter @islanail.studio or islanail.studio."
            label="Instagram handle (optional)"
            value={profile.instagram}
            onChange={(event) => onProfileChange({ instagram: event.target.value })}
          />
          <ChoiceGroup
            legend="Preferred contact method"
            name="preferred-contact"
            options={CONTACT_METHODS}
            value={profile.preferredContact}
            onChange={(preferredContact) => onProfileChange({ preferredContact })}
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
};

const contactMethodHasValue = (
  profile: BusinessProfileDraft,
  method: PreferredContactMethod | null,
): boolean => {
  if (!method) return false;
  if (method === 'text') return Boolean(profile.textPhone.trim());
  if (method === 'call') return Boolean(profile.phone.trim());
  if (method === 'instagram') return Boolean(profile.instagram.trim());
  return Boolean(profile.email.trim());
};

export function LocationContactScreen({
  onBack,
  onContinue,
  onProfileChange,
  onSkipHours,
  onValidationFailure,
  profile,
}: LocationContactScreenProps) {
  const copy = SCREEN_METADATA.location_contact;
  const formId = useId();
  const [openCard, setOpenCard] = useState<LocationCardId>('location');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateLocation = (patch: Partial<BusinessProfileDraft['location']>) => {
    onProfileChange({ location: { ...profile.location, ...patch } });
  };
  const updateDay = (day: Weekday, patch: Partial<DayHoursDraft>) => {
    onProfileChange({
      hours: {
        ...profile.hours,
        days: {
          ...profile.hours.days,
          [day]: { ...profile.hours.days[day], ...patch },
        },
        skipped: false,
      },
    });
  };
  const hasAnyContact = Boolean(
    profile.phone.trim()
    || profile.textPhone.trim()
    || profile.email.trim()
    || profile.instagram.trim(),
  );

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
      && (!profile.preferredContact || !contactMethodHasValue(profile, profile.preferredContact))
    ) {
      nextErrors.preferredContact = 'Choose a preferred method that has contact information.';
    }
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      setOpenCard(nextErrors.cityOrArea ? 'location' : 'contact');
      onValidationFailure?.(failedFields);
      return;
    }
    onContinue();
  };

  const locationSummary = profile.location.cityOrArea.trim()
    || 'Add your general area';
  const contactSummary = profile.bookingOnlyContact
    ? 'Clients use Booking only'
    : profile.preferredContact
      ? `Preferred: ${CONTACT_METHODS.find(({ value }) => value === profile.preferredContact)?.label}`
      : 'Add a public contact method';
  const openDays = WEEKDAYS.filter(({ id }) => !profile.hours.days[id].closed).length;
  const hoursSummary = profile.hours.skipped
    ? 'Not shown yet'
    : `${openDays} day${openDays === 1 ? '' : 's'} open`;

  const publicLocation = profile.location.addressVisibility === 'public'
    && profile.location.exactAddress.trim()
    ? profile.location.exactAddress.trim()
    : profile.location.cityOrArea.trim();

  return (
    <section aria-labelledby="location-contact-heading" className="onboarding-screen onboarding-location-contact-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Essential</p>
        <h1 id="location-contact-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <form id={formId} noValidate onSubmit={submit}>
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
              legend="Location type"
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
            completed={profile.bookingOnlyContact || hasAnyContact}
            id="onboarding-contact-card"
            open={openCard === 'contact'}
            summary={contactSummary}
            title="Contact"
            onToggle={() => setOpenCard('contact')}
          >
            <TextField
              autoComplete="tel"
              label="Phone (optional)"
              type="tel"
              value={profile.phone}
              onChange={(event) => {
                setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                onProfileChange({ phone: event.target.value });
              }}
            />
            <TextField
              autoComplete="tel"
              label="Text (optional)"
              type="tel"
              value={profile.textPhone}
              onChange={(event) => {
                setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                onProfileChange({ textPhone: event.target.value });
              }}
            />
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
            <ChoiceGroup
              error={errors.preferredContact}
              legend="Preferred public contact method"
              name="public-contact-method"
              options={CONTACT_METHODS}
              value={profile.preferredContact}
              onChange={(preferredContact) => {
                setErrors((current) => ({ ...current, preferredContact: '' }));
                onProfileChange({ preferredContact, bookingOnlyContact: false });
              }}
            />
            <NativeSwitch
              checked={profile.bookingOnlyContact}
              description="Your website will guide clients to the Booking section instead of showing contact details."
              label="Clients should use Booking only"
              onChange={(bookingOnlyContact) => {
                setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                onProfileChange({ bookingOnlyContact });
              }}
            />
            {errors.contact ? (
              <p className="onboarding-field__error" role="alert">{errors.contact}</p>
            ) : null}
          </CollapsibleFormCard>

          <CollapsibleFormCard
            completed={profile.hours.skipped || openDays > 0}
            id="onboarding-hours-card"
            open={openCard === 'hours'}
            summary={hoursSummary}
            title="Hours"
            onToggle={() => setOpenCard('hours')}
          >
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
                      skipped: false,
                    },
                  });
                }}
              >
                Copy Monday to weekdays
              </button>
              <button
                type="button"
                onClick={() => {
                  onProfileChange({ hours: { ...profile.hours, skipped: true } });
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
          <strong>{publicLocation || 'Your general area'}</strong>
          {profile.bookingPreferences.visitMode ? (
            <span>
              {profile.bookingPreferences.visitMode === 'appointment_only'
                ? 'Appointment only'
                : profile.bookingPreferences.visitMode === 'walk_ins_only'
                  ? 'Walk-ins only'
                  : 'Appointments and walk-ins'}
            </span>
          ) : null}
          {!profile.hours.skipped ? (
            <span>{profile.hours.days.monday.closed ? 'Closed Monday' : 'Open Monday'}</span>
          ) : null}
          <div className="onboarding-location-preview__actions">
            {publicLocation ? <button type="button">Directions</button> : null}
            {profile.bookingOnlyContact ? (
              <button type="button">Book now</button>
            ) : hasAnyContact ? <button type="button">Contact</button> : null}
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
