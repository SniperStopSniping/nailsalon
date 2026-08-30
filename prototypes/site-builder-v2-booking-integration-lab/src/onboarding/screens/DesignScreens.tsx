import {
  Check,
  FileImage,
  Images,
  Sparkles,
} from 'lucide-react';
import {
  useId,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

import type { SiteBuilderDocument } from '../../model/types';
import { Dialog } from '../../ui/Dialog';
import {
  CollapsibleFormCard,
  NativeSwitch,
  TextAreaField,
  TextField,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { SCREEN_METADATA } from '../copy';
import { recordOnboardingEvent } from '../events/journal';
import { useFeedback } from '../feedback/useFeedback';
import {
  buildAboutWordingSuggestion,
  formatAboutListInput,
  parseAboutListInput,
} from '../model/about';
import {
  getInstagramInputError,
  resolveInstagramUsername,
} from '../model/contact';
import {
  deriveDepositsAndCancellationsSummary,
  deriveDepositPolicySummary,
  derivePolicySuggestedWording,
  getDepositsAndCancellationsDisplayWording,
  getDepositPolicyMode,
  getLateCancellationChoice,
  getResolvedPolicyWording,
  hasMeaningfulPublishablePolicies,
  isDepositsAndCancellationsComplete,
  isDepositsAndCancellationsVisible,
  isPolicySectionComplete,
  LATE_CANCELLATION_CUSTOM_WORDING,
  refreshPolicySuggestedWording,
  type LateCancellationChoice,
  updateDepositDraft,
} from '../model/policies';
import { SITE_PALETTE_PRESETS } from '../model/palettes';
import { SITE_STYLE_PRESETS } from '../model/site-styles';
import type {
  AboutElementId,
  AboutPresetId,
  BusinessProfileDraft,
  OnboardingLabState,
  PoliciesDraft,
  PolicySectionId,
} from '../model/types';
import {
  ONBOARDING_STYLE_ROLES,
  OnboardingSitePreview,
} from '../preview/OnboardingSitePreview';

export type OnboardingStateUpdater = (
  update: (current: OnboardingLabState) => OnboardingLabState,
) => void;

type SharedScreenProps = {
  onBack: () => void;
  onUpdate: OnboardingStateUpdater;
  state: OnboardingLabState;
};

const SPECIALTY_OPTIONS = [
  'Russian Manicure',
  'BIAB',
  'Gel-X',
  'Hard Gel',
  'Nail Art',
  'Pedicures',
  'Natural Nail Care',
] as const;

const ABOUT_PRESETS: Array<{
  description: string;
  id: AboutPresetId;
  label: string;
}> = [
  { description: 'Organized details beside a polished portrait.', id: 'photo_right', label: 'Photo Right' },
  { description: 'A larger portrait with biography-led typography.', id: 'editorial_portrait', label: 'Editorial Portrait' },
  { description: 'Profile, biography, and an easy-to-scan fact grid.', id: 'profile_quick_facts', label: 'Profile + Quick Facts' },
  { description: 'Your story paired with booking and policy details.', id: 'about_before_you_book', label: 'About + Before You Book' },
];

function AboutPresetPoster({
  preset,
  state,
}: {
  preset: AboutPresetId;
  state: OnboardingLabState;
}) {
  const initials = (state.profile.ownerName || state.profile.businessName || 'L')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const name = state.profile.ownerName.trim() || 'Your name';
  const specialties = state.profile.about.specialties.slice(0, 2);

  return (
    <span className={`onboarding-about-poster is-${preset}`} aria-hidden="true">
      <i className="onboarding-about-poster__portrait">{initials || 'L'}</i>
      <i className="onboarding-about-poster__copy">
        <b>{name}</b>
        <span />
        <span />
        {specialties.length > 0 ? <em>{specialties.join(' · ')}</em> : null}
      </i>
      <i className="onboarding-about-poster__facts"><span /><span /><span /><span /></i>
      <i className="onboarding-about-poster__booking"><b>Before you book</b><span /><span /><span /></i>
      <i className="onboarding-about-poster__action">Book now</i>
    </span>
  );
}

const updateProfile = (
  current: OnboardingLabState,
  update: (profile: BusinessProfileDraft) => BusinessProfileDraft,
): OnboardingLabState => ({ ...current, profile: update(current.profile) });

const sameStringList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

function ScreenHeading({ id, status }: { id: keyof typeof SCREEN_METADATA; status?: string }) {
  const metadata = SCREEN_METADATA[id];
  return (
    <header className="onboarding-screen-heading">
      {status ? <span className="onboarding-screen-status">{status}</span> : null}
      <h1>{metadata.heading}</h1>
      <p>{metadata.supportingCopy}</p>
    </header>
  );
}

function AboutFieldVisibility({
  description,
  id,
  label,
  onUpdate,
  state,
}: Pick<SharedScreenProps, 'onUpdate' | 'state'> & {
  description?: string;
  id: AboutElementId;
  label: string;
}) {
  return (
    <NativeSwitch
      checked={state.profile.about.visibility[id]}
      description={description}
      label={label}
      onChange={(checked) => onUpdate((current) => updateProfile(current, (profile) => ({
        ...profile,
        about: {
          ...profile.about,
          visibility: { ...profile.about.visibility, [id]: checked },
        },
      })))}
    />
  );
}

export function AboutScreen({
  document: siteDocument,
  onBack,
  onContinue,
  onFullPreview,
  onWritingHelperOpenChange,
  onUpdate,
  state,
}: SharedScreenProps & {
  document?: SiteBuilderDocument | null;
  onContinue: () => void;
  onFullPreview: () => void;
  onWritingHelperOpenChange?: (open: boolean) => void;
}) {
  const { about } = state.profile;
  const helperSuggestionId = useId();
  const aboutDisabledMessageId = useId();
  const aboutFieldsRef = useRef<HTMLFieldSetElement>(null);
  const setupDetailsRef = useRef<HTMLDetailsElement>(null);
  const helperTriggerRef = useRef<HTMLButtonElement>(null);
  const [certificationsInput, setCertificationsInput] = useState(() =>
    formatAboutListInput(about.certifications));
  const [languagesInput, setLanguagesInput] = useState(() =>
    formatAboutListInput(about.languages));
  const [customSpecialtiesInput, setCustomSpecialtiesInput] = useState(() =>
    formatAboutListInput(about.specialties.filter((item) =>
      !SPECIALTY_OPTIONS.includes(item as typeof SPECIALTY_OPTIONS[number]))));
  const certificationsInputRef = useRef(certificationsInput);
  const languagesInputRef = useRef(languagesInput);
  const customSpecialtiesInputRef = useRef(customSpecialtiesInput);
  const certificationsDirtyRef = useRef(false);
  const languagesDirtyRef = useRef(false);
  const customSpecialtiesDirtyRef = useRef(false);
  const [writingSuggestion, setWritingSuggestion] = useState<string | null>(null);
  const [helperNotice, setHelperNotice] = useState<string | null>(null);
  const [undoBio, setUndoBio] = useState<{ applied: string; before: string } | null>(null);
  const appointmentStatus = state.profile.bookingPreferences.visitMode === 'appointment_only'
    ? 'Appointment only'
    : state.profile.bookingPreferences.visitMode === 'walk_ins_only'
      ? 'Walk-ins only'
      : state.profile.bookingPreferences.visitMode === 'appointments_and_walk_ins'
        ? 'Appointments and walk-ins'
        : 'Not answered yet';
  const newClientStatus = state.profile.bookingPreferences.newClientStatus === 'yes'
    ? 'Accepting new clients'
    : state.profile.bookingPreferences.newClientStatus === 'no'
      ? 'Not accepting new clients'
      : state.profile.bookingPreferences.newClientStatus === 'ask_first'
        ? 'New clients should ask first'
        : state.profile.bookingPreferences.newClientStatus === 'waitlist_only'
          ? 'Waitlist only'
          : 'Not answered yet';
  const instagramResolution = resolveInstagramUsername(state.profile.instagram);
  const instagramError = getInstagramInputError(state.profile.instagram);

  useEffect(() => () => onWritingHelperOpenChange?.(false), [onWritingHelperOpenChange]);

  const focusShortBio = () => window.requestAnimationFrame(() => {
    aboutFieldsRef.current
      ?.querySelector<HTMLTextAreaElement>('[data-about-primary-control]')
      ?.focus({ preventScroll: true });
  });

  const commitListInput = (
    field: 'certifications' | 'languages',
    rawValue: string,
  ) => {
    const parsed = parseAboutListInput(rawValue);
    if (field === 'certifications') certificationsDirtyRef.current = false;
    else languagesDirtyRef.current = false;
    onUpdate((current) => {
      if (sameStringList(current.profile.about[field], parsed)) return current;
      return updateProfile(current, (profile) => ({
        ...profile,
        about: { ...profile.about, [field]: parsed },
      }));
    });
  };
  const commitListInputs = () => {
    const certifications = parseAboutListInput(certificationsInputRef.current);
    const languages = parseAboutListInput(languagesInputRef.current);
    const customSpecialties = parseAboutListInput(customSpecialtiesInputRef.current);
    certificationsDirtyRef.current = false;
    languagesDirtyRef.current = false;
    customSpecialtiesDirtyRef.current = false;
    onUpdate((current) => {
      const suggestedSpecialties = current.profile.about.specialties.filter((item) =>
        SPECIALTY_OPTIONS.includes(item as typeof SPECIALTY_OPTIONS[number]));
      const specialties = [...suggestedSpecialties, ...customSpecialties];
      if (
        sameStringList(current.profile.about.certifications, certifications)
        && sameStringList(current.profile.about.languages, languages)
        && sameStringList(current.profile.about.specialties, specialties)
      ) return current;
      return updateProfile(current, (profile) => ({
        ...profile,
        about: { ...profile.about, certifications, languages, specialties },
      }));
    });
  };
  const commitCustomSpecialties = (rawValue: string) => {
    const customSpecialties = parseAboutListInput(rawValue);
    customSpecialtiesDirtyRef.current = false;
    onUpdate((current) => {
      const suggestedSpecialties = current.profile.about.specialties.filter((item) =>
        SPECIALTY_OPTIONS.includes(item as typeof SPECIALTY_OPTIONS[number]));
      const specialties = [...suggestedSpecialties, ...customSpecialties];
      if (sameStringList(current.profile.about.specialties, specialties)) return current;
      return updateProfile(current, (profile) => ({
        ...profile,
        about: { ...profile.about, specialties },
      }));
    });
  };
  useEffect(() => {
    const commitPendingRawLists = () => {
      if (
        !certificationsDirtyRef.current
        && !languagesDirtyRef.current
        && !customSpecialtiesDirtyRef.current
      ) return;
      flushSync(commitListInputs);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') commitPendingRawLists();
    };
    window.addEventListener('pagehide', commitPendingRawLists);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', commitPendingRawLists);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (
        certificationsDirtyRef.current
        || languagesDirtyRef.current
        || customSpecialtiesDirtyRef.current
      ) {
        commitListInputs();
      }
    };
  }, []);
  const commitOnEnter = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    field: 'certifications' | 'languages',
    rawValue: string,
  ) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      commitListInput(field, rawValue);
    }
  };
  const recordHelperAction = (
    action: 'opened' | 'used' | 'kept' | 'undone',
  ) => onUpdate((current) => recordOnboardingEvent(current, {
    action,
    type: 'about_wording_helper',
  }));
  const openWritingSuggestion = () => {
    setWritingSuggestion(buildAboutWordingSuggestion(state.profile));
    setHelperNotice(null);
    onWritingHelperOpenChange?.(true);
    recordHelperAction('opened');
  };
  const useWritingSuggestion = () => {
    if (writingSuggestion === null) return;
    const suggestion = writingSuggestion;
    setUndoBio({ applied: suggestion, before: about.shortBio });
    setWritingSuggestion(null);
    onWritingHelperOpenChange?.(false);
    setHelperNotice('Suggestion added to your short bio.');
    onUpdate((current) => recordOnboardingEvent(
      updateProfile(current, (profile) => ({
        ...profile,
        about: { ...profile.about, shortBio: suggestion },
      })),
      { action: 'used', type: 'about_wording_helper' },
    ));
    focusShortBio();
  };
  const keepExistingBio = () => {
    setWritingSuggestion(null);
    onWritingHelperOpenChange?.(false);
    setHelperNotice('Your existing bio was kept unchanged.');
    recordHelperAction('kept');
  };
  const closeWritingSuggestion = () => {
    setWritingSuggestion(null);
    onWritingHelperOpenChange?.(false);
    setHelperNotice('Suggestion closed. Your bio was not changed.');
  };
  const undoWritingSuggestion = () => {
    if (undoBio === null || about.shortBio !== undoBio.applied) return;
    const previousBio = undoBio.before;
    setUndoBio(null);
    setHelperNotice('Your previous bio was restored.');
    onUpdate((current) => recordOnboardingEvent(
      updateProfile(current, (profile) => ({
        ...profile,
        about: { ...profile.about, shortBio: previousBio },
      })),
      { action: 'undone', type: 'about_wording_helper' },
    ));
    focusShortBio();
  };
  const setAboutEnabled = (checked: boolean) => {
    onUpdate((current) => ({
      ...current,
      recipe: { ...current.recipe, aboutEnabled: checked },
    }));
    if (checked) {
      window.requestAnimationFrame(() => {
        aboutFieldsRef.current
          ?.querySelector<HTMLTextAreaElement>('[data-about-primary-control]')
          ?.focus({ preventScroll: true });
      });
    }
  };
  const commitInstagram = () => {
    if (
      instagramResolution.status !== 'resolved'
      || instagramResolution.username === state.profile.instagram
    ) return;
    onUpdate((current) => updateProfile(current, (profile) => ({
      ...profile,
      instagram: instagramResolution.username,
    })));
  };
  const toggleSpecialty = (specialty: string) => onUpdate((current) => updateProfile(
    current,
    (profile) => ({
      ...profile,
      about: {
        ...profile.about,
        specialties: profile.about.specialties.includes(specialty)
          ? profile.about.specialties.filter((item) => item !== specialty)
          : [...profile.about.specialties, specialty],
      },
    }),
  ));

  return (
    <div className="onboarding-screen onboarding-screen--split" data-screen="about">
      <div className="onboarding-screen__form">
        <ScreenHeading id="about" status="Optional" />
        <NativeSwitch
          checked={state.recipe.aboutEnabled}
          description={state.recipe.aboutEnabled ? 'Shown in customer previews' : 'Not shown on your site'}
          label="Include an About section"
          onChange={setAboutEnabled}
        />
        {!state.recipe.aboutEnabled ? (
          <p
            aria-live="polite"
            className="onboarding-disabled-message"
            id={aboutDisabledMessageId}
            role="status"
          >
            About section is not shown on your site. Your information is still saved.
          </p>
        ) : null}
        <fieldset
          ref={aboutFieldsRef}
          aria-describedby={!state.recipe.aboutEnabled ? aboutDisabledMessageId : undefined}
          className="onboarding-about-fields"
          disabled={!state.recipe.aboutEnabled}
        >
          <legend className="visually-hidden">About section details</legend>
          <TextAreaField
            data-about-primary-control
            hint="A quick introduction shown near the top of your About section."
            label="Short bio"
            maxLength={320}
            rows={4}
            value={about.shortBio}
            onChange={(event) => {
              if (undoBio !== null) {
                setUndoBio(null);
                setHelperNotice('Your bio changed, so the earlier suggestion can no longer be undone.');
              }
              const shortBio = event.target.value;
              onUpdate((current) => updateProfile(current, (profile) => ({
                ...profile,
                about: { ...profile.about, shortBio },
              })));
            }}
          />
          <button
            ref={helperTriggerRef}
            aria-controls={helperSuggestionId}
            aria-expanded={writingSuggestion !== null}
            className="onboarding-prototype-helper"
            type="button"
            onClick={openWritingSuggestion}
          >
            <Sparkles aria-hidden="true" size={16} /> Help me with wording <span>Preview wording</span>
          </button>
          {helperNotice ? (
            <div className="onboarding-writing-suggestion__notice">
              <p aria-live="polite" role="status">{helperNotice}</p>
              {undoBio !== null ? (
                <button type="button" onClick={undoWritingSuggestion}>Undo suggestion</button>
              ) : null}
            </div>
          ) : null}
          <div className="onboarding-about-field-with-visibility">
            <fieldset className="onboarding-chip-fieldset">
              <legend>Specialties</legend>
              <div className="onboarding-chip-list">
                {SPECIALTY_OPTIONS.map((specialty) => (
                  <label className="onboarding-chip" key={specialty}>
                    <input
                      checked={about.specialties.includes(specialty)}
                      type="checkbox"
                      onChange={() => toggleSpecialty(specialty)}
                    />
                    <span>{specialty}</span>
                  </label>
                ))}
              </div>
              <TextField
                aria-label="Custom specialties separated by commas"
                label="Custom"
                placeholder="E.g. structured gel, bridal nails"
                value={customSpecialtiesInput}
                onBlur={() => commitCustomSpecialties(customSpecialtiesInput)}
                onChange={(event) => {
                  const rawValue = event.target.value;
                  customSpecialtiesInputRef.current = rawValue;
                  customSpecialtiesDirtyRef.current = true;
                  setCustomSpecialtiesInput(rawValue);
                }}
                onKeyUp={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    commitCustomSpecialties(customSpecialtiesInput);
                  }
                }}
              />
            </fieldset>
            {about.specialties.length > 0 || customSpecialtiesInput.trim() ? (
              <AboutFieldVisibility
                id="specialties"
                label="Show specialties in About"
                onUpdate={onUpdate}
                state={state}
              />
            ) : null}
          </div>
          <div className="onboarding-about-field-with-visibility">
            <TextField
              label="Years of experience — optional"
              value={about.yearsOfExperience}
              onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
                ...profile,
                about: { ...profile.about, yearsOfExperience: event.target.value },
              })))}
            />
            {about.yearsOfExperience.trim() ? (
              <AboutFieldVisibility
                id="experience"
                label="Show years of experience in About"
                onUpdate={onUpdate}
                state={state}
              />
            ) : null}
          </div>
          <details className="onboarding-about-more">
            <summary>
              <span>
                <strong>More about you</strong>
                <small>Your longer story, certifications, languages and appointment style.</small>
              </span>
              <i aria-hidden="true" />
            </summary>
            <div className="onboarding-about-more__fields">
              <TextAreaField
                hint="Your longer story. Clients can choose Read more to see it."
                label="Full bio"
                rows={6}
                value={about.fullBio}
                onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
                  ...profile,
                  about: { ...profile.about, fullBio: event.target.value },
                })))}
              />
              <div className="onboarding-about-field-with-visibility">
                <TextAreaField
                  hint="Use commas, semicolons, or new lines. Entries save when you press Enter, leave the field, or continue."
                  label="Certifications — optional"
                  placeholder="One per line, or separate with commas or semicolons"
                  rows={3}
                  value={certificationsInput}
                  onBlur={() => commitListInput('certifications', certificationsInput)}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    certificationsInputRef.current = rawValue;
                    certificationsDirtyRef.current = true;
                    setCertificationsInput(rawValue);
                  }}
                  onKeyUp={(event) => commitOnEnter(event, 'certifications', certificationsInput)}
                />
                {certificationsInput.trim() ? (
                  <AboutFieldVisibility
                    id="certifications"
                    label="Show certifications in About"
                    onUpdate={onUpdate}
                    state={state}
                  />
                ) : null}
              </div>
              <div className="onboarding-about-field-with-visibility">
                <TextAreaField
                  hint="Use commas, semicolons, or new lines. Entries save when you press Enter, leave the field, or continue."
                  label="Languages — optional"
                  placeholder="One per line, or separate with commas or semicolons"
                  rows={3}
                  value={languagesInput}
                  onBlur={() => commitListInput('languages', languagesInput)}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    languagesInputRef.current = rawValue;
                    languagesDirtyRef.current = true;
                    setLanguagesInput(rawValue);
                  }}
                  onKeyUp={(event) => commitOnEnter(event, 'languages', languagesInput)}
                />
                {languagesInput.trim() ? (
                  <AboutFieldVisibility
                    id="languages"
                    label="Show languages in About"
                    onUpdate={onUpdate}
                    state={state}
                  />
                ) : null}
              </div>
              <TextAreaField
                label="What do clients appreciate about appointments with you? — optional"
                rows={3}
                value={about.clientAppreciation}
                onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
                  ...profile,
                  about: { ...profile.about, clientAppreciation: event.target.value },
                })))}
              />
            </div>
          </details>
          <details ref={setupDetailsRef} className="onboarding-about-shared-details">
            <summary>
              <span>
                <strong>Details from your setup</strong>
                <small>Appointment status, new clients, policies and Instagram.</small>
              </span>
              <i aria-hidden="true" />
            </summary>
            <div className="onboarding-about-shared-details__fields">
              {state.profile.bookingPreferences.visitMode ? (
                <AboutFieldVisibility
                  description={appointmentStatus}
                  id="appointment_status"
                  label="Show appointment status in About"
                  onUpdate={onUpdate}
                  state={state}
                />
              ) : null}
              {state.profile.bookingPreferences.newClientStatus ? (
                <AboutFieldVisibility
                  description={newClientStatus}
                  id="new_client_status"
                  label="Show new-client status in About"
                  onUpdate={onUpdate}
                  state={state}
                />
              ) : null}
              {state.recipe.policiesEnabled ? (
                <AboutFieldVisibility
                  description="A short summary of your saved policies."
                  id="policy_summary"
                  label="Show policy summary in About"
                  onUpdate={onUpdate}
                  state={state}
                />
              ) : null}
              <div className="onboarding-about-field-with-visibility">
                <TextField
                  data-instagram-input
                  error={instagramError}
                  hint="This is the same Instagram used in your contact details. Editing it here updates it everywhere."
                  label="Instagram handle"
                  value={state.profile.instagram}
                  onBlur={commitInstagram}
                  onChange={(event) => {
                    const instagram = event.target.value;
                    onUpdate((current) => updateProfile(current, (profile) => ({
                      ...profile,
                      instagram,
                    })));
                  }}
                />
                {instagramResolution.status === 'resolved' ? (
                  <AboutFieldVisibility
                    id="instagram"
                    label="Show Instagram in About"
                    onUpdate={onUpdate}
                    state={state}
                  />
                ) : null}
              </div>
            </div>
          </details>
        </fieldset>
      </div>
      <aside className="onboarding-screen__preview">
        <OnboardingSitePreview
          document={siteDocument ?? null}
          initialTarget="about"
          label="About section live preview"
          state={state}
        />
        <button className="onboarding-full-preview-button" type="button" onClick={onFullPreview}>
          Open interactive preview
        </button>
      </aside>
      <StickyOnboardingActions
        backLabel="Back"
        primaryLabel={state.recipe.aboutEnabled ? 'Choose an About design' : 'Continue without About'}
        onBack={onBack}
        onPrimary={() => {
          if (state.recipe.aboutEnabled && instagramError) {
            if (setupDetailsRef.current) setupDetailsRef.current.open = true;
            window.requestAnimationFrame(() => {
              aboutFieldsRef.current
                ?.querySelector<HTMLInputElement>('[data-instagram-input]')
                ?.focus({ preventScroll: true });
            });
            return;
          }
          commitInstagram();
          commitListInputs();
          onContinue();
        }}
      />
      <Dialog
        description="Compare your current words with a first-person suggestion. Nothing changes until you choose Use suggestion."
        initialFocusSelector="[data-dialog-title]"
        onClose={closeWritingSuggestion}
        open={writingSuggestion !== null}
        title="Use this suggested bio?"
      >
        <section className="onboarding-writing-suggestion" id={helperSuggestionId}>
          <p className="onboarding-screen-status">Writing suggestion</p>
          {about.shortBio.trim() ? (
            <div data-helper-current>
              <strong>Current bio</strong>
              <p>{about.shortBio}</p>
            </div>
          ) : null}
          <div>
            <strong>Suggested bio</strong>
            <p>{writingSuggestion}</p>
          </div>
          <small>Your bio has not changed. Choose whether to use this suggestion.</small>
          <div>
            <button type="button" onClick={keepExistingBio}>Keep my bio</button>
            <button className="is-primary" type="button" onClick={useWritingSuggestion}>Use suggestion</button>
          </div>
        </section>
      </Dialog>
    </div>
  );
}

