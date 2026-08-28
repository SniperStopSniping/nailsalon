import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileImage,
  Images,
  Sparkles,
} from 'lucide-react';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';

import type { SiteBuilderDocument } from '../../model/types';
import { NativeSwitch, TextAreaField, TextField } from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { SCREEN_METADATA } from '../copy';
import {
  derivePolicySuggestedWording,
  refreshPolicySuggestedWording,
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

const ABOUT_ELEMENT_LABELS: Record<AboutElementId, string> = {
  appointment_status: 'Appointment status',
  bio: 'Bio',
  book_button: 'Book button',
  certifications: 'Certifications',
  experience: 'Experience',
  instagram: 'Instagram',
  languages: 'Languages',
  new_client_status: 'New-client status',
  owner_name: 'Name',
  policy_summary: 'Policy summary',
  profile_photo: 'Profile photo',
  salon_name: 'Salon name',
  specialties: 'Specialties',
};

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
  { description: 'Warm, balanced, and easy to scan.', id: 'modern', label: 'Modern' },
  { description: 'Magazine-inspired type and crisp structure.', id: 'editorial', label: 'Editorial' },
  { description: 'Gentle colour, generous curves, calm spacing.', id: 'soft', label: 'Soft' },
  { description: 'Quiet neutrals and pared-back details.', id: 'minimal', label: 'Minimal' },
  { description: 'High-contrast colour and confident geometry.', id: 'bold', label: 'Bold' },
  { description: 'Dark surfaces, fine lines, and gold accents.', id: 'luxury', label: 'Luxury' },
];

const updateProfile = (
  current: OnboardingLabState,
  update: (profile: BusinessProfileDraft) => BusinessProfileDraft,
): OnboardingLabState => ({ ...current, profile: update(current.profile) });

const commaList = (value: string): string[] => value
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const listValue = (values: readonly string[]): string => values.join(', ');

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

function AboutVisibilityControls({ onUpdate, state }: Pick<SharedScreenProps, 'onUpdate' | 'state'>) {
  return (
    <details className="onboarding-content-disclosure">
      <summary>Content shown on your site</summary>
      <div className="onboarding-content-toggle-grid">
        {(Object.keys(ABOUT_ELEMENT_LABELS) as AboutElementId[]).map((id) => (
          <NativeSwitch
            checked={state.profile.about.visibility[id]}
            key={id}
            label={ABOUT_ELEMENT_LABELS[id]}
            onChange={(checked) => onUpdate((current) => updateProfile(current, (profile) => ({
              ...profile,
              about: {
                ...profile.about,
                visibility: { ...profile.about.visibility, [id]: checked },
              },
            })))}
          />
        ))}
      </div>
    </details>
  );
}

