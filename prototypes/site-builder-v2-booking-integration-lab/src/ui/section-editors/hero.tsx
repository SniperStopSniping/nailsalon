import type { HeroSettings } from '../../model/section-library/settings';
import { BoundTextField, ChoiceField, TextField, ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/**
 * Hero binds the shared profile: the headline defaults to the business name
 * and the intro to the shared structure-aware line, exactly as the customer
 * renderer resolves them. An override is deliberate and never rewrites the
 * profile. The design picker belongs to the dialog shell.
 */
export function HeroEditor({
  onChange,
  profile,
  settings,
}: LibrarySectionEditorProps<'hero'>) {
  const sharedHeadline = profile.businessName.trim() || 'Your nail studio';
  const sharedIntro = profile.businessStructure === 'multi_tech'
    ? 'Thoughtful nail care from a team, shaped around you.'
    : 'Thoughtful nail care, shaped around you.';
  const eyebrow = profile.location.cityOrArea.trim() || 'Independent nail care';
  return (
    <>
      <BoundTextField
        label="Headline"
        maxLength={80}
        onChange={headline => onChange({ ...settings, headline } satisfies HeroSettings)}
        sharedLabel="Use my business name"
        sharedValue={sharedHeadline}
        value={settings.headline}
      />
      <BoundTextField
        label="Intro line"
        maxLength={160}
        onChange={intro => onChange({ ...settings, intro } satisfies HeroSettings)}
        sharedLabel="Use the standard line"
        sharedValue={sharedIntro}
        value={settings.intro}
      />
      <ChoiceField
        label="Hero image"
        onChange={media => onChange({ ...settings, media } satisfies HeroSettings)}
        options={[
          { label: 'My photo', value: 'profile_photo' },
          { label: 'Logo emblem', value: 'logo_emblem' },
          { label: 'Soft gradient', value: 'gradient' },
        ]}
        value={settings.media}
      />
      <ToggleField
        hint={`Shows “${eyebrow}” above your headline.`}
        label="Show the location line"
        onChange={showLocationEyebrow => onChange({
          ...settings,
          showLocationEyebrow,
        } satisfies HeroSettings)}
        value={settings.showLocationEyebrow}
      />
      <ToggleField
        hint="Shows appointment mode, new-client status, and today’s open status — each one only when you have set it."
        label="Show the status line"
        onChange={showStatusLine => onChange({
          ...settings,
          showStatusLine,
        } satisfies HeroSettings)}
        value={settings.showStatusLine}
      />
      <TextField
        hint="Up to 40 characters. Left empty, the button reads “Book an appointment”."
        label="Booking button label"
        maxLength={40}
        onChange={primaryCtaLabel => onChange({
          ...settings,
          primaryCtaLabel,
        } satisfies HeroSettings)}
        placeholder="Book an appointment"
        value={settings.primaryCtaLabel}
      />
    </>
  );
}
