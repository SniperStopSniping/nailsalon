import { describe, expect, it } from 'vitest';

import { createDefaultWeeklyHours } from './defaults';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
  getWeeklyHoursSetupSummary,
} from './hours';

const configuredHours = () => {
  const hours = createDefaultWeeklyHours();
  hours.setupState = 'configured';
  hours.showOnSite = true;
  hours.days.thursday = { close: '18:00', closed: false, open: '10:00' };
  hours.days.sunday = { close: '', closed: true, open: '' };
  return hours;
};

describe('honest weekly-hours state', () => {
  it('starts unset with no seeded public schedule', () => {
    const hours = createDefaultWeeklyHours();
    expect(hours.setupState).toBe('unset');
    expect(hours.days.monday).toMatchObject({ close: '', open: '' });
    expect(hours.days.sunday).toMatchObject({ close: '', closed: false, open: '' });
    expect(getWeeklyHoursSetupSummary(hours)).toBe('Not set · Optional');
    expect(getPublicWeeklyHours(hours)).toEqual([]);
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-08-27T18:30:00.000Z',
    )).toBeNull();
  });

  it('does not publish or complete a legacy configured state without a valid interval', () => {
    const hours = createDefaultWeeklyHours();
    hours.setupState = 'configured';
    hours.showOnSite = true;
    hours.days.monday.open = '09:00';
    hours.days.sunday.closed = true;

    expect(getWeeklyHoursSetupSummary(hours)).toBe('Not set · Optional');
    expect(getPublicWeeklyHours(hours)).toEqual([]);
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-08-27T18:30:00.000Z',
    )).toBeNull();
  });

  it('derives open-until and closed from the deterministic fixture timestamp', () => {
    const hours = configuredHours();
    expect(getWeeklyHoursSetupSummary(hours)).toBe('1 day · Shown on your site');
    expect(getPublicWeeklyHours(hours)).toEqual([
      { hours: '10:00 AM–6:00 PM', label: 'Thursday', weekday: 'thursday' },
      { hours: 'Closed', label: 'Sunday', weekday: 'sunday' },
    ]);
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-08-27T18:30:00.000Z',
    )).toEqual({
      kind: 'open',
      label: 'Open until 6:00 PM',
      weekday: 'thursday',
    });
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-08-28T01:00:00.000Z',
    )).toEqual({
      kind: 'closed',
      label: 'Opens Thursday at 10:00 AM',
      weekday: 'thursday',
    });
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-08-30T18:30:00.000Z',
    )).toEqual({
      kind: 'closed',
      label: 'Opens Thursday at 10:00 AM',
      weekday: 'sunday',
    });
  });

  it('derives today, tomorrow, closed-day, and week-wrap openings from one schedule', () => {
    const hours = createDefaultWeeklyHours();
    hours.setupState = 'configured';
    hours.showOnSite = true;
    hours.days.monday = { close: '17:00', closed: false, open: '09:00' };
    hours.days.tuesday = { close: '', closed: true, open: '' };
    hours.days.wednesday = { close: '', closed: true, open: '' };
    hours.days.thursday = { close: '18:00', closed: false, open: '10:30' };

    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-08-31T12:00:00.000Z',
    )?.label).toBe('Opens today at 9:00 AM');
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-09-02T16:00:00.000Z',
    )?.label).toBe('Opens tomorrow at 10:30 AM');
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-09-01T16:00:00.000Z',
    )?.label).toBe('Opens Thursday at 10:30 AM');
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-09-04T16:00:00.000Z',
    )?.label).toBe('Opens Monday at 9:00 AM');
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-09-07T22:00:00.000Z',
    )?.label).toBe('Opens Thursday at 10:30 AM');
  });

  it.each([
    ['configured hidden', 'configured', false, 'Not shown on your site'],
    ['skipped', 'skipped', true, 'Not shown on your site'],
  ] as const)('suppresses false public status for %s hours', (_, setupState, showOnSite, summary) => {
    const hours = configuredHours();
    hours.setupState = setupState;
    hours.showOnSite = showOnSite;
    expect(getWeeklyHoursSetupSummary(hours)).toBe(summary);
    expect(getPublicWeeklyHours(hours)).toEqual([]);
    expect(getWeeklyHoursPreviewStatus(
      hours,
      '2026-08-27T18:30:00.000Z',
    )).toBeNull();
  });
});
