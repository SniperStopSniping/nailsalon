import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { TeamSettings } from '../../model/section-library/settings';
import type { StaffMemberRecord } from '../../model/section-library/site-content';
import { TextField, ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

const createMemberId = (): string =>
  `staff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Team binds shared `siteContent.staff` records. Record edits apply
 * immediately (they are a shared authority); the section's own settings
 * (preset, which members show, order) save with the dialog.
 */
export function TeamEditor({
  context,
  onChange,
  onSiteContent,
  settings,
}: LibrarySectionEditorProps<'team'>) {
  const [draftName, setDraftName] = useState('');
  const members = context.siteContent.staff;

  const toggleMember = (memberId: string, included: boolean) => {
    const nextIds = included
      ? [...settings.memberIds, memberId]
      : settings.memberIds.filter(id => id !== memberId);
    onChange({ ...settings, memberIds: nextIds } satisfies TeamSettings);
  };

  const addMember = () => {
    const name = draftName.trim();
    if (!name) {
      return;
    }
    const record: StaffMemberRecord = {
      acceptsBookings: true,
      id: createMemberId(),
      name,
      specialties: [],
      title: '',
    };
    if (onSiteContent({ collection: 'staff', operation: 'upsert', record })) {
      onChange({ ...settings, memberIds: [...settings.memberIds, record.id] });
      setDraftName('');
    }
  };

  const updateMember = (record: StaffMemberRecord) => {
    onSiteContent({ collection: 'staff', operation: 'upsert', record });
  };

  const removeMember = (memberId: string) => {
    if (onSiteContent({ collection: 'staff', operation: 'remove', recordId: memberId })) {
      onChange({
        ...settings,
        memberIds: settings.memberIds.filter(id => id !== memberId),
      });
    }
  };

  return (
    <>
      <div className="form-field">
        <span>Team members</span>
        {members.length === 0
          ? (
              <small className="form-hint">
                No team members yet — add your first below. The section stays off
                your site until someone is shown.
              </small>
            )
          : null}
        <div className="editor-record-list">
          {members.map((member) => {
            const included = settings.memberIds.includes(member.id);
            return (
              <details className="editor-record" key={member.id}>
                <summary>
                  <label className="editor-record-include">
                    <input
                      checked={included}
                      onChange={event => toggleMember(member.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="visually-hidden">
                      {'Show '}
                      {member.name}
                      {' '}
                      in this section
                    </span>
                  </label>
                  <strong>{member.name}</strong>
                  {member.title ? <small>{member.title}</small> : null}
                </summary>
                <TextField
                  label="Name"
                  maxLength={80}
                  onChange={name => updateMember({ ...member, name })}
                  value={member.name}
                />
                <TextField
                  label="Role or title"
                  maxLength={80}
                  onChange={title => updateMember({ ...member, title })}
                  placeholder="Senior nail artist"
                  value={member.title}
                />
                <TextField
                  hint="Separate with commas."
                  label="Specialties"
                  maxLength={200}
                  onChange={value => updateMember({
                    ...member,
                    specialties: value.split(',').map(item => item.trim()).filter(Boolean),
                  })}
                  placeholder="Russian manicure, chrome"
                  value={member.specialties.join(', ')}
                />
                <ToggleField
                  label="Accepts bookings"
                  onChange={acceptsBookings => updateMember({ ...member, acceptsBookings })}
                  value={member.acceptsBookings}
                />
                <button
                  className="secondary-button editor-record-remove"
                  onClick={() => removeMember(member.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  {' Remove '}
                  {member.name}
                </button>
              </details>
            );
          })}
        </div>
        <div className="editor-record-new">
          <input
            autoComplete="off"
            onChange={event => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addMember();
              }
            }}
            placeholder="New team member’s name"
            type="text"
            value={draftName}
          />
          <button className="secondary-button" onClick={addMember} type="button">
            Add member
          </button>
        </div>
      </div>
    </>
  );
}
