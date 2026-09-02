import {
  BriefcaseBusiness,
  Camera,
  CarFront,
  Check,
  House,
  Image,
  Instagram,
  Store,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import { WeeklyHoursEditor } from '../components/WeeklyHoursEditor';
import { SCREEN_METADATA } from '../copy';
import { useFeedback } from '../feedback/useFeedback';
import { resolveOnboardingImage } from '../integrations/adapters/media';
import {
  BUSINESS_TYPE_OPTIONS,
  deriveLegacyBusinessFields,
  isPersonalBusinessType,
  normalizeSiteSlug,
  normalizeSiteSlugInput,
  siteUrlForSlug,
  validateSiteSlug,
} from '../model/business-identity';
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
  LocationType,
  OnboardingBusinessType,
  PreferredContactMethod,
  QuickBookProfileVisibilityDraft,
  StarterId,
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
import '../your-business.css';

type ProfilePatch = Partial<BusinessProfileDraft>;

type SharedBasicsScreenProps = {
  onBack: () => void;
  onProfileChange: (patch: ProfilePatch) => void;
  profile: BusinessProfileDraft;
};

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

type BrandBasicsScreenProps = SharedBasicsScreenProps & {
  onContinue: () => void;
  onLogoSelected: (file: File) => Promise<void>;
  onProfilePhotoSelected: (file: File) => Promise<void>;
  onQuickBookProfileChange?: (patch: Partial<QuickBookProfileVisibilityDraft>) => void;
  onValidationFailure?: (fieldIds: string[]) => void;
  reveal?: boolean;
  starter: StarterId | null;
};

export function BrandBasicsScreen({
  onBack,
  onContinue,
  onLogoSelected,
  onProfileChange,
  onProfilePhotoSelected,
  onQuickBookProfileChange,
  onValidationFailure,
  profile,
  reveal = false,
}: BrandBasicsScreenProps) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const feedback = useFeedback();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editingSlug, setEditingSlug] = useState(profile.siteSlugCustomized);

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
  const personalBusiness = isPersonalBusinessType(profile.businessType);
  const effectiveSlug = profile.siteSlugCustomized
    ? profile.siteSlug
    : normalizeSiteSlug(profile.businessName);
  const slugError = validateSiteSlug(effectiveSlug);
  const basicsComplete = Boolean(
    profile.businessName.trim()
    && profile.businessType
    && (!personalBusiness || profile.ownerName.trim()),
  );
  const previousBasicsCompleteRef = useRef(basicsComplete);
  useEffect(() => {
    if (!previousBasicsCompleteRef.current && basicsComplete) {
      feedback.send({
        kind: 'completed',
        message: 'Your basics are in place',
        onceKey: 'brand_basics_saved',
      });
    }
    previousBasicsCompleteRef.current = basicsComplete;
  }, [basicsComplete, feedback]);

  const instagramConnected = instagramResolution.status === 'resolved'
    && instagramResolution.username.length > 0;
  const previousInstagramConnectedRef = useRef(instagramConnected);
  useEffect(() => {
    if (!previousInstagramConnectedRef.current && instagramConnected) {
      feedback.send({
        kind: 'added',
        message: 'Instagram connected',
        onceKey: 'instagram_connected',
      });
    }
    previousInstagramConnectedRef.current = instagramConnected;
  }, [feedback, instagramConnected]);

  const commitInstagram = () => {
    if (
      instagramResolution.status === 'resolved'
      && instagramResolution.username !== profile.instagram
    ) {
      onProfileChange({ instagram: instagramResolution.username });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!profile.businessName.trim()) nextErrors.businessName = 'Add your salon or studio name.';
    if (!profile.businessType) nextErrors.businessType = 'Choose what best describes your business.';
    if (personalBusiness && !profile.ownerName.trim()) nextErrors.ownerName = 'Add your name.';
    if (profile.businessName.trim() && slugError) nextErrors.siteSlug = slugError;
    if (instagramError) nextErrors.instagram = instagramError;
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      onValidationFailure?.(failedFields);
      window.requestAnimationFrame(() => {
        if (formRef.current) focusFirstInvalidControl(formRef.current);
      });
      return;
    }
    commitInstagram();
    if (!profile.siteSlugCustomized && profile.siteSlug !== effectiveSlug) {
      onProfileChange({ siteSlug: effectiveSlug });
    }
    onContinue();
  };

  const updateVisibility = (
    element: 'instagram' | 'owner_name' | 'profile_photo',
    quickBookKey: 'showInstagram' | 'showTechName' | 'showTechPhoto',
    checked: boolean,
  ) => {
    onProfileChange({
      about: {
        ...profile.about,
        visibility: { ...profile.about.visibility, [element]: checked },
      },
    });
    onQuickBookProfileChange?.({ [quickBookKey]: checked });
  };

  const selectBusinessType = (businessType: OnboardingBusinessType) => {
    const derived = deriveLegacyBusinessFields(businessType);
    setErrors((current) => ({ ...current, businessType: '', ownerName: '' }));
    onProfileChange({
      businessStructure: derived.businessStructure,
      businessType,
      location: {
        ...profile.location,
        ...(derived.addressVisibility
          ? { addressVisibility: derived.addressVisibility }
          : {}),
        locationType: derived.locationType,
      },
    });
  };

  const changeBusinessName = (businessName: string) => {
    setErrors((current) => ({ ...current, businessName: '', siteSlug: '' }));
    onProfileChange({
      businessName,
    });
  };

  return (
    <section
      aria-labelledby="business-screen-heading"
      className={`onboarding-screen onboarding-business-screen onboarding-your-business-screen${reveal ? ' is-revealing' : ''}`}
    >
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Your business</p>
        <h1 id="business-screen-heading">Let’s start with your business</h1>
        <p>Tell us a few basics and we’ll start building your site.</p>
      </header>
      <form id={formId} noValidate ref={formRef} onSubmit={submit}>
          <ValidationSummary errors={errors} />
          <section className="onboarding-business-card is-expanded">
            <header><Store aria-hidden="true" size={22} /><div><h2>Business name</h2><p>The name of your salon or nail business.</p></div></header>
            <TextField autoComplete="organization" error={errors.businessName} label="Salon or studio name *" required value={profile.businessName} onChange={(event) => changeBusinessName(event.target.value)} />
            {profile.businessName.trim() ? (
              <div className="onboarding-site-url">
                <div><span>Your Luster URL</span>{editingSlug ? (
                  <button type="button" onClick={() => { setEditingSlug(false); onProfileChange({ siteSlug: normalizeSiteSlug(profile.businessName), siteSlugCustomized: false }); }}>Use suggested URL</button>
                ) : <button type="button" onClick={() => setEditingSlug(true)}>Change URL</button>}</div>
                {editingSlug ? (
                  <label><span>lustergel.app/</span><input aria-label="Custom Luster URL" aria-invalid={errors.siteSlug ? 'true' : undefined} value={effectiveSlug} onChange={(event) => { const siteSlug = normalizeSiteSlugInput(event.target.value); setErrors((current) => ({ ...current, siteSlug: '' })); onProfileChange({ siteSlug, siteSlugCustomized: true }); }} /></label>
                ) : <strong>{siteUrlForSlug(effectiveSlug)}</strong>}
                {errors.siteSlug ? <p className="onboarding-field__error">{errors.siteSlug}</p> : !slugError ? <p className="onboarding-site-url__valid"><Check aria-hidden="true" size={14} /> This URL looks good <small>Final availability is confirmed when you save.</small></p> : null}
              </div>
            ) : null}
          </section>

          <fieldset className={`onboarding-business-card onboarding-business-type${errors.businessType ? ' has-error' : ''}`} aria-invalid={errors.businessType ? 'true' : undefined}>
            <legend>Which best describes your business?</legend>
            <p>Choose the option that fits you best.</p>
            <div>
              {BUSINESS_TYPE_OPTIONS.map((option) => {
                const Icon = option.id === 'independent_salon' ? BriefcaseBusiness : option.id === 'home_based' ? House : option.id === 'mobile' ? CarFront : UsersRound;
                return <label key={option.id}><input checked={profile.businessType === option.id} name="business-type" type="radio" value={option.id} onChange={() => selectBusinessType(option.id)} /><span><Icon aria-hidden="true" size={25} /><strong>{option.label}</strong><small>{option.description}</small>{profile.businessType === option.id ? <Check aria-hidden="true" className="onboarding-business-type__check" size={15} /> : null}</span></label>;
              })}
            </div>
            {errors.businessType ? <p className="onboarding-field__error">{errors.businessType}</p> : null}
          </fieldset>

          {personalBusiness ? (
            <section className="onboarding-business-card onboarding-business-card--split">
              <header><UserRound aria-hidden="true" size={22} /><div><h2>Your name</h2><p>Your name helps clients know who they’re booking with.</p></div></header>
              <TextField autoComplete="name" error={errors.ownerName} label="Your name *" required value={profile.ownerName} onChange={(event) => { setErrors((current) => ({ ...current, ownerName: '' })); onProfileChange({ ownerName: event.target.value }); }} />
              <NativeSwitch checked={profile.about.visibility.owner_name} description="Your name can appear with your business on your booking site." label="Show my name to clients" onChange={(checked) => updateVisibility('owner_name', 'showTechName', checked)} />
            </section>
          ) : null}

          {personalBusiness ? (
            <section className="onboarding-business-card onboarding-business-card--split">
              <header><Camera aria-hidden="true" size={22} /><div><h2>Profile photo <span>Optional</span></h2><p>Add a photo of yourself for your nail-tech profile.</p></div></header>
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
              <NativeSwitch checked={profile.about.visibility.profile_photo} description="Your photo can appear in your nail-tech profile." label="Show my photo to clients" onChange={(checked) => updateVisibility('profile_photo', 'showTechPhoto', checked)} />
            </section>
          ) : null}

          <section className="onboarding-business-card">
            <header><Image aria-hidden="true" size={22} /><div><h2>Logo <span>Optional</span></h2><p>Your business logo appears in your site header.</p></div></header>
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
          </section>

          <section className="onboarding-business-card onboarding-business-card--split">
            <header><Instagram aria-hidden="true" size={22} /><div><h2>Instagram <span>Optional</span></h2><p>Add your Instagram so clients can find your work.</p></div></header>
            <TextField
              autoComplete="off"
              data-instagram-input
              error={errors.instagram || instagramError}
              hint="Enter a username or paste an Instagram profile link."
              label="Instagram handle"
              value={profile.instagram}
              onBlur={commitInstagram}
              onChange={(event) => {
                setErrors((current) => ({ ...current, instagram: '' }));
                onProfileChange({ instagram: event.target.value });
              }}
            />
            <NativeSwitch checked={profile.about.visibility.instagram} description="Your Instagram link can appear on your booking site." label="Show Instagram to clients" onChange={(checked) => updateVisibility('instagram', 'showInstagram', checked)} />
          </section>
      </form>
      <p className="onboarding-business-reassurance">You can change all of this later.</p>
      <StickyOnboardingActions
        formId={formId}
        onBack={onBack}
        primaryFirst
        primaryLabel="Show me my site →"
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
  const hoursStatus = getWeeklyHoursPreviewStatus(
    profile.hours,
    previewTimestamp,
    profile.timeZone,
  );

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
