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
import {
  buildAboutWordingSuggestion,
  formatAboutListInput,
  parseAboutListInput,
} from '../model/about';
import {
  deriveDepositPolicySummary,
  derivePolicySuggestedWording,
  getDepositPolicyMode,
  getResolvedPolicyWording,
  refreshPolicySuggestedWording,
  updateDepositDraft,
} from '../model/policies';
import type {
  AboutElementId,
  AboutPresetId,
  BusinessProfileDraft,
  OnboardingLabState,
  PoliciesDraft,
  PolicySectionId,
  SiteStylePresetId,
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

const STYLE_PRESETS: Array<{
  description: string;
  id: SiteStylePresetId;
  label: string;
}> = [
  { description: 'Clean, warm and polished with rounded details.', id: 'modern', label: 'Modern' },
  { description: 'Magazine-inspired fonts with an elevated, luxury feel.', id: 'editorial', label: 'Editorial' },
  { description: 'Blush tones, softer shapes and a calm feminine feel.', id: 'soft', label: 'Soft' },
  { description: 'Simple neutrals, clean lines and less decoration.', id: 'minimal', label: 'Minimal' },
  { description: 'High-contrast colours, stronger type and statement details.', id: 'bold', label: 'Bold' },
  { description: 'Dark tones, refined typography and gold-inspired accents.', id: 'luxury', label: 'Luxury' },
];

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
            <AboutFieldVisibility
              id="specialties"
              label="Show specialties in About"
              onUpdate={onUpdate}
              state={state}
            />
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
            <AboutFieldVisibility
              id="experience"
              label="Show years of experience in About"
              onUpdate={onUpdate}
              state={state}
            />
          </div>
          <details className="onboarding-about-more">
            <summary>More about you</summary>
            <div className="onboarding-about-more__fields">
              <TextAreaField
                label="Full bio — optional"
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
                <AboutFieldVisibility
                  id="certifications"
                  label="Show certifications in About"
                  onUpdate={onUpdate}
                  state={state}
                />
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
                <AboutFieldVisibility
                  id="languages"
                  label="Show languages in About"
                  onUpdate={onUpdate}
                  state={state}
                />
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
          <section aria-labelledby="about-shared-details-heading" className="onboarding-about-shared-details">
            <div>
              <h2 id="about-shared-details-heading">Details already in your setup</h2>
              <p>Choose which details also appear in your About section.</p>
            </div>
            <AboutFieldVisibility
              description={appointmentStatus}
              id="appointment_status"
              label="Show appointment status in About"
              onUpdate={onUpdate}
              state={state}
            />
            <AboutFieldVisibility
              description={newClientStatus}
              id="new_client_status"
              label="Show new-client status in About"
              onUpdate={onUpdate}
              state={state}
            />
            <AboutFieldVisibility
              description={state.recipe.policiesEnabled
                ? 'A short summary of your saved policies.'
                : 'Add policies to show a summary here.'}
              id="policy_summary"
              label="Show policy summary in About"
              onUpdate={onUpdate}
              state={state}
            />
            <div className="onboarding-about-field-with-visibility">
              <TextField
                hint="This is the same Instagram used in your contact details. Editing it here updates it everywhere."
                label="Instagram handle — optional"
                value={state.profile.instagram}
                onChange={(event) => {
                  const instagram = event.target.value;
                  onUpdate((current) => updateProfile(current, (profile) => ({
                    ...profile,
                    instagram,
                  })));
                }}
              />
              <AboutFieldVisibility
                id="instagram"
                label="Show Instagram in About"
                onUpdate={onUpdate}
                state={state}
              />
            </div>
          </section>
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
  return (
    <div className="onboarding-screen onboarding-screen--designer" data-screen="about_design">
      <ScreenHeading id="about_design" status="Optional" />
      <div className="onboarding-designer-preview">
        <OnboardingSitePreview
          document={document}
          initialTarget="about"
          label="Selected About design preview"
          state={state}
        />
        <button className="onboarding-full-preview-button" type="button" onClick={onFullPreview}>
          Open interactive preview
        </button>
      </div>
      <div aria-label="About design presets" className="onboarding-preset-grid" role="group">
        {ABOUT_PRESETS.map((preset) => (
          <button
            aria-pressed={state.recipe.aboutPreset === preset.id}
            className="onboarding-preset-card"
            data-selected={state.recipe.aboutPreset === preset.id ? 'true' : 'false'}
            key={preset.id}
            type="button"
            onClick={() => onUpdate((current) => ({
              ...current,
              recipe: { ...current.recipe, aboutPreset: preset.id },
            }))}
          >
            <span className={`onboarding-about-poster is-${preset.id}`} aria-hidden="true"><i /><i /><i /></span>
            <strong>{preset.label}</strong>
            <small>{preset.description}</small>
            {state.recipe.aboutPreset === preset.id ? <span>✓ Selected</span> : null}
          </button>
        ))}
      </div>
      <StickyOnboardingActions
        backLabel="Back to edit About"
        primaryLabel="Use this design"
        onBack={onBack}
        onPrimary={onContinue}
      />
    </div>
  );
}

