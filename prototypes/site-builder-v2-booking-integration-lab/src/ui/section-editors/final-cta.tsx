import type { FinalCtaSettings } from '../../model/section-library/settings';
import { BoundTextField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/** The shared line the customer renderer shows when the headline is not overridden. */
const SHARED_HEADLINE = 'Ready when you are';

export function FinalCtaEditor({
  onChange,
  settings,
}: LibrarySectionEditorProps<'final_cta'>) {
  return (
    <>
      <BoundTextField
        label="Headline"
        onChange={headline => onChange({ ...settings, headline } satisfies FinalCtaSettings)}
        sharedLabel="Use the standard line"
        sharedValue={SHARED_HEADLINE}
        value={settings.headline}
      />
      <p className="form-hint">
        The button always takes visitors to your Booking section.
      </p>
    </>
  );
}
