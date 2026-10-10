import { describe, expect, it } from 'vitest';

import { formatIslaHours } from './islaHours';

describe('compact saved business hours', () => {
  it('groups adjacent equal weekdays and preserves Saturday and closed Sunday', () => {
    const weekday = { open: '10:00', close: '19:00' };

    expect(formatIslaHours({ monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: { open: '11:00', close: '17:00' }, sunday: null })).toEqual([
      { days: 'Mon–Fri', time: '10 am–7 pm' },
      { days: 'Sat', time: '11 am–5 pm' },
      { days: 'Sun', time: 'Closed' },
    ]);
  });

  it('preserves minutes, noon and midnight, and does not group across unknown days', () => {
    expect(formatIslaHours({ monday: { open: '00:00', close: '12:30' }, wednesday: { open: '00:00', close: '12:30' } })).toEqual([
      { days: 'Mon', time: '12 am–12:30 pm' },
      { days: 'Wed', time: '12 am–12:30 pm' },
    ]);
  });

  it('does not invent closed days or example hours for empty or invalid settings', () => {
    expect(formatIslaHours(null)).toEqual([]);
    expect(formatIslaHours({})).toEqual([]);
    expect(formatIslaHours({ monday: { open: '25:00', close: '17:00' } })).toEqual([]);
  });
});
