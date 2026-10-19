'use client';

import { useState } from 'react';

import { setupPolicyInput } from './booking-policy';
import type { SetupDocument } from './contracts';

export function BookingPolicyEditor({ value, disabled, onSave }: { value: SetupDocument['bookingPolicy']; disabled: boolean; onSave: (value: ReturnType<typeof setupPolicyInput>) => void }) {
  const policy = setupPolicyInput(value);
  const [enabled, setEnabled] = useState(policy.enabled);
  return (
    <details>
      <summary>Booking agreement</summary>
      <p>Choose what customers read and accept when booking. This does not collect deposits, charge cancellation fees or send messages now.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const field = (key: string) => String(form.get(key) ?? '').trim() || null;
        onSave({ ...policy, enabled, title: field('title'), text: field('text'), showOnServicePage: form.has('servicePage'), showInConfirmationEmail: form.has('email'), acknowledgment: { required: enabled && form.has('required'), text: field('acknowledgment') } });
      }}
      >
        <label>
          <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={disabled} />
          {' '}
          Show a booking agreement
        </label>
        <label>
          Agreement title
          <input name="title" defaultValue={policy.title ?? ''} maxLength={60} disabled={disabled} />
        </label>
        <label>
          Your booking agreement
          <textarea name="text" defaultValue={policy.text ?? ''} maxLength={1500} required={enabled} disabled={disabled} />
        </label>
        <label>
          <input type="checkbox" name="required" defaultChecked={policy.acknowledgment?.required} disabled={disabled || !enabled} />
          {' '}
          Ask customers to accept before confirming
        </label>
        <label>
          Acceptance checkbox wording
          <input name="acknowledgment" defaultValue={policy.acknowledgment?.text ?? ''} maxLength={220} disabled={disabled} />
        </label>
        <label>
          <input type="checkbox" name="servicePage" defaultChecked={policy.showOnServicePage} disabled={disabled} />
          {' '}
          Show on the service page
        </label>
        <label>
          <input type="checkbox" name="email" defaultChecked={policy.showInConfirmationEmail} disabled={disabled} />
          {' '}
          Include in future confirmation emails
        </label>
        <button type="submit" disabled={disabled}>Save booking agreement</button>
      </form>
    </details>
  );
}
