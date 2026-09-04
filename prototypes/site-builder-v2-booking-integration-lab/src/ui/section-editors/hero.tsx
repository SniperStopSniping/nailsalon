import type { HeroSettings } from '../../model/section-library/settings';
import { BoundTextField, TextField } from './fields';
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
      <p className="form-hint">
        Hero uses the selected design’s no-media treatment. Your Profile photo stays in About,
        while location and booking facts stay in their dedicated sections.
      </p>
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
