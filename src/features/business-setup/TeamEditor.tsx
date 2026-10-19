'use client';

import { useState } from 'react';

import { type SetupHours, type SetupService, type SetupStaff, WEEKDAYS } from './contracts';

function TeamMember({ person, services, hours, disabled, onSave }: { person: SetupStaff; services: SetupService[]; hours: SetupHours; disabled: boolean; onSave: (person: SetupStaff) => void }) {
  const [mode, setMode] = useState(person.assignmentMode);
  const [keepSchedule, setKeepSchedule] = useState(!person.id.startsWith('draft_'));
  const schedule = person.hours ?? hours;
  return (
    <form
      className="setup-service"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const proposedHours = Object.fromEntries(WEEKDAYS.map(day => [day, form.get(`${day}-open`) ? { open: String(form.get(`${day}-start`)), close: String(form.get(`${day}-end`)) } : null])) as SetupHours;
        onSave({ id: person.id, name: String(form.get('name')), isActive: form.has('active'), hours: form.has('keepHours') ? null : proposedHours, assignmentMode: mode, serviceIds: mode === 'preserve' ? person.serviceIds : form.getAll('services').map(String) });
      }}
    >
      <label>
        Booking name
        <input name="name" defaultValue={person.name} maxLength={120} required disabled={disabled} />
      </label>
      <label>
        <input name="active" type="checkbox" defaultChecked={person.isActive} disabled={disabled} />
        {' '}
        Accept bookings for this person
      </label>
      <label>
        Services this person can perform
        <select aria-label={`${person.name} service choices`} value={mode} onChange={event => setMode(event.target.value as SetupStaff['assignmentMode'])} disabled={disabled}>
          {!person.id.startsWith('draft_') && <option value="preserve">Keep current booking eligibility</option>}
          <option value="explicit">Choose services below</option>
        </select>
      </label>
      {mode === 'explicit' && (
        <fieldset disabled={disabled}>
          <legend>Assigned services</legend>
          {services.map(service => (
            <label key={service.id}>
              <input type="checkbox" name="services" value={service.id} defaultChecked={person.serviceIds.includes(service.id)} />
              {' '}
              {service.name}
            </label>
          ))}
        </fieldset>
      )}
      <details>
        <summary>Working hours</summary>
        {!person.id.startsWith('draft_') && (
          <label>
            <input type="checkbox" name="keepHours" checked={keepSchedule} onChange={event => setKeepSchedule(event.target.checked)} disabled={disabled} />
            {' '}
            Keep this draft’s schedule
          </label>
        )}
        {WEEKDAYS.map(day => (
          <div className="setup-hour" key={day}>
            <label>
              <input type="checkbox" name={`${day}-open`} defaultChecked={Boolean(schedule[day])} disabled={disabled || keepSchedule} />
              {day}
            </label>
            <input type="time" name={`${day}-start`} aria-label={`${person.name} ${day} starts`} defaultValue={schedule[day]?.open ?? '09:00'} disabled={disabled || keepSchedule} />
            <input type="time" name={`${day}-end`} aria-label={`${person.name} ${day} ends`} defaultValue={schedule[day]?.close ?? '17:00'} disabled={disabled || keepSchedule} />
          </div>
        ))}
        <p>To change an existing schedule, uncheck “Keep this draft’s schedule”. Existing appointments keep their times and staff.</p>
      </details>
      <button type="submit" disabled={disabled}>Save team member</button>
    </form>
  );
}

export function TeamEditor({ staff, services, hours, revision, disabled, onSave }: { staff: SetupStaff[]; services: SetupService[]; hours: SetupHours; revision: number; disabled: boolean; onSave: (person: SetupStaff) => void }) {
  return (
    <section aria-label="Team booking setup">
      <h3>Your team</h3>
      <p>Choose who can perform each service and when they work. Adding a profile does not create a login or send an invitation.</p>
      {staff.map(person => <TeamMember key={`${person.id}-${revision}`} person={person} services={services} hours={hours} disabled={disabled} onSave={onSave} />)}
      <button type="button" disabled={disabled} onClick={() => onSave({ id: `draft_${crypto.randomUUID()}`, name: 'New team member', isActive: true, hours, serviceIds: [], assignmentMode: 'explicit' })}>Add a team member</button>
    </section>
  );
}
