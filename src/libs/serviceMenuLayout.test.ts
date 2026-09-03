import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SERVICE_MENU_LAYOUT,
  resolveServiceMenuLayout,
  resolveServiceMenuPresentation,
  SERVICE_MENU_LAYOUTS,
} from './serviceMenuLayout';

describe('service-menu layout contract', () => {
  it('exposes the five approved stable identifiers', () => {
    expect(SERVICE_MENU_LAYOUTS).toEqual([
      'visual_grid',
      'clean_list',
      'editorial_cards',
      'category_menu',
      'editorial_price_list',
    ]);
  });

  it.each(SERVICE_MENU_LAYOUTS)('resolves %s without changing its identity', (layout) => {
    expect(resolveServiceMenuLayout(layout)).toBe(layout);
    expect(resolveServiceMenuPresentation(layout).layout).toBe(layout);
  });

  it('falls back safely for absent and unsupported persisted values', () => {
    expect(resolveServiceMenuLayout(undefined)).toBe(DEFAULT_SERVICE_MENU_LAYOUT);
    expect(resolveServiceMenuLayout('unknown_layout')).toBe(DEFAULT_SERVICE_MENU_LAYOUT);
    expect(resolveServiceMenuLayout({ layout: 'clean_list' })).toBe(DEFAULT_SERVICE_MENU_LAYOUT);
  });

  it('gives each presentation a deliberate catalogue structure', () => {
    expect(resolveServiceMenuPresentation('visual_grid')).toMatchObject({
      columns: 2,
      grouped: false,
      image: 'standard',
    });
    expect(resolveServiceMenuPresentation('clean_list')).toMatchObject({
      columns: 1,
      grouped: false,
      image: 'thumbnail',
    });
    expect(resolveServiceMenuPresentation('editorial_cards')).toMatchObject({
      columns: 1,
      description: 'editorial',
      image: 'hero',
    });
    expect(resolveServiceMenuPresentation('category_menu')).toMatchObject({
      columns: 1,
      grouped: true,
      image: 'thumbnail',
    });
    expect(resolveServiceMenuPresentation('editorial_price_list')).toMatchObject({
      columns: 1,
      description: 'hidden',
      image: 'hidden',
    });
  });
});
