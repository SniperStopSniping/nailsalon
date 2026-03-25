import { describe, expect, it } from 'vitest';

import {
  hasWorkingHours,
  normalizeScheduleDay,
  normalizeWeeklySchedule,
  resolveWeeklySchedule,
} from './weeklySchedule';

describe('weeklySchedule helpers', () => {
  it('normalizes missing days to explicit null values', () => {
    expect(normalizeWeeklySchedule({
      monday: { start: '09:00', end: '18:00' },
    })).toEqual({
      sunday: null,
      monday: { start: '09:00', end: '18:00' },
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
    });
  });

  it('falls back to legacy workDays/startTime/endTime when weeklySchedule is empty', () => {
    const schedule = resolveWeeklySchedule({
      weeklySchedule: {},
      workDays: [1, 2, 3, 4, 5],
      startTime: '10:00',
      endTime: '19:00',
    });

    expect(schedule).toEqual({
      sunday: null,
      monday: { start: '10:00', end: '19:00' },
      tuesday: { start: '10:00', end: '19:00' },
      wednesday: { start: '10:00', end: '19:00' },
      thursday: { start: '10:00', end: '19:00' },
      friday: { start: '10:00', end: '19:00' },
      saturday: null,
    });
    expect(hasWorkingHours(schedule)).toBe(true);
  });

  it('normalizes legacy per-day shapes into start/end pairs', () => {
    expect(normalizeScheduleDay({ open: '09:00', close: '17:00' })).toEqual({
      start: '09:00',
      end: '17:00',
    });

    expect(normalizeScheduleDay({ startTime: '10:00', endTime: '18:30' })).toEqual({
      start: '10:00',
      end: '18:30',
    });

    expect(normalizeScheduleDay({ open: '09:00' })).toBeNull();
  });
});
