import { describe, expect, it } from 'vitest';

import {
  formatMinimumNoticeDuration,
  getMinimumNoticeCopy,
} from './minimum-notice';

describe('minimum booking notice copy', () => {
  it.each([
    [0, 'No minimum notice', 'Clients can book without a minimum-notice requirement.'],
    [120, '2 hours', 'Clients must book at least 2 hours before the appointment starts.'],
    [1_440, '1 day', 'Clients must book at least 1 day before the appointment starts.'],
    [180, '3 hours', 'Clients must book at least 3 hours before the appointment starts.'],
  ] as const)('describes %i minutes as a cutoff', (minutes, duration, helper) => {
    expect(formatMinimumNoticeDuration(minutes)).toBe(duration);
    expect(getMinimumNoticeCopy(minutes).helper).toBe(helper);
  });

  it('never describes a seeded appointment or availability result', () => {
    const copy = Object.values(getMinimumNoticeCopy(120)).join(' ');

    expect(copy).not.toMatch(/available time|appointment time|earliest bookable/iu);
    expect(copy).toContain('before the appointment starts');
  });
});
