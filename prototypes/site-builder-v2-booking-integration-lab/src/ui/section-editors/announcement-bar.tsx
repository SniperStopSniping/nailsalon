import type { AnnouncementBarSettings } from '../../model/section-library/settings';
import { ChoiceField, TextField, ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

export function AnnouncementBarEditor({
  onChange,
  settings,
}: LibrarySectionEditorProps<'announcement_bar'>) {
  const action = settings.action;
  return (
    <>
      <TextField
        hint="One short line — it never wraps into a paragraph."
        label="Message"
        maxLength={120}
        onChange={message => onChange({ ...settings, message })}
        placeholder="Now booking September appointments"
        value={settings.message}
      />
      <ChoiceField
        label="Action"
        onChange={(kind) => {
          if (kind === 'none') {
            onChange({ ...settings, action: null });
          } else if (kind === 'booking') {
            onChange({
              ...settings,
              action: { kind: 'booking', label: action?.label || 'Book now' },
            });
          } else {
            onChange({
              ...settings,
              action: {
                kind: 'url',
                label: action?.label || 'Learn more',
                url: action?.kind === 'url' ? action.url : '',
              },
            });
          }
        }}
        options={[
          { label: 'None', value: 'none' },
          { label: 'Go to Booking', value: 'booking' },
          { label: 'Open a link', value: 'url' },
        ]}
        value={action ? action.kind : 'none'}
      />
      {action ? (
        <TextField
          label="Action label"
          maxLength={40}
          onChange={label => onChange({
            ...settings,
            action: action.kind === 'url'
              ? { ...action, label }
              : { kind: 'booking', label },
          })}
          value={action.label}
        />
      ) : null}
      {action?.kind === 'url' ? (
        <TextField
          hint="Full web address, starting with https://"
          label="Link address"
          maxLength={300}
          onChange={url => onChange({ ...settings, action: { ...action, url } })}
          value={action.url}
        />
      ) : null}
      <TextField
        hint="Optional smaller line under the action, e.g. deposit reassurance."
        label="Reassurance line"
        maxLength={90}
        onChange={reassurance => onChange({ ...settings, reassurance })}
        value={settings.reassurance}
      />
      <ChoiceField
        label="Tone"
        onChange={tone => onChange({ ...settings, tone })}
        options={[
          { label: 'Accent', value: 'accent' },
          { label: 'Soft tint', value: 'tint' },
        ]}
        value={settings.tone}
      />
      <ToggleField
        hint="Visitors can close the bar for their visit."
        label="Dismissible"
        onChange={dismissible => onChange({ ...settings, dismissible })}
        value={settings.dismissible}
      />
    </>
  );
}
