import { describe, expect, it } from 'vitest';

import {
  formatMinimumNoticeDuration,
  getMinimumNoticeCustomerCopy,
} from './minimumNoticeCopy';

describe('minimum-notice customer copy', () => {
  it.each([
    [0, 'No minimum booking notice is required.'],
    [120, 'Book at least 2 hours before your appointment starts.'],
    [240, 'Book at least 4 hours before your appointment starts.'],
    [1_440, 'Book at least 1 day before your appointment starts.'],
  ])('formats %i configured minutes truthfully', (minutes, expected) => {
    expect(getMinimumNoticeCustomerCopy(minutes)).toBe(expected);
  });

  it('preserves singular minutes and non-day hour totals', () => {
    expect(formatMinimumNoticeDuration(1)).toBe('1 minute');
    expect(formatMinimumNoticeDuration(180)).toBe('3 hours');
  });
});