const POLICY_CARD_LABELS: Record<PolicySectionId, string> = {
  cancellations: 'Cancellations',
  deposits: 'Deposits',
  late_arrivals: 'Late arrivals',
  no_shows: 'No-shows',
  other: 'Guests & appointment details',
  repairs: 'Repairs',
};

function BooleanChoice({ label, onChange, value }: {
  label: string;
  onChange: (value: boolean | null) => void;
  value: boolean | null;
}) {
  return (
    <label className="onboarding-select-field">
      <span>{label}</span>
      <select value={value === null ? '' : value ? 'yes' : 'no'} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'yes')}>
        <option value="">Choose</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function PolicyCopyCards({ onUpdate, state }: Pick<SharedScreenProps, 'onUpdate' | 'state'>) {
  return (
    <div className="onboarding-policy-copy-list">
      {(Object.keys(POLICY_CARD_LABELS) as PolicySectionId[]).map((id) => {
        const copy = state.profile.policies.copy[id];
        const suggestedWording = derivePolicySuggestedWording(state.profile.policies, id);
        const displayed = getResolvedPolicyWording(state.profile.policies, id);
        const wordingOverride = id === 'deposits'
          ? state.profile.policies.deposits.wordingOverride
          : copy.wordingOverride;
        const updateCopy = (values: Partial<typeof copy>) => onUpdate((current) =>
          updateProfile(current, (profile) => {
            const { wordingOverride: nextWordingOverride, ...copyValues } = values;
            return {
              ...profile,
              policies: {
                ...profile.policies,
                deposits: id === 'deposits' && nextWordingOverride !== undefined
                  ? {
                      ...profile.policies.deposits,
                      wordingOverride: nextWordingOverride,
                    }
                  : profile.policies.deposits,
                copy: {
                  ...profile.policies.copy,
                  [id]: {
                    ...profile.policies.copy[id],
                    ...copyValues,
                    ...(id !== 'deposits' && nextWordingOverride !== undefined
                      ? { wordingOverride: nextWordingOverride }
                      : {}),
                  },
                },
              },
            };
          }));
        return (
          <article className="onboarding-policy-copy-card" key={id}>
            <header><h3>{POLICY_CARD_LABELS[id]}</h3><NativeSwitch checked={copy.visible} label={`Show ${POLICY_CARD_LABELS[id]} on my website`} onChange={(visible) => updateCopy({ visible })} /></header>
            {copy.useSuggestedWording ? <p>{displayed || 'Answer the questions to generate suggested wording.'}</p> : (
              <>
                <TextAreaField label={`${POLICY_CARD_LABELS[id]} wording`} rows={3} value={wordingOverride} onChange={(event) => updateCopy({ wordingOverride: event.target.value })} />
                {displayed !== wordingOverride.trim() ? (
                  <p className="onboarding-policy-copy-card__effective" role="status">
                    Shown on your site: {displayed || 'This policy is omitted until the wording matches your current answers.'}
                  </p>
                ) : null}
              </>
            )}
            <div>
              <button type="button" onClick={() => updateCopy({ useSuggestedWording: false, wordingOverride: wordingOverride || suggestedWording })}>Edit wording</button>
              <button type="button" onClick={() => updateCopy({ suggestedWording, useSuggestedWording: true })}>Use suggested wording</button>
            </div>
          </article>
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
  const depositMode = getDepositPolicyMode(policies);
  const depositSummary = deriveDepositPolicySummary(policies);
  const [openPolicy, setOpenPolicy] = useState<PolicySectionId | null>('cancellations');
  const [customLateOpen, setCustomLateOpen] = useState(
    Boolean(policies.lateArrivals.gracePeriodMinutes.trim())
      && !['5', '10', '15', '20'].includes(policies.lateArrivals.gracePeriodMinutes.trim()),
  );
  const [customRepairOpen, setCustomRepairOpen] = useState(
    Boolean(policies.repairs.freeRepairWindowDays.trim())
      && !['3', '5', '7', '14'].includes(policies.repairs.freeRepairWindowDays.trim()),
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
  const cancellationNoticeSummary = policies.cancellations.notice === 'same_day'
    ? 'Same-day notice'
    : policies.cancellations.notice === '12_hours'
    ? '12 hours’ notice'
    : policies.cancellations.notice === '24_hours'
      ? '24 hours’ notice'
      : policies.cancellations.notice === '48_hours'
        ? '48 hours’ notice'
        : policies.cancellations.notice === '72_hours'
          ? '72 hours’ notice'
        : policies.cancellations.notice === 'custom'
          ? policies.cancellations.customNotice.trim() || 'Custom notice'
          : 'Choose your cancellation rules';
  const visibleCancellationConsequence = depositMode === 'none'
    && policies.cancellations.consequence === 'deposit_lost'
    ? null
    : policies.cancellations.consequence;
  const cancellationConsequenceSummary = visibleCancellationConsequence === 'deposit_lost'
    ? 'Deposit is kept after the deadline'
    : visibleCancellationConsequence === 'cancellation_fee'
      ? 'Cancellation fee after the deadline'
      : visibleCancellationConsequence === 'full_service_charge'
        ? 'Full service price after the deadline'
        : visibleCancellationConsequence === 'custom'
          ? policies.cancellations.customConsequence.trim() || 'Custom consequence'
          : '';
  const lateArrivalSummary = policies.lateArrivals.gracePeriodMinutes.trim()
    ? `${policies.lateArrivals.gracePeriodMinutes.trim()}-minute grace period`
    : 'Choose how you handle late arrivals';
  const storedNoShowPreset = policies.noShows.custom.trim()
    ? 'custom'
    : policies.noShows.loseDeposit
      ? 'deposit_lost'
      : policies.noShows.fullCharge
        ? 'full_charge'
        : policies.noShows.paymentRequiredToRebook
          ? 'payment_to_rebook'
          : '';
  const noShowPreset = depositMode === 'none' && storedNoShowPreset === 'deposit_lost'
    ? ''
    : storedNoShowPreset;
  const noShowSummary = noShowPreset === 'deposit_lost'
    ? 'Deposit is kept'
    : noShowPreset === 'full_charge'
      ? 'Full service price is charged'
      : noShowPreset === 'payment_to_rebook'
        ? 'Payment is required before rebooking'
        : noShowPreset === 'custom'
          ? policies.noShows.custom.trim()
          : 'Choose what happens after a no-show';
  const repairSummary = policies.repairs.noRepairPolicy
    ? 'No repair policy'
    : policies.repairs.freeRepairWindowDays.trim()
      ? `Free repairs within ${policies.repairs.freeRepairWindowDays.trim()} days`
      : 'Add a repair policy';
  const otherSummary = [
    policies.other.guests,
    policies.other.children,
    policies.other.appointmentPreparation,
    policies.other.outsideRemoval,
    policies.other.custom,
  ].some((value) => value.trim())
    ? 'Appointment details added'
    : 'Add any helpful appointment details';
  const togglePolicy = (id: PolicySectionId) => setOpenPolicy((current) =>
    current === id ? null : id);

  return (
    <div className="onboarding-screen onboarding-screen--split" data-screen="policies">
      <div className="onboarding-screen__form">
        <ScreenHeading id="policies" status="Recommended · Skippable" />
        <NativeSwitch
          checked={state.recipe.policiesEnabled}
          description="Your answers stay saved if you hide policies from your website."
          label="Show policies on my website"
          onChange={(checked) => onUpdate((current) => ({ ...current, recipe: { ...current.recipe, policiesEnabled: checked } }))}
        />
        <div className="onboarding-policy-questions">
          <CollapsibleFormCard
            completed={Boolean(policies.cancellations.notice || visibleCancellationConsequence)}
            id="onboarding-policy-cancellations"
            open={openPolicy === 'cancellations'}
            summary={[cancellationNoticeSummary, cancellationConsequenceSummary]
              .filter(Boolean).join(' · ')}
            title="Cancellations"
            onToggle={() => togglePolicy('cancellations')}
          >
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
                <option value="custom">Another amount</option>
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
              <span>What happens after the cancellation deadline?</span>
              <select
                value={visibleCancellationConsequence ?? ''}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  cancellations: {
                    ...current.cancellations,
                    consequence: event.target.value as typeof policies.cancellations.consequence,
                  },
                }))}
              >
                <option value="">Choose a consequence</option>
                {depositMode === 'fixed' ? (
                  <option value="deposit_lost">Keep the deposit</option>
                ) : null}
                <option value="cancellation_fee">Charge a cancellation fee</option>
                <option value="full_service_charge">Charge the full service price</option>
                <option value="custom">Something else</option>
              </select>
            </label>
            {policies.cancellations.consequence === 'custom' ? (
              <TextAreaField
                label="Custom consequence"
                placeholder="Describe what happens after the deadline"
                rows={2}
                value={policies.cancellations.customConsequence}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  cancellations: { ...current.cancellations, customConsequence: event.target.value },
                }))}
              />
            ) : null}
          </CollapsibleFormCard>
          <CollapsibleFormCard
            completed={depositMode === 'none'
              || (policies.deposits.refundable !== null
                && policies.deposits.transferable !== null)}
            id="onboarding-policy-deposits"
            open={openPolicy === 'deposits'}
            summary={depositSummary}
            title="Deposits"
            onToggle={() => togglePolicy('deposits')}
          >
            <div className="onboarding-deposit-answer">
              <span>From your Booking settings</span>
              <strong>{depositSummary}</strong>
              <small>The deposit choice and amount are set once in Booking.</small>
              {onEditBooking ? (
                <button type="button" onClick={onEditBooking}>
                  Edit deposit in Booking
                </button>
              ) : null}
            </div>
            {depositMode === 'fixed' ? (
              <div className="onboarding-deposit-details">
                <BooleanChoice
                  label="Can clients get their deposit back?"
                  value={policies.deposits.refundable}
                  onChange={(refundable) => updateDepositPolicy({ refundable })}
                />
                <BooleanChoice
                  label="Can clients move it to another appointment?"
                  value={policies.deposits.transferable}
                  onChange={(transferable) => updateDepositPolicy({ transferable })}
                />
              </div>
            ) : null}
          </CollapsibleFormCard>
          <CollapsibleFormCard
            completed={Boolean(policies.lateArrivals.gracePeriodMinutes.trim())}
            id="onboarding-policy-late-arrivals"
            open={openPolicy === 'late_arrivals'}
            summary={lateArrivalSummary}
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
                  if (value === 'custom') return;
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
            completed={Boolean(noShowPreset)}
            id="onboarding-policy-no-shows"
            open={openPolicy === 'no_shows'}
            summary={noShowSummary}
            title="No-shows"
            onToggle={() => togglePolicy('no_shows')}
          >
            <label className="onboarding-select-field">
              <span>What happens after a no-show?</span>
              <select
                value={noShowPreset}
                onChange={(event) => {
                  const preset = event.target.value;
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
                <option value="">Choose a consequence</option>
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
            completed={policies.repairs.noRepairPolicy
              || Boolean(policies.repairs.freeRepairWindowDays.trim())}
            id="onboarding-policy-repairs"
            open={openPolicy === 'repairs'}
            summary={repairSummary}
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
                  if (value === 'custom') return;
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
            completed={otherSummary === 'Appointment details added'}
            id="onboarding-policy-other"
            open={openPolicy === 'other'}
            summary={otherSummary}
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
                  if (value === 'custom') return;
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
                  if (value === 'custom') return;
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
      </div>
      <aside className="onboarding-screen__preview">
        <div className="onboarding-preview-card"><h2>What your clients will see</h2><PolicyCopyCards onUpdate={onUpdate} state={state} /></div>
      </aside>
      <StickyOnboardingActions
        backLabel="Back"
        primaryLabel="Save policies"
        skipLabel="Skip for now"
        onBack={onBack}
        onPrimary={onContinue}
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
  const confirmedStyleAtEntry = useRef(state.recipe.stylePreset);
  const selectedStyle = STYLE_PRESETS.find((preset) =>
    preset.id === state.recipe.stylePreset) ?? STYLE_PRESETS[0];
  const primaryLabel = state.recipe.styleConfirmed
    ? `Continue with ${selectedStyle?.label ?? 'this style'}`
    : `Use ${selectedStyle?.label ?? 'this style'}`;
  return (
    <div className="onboarding-screen onboarding-screen--style" data-screen="site_style">
      <div className="onboarding-screen__form">
        <ScreenHeading id="site_style" status="Essential" />
        <p className="onboarding-style-reassurance">
          Your pages, photos and information stay the same — only the style changes.
        </p>
        <div aria-label="Site style presets" className="onboarding-style-grid" role="group">
          {STYLE_PRESETS.map((preset) => {
            const roles = ONBOARDING_STYLE_ROLES[preset.id];
            const isCurrentStyle = preset.id === confirmedStyleAtEntry.current;
            const isSelectedStyle = preset.id === state.recipe.stylePreset
              && (!state.recipe.styleConfirmed || !isCurrentStyle);
            return (
              <button
                aria-pressed={state.recipe.stylePreset === preset.id}
                className="onboarding-style-card"
                data-selected={state.recipe.stylePreset === preset.id ? 'true' : 'false'}
                key={preset.id}
                style={{
                  '--swatch-accent': roles.accent,
                  '--swatch-body-font': roles.bodyFont,
                  '--swatch-button-radius': roles.buttonRadius,
                  '--swatch-ground': roles.ground,
                  '--swatch-heading-font': roles.headingFont,
                  '--swatch-ink': roles.ink,
                } as CSSProperties}
                type="button"
                onClick={() => onUpdate((current) => ({
                  ...current,
                  recipe: { ...current.recipe, styleConfirmed: false, stylePreset: preset.id },
                }))}
              >
                <span className="onboarding-style-swatch" aria-hidden="true">
                  <i>Aa</i><i>Beautiful nails, made for you.</i><i>Book now</i>
                </span>
                <strong>{preset.label}</strong>
                <small>{preset.description}</small>
                {isCurrentStyle || isSelectedStyle ? (
                  <span>
                    <Check aria-hidden="true" size={14} />
                    {isSelectedStyle ? 'Selected' : 'Current style'}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
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
          <span>{state.recipe.galleryEnabled ? 'Added' : 'Optional'}</span>
          <h2>Show off your work</h2>
          <p>{state.recipe.galleryEnabled
            ? `${galleryCount} ${galleryCount === 1 ? 'photo' : 'photos'} added · ${galleryLayout}`
            : 'Add photos of your nail sets so clients can see your style.'}</p>
          {state.recipe.galleryEnabled ? <strong>✓ Gallery added</strong> : null}
          <button type="button" onClick={onOpenGallery}>{state.recipe.galleryEnabled ? 'Edit Gallery' : 'Add Gallery'}</button>
        </article>
        <article className={`onboarding-extra-card${state.recipe.canvaEnabled ? ' is-added' : ''}${state.recipe.wantsCanvaFromWelcome ? ' is-recommended' : ''}`}>
          <FileImage aria-hidden="true" size={28} />
          <span>{state.recipe.canvaEnabled
            ? 'Added'
            : state.recipe.wantsCanvaFromWelcome
              ? 'Recommended for you'
              : 'Optional'}</span>
          <h2>Already have a Canva design?</h2>
          <p>{state.recipe.canvaEnabled
            ? `${canvaCount} Canva ${canvaCount === 1 ? 'page' : 'pages'} added · ${canvaPlacement}`
            : state.recipe.wantsCanvaFromWelcome
              ? 'You told us you already have a Canva design. Upload your pages and we’ll add them to your website.'
              : 'Upload your Canva pages and we’ll add them to your website.'}</p>
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
