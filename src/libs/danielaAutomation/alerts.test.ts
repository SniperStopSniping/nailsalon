import { expect, it } from 'vitest';

import type { CallerContext } from './alerts';
import { formatOwnerAlert } from './alerts';

const call = { kind: 'call', phone: '+14165550100', body: null, receivedAt: new Date('2026-11-02T20:05:26Z') };
const matched: CallerContext = {
  match: 'matched',
  name: 'Synthetic Client',
  nextAppointment: { startTime: new Date('2026-11-04T18:00:00Z'), status: 'confirmed', services: ['Russian Manicure'] },
};

it('clearly identifies a call, local date/time, callback number and verified appointment', () => {
  const text = formatOwnerAlert(call, matched);

  expect(text).toContain('📞 Incoming call');
  expect(text).toContain('Phone: +1 (416) 555-0100');
  expect(text).toContain('Date/time (Toronto): Mon, Nov 2, 2026');
  expect(text).toMatch(/3:05\s*PM EST/u);
  expect(text).toContain('Name: Synthetic Client');
  expect(text).toContain('Next appointment: Wed, Nov 4, 2026');
  expect(text).toMatch(/1:00\s*PM EST/u);
  expect(text).toContain('Services: Russian Manicure');
  expect(text).toContain('Message: Phone call — no written message.');
  expect(text).not.toContain('Event:');
});

it('preserves the actual text message and labels a pending appointment accurately', () => {
  const text = formatOwnerAlert({ ...call, kind: 'sms', body: 'Can I move my visit?\n<b>Please call me</b>' }, {
    ...matched,
    nextAppointment: { ...matched.nextAppointment!, status: 'pending' },
  });

  expect(text).toContain('💬 Incoming text');
  expect(text).toContain('Message:\nCan I move my visit?\n<b>Please call me</b>');
  expect(text).toContain('(pending confirmation)');
});

it('uses Toronto daylight saving time rather than a fixed UTC offset', () => {
  const text = formatOwnerAlert({ ...call, receivedAt: new Date('2026-07-01T15:05:00Z') }, { ...matched, nextAppointment: null });

  expect(text).toMatch(/11:05\s*AM EDT/u);
  expect(text).toContain('Next appointment: None scheduled');
});

it('does not invent a name or appointment for an unidentified caller', () => {
  const text = formatOwnerAlert({ ...call, phone: null }, { match: 'not_found', name: null, nextAppointment: null });

  expect(text).toContain('Phone: Unavailable / withheld');
  expect(text).toContain('Name: Not found in client list');
  expect(text).toContain('Next appointment: Not linked');
});

it('never renders stray personal details when the client match is ambiguous', () => {
  const text = formatOwnerAlert(call, { ...matched, match: 'ambiguous' });

  expect(text).toContain('Client match unclear');
  expect(text).not.toContain('Synthetic Client');
  expect(text).not.toContain('Russian Manicure');
  expect(text).toContain('Next appointment: Not linked');
});

it('keeps useful call details when optional client lookup is unavailable', () => {
  const text = formatOwnerAlert(call, { match: 'unavailable', name: null, nextAppointment: null });

  expect(text).toContain('Phone: +1 (416) 555-0100');
  expect(text).toContain('Name: Temporarily unavailable');
  expect(text).toContain('Next appointment: Could not verify');
});

it('bounds long text messages while preserving the caller and appointment fields', () => {
  const text = formatOwnerAlert({ ...call, kind: 'sms', body: 'x'.repeat(5000) }, matched);

  expect(text.length).toBeLessThanOrEqual(4000);
  expect(text).toContain('Phone: +1 (416) 555-0100');
  expect(text).toContain('Name: Synthetic Client');
  expect(text).toContain('Russian Manicure');
  expect(text).toContain('[Message shortened]');
});