export function AboutScreen({
  onBack,
  onContinue,
  onUpdate,
  state,
}: SharedScreenProps & { onContinue: () => void }) {
  const { about } = state.profile;
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
          onChange={(checked) => onUpdate((current) => ({
            ...current,
            recipe: { ...current.recipe, aboutEnabled: checked },
          }))}
        />
        {!state.recipe.aboutEnabled ? (
          <p aria-live="polite" className="onboarding-disabled-message">
            About section is not shown on your site. Your information stays saved.
          </p>
        ) : null}
        <fieldset className="onboarding-about-fields" disabled={!state.recipe.aboutEnabled}>
          <TextAreaField
            label="Short bio"
            maxLength={320}
            rows={4}
            value={about.shortBio}
            onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
              ...profile,
              about: { ...profile.about, shortBio: event.target.value },
            })))}
          />
          <button
            className="onboarding-prototype-helper"
            type="button"
            onClick={() => onUpdate((current) => updateProfile(current, (profile) => ({
              ...profile,
              about: {
                ...profile.about,
                shortBio: `${profile.ownerName || 'Your nail artist'} creates thoughtful, long-lasting nail services in a calm and welcoming studio.`,
              },
            })))}
          >
            <Sparkles aria-hidden="true" size={16} /> Help me with wording <span>Prototype helper</span>
          </button>
          <TextAreaField
            label="Full bio — optional"
            rows={6}
            value={about.fullBio}
            onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
              ...profile,
              about: { ...profile.about, fullBio: event.target.value },
            })))}
          />
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
              value={about.specialties.filter((item) => !SPECIALTY_OPTIONS.includes(item as typeof SPECIALTY_OPTIONS[number])).join(', ')}
              onChange={(event) => {
                const suggested = about.specialties.filter((item) => SPECIALTY_OPTIONS.includes(item as typeof SPECIALTY_OPTIONS[number]));
                onUpdate((current) => updateProfile(current, (profile) => ({
                  ...profile,
                  about: { ...profile.about, specialties: [...suggested, ...commaList(event.target.value)] },
                })));
              }}
            />
          </fieldset>
          <div className="onboarding-field-grid">
            <TextField
              label="Years of experience — optional"
              value={about.yearsOfExperience}
              onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
                ...profile,
                about: { ...profile.about, yearsOfExperience: event.target.value },
              })))}
            />
            <TextField
              label="Certifications — optional"
              placeholder="Separate with commas"
              value={listValue(about.certifications)}
              onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
                ...profile,
                about: { ...profile.about, certifications: commaList(event.target.value) },
              })))}
            />
            <TextField
              label="Languages — optional"
              placeholder="Separate with commas"
              value={listValue(about.languages)}
              onChange={(event) => onUpdate((current) => updateProfile(current, (profile) => ({
                ...profile,
                about: { ...profile.about, languages: commaList(event.target.value) },
              })))}
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
          <AboutVisibilityControls onUpdate={onUpdate} state={state} />
        </fieldset>
      </div>
      <aside className="onboarding-screen__preview">
        <OnboardingSitePreview document={null} label="About section live preview" state={state} />
      </aside>
      <StickyOnboardingActions
        backLabel="Back"
        primaryLabel={state.recipe.aboutEnabled ? 'Choose an About design' : 'Continue without About'}
        onBack={onBack}
        onPrimary={onContinue}
      />
    </div>
  );
}

