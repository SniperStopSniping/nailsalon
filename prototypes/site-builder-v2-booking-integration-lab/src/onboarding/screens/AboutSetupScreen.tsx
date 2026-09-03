import {
  Award,
  Check,
  ChevronDown,
  ChevronRight,
  Languages as LanguagesIcon,
  Pencil,
  Plus,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import { Dialog } from '../../ui/Dialog';
import { NativeSwitch } from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { recordOnboardingEvent } from '../events/journal';
import { useFeedback } from '../feedback/useFeedback';
import { resolveOnboardingImage } from '../integrations/adapters/media';
import { buildAboutWordingSuggestion } from '../model/about';
import type {
  AboutElementId,
  BusinessProfileDraft,
  OnboardingLabState,
} from '../model/types';

type OnboardingStateUpdater = (
  update: (current: OnboardingLabState) => OnboardingLabState,
) => void;

type AboutSetupScreenProps = {
  onBack: () => void;
  onContinue: () => void;
  onEditProfile?: () => void;
  onUpdate: OnboardingStateUpdater;
  onWritingHelperOpenChange?: (open: boolean) => void;
  state: OnboardingLabState;
};

type AboutTaskId = 'introduction' | 'specialties' | 'details';
type DetailEditor = 'certifications' | 'full_bio' | 'languages' | null;

const SHORT_INTRODUCTION_LIMIT = 180;
const SPECIALTY_OPTIONS = [
  'Russian Manicure',
  'BIAB',
  'Gel-X',
  'Hard Gel',
  'Nail Art',
  'Pedicures',
  'Natural Nail Care',
] as const;

const updateProfile = (
  current: OnboardingLabState,
  update: (profile: BusinessProfileDraft) => BusinessProfileDraft,
): OnboardingLabState => ({ ...current, profile: update(current.profile) });

const updateAbout = (
  current: OnboardingLabState,
  patch: Partial<BusinessProfileDraft['about']>,
  visibleElement?: AboutElementId,
): OnboardingLabState => updateProfile(current, (profile) => ({
  ...profile,
  about: {
    ...profile.about,
    ...patch,
    visibility: visibleElement
      ? { ...profile.about.visibility, [visibleElement]: true }
      : profile.about.visibility,
  },
}));

const cleanListValue = (value: string): string => value.trim().replace(/\s+/gu, ' ');

const clampSuggestion = (value: string): string => {
  const clean = cleanListValue(value);
  if (clean.length <= SHORT_INTRODUCTION_LIMIT) return clean;
  const candidate = clean.slice(0, SHORT_INTRODUCTION_LIMIT - 1);
  const lastSpace = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, lastSpace > 120 ? lastSpace : candidate.length).trim()}…`;
};

function AboutTaskCard({
  badge,
  children,
  complete,
  id,
  number,
  onToggle,
  open,
  summary,
  supportingText,
  title,
}: {
  badge?: string;
  children: ReactNode;
  complete?: boolean;
  id: AboutTaskId;
  number: number;
  onToggle: (id: AboutTaskId) => void;
  open: boolean;
  summary?: string;
  supportingText: string;
  title: string;
}) {
  const contentId = useId();

  return (
    <section className={`screen-eight-task${open ? ' is-open' : ''}${complete ? ' is-complete' : ''}`}>
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="screen-eight-task__trigger"
        type="button"
        onClick={() => onToggle(id)}
      >
        <span className="screen-eight-task__number">{complete ? <Check aria-hidden="true" size={15} /> : number}</span>
        <span className="screen-eight-task__heading">
          <span className="screen-eight-task__title-row">
            <strong>{title}</strong>
            {badge ? <small>{badge}</small> : null}
          </span>
          <span>{summary || supportingText}</span>
        </span>
        {complete ? <span className="screen-eight-task__complete">Complete <Check aria-hidden="true" size={14} /></span> : null}
        <ChevronDown aria-hidden="true" className="screen-eight-task__chevron" size={19} />
      </button>
      {open ? <div className="screen-eight-task__content" id={contentId}>{children}</div> : null}
    </section>
  );
}

function SavedIdentity({
  onEditProfile,
  profile,
}: {
  onEditProfile?: () => void;
  profile: BusinessProfileDraft;
}) {
  const assetIds = profile.profilePhoto?.storageId ? [profile.profilePhoto.storageId] : [];
  const assets = useCustomDesignAssetMap(assetIds);
  const profileImage = resolveOnboardingImage(profile.profilePhoto, assets);
  const initials = (profile.ownerName || profile.businessName || 'L')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="screen-eight-identity">
      {profileImage.status === 'ready' ? (
        <img
          alt={`${profile.ownerName || 'Nail tech'} profile photo`}
          data-media-id={profile.profilePhoto?.storageId ?? profile.profilePhoto?.id}
          src={profileImage.url}
        />
      ) : (
        <span aria-hidden="true" className="screen-eight-identity__fallback">{initials || 'L'}</span>
      )}
      <span className="screen-eight-identity__copy">
        <strong>{profile.ownerName.trim() || 'Your profile'}</strong>
        <span>{profile.businessName.trim() || 'Your business'}</span>
        <small><Check aria-hidden="true" size={13} /> Saved</small>
      </span>
      <button type="button" onClick={onEditProfile}>
        <Pencil aria-hidden="true" size={15} /> Edit profile
      </button>
    </div>
  );
}

export function AboutSetupScreen({
  onBack,
  onContinue,
  onEditProfile,
  onUpdate,
  onWritingHelperOpenChange,
  state,
}: AboutSetupScreenProps) {
  const { about } = state.profile;
  const feedback = useFeedback();
  const listInputId = useId();
  const [openTask, setOpenTask] = useState<AboutTaskId | null>('introduction');
  const [detailEditor, setDetailEditor] = useState<DetailEditor>(null);
  const [customSpecialty, setCustomSpecialty] = useState('');
  const [listDraft, setListDraft] = useState('');
  const listDraftRef = useRef('');
  const fullBioInputRef = useRef<HTMLTextAreaElement>(null);
  const writingContextRef = useRef('');
  const [writingStep, setWritingStep] = useState<{
    phase: 'context' | 'suggestion';
    suggestion: string;
  } | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const introductionComplete = Boolean(about.shortBio.trim());
  const specialtiesPopulated = about.specialties.length > 0 || Boolean(about.yearsOfExperience.trim());
  const detailsPopulated = Boolean(
    about.fullBio.trim() || about.certifications.length || about.languages.length,
  );
  const previousIntroductionComplete = useRef(introductionComplete);

  useEffect(() => () => onWritingHelperOpenChange?.(false), [onWritingHelperOpenChange]);

  useEffect(() => {
    if (!previousIntroductionComplete.current && introductionComplete) {
      feedback.send({
        kind: 'completed',
        message: 'About added. Nice! Clients can now get to know you.',
        onceKey: 'about_introduction_added',
        visual: false,
      });
    }
    previousIntroductionComplete.current = introductionComplete;
  }, [feedback, introductionComplete]);

  const setAboutEnabled = (checked: boolean) => {
    feedback.send({ kind: 'selection' });
    onUpdate((current) => ({
      ...current,
      recipe: { ...current.recipe, aboutEnabled: checked },
    }));
    if (checked) setOpenTask('introduction');
  };

  const toggleSpecialty = (specialty: string) => {
    feedback.send({ kind: 'selection' });
    onUpdate((current) => updateAbout(current, {
      specialties: current.profile.about.specialties.includes(specialty)
        ? current.profile.about.specialties.filter((item) => item !== specialty)
        : [...current.profile.about.specialties, specialty],
    }, 'specialties'));
  };

  const addCustomSpecialty = () => {
    const specialty = cleanListValue(customSpecialty);
    if (!specialty || about.specialties.some((item) => item.toLowerCase() === specialty.toLowerCase())) return;
    onUpdate((current) => updateAbout(current, {
      specialties: [...current.profile.about.specialties, specialty],
    }, 'specialties'));
    setCustomSpecialty('');
  };

  const openWritingHelper = () => {
    setWritingStep({ phase: 'context', suggestion: '' });
    onWritingHelperOpenChange?.(true);
    onUpdate((current) => recordOnboardingEvent(current, {
      action: 'opened',
      type: 'about_wording_helper',
    }));
  };

  const closeWritingHelper = () => {
    setWritingStep(null);
    onWritingHelperOpenChange?.(false);
  };

  const generateSuggestion = () => {
    const knownFacts = buildAboutWordingSuggestion(state.profile);
    const ownerContext = cleanListValue(writingContextRef.current);
    const suggestion = clampSuggestion(ownerContext
      ? `${knownFacts.split(/(?<=[.!?])\s/u)[0] ?? ''} ${ownerContext}`
      : knownFacts);
    setWritingStep({ phase: 'suggestion', suggestion });
  };

  const useSuggestion = () => {
    if (!writingStep?.suggestion) return;
    onUpdate((current) => recordOnboardingEvent(
      updateAbout(current, { shortBio: writingStep.suggestion }, 'bio'),
      { action: 'used', type: 'about_wording_helper' },
    ));
    setSuggestionApplied(true);
    closeWritingHelper();
  };

  const openDetailEditor = (editor: Exclude<DetailEditor, null>) => {
    listDraftRef.current = '';
    setListDraft('');
    setDetailEditor(editor);
  };

  const addListItem = (field: 'certifications' | 'languages') => {
    const value = cleanListValue(listDraftRef.current);
    if (!value || about[field].some((item) => item.toLowerCase() === value.toLowerCase())) return;
    onUpdate((current) => updateAbout(current, {
      [field]: [...current.profile.about[field], value],
    }, field));
    setListDraft('');
    listDraftRef.current = '';
  };

  const removeListItem = (field: 'certifications' | 'languages', value: string) => {
    onUpdate((current) => updateAbout(current, {
      [field]: current.profile.about[field].filter((item) => item !== value),
    }, field));
  };

  const specialtiesSummary = [
    ...about.specialties.slice(0, 3),
    about.yearsOfExperience.trim() ? `${about.yearsOfExperience.trim()} years` : '',
  ].filter(Boolean).join(' · ');
  const detailSummary = [
    about.fullBio.trim() ? 'Bio' : '',
    about.languages.length ? `${about.languages.length} ${about.languages.length === 1 ? 'language' : 'languages'}` : '',
    about.certifications.length ? `${about.certifications.length} ${about.certifications.length === 1 ? 'certification' : 'certifications'}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="onboarding-screen screen-eight-about" data-screen="about">
      <header className="onboarding-screen-heading screen-eight-about__heading">
        <span className="onboarding-screen-status">Step 8 — About</span>
        <h1>Tell clients a little about you</h1>
        <p>Add as much or as little as you like.<br />You can always update this from your dashboard.</p>
      </header>

      <aside className="screen-eight-helper">
        <Sparkles aria-hidden="true" size={20} />
        <div>
          <strong>KEEP IT SIMPLE</strong>
          <p>You don’t need to write your whole story now. A short introduction is enough to get started — you can add more anytime from your dashboard.</p>
        </div>
      </aside>

      <NativeSwitch
        checked={state.recipe.aboutEnabled}
        description="Give clients a quick introduction to you and your work."
        label="Show an About section"
        onChange={setAboutEnabled}
      />

      {!state.recipe.aboutEnabled ? (
        <p aria-live="polite" className="screen-eight-hidden-note" role="status">
          Your About information is saved, but it won’t appear on your site.
        </p>
      ) : (
        <div className="screen-eight-about__tasks">
          <AboutTaskCard
            complete={introductionComplete}
            id="introduction"
            number={1}
            onToggle={(id) => setOpenTask((current) => current === id ? null : id)}
            open={openTask === 'introduction'}
            summary={introductionComplete && openTask !== 'introduction' ? 'Short introduction added' : undefined}
            supportingText="A quick intro clients can read at a glance."
            title="Introduction"
          >
            <SavedIdentity onEditProfile={onEditProfile} profile={state.profile} />
            <div className={`screen-eight-short-intro${suggestionApplied ? ' is-highlighted' : ''}`}>
              <div className="screen-eight-field-label">
                <label htmlFor="screen-eight-short-intro">Short introduction</label>
                <button type="button" onClick={openWritingHelper}>
                  <Sparkles aria-hidden="true" size={14} /> Help me write
                </button>
              </div>
              <textarea
                id="screen-eight-short-intro"
                maxLength={SHORT_INTRODUCTION_LIMIT}
                placeholder="Example: Share what clients can expect at an appointment, what you specialize in, and what makes your approach yours."
                rows={5}
                value={about.shortBio}
                onChange={(event) => {
                  setSuggestionApplied(false);
                  onUpdate((current) => updateAbout(current, { shortBio: event.target.value }, 'bio'));
                }}
              />
              <span className="screen-eight-character-count">{about.shortBio.length} / {SHORT_INTRODUCTION_LIMIT}</span>
            </div>
            <button className="screen-eight-writing-prompt" type="button" onClick={openWritingHelper}>
              <Sparkles aria-hidden="true" size={18} />
              <span><strong>Need help getting started?</strong><small>Use AI to write a suggestion — you can edit it before saving.</small></span>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </AboutTaskCard>

          <AboutTaskCard
            badge="Optional"
            complete={specialtiesPopulated}
            id="specialties"
            number={2}
            onToggle={(id) => setOpenTask((current) => current === id ? null : id)}
            open={openTask === 'specialties'}
            summary={specialtiesPopulated && openTask !== 'specialties' ? specialtiesSummary : undefined}
            supportingText="Highlight what you’re known for."
            title="Specialties & experience"
          >
            <fieldset className="screen-eight-specialties">
              <legend>What are your specialties?</legend>
              <p>Select all that apply.</p>
              <div>
                {SPECIALTY_OPTIONS.map((specialty) => (
                  <label key={specialty}>
                    <input
                      checked={about.specialties.includes(specialty)}
                      type="checkbox"
                      onChange={() => toggleSpecialty(specialty)}
                    />
                    <span>{specialty}<Check aria-hidden="true" size={13} /></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="screen-eight-add-own">
              <label htmlFor="screen-eight-custom-specialty">Add your own</label>
              <span>
                <input
                  id="screen-eight-custom-specialty"
                  placeholder="e.g. Structured gel, Bridal nails"
                  value={customSpecialty}
                  onChange={(event) => setCustomSpecialty(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCustomSpecialty();
                    }
                  }}
                />
                <button aria-label="Add specialty" type="button" onClick={addCustomSpecialty}><Plus aria-hidden="true" size={18} /></button>
              </span>
            </div>
            {about.specialties.some((item) => !SPECIALTY_OPTIONS.includes(item as typeof SPECIALTY_OPTIONS[number])) ? (
              <div aria-label="Custom specialties" className="screen-eight-removable-list">
                {about.specialties.filter((item) => !SPECIALTY_OPTIONS.includes(item as typeof SPECIALTY_OPTIONS[number])).map((item) => (
                  <span key={item}>{item}<button aria-label={`Remove ${item}`} type="button" onClick={() => toggleSpecialty(item)}><X aria-hidden="true" size={13} /></button></span>
                ))}
              </div>
            ) : null}
            <label className="screen-eight-experience">
              <span>Years of experience <small>Optional</small></span>
              <input
                inputMode="numeric"
                max="80"
                min="0"
                type="number"
                value={about.yearsOfExperience}
                onChange={(event) => onUpdate((current) => updateAbout(current, {
                  yearsOfExperience: event.target.value,
                }, 'experience'))}
              />
              <small>We’ll only use this if you choose to add it.</small>
            </label>
          </AboutTaskCard>

          <AboutTaskCard
            badge="Optional"
            complete={detailsPopulated}
            id="details"
            number={3}
            onToggle={(id) => setOpenTask((current) => current === id ? null : id)}
            open={openTask === 'details'}
            summary={detailsPopulated && openTask !== 'details' ? detailSummary : undefined}
            supportingText="Bio, languages & certifications"
            title="Add more details"
          >
            <div className="screen-eight-detail-rows">
              <button type="button" onClick={() => openDetailEditor('full_bio')}>
                <UserRound aria-hidden="true" size={17} />
                <span><strong>Full bio</strong><small>{about.fullBio.trim() ? 'Added' : 'Not added'}</small></span>
                {about.fullBio.trim() ? <Check aria-hidden="true" className="is-complete" size={16} /> : <ChevronRight aria-hidden="true" size={17} />}
              </button>
              <button type="button" onClick={() => openDetailEditor('certifications')}>
                <Award aria-hidden="true" size={17} />
                <span><strong>Certifications</strong><small>{about.certifications.length ? `${about.certifications.length} added` : 'Not added'}</small></span>
                {about.certifications.length ? <Check aria-hidden="true" className="is-complete" size={16} /> : <ChevronRight aria-hidden="true" size={17} />}
              </button>
              <button type="button" onClick={() => openDetailEditor('languages')}>
                <LanguagesIcon aria-hidden="true" size={17} />
                <span><strong>Languages</strong><small>{about.languages.length ? `${about.languages.length} added` : 'Not added'}</small></span>
                {about.languages.length ? <Check aria-hidden="true" className="is-complete" size={16} /> : <ChevronRight aria-hidden="true" size={17} />}
              </button>
            </div>
            <button className="screen-eight-add-detail" type="button" onClick={() => openDetailEditor(
              !about.fullBio.trim() ? 'full_bio' : !about.certifications.length ? 'certifications' : 'languages',
            )}><Plus aria-hidden="true" size={16} /> Add another detail</button>
          </AboutTaskCard>
        </div>
      )}

      {state.recipe.aboutEnabled && introductionComplete ? (
        <aside aria-live="polite" className="screen-eight-about-added" role="status">
          <span><Check aria-hidden="true" size={18} /></span>
          <div><strong>About added</strong><p>Nice! Clients can now get to know you.</p></div>
          <Sparkles aria-hidden="true" size={22} />
        </aside>
      ) : null}

      <p className="screen-eight-about__reassurance">🔒 You can update your About anytime from your dashboard.</p>
      <StickyOnboardingActions
        backLabel="Back"
        primaryFirst
        primaryLabel="Save and continue"
        skipLabel="Skip for now"
        onBack={onBack}
        onPrimary={onContinue}
        onSkip={() => {
          onUpdate((current) => ({
            ...current,
            recipe: { ...current.recipe, aboutEnabled: false },
          }));
          onContinue();
        }}
      />

      <Dialog
        description={writingStep?.phase === 'suggestion'
          ? 'Review this suggestion before adding it to your introduction.'
          : 'Share a few facts and Luster will draft a short introduction you can edit.'}
        onClose={closeWritingHelper}
        open={writingStep !== null}
        title={writingStep?.phase === 'suggestion'
          ? 'Your suggested introduction'
          : 'Tell us a little about yourself'}
      >
        {writingStep?.phase === 'suggestion' ? (
          <div className="screen-eight-editor">
            <div className="screen-eight-suggestion"><strong>Suggestion</strong><p>{writingStep.suggestion}</p></div>
            <div className="screen-eight-editor__actions">
              <button type="button" onClick={closeWritingHelper}>Cancel</button>
              <button type="button" onClick={generateSuggestion}>Try again</button>
              <button className="is-primary" type="button" onClick={useSuggestion}>Use suggestion</button>
            </div>
          </div>
        ) : (
          <div className="screen-eight-editor">
            <label>
              <span>Tell us a little about yourself</span>
              <textarea
              placeholder="I specialize in structured manicures and natural nails. I like appointments to feel relaxed and never rushed."
              rows={5}
              defaultValue={writingContextRef.current}
              onChange={(event) => { writingContextRef.current = event.target.value; }}
              />
            </label>
            <div className="screen-eight-editor__actions">
              <button type="button" onClick={closeWritingHelper}>Cancel</button>
              <button className="is-primary" type="button" onClick={generateSuggestion}>Generate suggestion</button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        description={detailEditor === 'full_bio'
          ? 'Tell clients more about your story, approach or appointment experience.'
          : detailEditor === 'certifications'
            ? 'Add only certifications you have earned.'
            : 'Add the languages you can use with clients.'}
        onClose={() => setDetailEditor(null)}
        open={detailEditor !== null}
        title={detailEditor === 'full_bio'
          ? 'Full bio · Optional'
          : detailEditor === 'certifications'
            ? 'Certifications · Optional'
            : 'Languages · Optional'}
      >
        <div className="screen-eight-editor">
          {detailEditor === 'full_bio' ? (
            <label>
              <span>Full bio</span>
              <textarea
                ref={fullBioInputRef}
                defaultValue={about.fullBio}
                placeholder="Tell clients how you got started, what you love about doing nails, or what they can expect when they book with you."
                rows={8}
              />
            </label>
          ) : detailEditor ? (
            <>
              <div className="screen-eight-list-editor">
                {about[detailEditor].map((item) => (
                  <span key={item}>{item}<button aria-label={`Remove ${item}`} type="button" onClick={() => removeListItem(detailEditor, item)}><X aria-hidden="true" size={15} /></button></span>
                ))}
              </div>
              <div>
                <label htmlFor={listInputId}>{detailEditor === 'certifications' ? 'Add certification' : 'Add language'}</label>
                <div className="screen-eight-editor__add-row">
                  <input
                    id={listInputId}
                    placeholder={detailEditor === 'certifications' ? 'e.g. Gel-X Certification' : 'e.g. English'}
                    key={`${detailEditor}-${listDraft}`}
                    defaultValue={listDraftRef.current}
                    onChange={(event) => { listDraftRef.current = event.target.value; }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addListItem(detailEditor);
                      }
                    }}
                  />
                  <button type="button" onClick={() => addListItem(detailEditor)}><Plus aria-hidden="true" size={17} /> Add</button>
                </div>
              </div>
            </>
          ) : null}
          <div className="screen-eight-editor__actions">
            <button type="button" onClick={() => setDetailEditor(null)}>Cancel</button>
            <button
              className="is-primary"
              type="button"
              onClick={() => {
                if (detailEditor === 'full_bio') {
                  onUpdate((current) => updateAbout(current, {
                    fullBio: fullBioInputRef.current?.value ?? current.profile.about.fullBio,
                  }, 'bio'));
                }
                setDetailEditor(null);
              }}
            >Save</button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
