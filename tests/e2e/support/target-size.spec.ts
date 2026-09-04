import { expect, test } from '@playwright/test';

import { meetsMinimumTargetSize } from './target-size';

test('44px targets tolerate only DOMRect floating-point noise', () => {
  for (const dimension of [44, 44.5, 43.99998474121094]) {
    expect(meetsMinimumTargetSize({ width: dimension, height: 44 })).toBe(true);
    expect(meetsMinimumTargetSize({ width: 44, height: dimension })).toBe(true);
  }
});

test('genuinely undersized or invalid targets still fail the 44px floor', () => {
  for (const dimension of [43.999, 43.984375, 43.5, 43, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(meetsMinimumTargetSize({ width: dimension, height: 44 })).toBe(false);
    expect(meetsMinimumTargetSize({ width: 44, height: dimension })).toBe(false);
  }
});
