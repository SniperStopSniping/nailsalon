import type { AboutSectionSettings } from '../../model/section-library/settings';
import { resolveAboutBio } from '../../onboarding/model/about';
import { BoundTextField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/**
 * About owns one deliberate override — the opening line — and nothing else.
 * Bio, specialties, credentials, photo, and visibility all stay with the
 * Business Profile authority, so the editor names that authority instead of
 * duplicating its fields here.
 */
export function AboutEditor({
  onChange,
  profile,
  settings,
}: LibrarySectionEditorProps<'about'>) {
  const bio = resolveAboutBio(profile.about.shortBio, profile.about.fullBio);
  return (
    <>
      <BoundTextField
        label="Intro line"
        maxLength={200}
        onChange={intro => onChange({ ...settings, intro } satisfies AboutSectionSettings)}
        sharedLabel="Use my Business Profile bio"
        sharedValue={bio.lead ?? ''}
        value={settings.intro}
      />
      {settings.intro.source === 'shared' && !bio.lead ? (
        <small className="form-hint">
          Your Business Profile has no bio yet, so there is no intro line to
          show — add one there, or write your own line here.
        </small>
      ) : null}
      <p className="form-hint">
        The rest of About — your bio, specialties, and credentials — comes from
        your Business Profile. Edit it there and this section follows.
      </p>
    </>
  );
}
