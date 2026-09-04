import type { FooterSettings } from '../../model/section-library/settings';
import { ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

export function FooterEditor({
  onChange,
  settings,
}: LibrarySectionEditorProps<'footer'>) {
  return (
    <>
      <ToggleField
        hint="A small credit line at the very bottom of the page."
        label="Show “Powered by Luster”"
        onChange={showAttribution => onChange({
          ...settings,
          showAttribution,
        } satisfies FooterSettings)}
        value={settings.showAttribution}
      />
      <p className="form-hint">
        Your studio name, area, and public contact links come from your
        profile. The compact design shows just the name and area.
      </p>
    </>
  );
}