export function AboutDesignScreen({
  document,
  onBack,
  onContinue,
  onFullPreview,
  onUpdate,
  state,
}: SharedScreenProps & {
  document: SiteBuilderDocument | null;
  onContinue: () => void;
  onFullPreview: () => void;
}) {
  const feedback = useFeedback();
  const selectedPreset = ABOUT_PRESETS.find(({ id }) => id === state.recipe.aboutPreset)
    ?? ABOUT_PRESETS[0]!;
  return (
    <div className="onboarding-screen onboarding-screen--designer" data-screen="about_design">
      <ScreenHeading id="about_design" status="Optional" />
      <div aria-label="About design presets" className="onboarding-preset-grid" role="group">
        {ABOUT_PRESETS.map((preset) => (
          <button
            aria-pressed={state.recipe.aboutPreset === preset.id}
            className="onboarding-preset-card"
            data-selected={state.recipe.aboutPreset === preset.id ? 'true' : 'false'}
            key={preset.id}
            type="button"
            onClick={() => {
              feedback.send({ kind: 'selection' });
              onUpdate((current) => ({
                ...current,
                recipe: { ...current.recipe, aboutPreset: preset.id },
              }));
            }}
          >
            <AboutPresetPoster preset={preset.id} state={state} />
            <strong>{preset.label}</strong>
            <small>{preset.description}</small>
            {state.recipe.aboutPreset === preset.id ? <span><Check aria-hidden="true" size={14} /> Selected</span> : null}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="onboarding-about-design-selection-status">
        {selectedPreset.label} selected
      </p>
      <section aria-labelledby="about-design-site-preview-heading" className="onboarding-designer-preview onboarding-about-design-preview">
        <h2 id="about-design-site-preview-heading">See it on your site</h2>
        <OnboardingSitePreview
          document={document}
          initialTarget="about"
          label={`Selected About design preview: ${selectedPreset.label}`}
          state={state}
        />
        <button className="onboarding-full-preview-button" type="button" onClick={onFullPreview}>
          Open interactive preview
        </button>
      </section>
      <StickyOnboardingActions
        backLabel="Back to edit About"
        primaryFirst
        primaryLabel="Use this design"
        onBack={onBack}
        onPrimary={onContinue}
      />
    </div>
  );
}

type OtherPolicySectionId = Exclude<PolicySectionId, 'cancellations' | 'deposits'>;
type PolicyAccordionId = 'deposits_cancellations' | OtherPolicySectionId;

const OTHER_POLICY_CARD_LABELS: Record<OtherPolicySectionId, string> = {
  late_arrivals: 'Late arrivals',
  no_shows: 'No-shows',
  repairs: 'Repairs',
  other: 'Guests & appointment details',
};

const OTHER_POLICY_SECTION_IDS: OtherPolicySectionId[] = [
  'late_arrivals',
  'no_shows',
  'repairs',
  'other',
];

function BooleanChoice({ hint, label, onChange, value }: {
  hint?: string;
  label: string;
  onChange: (value: boolean | null) => void;
  value: boolean | null;
}) {
  return (
    <label className="onboarding-select-field">
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
      <select value={value === null ? '' : value ? 'yes' : 'no'} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'yes')}>
        <option value="">Choose</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function PolicyCopyCards({ onUpdate, state }: Pick<SharedScreenProps, 'onUpdate' | 'state'>) {
  const policiesShown = state.recipe.policiesEnabled;
  const policies = state.profile.policies;
  const cancellationsCopy = policies.copy.cancellations;
  const depositsCopy = policies.copy.deposits;
  const combinedVisible = isDepositsAndCancellationsVisible(policies);
  const bothCombinedPoliciesVisible = cancellationsCopy.visible && depositsCopy.visible;
  const combinedDisplayed = getDepositsAndCancellationsDisplayWording(policies);
  const combinedUsesSuggested = cancellationsCopy.useSuggestedWording
    && depositsCopy.useSuggestedWording;
  const updateCombinedVisibility = (visible: boolean) => onUpdate((current) =>
    updateProfile(current, (profile) => ({
      ...profile,
      policies: {
        ...profile.policies,
        copy: {
          ...profile.policies.copy,
          cancellations: { ...profile.policies.copy.cancellations, visible },
          deposits: { ...profile.policies.copy.deposits, visible },
        },
      },
    })));
  const updateCombinedOverride = (
    id: 'cancellations' | 'deposits',
    wordingOverride: string,
  ) => onUpdate((current) => updateProfile(current, (profile) => ({
    ...profile,
    policies: {
      ...profile.policies,
      deposits: id === 'deposits'
        ? { ...profile.policies.deposits, wordingOverride }
        : profile.policies.deposits,
      copy: {
        ...profile.policies.copy,
        [id]: {
          ...profile.policies.copy[id],
          useSuggestedWording: false,
          ...(id === 'cancellations' ? { wordingOverride } : {}),
        },
      },
    },
  })));
  const editCombinedWording = () => onUpdate((current) =>
    updateProfile(current, (profile) => {
      const currentPolicies = profile.policies;
      return {
        ...profile,
        policies: {
          ...currentPolicies,
          deposits: {
            ...currentPolicies.deposits,
            wordingOverride: currentPolicies.deposits.wordingOverride
              || derivePolicySuggestedWording(currentPolicies, 'deposits'),
          },
          copy: {
            ...currentPolicies.copy,
            cancellations: {
              ...currentPolicies.copy.cancellations,
              useSuggestedWording: false,
              wordingOverride: currentPolicies.copy.cancellations.wordingOverride
                || derivePolicySuggestedWording(currentPolicies, 'cancellations'),
            },
            deposits: {
              ...currentPolicies.copy.deposits,
              useSuggestedWording: false,
            },
          },
        },
      };
    }));
  const useCombinedSuggestedWording = () => onUpdate((current) =>
    updateProfile(current, (profile) => {
      const currentPolicies = profile.policies;
      return {
        ...profile,
        policies: {
          ...currentPolicies,
          copy: {
            ...currentPolicies.copy,
            cancellations: {
              ...currentPolicies.copy.cancellations,
              suggestedWording: derivePolicySuggestedWording(currentPolicies, 'cancellations'),
              useSuggestedWording: true,
            },
            deposits: {
              ...currentPolicies.copy.deposits,
              suggestedWording: derivePolicySuggestedWording(currentPolicies, 'deposits'),
              useSuggestedWording: true,
            },
          },
        },
      };
    }));
  return (
    <div className="onboarding-policy-copy-list">
      <details className="onboarding-policy-copy-card">
        <summary>
          Deposits & cancellations
          <span>{!policiesShown
            ? 'Saved, but not shown on your site'
            : cancellationsCopy.visible !== depositsCopy.visible
              ? 'Partly shown on site'
              : combinedVisible ? 'Shown on site' : 'Not shown'}</span>
        </summary>
        <NativeSwitch
          checked={bothCombinedPoliciesVisible}
          description={!policiesShown
            ? 'Turn on Show policies on my website to publish this saved policy.'
            : cancellationsCopy.visible !== depositsCopy.visible
              ? 'One legacy policy is hidden. Changing this setting will keep both together.'
              : undefined}
          disabled={!policiesShown}
          label="Show Deposits & cancellations on my website"
          onChange={updateCombinedVisibility}
        />
        {combinedUsesSuggested ? (
          <p>{combinedDisplayed
            || 'Answer the questions to create client wording.'}</p>
        ) : (
          <>
            <TextAreaField
              label="Deposit wording"
              rows={3}
              value={policies.deposits.wordingOverride}
              onChange={(event) => updateCombinedOverride('deposits', event.target.value)}
            />
            <TextAreaField
              label="Cancellation wording"
              rows={3}
              value={cancellationsCopy.wordingOverride}
              onChange={(event) => updateCombinedOverride('cancellations', event.target.value)}
            />
            <p className="onboarding-policy-copy-card__effective" role="status">
              Shown on your site: {combinedDisplayed
                || 'This policy stays hidden until its wording matches your current answers.'}
            </p>
          </>
        )}
        <div>
          <button type="button" onClick={editCombinedWording}>Edit wording</button>
          <button type="button" onClick={useCombinedSuggestedWording}>Use suggested wording</button>
        </div>
      </details>
      {OTHER_POLICY_SECTION_IDS.map((id) => {
        const copy = policies.copy[id];
        const suggestedWording = derivePolicySuggestedWording(policies, id);
        const displayed = getResolvedPolicyWording(policies, id);
        const wordingOverride = copy.wordingOverride;
        const updateCopy = (values: Partial<typeof copy>) => onUpdate((current) =>
          updateProfile(current, (profile) => {
            return {
              ...profile,
              policies: {
                ...profile.policies,
                copy: {
                  ...profile.policies.copy,
                  [id]: {
                    ...profile.policies.copy[id],
                    ...values,
                  },
                },
              },
            };
          }));
        return (
          <details className="onboarding-policy-copy-card" key={id}>
            <summary>
              {OTHER_POLICY_CARD_LABELS[id]}
              <span>{!policiesShown
                ? 'Saved, but not shown on your site'
                : copy.visible ? 'Shown on site' : 'Not shown'}</span>
            </summary>
            <NativeSwitch
              checked={copy.visible}
              description={!policiesShown
                ? 'Turn on Show policies on my website to publish this saved policy.'
                : undefined}
              disabled={!policiesShown}
              label={`Show ${OTHER_POLICY_CARD_LABELS[id]} on my website`}
              onChange={(visible) => updateCopy({ visible })}
            />
            {copy.useSuggestedWording ? <p>{displayed || 'Answer the questions to create client wording.'}</p> : (
              <>
                <TextAreaField label={`${OTHER_POLICY_CARD_LABELS[id]} wording`} rows={3} value={wordingOverride} onChange={(event) => updateCopy({ wordingOverride: event.target.value })} />
                {displayed !== wordingOverride.trim() ? (
                  <p className="onboarding-policy-copy-card__effective" role="status">
                    Shown on your site: {displayed || 'This policy stays hidden until its wording matches your current answers.'}
                  </p>
                ) : null}
              </>
            )}
            <div>
              <button type="button" onClick={() => updateCopy({ useSuggestedWording: false, wordingOverride: wordingOverride || suggestedWording })}>Edit wording</button>
              <button type="button" onClick={() => updateCopy({ suggestedWording, useSuggestedWording: true })}>Use suggested wording</button>
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function PoliciesScreen({
  onBack,
  onContinue,
  onEditBooking,
  onSkip,
  onUpdate,
  state,
}: SharedScreenProps & {
  onContinue: () => void;
  onEditBooking?: () => void;
  onSkip: () => void;
}) {
  const policies = state.profile.policies;
  const feedback = useFeedback();
  const depositMode = getDepositPolicyMode(policies);
  const depositSummary = deriveDepositPolicySummary(policies);
  const combinedPolicyComplete = isDepositsAndCancellationsComplete(policies);
  const combinedPolicySummary = deriveDepositsAndCancellationsSummary(policies);
  const lateCancellationChoice = getLateCancellationChoice(policies);
  const customLateCancellationOpen = policies.cancellations.consequence === 'custom'
    && !Object.values(LATE_CANCELLATION_CUSTOM_WORDING).some(
      (wording) => wording === policies.cancellations.customConsequence.trim(),
    );
  const visibleLateCancellationChoice = customLateCancellationOpen
    ? 'custom'
    : lateCancellationChoice;
  const combinedPolicyHasAnswer = depositMode === 'fixed'
    || policies.cancellations.notice !== null
    || Boolean(visibleLateCancellationChoice);
  const [openPolicy, setOpenPolicy] = useState<PolicyAccordionId | null>(
    'deposits_cancellations',
  );
  const [customLateOpen, setCustomLateOpen] = useState(
    Boolean(policies.lateArrivals.gracePeriodMinutes.trim())
      && !['5', '10', '15', '20'].includes(policies.lateArrivals.gracePeriodMinutes.trim()),
  );
  const [customRepairOpen, setCustomRepairOpen] = useState(
    Boolean(policies.repairs.freeRepairWindowDays.trim())
      && !['3', '5', '7', '14'].includes(policies.repairs.freeRepairWindowDays.trim()),
  );
  const [customNoShowOpen, setCustomNoShowOpen] = useState(
    Boolean(policies.noShows.custom.trim()),
  );
  const [customGuestsOpen, setCustomGuestsOpen] = useState(
    Boolean(policies.other.guests.trim())
      && !['No guests', 'One guest allowed', 'Guests welcome'].includes(policies.other.guests.trim()),
  );
  const [customChildrenOpen, setCustomChildrenOpen] = useState(
    Boolean(policies.other.children.trim())
      && ![
        'No children unless receiving a service',
        'Children welcome',
        'Please arrange childcare',
      ].includes(policies.other.children.trim()),
  );
  const updatePolicies = (update: (current: PoliciesDraft) => PoliciesDraft) => {
    onUpdate((current) => updateProfile(current, (profile) => ({
      ...profile,
      policies: refreshPolicySuggestedWording(update(profile.policies)),
    })));
  };
  const updateDepositPolicy = (
    patch: Partial<Pick<PoliciesDraft['deposits'], 'refundable' | 'transferable'>>,
  ) => {
    onUpdate((current) => updateProfile(current, (profile) => ({
      ...profile,
      policies: updateDepositDraft(profile.policies, patch),
    })));
  };
  const policyComplete = (sectionId: PolicySectionId) =>
    isPolicySectionComplete(policies, sectionId);
  const lateArrivalSummary = policies.lateArrivals.gracePeriodMinutes.trim()
    ? policyComplete('late_arrivals')
      ? `${policies.lateArrivals.gracePeriodMinutes.trim()}-minute grace period`
      : 'Finish this policy'
    : customLateOpen ? 'Finish this policy' : 'Choose how you handle late arrivals';
  const storedNoShowPreset = policies.noShows.custom.trim()
    ? 'custom'
    : policies.noShows.loseDeposit
      ? 'deposit_lost'
      : policies.noShows.fullCharge
        ? 'full_charge'
        : policies.noShows.paymentRequiredToRebook
          ? 'payment_to_rebook'
          : '';
  const noShowPreset = customNoShowOpen
    ? 'custom'
    : depositMode === 'none' && storedNoShowPreset === 'deposit_lost'
      ? ''
      : storedNoShowPreset;
  const noShowSummary = noShowPreset === 'deposit_lost'
    ? 'Deposit is kept'
    : noShowPreset === 'full_charge'
      ? 'Full service price is charged'
      : noShowPreset === 'payment_to_rebook'
        ? 'Payment is required before rebooking'
        : noShowPreset === 'custom'
          ? policies.noShows.custom.trim() || 'Add your wording'
          : 'Choose what happens after a no-show';
  const repairSummary = policies.repairs.noRepairPolicy
    ? 'No repair policy'
    : policies.repairs.freeRepairWindowDays.trim()
      ? `Free repairs within ${policies.repairs.freeRepairWindowDays.trim()} days`
      : customRepairOpen ? 'Finish this policy' : 'Add a repair policy';
  const otherHasAnswer = [
    policies.other.guests,
    policies.other.children,
    policies.other.appointmentPreparation,
    policies.other.outsideRemoval,
    policies.other.custom,
  ].some((value) => value.trim());
  const otherSummary = (customGuestsOpen && !policies.other.guests.trim())
    || (customChildrenOpen && !policies.other.children.trim())
    ? 'Add your wording'
    : otherHasAnswer
      ? 'Appointment details added'
      : 'Add any helpful appointment details';
  const togglePolicy = (id: PolicyAccordionId) => setOpenPolicy((current) =>
    current === id ? null : id);
  const savePolicies = () => {
    const hasPublishablePolicies = hasMeaningfulPublishablePolicies(policies);
    if (hasPublishablePolicies) {
      const wereAlreadyShown = state.recipe.policiesEnabled;
      onUpdate((current) => ({
        ...current,
        recipe: { ...current.recipe, policiesEnabled: true },
      }));
      feedback.send({
        kind: 'completed',
        message: wereAlreadyShown ? 'Policies updated.' : 'Policies added to your site.',
      });
    }
    onContinue();
  };

  return (
    <div className="onboarding-screen onboarding-screen--split" data-screen="policies">
      <div className="onboarding-screen__form">
        <ScreenHeading id="policies" status="Recommended · Optional" />
        <NativeSwitch
          checked={state.recipe.policiesEnabled}
          description="Your answers stay saved if you hide policies from your website."
          label="Show policies on my website"
          onChange={(checked) => onUpdate((current) => ({ ...current, recipe: { ...current.recipe, policiesEnabled: checked } }))}
        />
        <div className="onboarding-policy-questions">
          <CollapsibleFormCard
            completed={combinedPolicyComplete}
            id="onboarding-policy-deposits-cancellations"
            open={openPolicy === 'deposits_cancellations'}
            summary={combinedPolicySummary}
            status={combinedPolicyComplete
              ? state.recipe.policiesEnabled ? 'complete' : 'not_shown'
              : combinedPolicyHasAnswer ? 'finish' : 'set_up'}
            title="Deposits & cancellations"
            onToggle={() => togglePolicy('deposits_cancellations')}
          >
            <div className="onboarding-deposit-answer">
              <span>From your Booking settings</span>
              <strong>{depositSummary}</strong>
              <small>The deposit type and amount are set once in Booking.</small>
              {onEditBooking ? (
                <button type="button" onClick={onEditBooking}>
                  {depositMode === 'fixed' ? 'Edit deposit in Booking' : 'Change in Booking'}
                </button>
              ) : null}
            </div>
            <label className="onboarding-select-field">
              <span>How much notice do clients need to cancel?</span>
              <select
                value={policies.cancellations.notice ?? ''}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  cancellations: {
                    ...current.cancellations,
                    notice: event.target.value as typeof policies.cancellations.notice,
                  },
                }))}
              >
                <option value="">Choose a notice period</option>
                <option value="same_day">Same day</option>
                <option value="12_hours">12 hours</option>
                <option value="24_hours">24 hours</option>
                <option value="48_hours">48 hours</option>
                <option value="72_hours">72 hours</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {policies.cancellations.notice === 'custom' ? (
              <TextField
                label="Custom notice"
                placeholder="For example, 36 hours"
                value={policies.cancellations.customNotice}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  cancellations: { ...current.cancellations, customNotice: event.target.value },
                }))}
              />
            ) : null}
            <label className="onboarding-select-field">
              <span>{depositMode === 'fixed'
                ? 'What happens to the deposit if they cancel late?'
                : 'What happens if they cancel late?'}</span>
              <select
                value={visibleLateCancellationChoice}
                onChange={(event) => {
                  const choice = event.target.value as LateCancellationChoice;
                  updatePolicies((current) => {
                    const presetWording = choice === 'case_by_case'
                      || choice === 'move_deposit'
                      || choice === 'refund_deposit'
                      ? LATE_CANCELLATION_CUSTOM_WORDING[choice]
                      : null;
                    const customConsequence = presetWording
                      ?? (choice === 'custom'
                        && Object.values(LATE_CANCELLATION_CUSTOM_WORDING).some(
                          (wording) => wording === current.cancellations.customConsequence,
                        )
                          ? ''
                          : current.cancellations.customConsequence);
                    const consequence: PoliciesDraft['cancellations']['consequence'] =
                      choice === 'deposit_lost'
                      || choice === 'cancellation_fee'
                      || choice === 'full_service_charge'
                        ? choice
                        : choice === '' ? null : 'custom';
                    return {
                      ...current,
                      cancellations: {
                        ...current.cancellations,
                        consequence,
                        customConsequence,
                      },
                    };
                  });
                }}
              >
                <option value="">Choose what happens</option>
                {depositMode === 'fixed' ? (
                  <>
                    <option value="deposit_lost">Keep the deposit</option>
                    <option value="move_deposit">Move it to a new appointment</option>
                    <option value="refund_deposit">Refund it</option>
                  </>
                ) : null}
                <option value="case_by_case">Handle it case by case</option>
                <option value="cancellation_fee">Charge a cancellation fee</option>
                <option value="full_service_charge">Charge the full service price</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {customLateCancellationOpen ? (
              <TextAreaField
                label="Custom late-cancellation rule"
                placeholder="Describe what happens after the deadline"
                rows={2}
                value={policies.cancellations.customConsequence}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  cancellations: { ...current.cancellations, customConsequence: event.target.value },
                }))}
              />
            ) : null}
            {depositMode === 'fixed' ? (
              <div className="onboarding-deposit-details">
                <BooleanChoice
                  hint="This applies before the late-cancellation deadline."
                  label="Can clients get their deposit back?"
                  value={policies.deposits.refundable}
                  onChange={(refundable) => updateDepositPolicy({ refundable })}
                />
                <BooleanChoice
                  hint="This applies when they reschedule before the deadline."
                  label="Can clients move it to another appointment?"
                  value={policies.deposits.transferable}
                  onChange={(transferable) => updateDepositPolicy({ transferable })}
                />
              </div>
            ) : null}
          </CollapsibleFormCard>
          <CollapsibleFormCard
            completed={policyComplete('late_arrivals')}
            id="onboarding-policy-late-arrivals"
            open={openPolicy === 'late_arrivals'}
            summary={lateArrivalSummary}
            status={policyComplete('late_arrivals')
              ? 'complete'
              : policies.lateArrivals.gracePeriodMinutes.trim() || customLateOpen
                ? 'finish'
                : 'set_up'}
            title="Late arrivals"
            onToggle={() => togglePolicy('late_arrivals')}
          >
            <label className="onboarding-select-field">
              <span>How late can a client be?</span>
              <select
                value={customLateOpen
                  ? 'custom'
                  : policies.lateArrivals.gracePeriodMinutes}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomLateOpen(value === 'custom');
                  if (value === 'custom') {
                    updatePolicies((current) => ({
                      ...current,
                      lateArrivals: { ...current.lateArrivals, gracePeriodMinutes: '' },
                    }));
                    return;
                  }
                  updatePolicies((current) => ({
                    ...current,
                    lateArrivals: { ...current.lateArrivals, gracePeriodMinutes: value },
                  }));
                }}
              >
                <option value="">Choose a grace period</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="15">15 minutes</option>
                <option value="20">20 minutes</option>
                <option value="custom">Another amount</option>
              </select>
            </label>
            {customLateOpen ? (
              <TextField
                inputMode="numeric"
                label="Custom grace period in minutes"
                value={policies.lateArrivals.gracePeriodMinutes}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  lateArrivals: { ...current.lateArrivals, gracePeriodMinutes: event.target.value },
                }))}
              />
            ) : null}
            <BooleanChoice
              label="Shorten the service when needed?"
              value={policies.lateArrivals.shortenService}
              onChange={(shortenService) => updatePolicies((current) => ({
                ...current,
                lateArrivals: { ...current.lateArrivals, shortenService },
              }))}
            />
            <BooleanChoice
              label="Reschedule if they arrive after the limit?"
              value={policies.lateArrivals.rescheduleAfterLimit}
              onChange={(rescheduleAfterLimit) => updatePolicies((current) => ({
                ...current,
                lateArrivals: { ...current.lateArrivals, rescheduleAfterLimit },
              }))}
            />
          </CollapsibleFormCard>
          <CollapsibleFormCard
            completed={policyComplete('no_shows')}
            id="onboarding-policy-no-shows"
            open={openPolicy === 'no_shows'}
            summary={noShowSummary}
            status={policyComplete('no_shows')
              ? 'complete'
              : noShowPreset ? 'finish' : 'set_up'}
            title="No-shows"
            onToggle={() => togglePolicy('no_shows')}
          >
            <label className="onboarding-select-field">
              <span>What happens if a client misses their appointment?</span>
              <select
                value={noShowPreset}
                onChange={(event) => {
                  const preset = event.target.value;
                  setCustomNoShowOpen(preset === 'custom');
                  updatePolicies((current) => ({
                    ...current,
                    noShows: {
                      ...current.noShows,
                      custom: preset === 'custom' ? current.noShows.custom : '',
                      fullCharge: preset === 'full_charge',
                      loseDeposit: preset === 'deposit_lost',
                      paymentRequiredToRebook: preset === 'payment_to_rebook',
                    },
                  }));
                }}
              >
                <option value="">Choose what happens</option>
                {depositMode === 'fixed' ? (
                  <option value="deposit_lost">Keep the deposit</option>
                ) : null}
                <option value="full_charge">Charge the full service price</option>
                <option value="payment_to_rebook">Require payment before rebooking</option>
                <option value="custom">Something else</option>
              </select>
            </label>
            {noShowPreset === 'custom' ? (
              <TextAreaField
                label="Custom no-show consequence"
                rows={2}
                value={policies.noShows.custom}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  noShows: { ...current.noShows, custom: event.target.value },
                }))}
              />
            ) : null}
          </CollapsibleFormCard>
          <CollapsibleFormCard
            completed={policyComplete('repairs')}
            id="onboarding-policy-repairs"
            open={openPolicy === 'repairs'}
            summary={repairSummary}
            status={policyComplete('repairs')
              ? 'complete'
              : policies.repairs.freeRepairWindowDays.trim() || customRepairOpen
                ? 'finish'
                : 'set_up'}
            title="Repairs"
            onToggle={() => togglePolicy('repairs')}
          >
            <label className="onboarding-select-field">
              <span>Free repair window</span>
              <select
                value={customRepairOpen
                  ? 'custom'
                  : policies.repairs.freeRepairWindowDays}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomRepairOpen(value === 'custom');
                  if (value === 'custom') {
                    updatePolicies((current) => ({
                      ...current,
                      repairs: { ...current.repairs, freeRepairWindowDays: '' },
                    }));
                    return;
                  }
                  updatePolicies((current) => ({
                    ...current,
                    repairs: { ...current.repairs, freeRepairWindowDays: value },
                  }));
                }}
              >
                <option value="">Choose a repair window</option>
                <option value="3">3 days</option>
                <option value="5">5 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="custom">Another amount</option>
              </select>
            </label>
            {customRepairOpen ? (
              <TextField
                inputMode="numeric"
                label="Custom repair window in days"
                value={policies.repairs.freeRepairWindowDays}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  repairs: { ...current.repairs, freeRepairWindowDays: event.target.value },
                }))}
              />
            ) : null}
            <TextAreaField
              label="Repair conditions — optional"
              rows={2}
              value={policies.repairs.conditions}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                repairs: { ...current.repairs, conditions: event.target.value },
              }))}
            />
            <NativeSwitch
              checked={policies.repairs.noRepairPolicy}
              label="I do not offer repairs"
              onChange={(noRepairPolicy) => updatePolicies((current) => ({
                ...current,
                repairs: { ...current.repairs, noRepairPolicy },
              }))}
            />
          </CollapsibleFormCard>
          <CollapsibleFormCard
            completed={policyComplete('other')}
            id="onboarding-policy-other"
            open={openPolicy === 'other'}
            summary={otherSummary}
            status={policyComplete('other')
              ? 'complete'
              : customGuestsOpen || customChildrenOpen ? 'finish' : 'set_up'}
            title="Guests & appointment details"
            onToggle={() => togglePolicy('other')}
          >
            <label className="onboarding-select-field">
              <span>Guests</span>
              <select
                value={customGuestsOpen ? 'custom' : policies.other.guests}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomGuestsOpen(value === 'custom');
                  if (value === 'custom') {
                    updatePolicies((current) => ({
                      ...current,
                      other: { ...current.other, guests: '' },
                    }));
                    return;
                  }
                  updatePolicies((current) => ({
                    ...current,
                    other: { ...current.other, guests: value },
                  }));
                }}
              >
                <option value="">Choose a guest policy</option>
                <option value="No guests">No guests</option>
                <option value="One guest allowed">One guest allowed</option>
                <option value="Guests welcome">Guests welcome</option>
                <option value="custom">Something else</option>
              </select>
            </label>
            {customGuestsOpen ? (
              <TextField
                label="Custom guest policy"
                value={policies.other.guests}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  other: { ...current.other, guests: event.target.value },
                }))}
              />
            ) : null}
            <label className="onboarding-select-field">
              <span>Children</span>
              <select
                value={customChildrenOpen ? 'custom' : policies.other.children}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomChildrenOpen(value === 'custom');
                  if (value === 'custom') {
                    updatePolicies((current) => ({
                      ...current,
                      other: { ...current.other, children: '' },
                    }));
                    return;
                  }
                  updatePolicies((current) => ({
                    ...current,
                    other: { ...current.other, children: value },
                  }));
                }}
              >
                <option value="">Choose a children policy</option>
                <option value="No children unless receiving a service">No children unless receiving a service</option>
                <option value="Children welcome">Children welcome</option>
                <option value="Please arrange childcare">Please arrange childcare</option>
                <option value="custom">Something else</option>
              </select>
            </label>
            {customChildrenOpen ? (
              <TextField
                label="Custom children policy"
                value={policies.other.children}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  other: { ...current.other, children: event.target.value },
                }))}
              />
            ) : null}
            <TextAreaField
              label="How should clients prepare? — optional"
              rows={2}
              value={policies.other.appointmentPreparation}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, appointmentPreparation: event.target.value },
              }))}
            />
            <TextField
              label="Removal from another salon — optional"
              value={policies.other.outsideRemoval}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, outsideRemoval: event.target.value },
              }))}
            />
            <TextAreaField
              label="Anything else clients should know? — optional"
              rows={2}
              value={policies.other.custom}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, custom: event.target.value },
              }))}
            />
          </CollapsibleFormCard>
        </div>
        <p className="onboarding-policy-later-helper">
          You can add or change policies later from your dashboard.
        </p>
      </div>
      <aside className="onboarding-screen__preview">
        <div className="onboarding-preview-card">
          <h2>{state.recipe.policiesEnabled
            ? 'What your clients will see'
            : 'Your saved policy wording'}</h2>
          {!state.recipe.policiesEnabled ? (
            <p role="status">Policies are saved, but not shown on your site.</p>
          ) : null}
          <PolicyCopyCards onUpdate={onUpdate} state={state} />
        </div>
      </aside>
      <StickyOnboardingActions
        backLabel="Back"
        primaryLabel="Save policies"
        skipLabel="Skip for now"
        onBack={onBack}
        onPrimary={savePolicies}
        onSkip={onSkip}
      />
    </div>
  );
}

