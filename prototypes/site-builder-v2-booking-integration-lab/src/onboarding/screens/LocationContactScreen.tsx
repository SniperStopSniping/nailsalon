import '../location-contact-screen.css';

import { type FormEvent, useId, useRef, useState } from 'react';

import { useMediaQuery } from '../../ui/StarterChooser';
import { AddressSearchField } from '../components/AddressSearchField';
import {
  ChoiceGroup,
  type ChoiceOption,
  CollapsibleFormCard,
  focusAndRevealControl,
  NativeSwitch,
  TextAreaField,
  TextField,
  ValidationSummary,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import {
  getAvailableContactMethods,
  getCoherentPreferredContact,
  getInstagramInputError,
  resolveInstagramUsername,
} from '../model/contact';
import type {
  AddressVisibility,
  BusinessProfileDraft,
  PreferredContactMethod,
} from '../model/types';

type ProfilePatch = Partial<BusinessProfileDraft>;

type LocationContactScreenProps = {
  contactSetupConfirmed?: boolean;
  onBack: () => void;
  onContactConfirmed?: () => void;
  onContinue: () => void;
  onProfileChange: (patch: ProfilePatch) => void;
  onValidationFailure?: (fieldIds: string[]) => void;
  profile: BusinessProfileDraft;
};

type CardId = 'location' | 'contact' | 'arrival';

const CONTACT_METHODS: readonly ChoiceOption<PreferredContactMethod>[] = [
  { label: 'Text', value: 'text' },
  { label: 'Call', value: 'call' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Email', value: 'email' },
];

const ADDRESS_VISIBILITY_OPTIONS: readonly {
  description: string;
  label: string;
  note: string;
  value: AddressVisibility;
}[] = [
  {
    description: 'Clients see your city while your full address stays private.',
    label: 'Show only my city',
    note: 'Most private',
    value: 'hidden',
  },
  {
    description: 'Clients can see your complete address and use it for directions.',
    label: 'Always show my full address',
    note: 'Most visible',
    value: 'public',
  },
  {
    description: 'Clients see only your city while browsing. Your full address becomes available after a confirmed appointment.',
    label: 'Show my full address after they book',
    note: 'Balanced privacy',
    value: 'after_booking',
  },
];

const emailLooksValid = (value: string): boolean => !value.trim()
  || /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/u.test(value.trim());

const locationAddressLabel = (profile: BusinessProfileDraft): string => {
  if (profile.businessType === 'home_based') {
    return 'Home studio address *';
  }
  if (profile.businessType === 'salon_team') {
    return 'Salon address *';
  }
  return 'Full address *';
};

const addressVisibilitySummary = (
  visibility: AddressVisibility,
): string => visibility === 'public'
  ? 'Full address public'
  : visibility === 'after_booking'
    ? 'Address after booking'
    : 'City only';

const hasCompleteLocation = (profile: BusinessProfileDraft): boolean =>
  profile.businessType === 'mobile'
    ? Boolean(profile.location.cityOrArea.trim())
    : Boolean(
      profile.location.cityOrArea.trim()
      && profile.location.exactAddress.trim()
      && profile.location.addressVisibility,
    );

export function LocationContactScreen({
  contactSetupConfirmed = false,
  onBack,
  onContactConfirmed,
  onContinue,
  onProfileChange,
  onValidationFailure,
  profile,
}: LocationContactScreenProps) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const isShortPhone = useMediaQuery('(max-width: 479px) and (max-height: 700px)');
  const [openCard, setOpenCard] = useState<CardId | null>(() =>
    isShortPhone && hasCompleteLocation(profile) ? null : 'location');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editingInstagram, setEditingInstagram] = useState(false);
  const [contactConfirmed, setContactConfirmed] = useState(
    contactSetupConfirmed || !profile.bookingOnlyContact,
  );
  const mobileBusiness = profile.businessType === 'mobile';
  const instagram = resolveInstagramUsername(profile.instagram);
  const instagramError = getInstagramInputError(profile.instagram);
  const emailError = emailLooksValid(profile.email)
    ? undefined
    : 'Enter a valid email address.';

  const updateLocation = (patch: Partial<BusinessProfileDraft['location']>) => {
    onProfileChange({ location: { ...profile.location, ...patch } });
  };

  const rawAvailableMethods = getAvailableContactMethods(profile);
  const availableMethods = rawAvailableMethods.filter(method =>
    method !== 'email' || !emailError);
  const hasPreferredContact = profile.preferredContact
    ? availableMethods.includes(profile.preferredContact)
    : false;
  const contactValid = profile.bookingOnlyContact || (
    availableMethods.length === 1 || hasPreferredContact
  );
  const contactComplete = contactConfirmed && contactValid;
  const locationComplete = hasCompleteLocation(profile);
  const arrivalComplete = Boolean(
    profile.location.parking.trim()
    || profile.location.entranceInstructions.trim()
    || profile.location.transitInformation.trim(),
  );

  const availableContactOptions = CONTACT_METHODS.filter(({ value }) =>
    availableMethods.includes(value));
  const locationSummary = profile.location.cityOrArea.trim()
    ? mobileBusiness
      ? `${profile.location.cityOrArea.trim()} · Mobile service area`
      : `${profile.location.cityOrArea.trim()} · ${addressVisibilitySummary(profile.location.addressVisibility)}`
    : mobileBusiness
      ? 'Add your primary service area'
      : 'Add your city and address';
  const preferredLabel = CONTACT_METHODS.find(
    ({ value }) => value === profile.preferredContact,
  )?.label;
  const preferredDetail = profile.preferredContact === 'text'
    ? profile.clientContact.useDifferentTextNumber
      ? profile.clientContact.differentTextNumber.trim()
      : profile.clientContact.primaryNumber.trim()
    : profile.preferredContact === 'call'
      ? profile.clientContact.primaryNumber.trim()
      : profile.preferredContact === 'instagram' && instagram.status === 'resolved'
        ? `@${instagram.username}`
        : profile.preferredContact === 'email'
          ? profile.email.trim()
          : '';
  const contactSummary = !contactConfirmed
    ? 'Add phone or email, or use online booking only'
    : profile.bookingOnlyContact
      ? 'Online booking only'
      : contactComplete && preferredLabel
        ? `${preferredLabel} preferred${preferredDetail ? ` · ${preferredDetail}` : ''}`
        : availableMethods.length === 1
          ? `${CONTACT_METHODS.find(({ value }) => value === availableMethods[0])?.label} added`
          : 'Choose how clients can reach you';

  const revealError = (fieldId: string) => {
    const card: CardId = fieldId === 'contact'
      || fieldId === 'email'
      || fieldId === 'instagram'
      || fieldId === 'preferredContact'
      ? 'contact'
      : 'location';
    setOpenCard(card);
    if (fieldId === 'instagram') {
      setEditingInstagram(true);
    }
    window.requestAnimationFrame(() => {
      const panel = formRef.current?.querySelector<HTMLElement>(
        `#onboarding-${card}-card-panel`,
      );
      const target = fieldId === 'cityOrArea'
        ? panel?.querySelector<HTMLElement>('[autocomplete="address-level2"]')
        : fieldId === 'exactAddress'
          ? panel?.querySelector<HTMLElement>('[autocomplete="street-address"]')
          : fieldId === 'preferredContact'
            ? panel?.querySelector<HTMLElement>('[name="public-contact-method"]')
            : fieldId === 'instagram'
              ? panel?.querySelector<HTMLElement>('[data-instagram-input]')
              : panel?.querySelector<HTMLElement>('[aria-invalid="true"], input, button');
      if (target) {
        focusAndRevealControl(target, target);
      }
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!profile.location.cityOrArea.trim()) {
      nextErrors.cityOrArea = mobileBusiness
        ? 'Add your primary service area.'
        : 'Add your city.';
    }
    if (!mobileBusiness && !profile.location.exactAddress.trim()) {
      nextErrors.exactAddress = 'Add the address clients will use for appointments.';
    }
    if (instagramError) {
      nextErrors.instagram = instagramError;
    }
    if (emailError) {
      nextErrors.email = emailError;
    }
    if (!contactConfirmed) {
      nextErrors.contact = 'Choose online booking only or add a direct contact method.';
    } else if (!profile.bookingOnlyContact && availableMethods.length === 0) {
      nextErrors.contact = 'Add at least one usable contact method or choose Online booking only.';
    } else if (!profile.bookingOnlyContact
      && availableMethods.length > 1
      && !hasPreferredContact) {
      nextErrors.preferredContact = 'Choose which contact method should appear first.';
    }
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      onValidationFailure?.(failedFields);
      revealError(failedFields[0] ?? 'cityOrArea');
      return;
    }
    if (!profile.bookingOnlyContact && availableMethods.length === 1) {
      onProfileChange({ preferredContact: availableMethods[0] ?? null });
    }
    onContinue();
  };

  const selectContactMode = (bookingOnlyContact: boolean) => {
    setContactConfirmed(true);
    onContactConfirmed?.();
    setErrors(current => ({
      ...current,
      contact: '',
      preferredContact: '',
    }));
    onProfileChange({
      bookingOnlyContact,
      preferredContact: bookingOnlyContact
        ? profile.preferredContact
        : getCoherentPreferredContact({ ...profile, bookingOnlyContact }),
    });
  };

  return (
    <section
      aria-labelledby="location-contact-heading"
      className="onboarding-screen onboarding-location-contact-screen onboarding-location-contact-v2"
    >
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Step 3 — Location &amp; contact</p>
        <h1 id="location-contact-heading">Where can clients find you?</h1>
        <p>Add your location and choose what clients can see.</p>
      </header>

      <form id={formId} noValidate ref={formRef} onSubmit={submit}>
        <ValidationSummary errors={errors} onSelectError={revealError} />
        <CollapsibleFormCard
          collapsedActionLabel="Edit"
          completed={locationComplete}
          errorCount={[errors.cityOrArea, errors.exactAddress].filter(Boolean).length}
          id="onboarding-location-card"
          open={openCard === 'location'}
          summary={locationSummary}
          title="Location"
          onToggle={() => setOpenCard(current => current === 'location' ? null : 'location')}
        >
          <p className="onboarding-location-contact-v2__intro">
            Choose your business location and what clients can see.
          </p>
          <div className="onboarding-location-contact-v2__fields">
            <TextField
              autoComplete="address-level2"
              error={errors.cityOrArea}
              label={mobileBusiness ? 'Primary service area *' : 'City *'}
              required
              value={profile.location.cityOrArea}
              onChange={(event) => {
                setErrors(current => ({ ...current, cityOrArea: '' }));
                updateLocation({
                  allowGeneralAreaDirections: mobileBusiness,
                  cityOrArea: event.target.value,
                  ...(mobileBusiness ? { addressVisibility: 'public' } : {}),
                });
              }}
            />
            {mobileBusiness
              ? (
                  <TextAreaField
                    label="Areas you serve · Optional"
                    value={profile.location.serviceAreas ?? ''}
                    onChange={event => updateLocation({ serviceAreas: event.target.value })}
                  />
                )
              : (
                  <AddressSearchField
                    city={profile.location.cityOrArea}
                    error={errors.exactAddress}
                    label={locationAddressLabel(profile)}
                    value={profile.location.exactAddress}
                    onChange={(value) => {
                      setErrors(current => ({ ...current, exactAddress: '' }));
                      updateLocation({ exactAddress: value });
                    }}
                    onSelect={(suggestion) => {
                      setErrors(current => ({ ...current, cityOrArea: '', exactAddress: '' }));
                      updateLocation({ exactAddress: suggestion.address, cityOrArea: suggestion.city });
                    }}
                  />
                )}
          </div>

          {!mobileBusiness
            ? (
                <fieldset className="onboarding-address-visibility">
                  <legend>What should clients see? *</legend>
                  <p>This controls how your location appears across your site and map.</p>
                  <div>
                    {ADDRESS_VISIBILITY_OPTIONS.map(option => (
                      <label key={option.value}>
                        <input
                          checked={profile.location.addressVisibility === option.value}
                          name="address-visibility"
                          type="radio"
                          value={option.value}
                          onChange={() => updateLocation({
                            addressVisibility: option.value,
                            allowGeneralAreaDirections: option.value === 'hidden',
                          })}
                        />
                        <span>
                          <span className="onboarding-address-visibility__check" aria-hidden="true">
                            {profile.location.addressVisibility === option.value ? '✓' : ''}
                          </span>
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                          <em>{option.note}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            : (
                <p className="onboarding-mobile-location-note">
                  Your customer site and map will show your service area, not a salon address.
                </p>
              )}
          {isShortPhone
            ? (
                <button
                  className="onboarding-location-contact-v2__done"
                  disabled={!locationComplete}
                  type="button"
                  onClick={() => setOpenCard(null)}
                >
                  Done editing location
                </button>
              )
            : null}
        </CollapsibleFormCard>

        <CollapsibleFormCard
          collapsedActionLabel={contactConfirmed ? 'Edit' : 'Choose'}
          completed={contactComplete && !instagramError && !emailError}
          errorCount={[errors.contact, errors.email, errors.instagram, errors.preferredContact]
            .filter(Boolean).length}
          id="onboarding-contact-card"
          open={openCard === 'contact'}
          summary={contactSummary}
          title="Contact"
          onToggle={() => setOpenCard(current => current === 'contact' ? null : 'contact')}
        >
          <fieldset className="onboarding-contact-mode">
            <legend>How should clients reach you?</legend>
            <label>
              <input
                checked={contactConfirmed && profile.bookingOnlyContact}
                name="contact-mode"
                type="radio"
                onChange={() => selectContactMode(true)}
              />
              <span>
                <strong>Online booking only</strong>
                <small>Clients use your Luster booking page to book with you.</small>
              </span>
            </label>
            <label>
              <input
                checked={contactConfirmed && !profile.bookingOnlyContact}
                name="contact-mode"
                type="radio"
                onChange={() => selectContactMode(false)}
              />
              <span>
                <strong>Let clients contact me directly</strong>
                <small>Choose which phone, text, email or Instagram details clients can use.</small>
              </span>
            </label>
          </fieldset>

          {!profile.bookingOnlyContact
            ? (
                <div className="onboarding-direct-contact-fields">
                  <TextField
                    autoComplete="tel"
                    error={errors.contact}
                    label="Phone number"
                    type="tel"
                    value={profile.clientContact.primaryNumber}
                    onChange={(event) => {
                      setErrors(current => ({ ...current, contact: '', preferredContact: '' }));
                      const clientContact = {
                        ...profile.clientContact,
                        primaryNumber: event.target.value,
                      };
                      onProfileChange({
                        clientContact,
                        preferredContact: getCoherentPreferredContact({ ...profile, clientContact }),
                      });
                    }}
                  />
                  <NativeSwitch
                    checked={profile.clientContact.callEnabled}
                    description="Show a Call action on your customer site."
                    label="Clients can call this number"
                    onChange={(callEnabled) => {
                      const clientContact = { ...profile.clientContact, callEnabled };
                      onProfileChange({
                        clientContact,
                        preferredContact: getCoherentPreferredContact({ ...profile, clientContact }),
                      });
                    }}
                  />
                  <NativeSwitch
                    checked={profile.clientContact.textEnabled}
                    description="Show a Text action on your customer site."
                    label="Clients can text this number"
                    onChange={(textEnabled) => {
                      const clientContact = { ...profile.clientContact, textEnabled };
                      onProfileChange({
                        clientContact,
                        preferredContact: getCoherentPreferredContact({ ...profile, clientContact }),
                      });
                    }}
                  />
                  {profile.clientContact.textEnabled
                    ? (
                        <NativeSwitch
                          checked={profile.clientContact.useDifferentTextNumber}
                          description="Keep calls on the primary number and route texts somewhere else."
                          label="Use a different number for texts"
                          onChange={useDifferentTextNumber => onProfileChange({
                            clientContact: { ...profile.clientContact, useDifferentTextNumber },
                          })}
                        />
                      )
                    : null}
                  {profile.clientContact.textEnabled
                  && profile.clientContact.useDifferentTextNumber
                    ? (
                        <TextField
                          autoComplete="tel"
                          label="Text message number"
                          type="tel"
                          value={profile.clientContact.differentTextNumber}
                          onChange={event => onProfileChange({
                            clientContact: {
                              ...profile.clientContact,
                              differentTextNumber: event.target.value,
                            },
                          })}
                        />
                      )
                    : null}
                  <TextField
                    autoComplete="email"
                    error={errors.email || emailError}
                    label="Email · Optional"
                    type="email"
                    value={profile.email}
                    onChange={(event) => {
                      setErrors(current => ({ ...current, email: '', preferredContact: '' }));
                      const email = event.target.value;
                      onProfileChange({
                        email,
                        preferredContact: getCoherentPreferredContact({ ...profile, email }),
                      });
                    }}
                  />
                </div>
              )
            : null}

          <div className="onboarding-shared-instagram">
            <div>
              <span>Instagram</span>
              <strong>
                {instagram.status === 'resolved'
                  ? `@${instagram.username}`
                  : profile.instagram.trim() || 'Not added'}
              </strong>
              <small>{instagram.status === 'resolved' ? '✓ Saved' : 'Add this on Your Business or edit it here.'}</small>
            </div>
            <button type="button" onClick={() => setEditingInstagram(current => !current)}>
              {editingInstagram ? 'Done' : 'Edit'}
            </button>
          </div>
          {editingInstagram
            ? (
                <TextField
                  data-instagram-input
                  error={errors.instagram || instagramError}
                  hint="Enter a username or paste an Instagram profile link."
                  label="Instagram handle"
                  value={profile.instagram}
                  onBlur={() => {
                    if (instagram.status === 'resolved' && instagram.username !== profile.instagram) {
                      onProfileChange({ instagram: instagram.username });
                    }
                  }}
                  onChange={(event) => {
                    setErrors(current => ({ ...current, instagram: '', preferredContact: '' }));
                    onProfileChange({ instagram: event.target.value });
                  }}
                />
              )
            : null}

          {!profile.bookingOnlyContact && availableContactOptions.length > 1
            ? (
                <ChoiceGroup
                  error={errors.preferredContact}
                  legend="Which contact method should appear first?"
                  name="public-contact-method"
                  options={availableContactOptions}
                  value={profile.preferredContact}
                  onChange={(preferredContact) => {
                    setErrors(current => ({ ...current, preferredContact: '' }));
                    onProfileChange({ preferredContact });
                  }}
                />
              )
            : null}
          {errors.contact ? <p className="onboarding-field__error">{errors.contact}</p> : null}
        </CollapsibleFormCard>

        <CollapsibleFormCard
          completed={false}
          id="onboarding-arrival-card"
          open={openCard === 'arrival'}
          status="optional"
          summary={arrivalComplete
            ? 'Arrival instructions added'
            : 'Parking, entrance or transit instructions'}
          title="Arrival details"
          onToggle={() => setOpenCard(current => current === 'arrival' ? null : 'arrival')}
        >
          <p className="onboarding-location-contact-v2__intro">
            Parking, entrance or transit instructions for clients.
          </p>
          <TextField
            label="Parking"
            value={profile.location.parking}
            onChange={event => updateLocation({ parking: event.target.value })}
          />
          <TextAreaField
            label="Entrance instructions"
            value={profile.location.entranceInstructions}
            onChange={event => updateLocation({ entranceInstructions: event.target.value })}
          />
          <TextField
            label="Transit information"
            value={profile.location.transitInformation}
            onChange={event => updateLocation({ transitInformation: event.target.value })}
          />
          {profile.location.addressVisibility !== 'public' && !mobileBusiness
            ? (
                <p className="onboarding-private-arrival-note">
                  These details follow your address privacy choice and stay hidden while clients browse.
                </p>
              )
            : null}
        </CollapsibleFormCard>
      </form>

      <StickyOnboardingActions
        formId={formId}
        onBack={onBack}
        primaryFirst
        primaryLabel="Save and continue"
      />
    </section>
  );
}