export function AboutDesignScreen({
  document,
  onBack,
  onContinue,
  onUpdate,
  state,
}: SharedScreenProps & { document: SiteBuilderDocument | null; onContinue: () => void }) {
  const contentControlsId = useId();
  const [showContent, setShowContent] = useState(false);
  const selectedIndex = ABOUT_PRESETS.findIndex((preset) => preset.id === state.recipe.aboutPreset);
  const selectedPreset = ABOUT_PRESETS[selectedIndex] ?? ABOUT_PRESETS[0];
  const selectRelative = (delta: number) => {
    const next = ABOUT_PRESETS[(selectedIndex + delta + ABOUT_PRESETS.length) % ABOUT_PRESETS.length];
    if (next) onUpdate((current) => ({ ...current, recipe: { ...current.recipe, aboutPreset: next.id } }));
  };

  return (
    <div className="onboarding-screen onboarding-screen--designer" data-screen="about_design">
      <ScreenHeading id="about_design" status="Optional" />
      <div className="onboarding-designer-preview">
        <OnboardingSitePreview document={document} label="Selected About design preview" state={state} />
      </div>
      <div aria-label="About design carousel controls" className="onboarding-carousel-controls" role="group">
        <button aria-label="Previous About design" type="button" onClick={() => selectRelative(-1)}><ArrowLeft aria-hidden="true" /></button>
        <span aria-live="polite">{selectedPreset?.label} · {selectedIndex + 1} of {ABOUT_PRESETS.length}</span>
        <button aria-label="Next About design" type="button" onClick={() => selectRelative(1)}><ArrowRight aria-hidden="true" /></button>
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
          </button>
        ))}
      </div>
      <button
        aria-controls={contentControlsId}
        aria-expanded={showContent}
        className="onboarding-content-button"
        type="button"
        onClick={() => setShowContent((current) => !current)}
      >
        {showContent ? 'Hide content controls' : 'Content'}
      </button>
      <div hidden={!showContent} id={contentControlsId}>
        <AboutVisibilityControls onUpdate={onUpdate} state={state} />
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
  other: 'Other',
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
        const displayed = copy.useSuggestedWording ? suggestedWording : copy.wordingOverride;
        const updateCopy = (values: Partial<typeof copy>) => onUpdate((current) => updateProfile(current, (profile) => ({
          ...profile,
          policies: {
            ...profile.policies,
            copy: {
              ...profile.policies.copy,
              [id]: { ...profile.policies.copy[id], ...values },
            },
          },
        })));
        return (
          <article className="onboarding-policy-copy-card" key={id}>
            <header><h3>{POLICY_CARD_LABELS[id]}</h3><NativeSwitch checked={copy.visible} label={`Show ${POLICY_CARD_LABELS[id]} on site`} onChange={(visible) => updateCopy({ visible })} /></header>
            {copy.useSuggestedWording ? <p>{displayed || 'Answer the questions to generate suggested wording.'}</p> : (
              <TextAreaField label={`${POLICY_CARD_LABELS[id]} wording`} rows={3} value={copy.wordingOverride} onChange={(event) => updateCopy({ wordingOverride: event.target.value })} />
            )}
            <div>
              <button type="button" onClick={() => updateCopy({ useSuggestedWording: false, wordingOverride: copy.wordingOverride || suggestedWording })}>Edit wording</button>
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
  onSkip,
  onUpdate,
  state,
}: SharedScreenProps & { onContinue: () => void; onSkip: () => void }) {
  const policies = state.profile.policies;
  const updatePolicies = (update: (current: PoliciesDraft) => PoliciesDraft) => {
    onUpdate((current) => updateProfile(current, (profile) => ({
      ...profile,
      policies: refreshPolicySuggestedWording(update(profile.policies)),
    })));
  };
  return (
    <div className="onboarding-screen onboarding-screen--split" data-screen="policies">
      <div className="onboarding-screen__form">
        <ScreenHeading id="policies" status="Recommended · Skippable" />
        <NativeSwitch
          checked={state.recipe.policiesEnabled}
          description="Operational answers remain saved even when website wording is hidden."
          label="Show policies on my website"
          onChange={(checked) => onUpdate((current) => ({ ...current, recipe: { ...current.recipe, policiesEnabled: checked } }))}
        />
        <div className="onboarding-policy-questions">
          <fieldset>
            <legend>Cancellations</legend>
            <label className="onboarding-select-field">
              <span>Required notice</span>
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
                <option value="">Choose</option>
                <option value="12_hours">12 hours</option>
                <option value="24_hours">24 hours</option>
                <option value="48_hours">48 hours</option>
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
              <span>After deadline</span>
              <select
                value={policies.cancellations.consequence ?? ''}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  cancellations: {
                    ...current.cancellations,
                    consequence: event.target.value as typeof policies.cancellations.consequence,
                  },
                }))}
              >
                <option value="">Choose</option>
                <option value="deposit_lost">Deposit is lost</option>
                <option value="cancellation_fee">Cancellation fee</option>
                <option value="full_service_charge">Full service charge</option>
                <option value="custom">Custom</option>
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
          </fieldset>
          <fieldset>
            <legend>Deposits</legend>
            <BooleanChoice
              label="Required?"
              value={policies.deposits.required}
              onChange={(required) => updatePolicies((current) => ({
                ...current,
                deposits: { ...current.deposits, required },
              }))}
            />
            <label className="onboarding-select-field">
              <span>Fixed amount or percentage?</span>
              <select
                value={policies.deposits.amountType ?? ''}
                onChange={(event) => updatePolicies((current) => ({
                  ...current,
                  deposits: {
                    ...current.deposits,
                    amountType: event.target.value as typeof policies.deposits.amountType,
                  },
                }))}
              >
                <option value="">Choose</option>
                <option value="fixed">Fixed amount</option>
                <option value="percentage">Percentage</option>
              </select>
            </label>
            <TextField
              inputMode="decimal"
              label="Amount"
              value={policies.deposits.amount}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                deposits: { ...current.deposits, amount: event.target.value },
              }))}
            />
            <BooleanChoice
              label="Refundable?"
              value={policies.deposits.refundable}
              onChange={(refundable) => updatePolicies((current) => ({
                ...current,
                deposits: { ...current.deposits, refundable },
              }))}
            />
            <BooleanChoice
              label="Transferable?"
              value={policies.deposits.transferable}
              onChange={(transferable) => updatePolicies((current) => ({
                ...current,
                deposits: { ...current.deposits, transferable },
              }))}
            />
          </fieldset>
          <fieldset>
            <legend>Late arrivals</legend>
            <TextField
              inputMode="numeric"
              label="Grace period (minutes)"
              value={policies.lateArrivals.gracePeriodMinutes}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                lateArrivals: { ...current.lateArrivals, gracePeriodMinutes: event.target.value },
              }))}
            />
            <BooleanChoice
              label="Shorten service?"
              value={policies.lateArrivals.shortenService}
              onChange={(shortenService) => updatePolicies((current) => ({
                ...current,
                lateArrivals: { ...current.lateArrivals, shortenService },
              }))}
            />
            <BooleanChoice
              label="Reschedule after limit?"
              value={policies.lateArrivals.rescheduleAfterLimit}
              onChange={(rescheduleAfterLimit) => updatePolicies((current) => ({
                ...current,
                lateArrivals: { ...current.lateArrivals, rescheduleAfterLimit },
              }))}
            />
          </fieldset>
          <fieldset>
            <legend>No-shows</legend>
            <NativeSwitch
              checked={policies.noShows.loseDeposit}
              label="Lose deposit"
              onChange={(loseDeposit) => updatePolicies((current) => ({
                ...current,
                noShows: { ...current.noShows, loseDeposit },
              }))}
            />
            <NativeSwitch
              checked={policies.noShows.fullCharge}
              label="Full charge"
              onChange={(fullCharge) => updatePolicies((current) => ({
                ...current,
                noShows: { ...current.noShows, fullCharge },
              }))}
            />
            <NativeSwitch
              checked={policies.noShows.paymentRequiredToRebook}
              label="Cannot rebook without payment"
              onChange={(paymentRequiredToRebook) => updatePolicies((current) => ({
                ...current,
                noShows: { ...current.noShows, paymentRequiredToRebook },
              }))}
            />
            <TextAreaField
              label="Custom no-show rule"
              rows={2}
              value={policies.noShows.custom}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                noShows: { ...current.noShows, custom: event.target.value },
              }))}
            />
          </fieldset>
          <fieldset>
            <legend>Repairs</legend>
            <TextField
              inputMode="numeric"
              label="Free repair window (days)"
              value={policies.repairs.freeRepairWindowDays}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                repairs: { ...current.repairs, freeRepairWindowDays: event.target.value },
              }))}
            />
            <TextAreaField
              label="Conditions"
              rows={2}
              value={policies.repairs.conditions}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                repairs: { ...current.repairs, conditions: event.target.value },
              }))}
            />
            <NativeSwitch
              checked={policies.repairs.noRepairPolicy}
              label="No repair policy"
              onChange={(noRepairPolicy) => updatePolicies((current) => ({
                ...current,
                repairs: { ...current.repairs, noRepairPolicy },
              }))}
            />
          </fieldset>
          <fieldset>
            <legend>Other</legend>
            <TextField
              label="Guests"
              value={policies.other.guests}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, guests: event.target.value },
              }))}
            />
            <TextField
              label="Children"
              value={policies.other.children}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, children: event.target.value },
              }))}
            />
            <TextAreaField
              label="Appointment preparation"
              rows={2}
              value={policies.other.appointmentPreparation}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, appointmentPreparation: event.target.value },
              }))}
            />
            <TextField
              label="Removal from another salon"
              value={policies.other.outsideRemoval}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, outsideRemoval: event.target.value },
              }))}
            />
            <TextAreaField
              label="Custom policy"
              rows={2}
              value={policies.other.custom}
              onChange={(event) => updatePolicies((current) => ({
                ...current,
                other: { ...current.other, custom: event.target.value },
              }))}
            />
          </fieldset>
        </div>
      </div>
      <aside className="onboarding-screen__preview">
        <div className="onboarding-preview-card"><h2>Live policy wording</h2><PolicyCopyCards onUpdate={onUpdate} state={state} /></div>
      </aside>
      <StickyOnboardingActions backLabel="Back" primaryLabel="Save policies" skipLabel="Skip for now" onBack={onBack} onPrimary={onContinue} onSkip={onSkip} />
    </div>
  );
}

