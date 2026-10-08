import { describe, expect, it } from 'vitest';

import { smsCreditStatus } from './smsCreditStatus';

describe('shared SMS credit thresholds', () => {
  it.each([
    [-4, 'empty'],
    [0, 'empty'],
    [1, 'critical'],
    [10, 'critical'],
    [11, 'low'],
    [25, 'low'],
    [26, 'healthy'],
    [100000, 'healthy'],
  ] as const)('classifies %i remaining as %s', (remaining, expected) => {
    expect(smsCreditStatus(remaining)).toBe(expected);
  });
});
