import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUICK_BOOK_SITE_LAYOUT,
  QUICK_BOOK_SITE_LAYOUTS,
  resolveQuickBookSiteLayout,
} from './quickBookSiteLayout';

describe('quickBookSiteLayout', () => {
  it.each(QUICK_BOOK_SITE_LAYOUTS)('preserves the supported %s composition', (layout) => {
    expect(resolveQuickBookSiteLayout(layout)).toBe(layout);
  });

  it.each([undefined, null, '', 'unknown', 1, {}])(
    'falls back safely for %j',
    (value) => {
      expect(resolveQuickBookSiteLayout(value)).toBe(DEFAULT_QUICK_BOOK_SITE_LAYOUT);
    },
  );
});