export function SiteStyleScreen({
  document,
  onBack,
  onContinue,
  onFullPreview,
  onKeepCurrent,
  onUpdate,
  state,
}: SharedScreenProps & {
  document: SiteBuilderDocument | null;
  onContinue: () => void;
  onFullPreview: () => void;
  onKeepCurrent: () => void;
}) {
  return (
    <div className="onboarding-screen onboarding-screen--style" data-screen="site_style">
      <div className="onboarding-screen__form">
        <ScreenHeading id="site_style" status="Essential" />
        <div aria-label="Site style presets" className="onboarding-style-grid" role="group">
          {STYLE_PRESETS.map((preset) => {
            const roles = ONBOARDING_STYLE_ROLES[preset.id];
            return (
              <button
                aria-pressed={state.recipe.stylePreset === preset.id}
                className="onboarding-style-card"
                data-selected={state.recipe.stylePreset === preset.id ? 'true' : 'false'}
                key={preset.id}
                style={{ '--swatch-accent': roles.accent, '--swatch-ground': roles.ground, '--swatch-ink': roles.ink } as CSSProperties}
                type="button"
                onClick={() => onUpdate((current) => ({
                  ...current,
                  recipe: { ...current.recipe, styleConfirmed: false, stylePreset: preset.id },
                }))}
              >
                <span className="onboarding-style-swatch" aria-hidden="true"><i /><i /><i /></span>
                <strong>{preset.label}</strong>
                <small>{preset.description}</small>
                {state.recipe.stylePreset === preset.id ? <span><Check aria-hidden="true" size={14} /> Selected</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <aside className="onboarding-screen__preview is-preview-first">
        <OnboardingSitePreview document={document} label="Live personalized style preview" state={state} />
        <button className="onboarding-full-preview-button" type="button" onClick={onFullPreview}>View full preview</button>
      </aside>
      <StickyOnboardingActions backLabel="Back" primaryLabel="Use this style" skipLabel="Keep current style" onBack={onBack} onPrimary={onContinue} onSkip={onKeepCurrent} />
    </div>
  );
}

export function ExtrasScreen({
  onBack,
  onContinue,
  onOpenCanva,
  onOpenGallery,
  onSkip,
  state,
}: Omit<SharedScreenProps, 'onUpdate'> & {
  onContinue: () => void;
  onOpenCanva: () => void;
  onOpenGallery: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="onboarding-screen" data-screen="extras">
      <ScreenHeading id="extras" status="Optional" />
      <div className="onboarding-extra-grid">
        <article className={`onboarding-extra-card${state.recipe.galleryEnabled ? ' is-added' : ''}`}>
          <Images aria-hidden="true" size={28} />
          <span>{state.recipe.galleryEnabled ? 'Added' : 'Optional'}</span>
          <h2>Add your work</h2>
          <p>Upload portfolio photos or use the mock Luster portfolio.</p>
          <ul><li>Grid</li><li>Carousel</li><li>Editorial</li></ul>
          <button type="button" onClick={onOpenGallery}>{state.recipe.galleryEnabled ? 'Edit Gallery' : 'Add Gallery'}</button>
        </article>
        <article className={`onboarding-extra-card${state.recipe.canvaEnabled ? ' is-added' : ''}${state.recipe.wantsCanvaFromWelcome ? ' is-recommended' : ''}`}>
          <FileImage aria-hidden="true" size={28} />
          <span>{state.recipe.wantsCanvaFromWelcome ? 'Recommended from your welcome choice' : state.recipe.canvaEnabled ? 'Added' : 'Optional'}</span>
          <h2>Upload a Canva design</h2>
          <p>Upload one or several PNG, JPG, or WebP pages through Luster’s real Custom Design section.</p>
          <ul><li>Poster</li><li>Contained</li><li>Full width</li></ul>
          <button type="button" onClick={onOpenCanva}>{state.recipe.canvaEnabled ? 'Edit Canva design' : 'Upload Canva design'}</button>
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
      <StickyOnboardingActions backLabel="Back" primaryLabel="Continue to review" skipLabel="Skip extras" onBack={onBack} onPrimary={onContinue} onSkip={onSkip} />
    </div>
  );
}

export function OnboardingSubflowActions({ children }: { children: ReactNode }) {
  return <div className="onboarding-subflow-actions">{children}</div>;
}