export function SiteStyleScreen({
  document,
  onBack,
  onContinue,
  onFullPreview,
  onUpdate,
  state,
}: SharedScreenProps & {
  document: SiteBuilderDocument | null;
  onContinue: () => void;
  onFullPreview: () => void;
  onKeepCurrent?: () => void;
}) {
  const feedback = useFeedback();
  const confirmedStyleAtEntry = useRef(state.recipe.stylePreset);
  const confirmedPaletteAtEntry = useRef(state.recipe.palettePreset);
  const selectedStyle = SITE_STYLE_PRESETS.find((preset) =>
    preset.id === state.recipe.stylePreset) ?? SITE_STYLE_PRESETS[0];
  const primaryLabel = state.recipe.styleConfirmed && state.recipe.paletteConfirmed
    ? `Continue with ${selectedStyle?.label ?? 'this style'}`
    : `Use ${selectedStyle?.label ?? 'this style'}`;
  return (
    <div className="onboarding-screen onboarding-screen--style" data-screen="site_style">
      <div className="onboarding-screen__form">
        <ScreenHeading id="site_style" status="Required step" />
        <p className="onboarding-style-reassurance">
          Your pages, photos and information stay the same — only the style changes.
        </p>
        <div aria-label="Site style presets" className="onboarding-style-grid" role="group">
          {SITE_STYLE_PRESETS.map((preset) => {
            const roles = ONBOARDING_STYLE_ROLES[preset.id];
            const isCurrentStyle = preset.id === confirmedStyleAtEntry.current;
            const isSelectedStyle = preset.id === state.recipe.stylePreset;
            const isPreviewingStyle = isSelectedStyle && !state.recipe.styleConfirmed;
            return (
              <button
                aria-pressed={state.recipe.stylePreset === preset.id}
                className="onboarding-style-card"
                data-current={isCurrentStyle ? 'true' : 'false'}
                data-previewing={isPreviewingStyle ? 'true' : 'false'}
                data-selected={state.recipe.stylePreset === preset.id ? 'true' : 'false'}
                key={preset.id}
                style={{
                  '--swatch-accent': roles.accent,
                  '--swatch-body-font': roles.bodyFont,
                  '--swatch-button-radius': roles.buttonRadius,
                  '--swatch-ground': roles.ground,
                  '--swatch-heading-font': roles.headingFont,
                  '--swatch-ink': roles.ink,
                  '--swatch-line': roles.line,
                  '--swatch-secondary': roles.secondaryAccent,
                  '--swatch-surface': roles.surface,
                } as CSSProperties}
                type="button"
                onClick={() => {
                  feedback.send({ kind: 'selection' });
                  onUpdate((current) => ({
                    ...current,
                    recipe: { ...current.recipe, styleConfirmed: false, stylePreset: preset.id },
                  }));
                }}
              >
                <span className="onboarding-style-swatch" aria-hidden="true">
                  <i>Aa</i>
                  <i>Beautiful nails, made for you.</i>
                  <i>Book now</i>
                  <b>
                    <em /><em /><em /><em />
                  </b>
                </span>
                <strong>{preset.label}</strong>
                <small>{preset.description}</small>
                {isCurrentStyle || isPreviewingStyle ? (
                  <span className="onboarding-style-card__statuses">
                    {isCurrentStyle ? <em>On your site now</em> : null}
                    {isPreviewingStyle ? (
                      <em className="is-previewing"><Check aria-hidden="true" size={14} /> Previewing</em>
                    ) : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <section className="onboarding-palette-section" aria-labelledby="onboarding-palette-heading">
          <div className="onboarding-palette-section__heading">
            <p className="onboarding-screen-kicker">Colours</p>
            <h2 id="onboarding-palette-heading">Choose your colours</h2>
            <p>Keep the same layout and fonts, then choose the colours that feel most like your brand.</p>
          </div>
          <div aria-label="Website colour palettes" className="onboarding-palette-grid" role="group">
            {SITE_PALETTE_PRESETS.map((preset) => {
              const isCurrentPalette = preset.id === confirmedPaletteAtEntry.current;
              const isSelectedPalette = preset.id === state.recipe.palettePreset;
              const isPreviewingPalette = isSelectedPalette && !state.recipe.paletteConfirmed;
              return (
                <button
                  aria-pressed={isSelectedPalette}
                  className="onboarding-palette-card"
                  data-current={isCurrentPalette ? 'true' : 'false'}
                  data-previewing={isPreviewingPalette ? 'true' : 'false'}
                  key={preset.id}
                  style={{
                    '--palette-accent': preset.roles.accent,
                    '--palette-button': preset.roles.button,
                    '--palette-button-text': preset.roles.buttonText,
                    '--palette-ground': preset.roles.ground,
                    '--palette-ink': preset.roles.ink,
                    '--palette-line': preset.roles.line,
                    '--palette-secondary': preset.roles.secondaryAccent,
                    '--palette-surface': preset.roles.surface,
                  } as CSSProperties}
                  type="button"
                  onClick={() => {
                    feedback.send({ kind: 'selection' });
                    onUpdate((current) => ({
                      ...current,
                      recipe: {
                        ...current.recipe,
                        paletteConfirmed: false,
                        palettePreset: preset.id,
                      },
                    }));
                  }}
                >
                  <span aria-hidden="true" className="onboarding-palette-card__preview">
                    <i /><i /><i /><i /><i />
                    <b>Book now</b>
                  </span>
                  <strong>{preset.label}</strong>
                  <small>{preset.description}</small>
                  {isCurrentPalette || isPreviewingPalette ? (
                    <span className="onboarding-palette-card__status">
                      {isCurrentPalette ? <em>Current colours</em> : null}
                      {isPreviewingPalette ? (
                        <em className="is-previewing"><Check aria-hidden="true" size={14} /> Previewing</em>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <aside className="onboarding-screen__preview is-preview-first">
        <OnboardingSitePreview document={document} label="Live personalized style preview" state={state} />
        <button className="onboarding-full-preview-button" type="button" onClick={onFullPreview}>View full preview</button>
      </aside>
      <StickyOnboardingActions
        backLabel="Back"
        primaryLabel={primaryLabel}
        onBack={onBack}
        onPrimary={onContinue}
      />
    </div>
  );
}

export function ExtrasScreen({
  onBack,
  onContinue,
  onOpenCanva,
  onOpenGallery,
  state,
}: Omit<SharedScreenProps, 'onUpdate'> & {
  onContinue: () => void;
  onOpenCanva: () => void;
  onOpenGallery: () => void;
  onSkip?: () => void;
}) {
  const galleryCount = state.gallery.images.length;
  const canvaCount = state.canva.images.length;
  const galleryLayout = state.gallery.layout === 'grid'
    ? 'Grid'
    : state.gallery.layout === 'carousel'
      ? 'Carousel'
      : 'Editorial';
  const canvaPlacement = state.canva.placement === 'before_booking'
    ? 'Before Booking'
    : 'After Booking';
  return (
    <div className="onboarding-screen" data-screen="extras">
      <ScreenHeading id="extras" status="Optional" />
      <div className="onboarding-extra-grid">
        <article className={`onboarding-extra-card${state.recipe.galleryEnabled ? ' is-added' : ''}`}>
          <Images aria-hidden="true" size={28} />
          {state.recipe.galleryEnabled ? <span>Added</span> : null}
          <h2>Show off your work</h2>
          <p>{state.recipe.galleryEnabled
            ? `${galleryCount} ${state.gallery.source === 'mock_luster' ? 'example ' : ''}${galleryCount === 1 ? 'photo' : 'photos'} · ${galleryLayout}`
            : 'Add photos of your nail sets so clients can see your style.'}</p>
          {state.recipe.galleryEnabled ? <strong>✓ Gallery added</strong> : null}
          {state.recipe.galleryEnabled && state.gallery.source === 'mock_luster' ? (
            <small>Swap in your own photos whenever you’re ready.</small>
          ) : null}
          <button type="button" onClick={onOpenGallery}>{state.recipe.galleryEnabled ? 'Edit Gallery' : 'Add Gallery'}</button>
        </article>
        <article className={`onboarding-extra-card${state.recipe.canvaEnabled ? ' is-added' : ''}${state.recipe.wantsCanvaFromWelcome ? ' is-recommended' : ''}`}>
          <FileImage aria-hidden="true" size={28} />
          {state.recipe.canvaEnabled || state.recipe.wantsCanvaFromWelcome ? (
            <span>{state.recipe.canvaEnabled ? 'Added' : 'Recommended for you'}</span>
          ) : null}
          <h2>Already have a Canva design?</h2>
          <p>{state.recipe.canvaEnabled
            ? `${canvaCount} Canva ${canvaCount === 1 ? 'page' : 'pages'} added · ${canvaPlacement}`
            : state.recipe.wantsCanvaFromWelcome
              ? 'You told us you already have a Canva design. Upload your pages and we’ll add them to your website.'
              : 'Upload pages you exported from Canva and add them to your website.'}</p>
          {state.recipe.canvaEnabled ? <strong>✓ Canva design added</strong> : null}
          <button type="button" onClick={onOpenCanva}>{state.recipe.canvaEnabled ? 'Edit design' : 'Upload Canva design'}</button>
        </article>
      </div>
      {(state.recipe.galleryEnabled || state.recipe.canvaEnabled) ? (
        <p aria-live="polite" className="onboarding-extras-summary">
          Added: {[state.recipe.galleryEnabled ? 'Gallery' : null, state.recipe.canvaEnabled ? 'Canva' : null].filter(Boolean).join(' and ')}
        </p>
      ) : null}
      {state.canva.status === 'invalid' ? (
        <p className="onboarding-inline-error" role="alert">
          Some Canva pages need attention. {state.canva.errorMessage}
        </p>
      ) : null}
      <StickyOnboardingActions
        backLabel="Back"
        primaryLabel="Continue to review"
        onBack={onBack}
        onPrimary={onContinue}
      />
    </div>
  );
}

export function OnboardingSubflowActions({ children }: { children: ReactNode }) {
  return <div className="onboarding-subflow-actions">{children}</div>;
}
