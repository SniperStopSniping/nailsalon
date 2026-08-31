import type { HoursSectionSettings } from '../../model/section-library/settings';
import { getPublicWeeklyHours } from '../../onboarding/model/hours';
import { ChoiceField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/**
 * Hours has no content of its own — it reads the one shared weekly-hours
 * authority. The preview below mirrors exactly what each layout renders
 * (compact drops the closed days and shortens the weekday labels).
 */
export function HoursEditor({
  context,
  onChange,
  profile,
  settings,
}: LibrarySectionEditorProps<'hours'>) {
  const compact = settings.layout === 'compact';
  const rows = getPublicWeeklyHours(profile.hours);
  const shownRows = compact ? rows.filter(row => row.hours !== 'Closed') : rows;

  return (
    <>
      <ChoiceField
        hint="Compact lists only the days you are open. Full week keeps every day, closed ones included."
        label="Layout"
        onChange={layout => onChange({ ...settings, layout } satisfies HoursSectionSettings)}
        options={[
          { label: 'Compact', value: 'compact' },
          { label: 'Full week', value: 'full' },
        ]}
        value={settings.layout}
      />
      <div className="form-field">
        <span>What visitors see</span>
        {shownRows.length === 0 ? (
          <small className="form-hint">
            {!context.hoursConfigured
              ? 'Your weekly hours are not set up yet, so this section stays off your site. Set them in Hours.'
              : !context.hoursShownOnSite
                ? 'Your hours are set up but turned off for your site, so this section stays hidden. Turn them back on in Hours.'
                : 'Every day is marked closed, so the compact layout has nothing to list.'}
          </small>
        ) : (
          <dl className="editor-record-list">
            {shownRows.map(row => (
              <div key={row.weekday}>
                <dt>{compact ? row.label.slice(0, 3) : row.label}</dt>
                <dd>{row.hours}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </>
  );
}
