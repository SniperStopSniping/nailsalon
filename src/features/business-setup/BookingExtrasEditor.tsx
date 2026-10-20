'use client';

import { useState } from 'react';

import { createReminderRuleId, MAX_REMINDER_RULES, type ReminderRule } from '@/libs/communicationReminders.shared';
import { MAX_DEPOSIT_CENTS_ABSURDITY, MIN_DEPOSIT_CENTS } from '@/libs/depositPolicy';

import { type SetupDeposit, setupDepositSchema, type SetupReminders, setupRemindersSchema } from './booking-extras';
import type { SetupDocument } from './contracts';

export function BookingExtrasEditor({ document, disabled, onDeposit, onReminders }: { document: SetupDocument; disabled: boolean; onDeposit: (values: SetupDeposit) => void; onReminders: (values: SetupReminders) => void }) {
  const [rules, setRules] = useState(document.reminders?.rules ?? []);
  const [error, setError] = useState('');
  const update = (id: string, values: Partial<ReminderRule>) => setRules(current => current.map(rule => rule.id === id ? { ...rule, ...values } : rule));
  return (
    <>
      <details open={Boolean(document.depositEditedFields?.length)}>
        <summary>Deposits</summary>
        <p>Choose a fixed amount in Canadian dollars. Saving here does not collect money. Collection needs a connected, charge-ready payment account and your publication approval.</p>
        <form
          className="setup-service"
          aria-label="Deposit proposal"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const input = String(form.get('amount')).trim();
            const parsed = setupDepositSchema.safeParse({ enabled: form.has('enabled'), amountCents: input ? Math.round(Number(input) * 100) : null });
            if (!parsed.success) {
              setError('Use a valid deposit amount, or leave it blank with collection off.');
              return;
            }
            setError('');
            onDeposit(parsed.data);
          }}
        >
          <label>
            <input type="checkbox" name="enabled" defaultChecked={document.deposit?.enabled ?? false} disabled={disabled} />
            {' '}
            Require a deposit for new bookings after approval
          </label>
          <label>
            Deposit amount (CAD)
            <input name="amount" type="number" step="0.01" min={MIN_DEPOSIT_CENTS / 100} max={MAX_DEPOSIT_CENTS_ABSURDITY / 100} defaultValue={document.deposit?.amountCents === null || document.deposit?.amountCents === undefined ? '' : document.deposit.amountCents / 100} disabled={disabled} />
          </label>
          <p>You can save the amount with collection off until your payment account is ready. Existing no-show protection is kept and may still require deposits.</p>
          <button type="submit" disabled={disabled}>Save deposit proposal</button>
        </form>
      </details>
      {document.reminders && (
        <details open={Boolean(document.remindersEditedFields?.length)}>
          <summary>Appointment reminders</summary>
          <p>Choose when reminders should go out. Your messaging switches, SMS credits, customer consent and delivery controls are kept. Existing upcoming reminders may be rescheduled after publication.</p>
          <form
            className="setup-service"
            aria-label="Reminder proposal"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const parsed = setupRemindersSchema.safeParse({ rules, quietHours: { enabled: form.has('quiet'), start: String(form.get('quietStart')), end: String(form.get('quietEnd')) } });
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? 'Check the reminder times.');
                return;
              }
              setError('');
              onReminders(parsed.data);
            }}
          >
            {rules.map((rule, index) => (
              <fieldset key={rule.id} disabled={disabled}>
                <legend>
                  Reminder
                  {index + 1}
                </legend>
                <label>
                  <input type="checkbox" checked={rule.enabled} onChange={event => update(rule.id, { enabled: event.target.checked })} />
                  {' '}
                  Enabled
                </label>
                <label>
                  Hours before appointment
                  <input type="number" min="0.25" max="168" step="any" value={rule.offsetMinutes / 60} onChange={event => update(rule.id, { offsetMinutes: Math.round(Number(event.target.value) * 60) })} />
                </label>
                <label>
                  Send by
                  <select value={rule.channels} onChange={event => update(rule.id, { channels: event.target.value as ReminderRule['channels'] })}>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                    <option value="both">SMS and email</option>
                  </select>
                </label>
                <button type="button" onClick={() => setRules(current => current.filter(item => item.id !== rule.id))}>Remove this reminder</button>
              </fieldset>
            ))}
            <button type="button" disabled={disabled || rules.length >= MAX_REMINDER_RULES} onClick={() => setRules(current => [...current, { id: createReminderRuleId(), offsetMinutes: [1440, 120, 2880].find(offset => !current.some(rule => rule.offsetMinutes === offset)) ?? 60, channels: 'both', enabled: true }])}>Add a reminder</button>
            <label>
              <input type="checkbox" name="quiet" defaultChecked={document.reminders.quietHours.enabled} disabled={disabled} />
              {' '}
              Keep messages within quiet-hour rules
            </label>
            <label>
              Quiet hours start
              <input name="quietStart" type="time" defaultValue={document.reminders.quietHours.start} disabled={disabled} />
            </label>
            <label>
              Quiet hours end
              <input name="quietEnd" type="time" defaultValue={document.reminders.quietHours.end} disabled={disabled} />
            </label>
            <p>Quiet hours use your salon’s time zone. Saving preferences does not turn texting or email on.</p>
            <button type="submit" disabled={disabled}>Save reminder proposal</button>
          </form>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
