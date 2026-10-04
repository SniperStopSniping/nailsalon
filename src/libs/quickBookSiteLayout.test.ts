import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUICK_BOOK_SITE_LAYOUT,
  getSelectableQuickBookLayoutsByFamily,
  QUICK_BOOK_SITE_LAYOUTS,
  resolveQuickBookSiteLayout,
} from './quickBookSiteLayout';

describe('quickBookSiteLayout', () => {
  it('retires two chooser options while preserving all persisted compositions', () => {
    const choices = ['simple', 'profile', 'cover'].flatMap(family => (
      getSelectableQuickBookLayoutsByFamily(family as 'simple' | 'profile' | 'cover')
    )).map(layout => layout.id);

    expect(choices).toHaveLength(20);
    expect(choices).not.toContain('editorial');
    expect(choices).not.toContain('hub_menu');
    expect(choices).toContain('editorial_split');
    expect(resolveQuickBookSiteLayout('editorial')).toBe('editorial');
    expect(resolveQuickBookSiteLayout('hub_menu')).toBe('hub_menu');
  });

  it.each(['editorial', 'hub_menu'] as const)('keeps a saved %s choice visible without offering the other retired layout', (currentLayout) => {
    const choices = getSelectableQuickBookLayoutsByFamily('simple', currentLayout).map(layout => layout.id);

    expect(choices).toHaveLength(7);
    expect(choices).toContain(currentLayout);
    expect(choices).not.toContain(currentLayout === 'editorial' ? 'hub_menu' : 'editorial');
  });

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
