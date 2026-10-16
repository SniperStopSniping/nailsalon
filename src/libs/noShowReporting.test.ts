import { describe, expect, it } from 'vitest';

import { isNoShowWindowOpen, validateNoShowReport } from './noShowReporting';

describe('no-show reporting window and truthful reasons', () => {
  const start = new Date('2030-06-15T19:00:00Z');

  it.each([
    ['2030-06-14T18:59:59.999Z', false],
    ['2030-06-14T19:00:00Z', true],
    ['2030-06-15T18:30:00Z', true],
    ['2030-06-15T19:00:00Z', true],
    ['2030-07-15T19:00:00Z', true],
  ])('opens at exactly 24 hours and has no post-visit deadline: %s', (now, allowed) => {
    expect(isNoShowWindowOpen(start, new Date(now))).toBe(allowed);
  });

  it.each(['late_cancellation', 'confirmed_nonattendance'])('accepts explicit %s before start', (reason) => {
    expect(validateNoShowReport(start, { reason }, new Date('2030-06-15T18:30:00Z')).reason).toBe(reason);
  });

  it.each(['did_not_attend', 'other'])('refuses a future absence as fact: %s', (reason) => {
    expect(() => validateNoShowReport(start, { reason, explanation: 'A future absence is not known.' }, new Date('2030-06-15T18:30:00Z'))).toThrow(/explicit late cancellation or confirmed nonattendance/);
  });

  it('requires a reason and an explanation for Other; accepts attendance absence at the start', () => {
    expect(() => validateNoShowReport(start, undefined, start)).toThrow(/Select/);
    expect(() => validateNoShowReport(start, { reason: 'other', explanation: ' ' }, start)).toThrow(/Other/);
    expect(validateNoShowReport(start, { reason: 'other', explanation: 'Verified nonattendance', privateNote: 'Private' }, start).privateNote).toBe('Private');
    expect(validateNoShowReport(start, { reason: 'did_not_attend' }, start).reason).toBe('did_not_attend');
  });

  it.each([
    // Toronto spring forward and fall back: subtract 24 elapsed hours from the canonical instant.
    ['2030-03-10T15:00:00-04:00', '2030-03-09T14:00:00-05:00'],
    ['2030-11-03T15:00:00-05:00', '2030-11-02T16:00:00-04:00'],
    ['2030-06-15T15:00:00+09:00', '2030-06-14T15:00:00+09:00'],
  ])('honors canonical salon instants across timezone changes: %s', (scheduled, opens) => {
    expect(isNoShowWindowOpen(scheduled, new Date(opens))).toBe(true);
    expect(isNoShowWindowOpen(scheduled, new Date(new Date(opens).getTime() - 1))).toBe(false);
  });
});
