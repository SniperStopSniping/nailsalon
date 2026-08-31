import type { VisitUsSettings, VisitUsSummaryMode } from '../../model/section-library/settings';
import { ChoiceField, ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

const NOT_FILLED_IN = '(not filled in yet)';

const SUMMARY_OPTIONS: ReadonlyArray<{ value: VisitUsSummaryMode; label: string }> = [
  { label: 'Automatic', value: 'auto' },
  { label: 'Always show', value: 'show' },
  { label: 'Hide', value: 'hide' },
];

/**
 * Visit Us shows arrival details from the shared location authority. The
 * toggles decide whether a note appears, never what it says, so each one
 * carries the live Business Profile text — or says plainly that it is empty.
 */
export function VisitUsEditor({
  onChange,
  profile,
  settings,
}: LibrarySectionEditorProps<'visit_us'>) {
  const { location } = profile;
  return (
    <>
      <ToggleField
        hint={location.parking.trim() || NOT_FILLED_IN}
        label="Show parking note"
        onChange={showParking => onChange({ ...settings, showParking } satisfies VisitUsSettings)}
        value={settings.showParking}
      />
      <ToggleField
        hint={location.entranceInstructions.trim() || NOT_FILLED_IN}
        label="Show entrance note"
        onChange={showEntrance => onChange({ ...settings, showEntrance } satisfies VisitUsSettings)}
        value={settings.showEntrance}
      />
      <ToggleField
        hint={location.transitInformation.trim() || NOT_FILLED_IN}
        label="Show transit note"
        onChange={showTransit => onChange({ ...settings, showTransit } satisfies VisitUsSettings)}
        value={settings.showTransit}
      />
      <ChoiceField
        hint="Automatic shows a short weekly schedule here only while no separate Hours section is on your site."
        label="Hours summary"
        onChange={hoursSummary => onChange({
          ...settings,
          hoursSummary,
        } satisfies VisitUsSettings)}
        options={SUMMARY_OPTIONS}
        value={settings.hoursSummary}
      />
      <ChoiceField
        hint="Automatic shows your contact links here only while no separate Contact section is on your site."
        label="Contact summary"
        onChange={contactSummary => onChange({
          ...settings,
          contactSummary,
        } satisfies VisitUsSettings)}
        options={SUMMARY_OPTIONS}
        value={settings.contactSummary}
      />
    </>
  );
}
