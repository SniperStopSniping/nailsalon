import { describe, expect, it, vi } from 'vitest';

import { BOOKING_COOLDOWN_MS, campaignSlot, greetingTwiml, inboundKeyword, normalizePhone } from './policy';
import { parseSheets, sheetDate } from './sheets';

vi.mock('server-only', () => ({}));

it('uses the selected seven-day cooldown', () => expect(BOOKING_COOLDOWN_MS).toBe(604800000));

it.each(['4165550100', '+14165550100', '(416) 555-0100'])('normalizes %s', value => expect(normalizePhone(value)).toBe('+14165550100'));

it.each(['anonymous', '+442012345678', '123', '0000000000', '4165550100 ext 4'])('rejects %s', value => expect(normalizePhone(value)).toBeNull());

it.each(['STOP', 'STOPALL', 'CANCEL', 'unsubscribe', 'END', 'QUIT', 'REVOKE', 'OPTOUT'])('honors %s as opt-out', value => expect(inboundKeyword(value)).toBe('stop'));

it('honors provider opt-out type regardless of body', () => expect(inboundKeyword('anything', 'STOP')).toBe('stop'));

it('recognizes START without treating ordinary booking text as consent', () => {
  expect(inboundKeyword('UNSTOP')).toBe('start');
  expect(inboundKeyword('Can I book?')).toBe('other');
});

it.each([
  ['2026-10-26T15:00:00Z', '2026-10-26T11:00'],
  ['2026-10-26T22:30:00Z', '2026-10-26T18:30'],
  ['2026-11-09T16:00:00Z', '2026-11-09T11:00'],
  ['2026-10-26T15:04:59Z', '2026-10-26T11:00'],
  ['2026-10-26T15:05:00Z', null],
  ['2026-10-26T14:30:00Z', null],
  ['2026-10-26T23:00:00Z', null],
])('matches Toronto campaign schedule at %s', (value, expected) => expect(campaignSlot(new Date(value))).toBe(expected));

it('escapes the automatic greeting as text rather than TwiML', () => {
  const xml = greetingTwiml('Hello <Dial> & goodbye');

  expect(xml).toContain('Hello &lt;Dial&gt; &amp; goodbye');
  expect(xml).toContain('<Say voice="Polly.Joanna">');
  expect(xml).toContain('<Hangup/>');
});

it('rejects timestamps without offsets instead of guessing the machine time zone', () => {
  expect(sheetDate('2026-10-26 11:00')).toBeNull();
  expect(sheetDate('2026-10-26T11:00:00-04:00')?.toISOString()).toBe('2026-10-26T15:00:00.000Z');
});

describe('migration reconciliation', () => {
  it('combines both sheets by phone, preserving any attempt, suppression and latest reply', () => {
    const result = parseSheets([
      { definition: { spreadsheetId: 'primary', tab: 'Sheet1', role: 'primary' }, headers: ['Phone', 'Booking Promo Attempted At', 'Last_auto_text_iso', 'Notes'], rows: [['4165550100', 'legacy marker', '2026-10-20T11:00:00-04:00', ''], ['+14165550100', '', '', 'STOP']] },
      { definition: { spreadsheetId: 'copy', tab: 'CRM', role: 'inbound' }, headers: ['Phone', 'Last_booking_text_iso', 'Last_inbound_iso', 'Last_Msg'], rows: [['4165550100', '2026-10-23T11:00:00-04:00', '2026-10-24T11:00:00-04:00', 'Hello']] },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ phone: '+14165550100', optedOut: true, campaignEligible: true, rowOrder: 2, lastMessage: 'Hello' });
    expect(result[0]!.promoAttemptedAt).not.toBeNull();
    expect(result[0]!.lastBookingAt?.toISOString()).toBe('2026-10-23T15:00:00.000Z');
  });

  it('does not turn new inbound leads into campaign recipients', () => {
    const result = parseSheets([{ definition: { spreadsheetId: 'copy', tab: 'CRM', role: 'inbound' }, headers: ['Phone'], rows: [['4165550100']] }]);

    expect(result[0]!.campaignEligible).toBe(false);
  });

  it('requires a phone header rather than silently clearing a campaign', () => {
    expect(() => parseSheets([{ definition: { spreadsheetId: 'x', tab: 'x', role: 'primary' }, headers: ['Wrong'], rows: [] }])).toThrow('SHEET_PHONE_COLUMN_REQUIRED');
  });
});
