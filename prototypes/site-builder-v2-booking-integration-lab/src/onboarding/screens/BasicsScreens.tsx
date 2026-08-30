import { useId, useRef, useState, type FormEvent } from 'react';

import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import { WeeklyHoursEditor } from '../components/WeeklyHoursEditor';
import { SCREEN_METADATA } from '../copy';
import { resolveOnboardingImage } from '../integrations/adapters/media';
import {
  contactMethodHasValue,
  getAvailableContactMethods,
  getCoherentPreferredContact,
  getInstagramInputError,
  getPublicContactPreview,
  resolveInstagramUsername,
} from '../model/contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursCardSummary,
  getWeeklyHoursPreviewStatus,
  hasCompleteWeeklyHours,
} from '../model/hours';
import { getPublicLocationPreview } from '../model/location';
import type {
  AddressVisibility,
  BusinessProfileDraft,
  BusinessStructure,
  LocationType,
  PreferredContactMethod,
} from '../model/types';
import {
  ChoiceGroup,
  CollapsibleFormCard,
  focusAndRevealControl,
  focusFirstInvalidControl,
  ImageUploadField,
  NativeSwitch,
  TextAreaField,
  TextField,
  ValidationSummary,
  type ChoiceOption,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import '../daniela-basics-booking.css';

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
    ?? 'Solo or team';
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
    if (!profile.businessName.trim()) nextErrors.businessName = 'Add your salon or studio name.';
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
        <p className="onboarding-screen-status">Required step</p>
        <h1 id="business-screen-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <form id={formId} noValidate onSubmit={submit}>
          <ValidationSummary errors={errors} />
          <TextField
            autoComplete="organization"
            error={errors.businessName}
            label="Salon or studio name"
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
          <p>{profile.businessName.trim() || 'Your salon or studio name'}</p>
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
  onLogoSelected: (file: File) => Promise<void>;
  onProfilePhotoSelected: (file: File) => Promise<void>;
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
  const screenRef = useRef<HTMLElement>(null);
  const imageAssetIds = [profile.profilePhoto, profile.logo]
    .flatMap((image) => image?.storageId ? [image.storageId] : []);
  const imageAssets = useCustomDesignAssetMap(imageAssetIds);
  const profileImage = resolveOnboardingImage(profile.profilePhoto, imageAssets);
  const logoImage = resolveOnboardingImage(profile.logo, imageAssets);
  const profileNeedsReselect = profileImage.status === 'error'
    || profileImage.status === 'missing';
  const logoNeedsReselect = logoImage.status === 'error'
    || logoImage.status === 'missing';
  const instagramResolution = resolveInstagramUsername(profile.instagram);
  const instagramError = getInstagramInputError(profile.instagram);
  const commitInstagram = () => {
    if (
      instagramResolution.status === 'resolved'
      && instagramResolution.username !== profile.instagram
    ) {
      onProfileChange({ instagram: instagramResolution.username });
    }
  };
  const continueFromPhotoSocial = () => {
    if (instagramError) {
      screenRef.current
        ?.querySelector<HTMLInputElement>('[data-instagram-input]')
        ?.focus();
      return;
    }
    commitInstagram();
    onContinue();
  };

  return (
    <section ref={screenRef} aria-labelledby="photo-social-heading" className="onboarding-screen onboarding-photo-social-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Optional</p>
        <h1 id="photo-social-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <div className="onboarding-form-stack">
          <ImageUploadField
            assetLoading={profileImage.status === 'loading'}
            chooseLabel="Choose profile photo"
            currentLabel={profile.profilePhoto?.fileName}
            currentSummary={profile.profilePhoto?.width && profile.profilePhoto.height
              ? `${profile.profilePhoto.width} × ${profile.profilePhoto.height}`
              : undefined}
            label="Profile photo"
            loadingLabel="Loading saved profile photo…"
            mediaRole="profile"
            needsReselect={profileNeedsReselect}
            onRemove={() => onProfileChange({ profilePhoto: undefined })}
            onSelect={onProfilePhotoSelected}
            previewAlt={`${profile.ownerName.trim() || 'Owner'} profile photo thumbnail`}
            previewUrl={profileImage.status === 'ready' ? profileImage.url : undefined}
            readyLabel="Profile photo ready"
            recoveryMessage={profileImage.status === 'error'
              ? 'This saved profile photo couldn’t be loaded on this device. Select it again to restore it.'
              : 'This saved profile photo is no longer available on this device. Select it again to restore it.'}
          />
          <ImageUploadField
            assetLoading={logoImage.status === 'loading'}
            chooseLabel="Choose logo"
            currentLabel={profile.logo?.fileName}
            currentSummary={profile.logo?.width && profile.logo.height
              ? `${profile.logo.width} × ${profile.logo.height}`
              : undefined}
            label="Logo"
            loadingLabel="Loading saved logo…"
            mediaRole="logo"
            needsReselect={logoNeedsReselect}
            onRemove={() => onProfileChange({ logo: undefined })}
            onSelect={onLogoSelected}
            previewAlt={`${profile.businessName.trim() || 'Salon'} logo thumbnail`}
            previewUrl={logoImage.status === 'ready' ? logoImage.url : undefined}
            readyLabel="Logo ready"
            recoveryMessage={logoImage.status === 'error'
              ? 'This saved logo couldn’t be loaded on this device. Select it again to restore it.'
              : 'This saved logo is no longer available on this device. Select it again to restore it.'}
          />
          <TextField
            autoComplete="off"
            data-instagram-input
            error={instagramError}
            hint="Enter a username or paste an Instagram profile link."
            label="Instagram handle"
            value={profile.instagram}
            onBlur={commitInstagram}
            onChange={(event) => onProfileChange({ instagram: event.target.value })}
          />
        </div>
        <aside aria-label="Profile preview" className="onboarding-profile-preview">
          {profileImage.status === 'ready' ? (
            <img
              alt={`${profile.ownerName.trim() || 'Owner'} profile photo`}
              data-media-role="profile"
              src={profileImage.url}
            />
          ) : (
            <span aria-label="Profile photo placeholder" className="onboarding-profile-preview__initials">
              {initialsFor(profile)}
            </span>
          )}
          <strong>{profile.ownerName || 'Your name'}</strong>
          <span>{profile.businessName || 'Your business'}</span>
          {instagramResolution.status === 'resolved'
            ? <span>@{instagramResolution.username}</span>
            : null}
        </aside>
      </div>
      <StickyOnboardingActions
        onBack={onBack}
        onPrimary={continueFromPhotoSocial}
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
  const formRef = useRef<HTMLFormElement>(null);
  const contactErrorId = `${formId}-contact-error`;
  const [openCard, setOpenCard] = useState<LocationCardId>('location');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editingInstagram, setEditingInstagram] = useState(
    !profile.instagram.trim()
      || resolveInstagramUsername(profile.instagram).status === 'invalid',
  );
  const instagramResolution = resolveInstagramUsername(profile.instagram);
  const instagramError = getInstagramInputError(profile.instagram);

  const revealError = (fieldId: string, keepSummaryVisible = false) => {
    const card: LocationCardId = fieldId === 'cityOrArea' || fieldId === 'locationType'
      ? 'location'
      : 'contact';
    setOpenCard(card);
    if (fieldId === 'instagram') setEditingInstagram(true);
    window.requestAnimationFrame(() => {
      const panel = formRef.current?.querySelector<HTMLElement>(
        `#onboarding-${card}-card-panel`,
      );
      const requestedTarget = fieldId === 'cityOrArea'
        ? panel?.querySelector<HTMLElement>('input[autocomplete="address-level2"]')
        : fieldId === 'locationType'
          ? panel?.querySelector<HTMLElement>('input[name="location-type"]')
        : fieldId === 'preferredContact'
          ? panel?.querySelector<HTMLElement>('input[name="public-contact-method"]')
          : fieldId === 'instagram'
            ? panel?.querySelector<HTMLElement>('[data-instagram-input]')
          : panel?.querySelector<HTMLElement>('input[autocomplete="tel"], input[type="email"]');
      const target = requestedTarget ?? panel?.querySelector<HTMLElement>(
        '[aria-invalid="true"] input:not([disabled]), [aria-invalid="true"] textarea:not([disabled]), [aria-invalid="true"] select:not([disabled]), [aria-invalid="true"] button:not([disabled]), [aria-invalid="true"][tabindex]',
      ) ?? panel?.querySelector<HTMLElement>('[aria-invalid="true"]');
      const targetGroup = target?.closest<HTMLElement>(
        '.onboarding-field, .onboarding-choice-group, .onboarding-contact-uses, [aria-invalid="true"]',
      ) ?? target;
      const summary = formRef.current?.querySelector<HTMLElement>(
        '.onboarding-validation-summary',
      );
      if (keepSummaryVisible) {
        summary?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
      }
      if (target) focusAndRevealControl(
        target,
        targetGroup ?? target,
        keepSummaryVisible ? summary : null,
      );
    });
  };

  const updateLocation = (patch: Partial<BusinessProfileDraft['location']>) => {
    onProfileChange({ location: { ...profile.location, ...patch } });
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
    if (!profile.location.locationType) {
      nextErrors.locationType = 'Choose where you see clients.';
    }
    if (instagramError) nextErrors.instagram = instagramError;
    if (!profile.bookingOnlyContact && !hasAnyContact) {
      nextErrors.contact = 'Add a phone number, email or Instagram so clients can reach you—or choose “Clients should use online booking only” to keep your details private.';
    } else if (
      !profile.bookingOnlyContact
      && availableContactMethods.length >= 2
      && !hasCoherentPreferredContact
    ) {
      nextErrors.preferredContact = 'Choose which contact option clients should see first.';
    }
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      onValidationFailure?.(failedFields);
      const firstFailedField = failedFields[0];
      if (firstFailedField) revealError(firstFailedField, true);
      return;
    }
    if (
      !profile.bookingOnlyContact
      && availableContactMethods.length === 1
      && !hasCoherentPreferredContact
    ) {
      onProfileChange({ preferredContact: availableContactMethods[0] ?? null });
    }
    onContinue();
  };

  const locationComplete = Boolean(
    profile.location.cityOrArea.trim()
      && profile.location.locationType
      && profile.location.addressVisibility,
  );
  const locationSummary = profile.location.cityOrArea.trim()
    ? profile.location.locationType
      ? profile.location.cityOrArea.trim()
      : `${profile.location.cityOrArea.trim()} · Add where you see clients`
    : 'Add your general area';
  const contactSummary = profile.bookingOnlyContact
    ? 'Online booking only'
    : hasCoherentPreferredContact && profile.preferredContact
      ? `${CONTACT_METHODS.find(({ value }) => value === profile.preferredContact)?.label} shown first`
      : availableContactMethods.length === 1
        ? `${CONTACT_METHODS.find(({ value }) => value === availableContactMethods[0])?.label} added`
      : 'Add phone, email or Instagram';
  const hoursSummary = getWeeklyHoursCardSummary(profile.hours);
  const hoursStatus = getWeeklyHoursPreviewStatus(profile.hours, previewTimestamp);

  const publicLocation = getPublicLocationPreview(profile.location);
  const publicContact = getPublicContactPreview(profile);
  const publicWeeklyHours = getPublicWeeklyHours(profile.hours);
  const hasCompleteHours = hasCompleteWeeklyHours(profile.hours);

  return (
    <section aria-labelledby="location-contact-heading" className="onboarding-screen onboarding-location-contact-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Required step</p>
        <h1 id="location-contact-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-split-layout">
        <form id={formId} noValidate ref={formRef} onSubmit={submit}>
          <ValidationSummary errors={errors} onSelectError={(fieldId) => revealError(fieldId)} />
          <CollapsibleFormCard
            completed={locationComplete}
            errorCount={[errors.cityOrArea, errors.locationType].filter(Boolean).length}
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
            <ChoiceGroup
              error={errors.locationType}
              legend="Where do you see clients?"
              name="location-type"
              options={LOCATION_TYPES}
              value={profile.location.locationType}
              onChange={(locationType) => {
                setErrors((current) => ({ ...current, locationType: '' }));
                updateLocation({
                  locationType,
                  ...(locationType === 'home_studio'
                    ? { addressVisibility: 'hidden' as const }
                    : {}),
                });
              }}
            />
            <ChoiceGroup
              legend="Who can see your address?"
              name="address-visibility"
              options={ADDRESS_VISIBILITY}
              value={profile.location.addressVisibility}
              onChange={(addressVisibility) => updateLocation({ addressVisibility })}
            />
            {profile.location.addressVisibility !== 'hidden' ? (
              <TextField
                autoComplete="street-address"
                label="Exact address (optional)"
                value={profile.location.exactAddress}
                onChange={(event) => updateLocation({ exactAddress: event.target.value })}
              />
            ) : null}
            <NativeSwitch
              checked={profile.location.addressVisibility === 'public'
                && !profile.location.exactAddress.trim()
                && profile.location.allowGeneralAreaDirections}
              description={profile.location.addressVisibility !== 'public'
                ? 'Make your general area public to offer Directions.'
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
            <details className="onboarding-arrival-details">
              <summary>
                <span><strong>Arrival details · Optional</strong><small>Help clients find and enter your location.</small></span>
              </summary>
              <div>
                <TextField
                  label="Parking"
                  value={profile.location.parking}
                  onChange={(event) => updateLocation({ parking: event.target.value })}
                />
                <TextAreaField
                  label="Entrance instructions"
                  value={profile.location.entranceInstructions}
                  onChange={(event) => updateLocation({ entranceInstructions: event.target.value })}
                />
                <TextField
                  label="Transit information"
                  value={profile.location.transitInformation}
                  onChange={(event) => updateLocation({ transitInformation: event.target.value })}
                />
              </div>
            </details>
          </CollapsibleFormCard>

          <CollapsibleFormCard
            completed={!instagramError && (
              profile.bookingOnlyContact || hasCoherentPreferredContact
            )}
            errorCount={[errors.contact, errors.instagram, errors.preferredContact]
              .filter(Boolean).length}
            id="onboarding-contact-card"
            open={openCard === 'contact'}
            summary={contactSummary}
            title="Contact"
            status={!instagramError && (
              profile.bookingOnlyContact || hasCoherentPreferredContact
            ) ? 'complete' : instagramError ? 'finish' : 'set_up'}
            onToggle={() => setOpenCard('contact')}
          >
            <h2 className="onboarding-card-section-heading">How should clients contact you?</h2>
            <NativeSwitch
              checked={profile.bookingOnlyContact}
              description="Your website will guide clients to Booking and keep your personal contact details private."
              label="Clients should use online booking only"
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
            <fieldset
              className="onboarding-public-contact-fields"
              disabled={profile.bookingOnlyContact}
            >
              <legend className="visually-hidden">Public phone and email contact details</legend>
              <TextField
                aria-describedby={errors.contact ? contactErrorId : undefined}
                aria-invalid={errors.contact ? 'true' : undefined}
                autoComplete="tel"
                label="Phone number clients can use"
                type="tel"
                value={profile.clientContact.primaryNumber}
                onChange={(event) => {
                  setErrors((current) => ({ ...current, contact: '', preferredContact: '' }));
                  const clientContact = {
                    ...profile.clientContact,
                    primaryNumber: event.target.value,
                  };
                  const nextProfile = { ...profile, clientContact };
                  onProfileChange({
                    clientContact,
                    preferredContact: getCoherentPreferredContact(nextProfile),
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
                  description="Clients see a Call button on your site."
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
                  description="Clients see a Text button on your site."
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
                      preferredContact: profile.preferredContact,
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
                      const clientContact = {
                        ...profile.clientContact,
                        differentTextNumber: event.target.value,
                      };
                      onProfileChange({
                        clientContact,
                        preferredContact: profile.preferredContact,
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
                  const email = event.target.value;
                  onProfileChange({
                    email,
                    preferredContact: getCoherentPreferredContact({ ...profile, email }),
                  });
                }}
              />
            </fieldset>
            <div className="onboarding-shared-instagram">
              <div>
                <span>Instagram</span>
                <strong>{instagramResolution.status === 'resolved'
                  ? `@${instagramResolution.username}`
                  : profile.instagram.trim() || 'Not added yet'}</strong>
                <small>Shared with Photo and Instagram. Changes update everywhere.</small>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (editingInstagram && instagramError) {
                    window.requestAnimationFrame(() => {
                      formRef.current
                        ?.querySelector<HTMLInputElement>('[data-instagram-input]')
                        ?.focus({ preventScroll: true });
                    });
                    return;
                  }
                  if (
                    editingInstagram
                    && instagramResolution.status === 'resolved'
                    && instagramResolution.username !== profile.instagram
                  ) {
                    onProfileChange({
                      instagram: instagramResolution.username,
                      preferredContact: getCoherentPreferredContact({
                        ...profile,
                        instagram: instagramResolution.username,
                      }),
                    });
                  }
                  setEditingInstagram((current) => !current);
                }}
              >
                {editingInstagram ? 'Done' : 'Edit'}
              </button>
            </div>
            {editingInstagram ? (
              <TextField
                data-instagram-input
                error={instagramError}
                hint="Enter a username or paste an Instagram profile link."
                label="Instagram handle"
                value={profile.instagram}
                onBlur={() => {
                  if (
                    instagramResolution.status === 'resolved'
                    && instagramResolution.username !== profile.instagram
                  ) {
                    onProfileChange({
                      instagram: instagramResolution.username,
                      preferredContact: getCoherentPreferredContact({
                        ...profile,
                        instagram: instagramResolution.username,
                      }),
                    });
                  }
                }}
                onChange={(event) => {
                  setErrors((current) => ({
                    ...current,
                    contact: '',
                    instagram: '',
                    preferredContact: '',
                  }));
                  const instagram = event.target.value;
                  onProfileChange({
                    instagram,
                    preferredContact: getCoherentPreferredContact({ ...profile, instagram }),
                  });
                }}
              />
            ) : null}
            {!profile.bookingOnlyContact && availableContactOptions.length >= 2 ? (
              <ChoiceGroup
                error={errors.preferredContact}
                legend="Which contact option should we show first?"
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
            completed={profile.hours.setupState === 'configured' && hasCompleteHours}
            id="onboarding-hours-card"
            open={openCard === 'hours'}
            summary={hoursSummary}
            status={profile.hours.setupState === 'skipped'
              || (profile.hours.setupState === 'configured' && !profile.hours.showOnSite)
              ? 'not_shown'
              : profile.hours.setupState === 'configured' && hasCompleteHours
                ? 'complete'
                : profile.hours.setupState === 'configured'
                  ? 'finish'
                : 'set_up'}
            title="Hours"
            onToggle={() => setOpenCard('hours')}
          >
            <NativeSwitch
              checked={profile.hours.setupState === 'configured'
                && hasCompleteHours
                && profile.hours.showOnSite}
              description={profile.hours.setupState === 'configured' && hasCompleteHours
                ? profile.hours.showOnSite
                  ? 'Your current open or closed status appears in connected previews.'
                  : 'Not shown on your site'
                : 'Add hours before showing a public status.'}
              disabled={profile.hours.setupState !== 'configured' || !hasCompleteHours}
              label="Show hours on my website"
              onChange={(showOnSite) => onProfileChange({
                hours: { ...profile.hours, showOnSite },
              })}
            />
            <WeeklyHoursEditor
              hours={profile.hours}
              onChange={(hours) => onProfileChange({ hours })}
              onSkip={() => {
                onProfileChange({
                  hours: { ...profile.hours, setupState: 'skipped' },
                });
                onSkipHours();
              }}
            />
            <p className="onboarding-field-hint">
              Website hours show clients when your business is open. Bookable appointment
              times follow your Booking availability, which you can manage from your dashboard.
            </p>
          </CollapsibleFormCard>
        </form>

        <aside
          aria-label="Location and contact visual preview. Customer actions are available in the full preview."
          className="onboarding-location-preview"
          role="img"
        >
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
          <div aria-hidden="true" className="onboarding-location-preview__actions">
            {publicLocation.directionsTarget ? <span>Directions</span> : null}
            {publicContact ? <span>{publicContact.actionLabel}</span> : null}
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
