import { describe, expect, it } from 'vitest';

import { calendarBlockInput, resolveCalendarBlockWindow } from './calendarBlocks';

const BLOCK_ID = '018f4b16-93d7-7c3c-8e57-dc8d6f11e001';
const TORONTO = 'America/Toronto';

function input(overrides: Partial<{
  date: string;
  startTime: string;
  endTime: string;
  label: string;
}> = {}) {
  return calendarBlockInput.parse({
    id: BLOCK_ID,
    technicianId: 'tech_1',
    date: '2026-06-15',
    startTime: '09:00',
    endTime: '10:00',
    label: 'Lunch',
    ...overrides,
  });
}

describe('calendar block windows', () => {
  it('preserves a valid salon-local intraday window as UTC instants', () => {
    const window = resolveCalendarBlockWindow(input(), TORONTO);

    expect(window.startsAt.toISOString()).toBe('2026-06-15T13:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-06-15T14:00:00.000Z');
  });

  it('allows adjacent boundaries without treating them as an overlap', () => {
    const first = resolveCalendarBlockWindow(input({ startTime: '09:00', endTime: '10:00' }), TORONTO);
    const second = resolveCalendarBlockWindow(input({ startTime: '10:00', endTime: '11:00' }), TORONTO);

    expect(first.endsAt).toEqual(second.startsAt);
  });

  it('rejects equal or reverse local windows', () => {
    expect(() => resolveCalendarBlockWindow(input({ startTime: '10:00', endTime: '10:00' }), TORONTO))
      .toThrow('Choose a valid start and later end time on the same day.');
    expect(() => resolveCalendarBlockWindow(input({ startTime: '11:00', endTime: '10:00' }), TORONTO))
      .toThrow('Choose a valid start and later end time on the same day.');
  });

  it('rejects impossible calendar dates instead of rolling them into another day', () => {
    expect(() => resolveCalendarBlockWindow(input({ date: '2026-02-30' }), TORONTO))
      .toThrow('Choose a valid start and later end time on the same day.');
  });

  it('rejects a nonexistent local time in the spring DST gap', () => {
    expect(() => resolveCalendarBlockWindow(input({
      date: '2026-03-08',
      startTime: '02:30',
      endTime: '03:30',
    }), TORONTO)).toThrow('Choose a valid start and later end time on the same day.');
  });

  it('rejects ambiguous wall times at the fall-back transition', () => {
    expect(() => resolveCalendarBlockWindow(input({ date: '2026-11-01', startTime: '01:15', endTime: '01:45' }), TORONTO)).toThrow('occurs twice');
  });
});
