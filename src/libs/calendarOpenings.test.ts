import { expect, it } from 'vitest';

import { findCalendarGaps } from './calendarOpenings';

it('uses the first usable grid time and preserves free window ends around overlapping busy periods', () => {
  const minutes = (minute: number) => minute * 60_000;
  const window = (start: number, end: number) => ({ startMs: minutes(start), endMs: minutes(end) });
  const starts = [15, 30, 45, 60, 75, 90, 105, 120].map(minutes);

  expect(findCalendarGaps(
    window(0, 150),
    [window(65, 87), window(38, 73), window(106, 118)],
    starts,
    11,
  )).toEqual([window(15, 38), window(90, 106), window(120, 150)]);
});
