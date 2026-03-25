import { describe, expect, it } from 'vitest';

import {
  getSalonSlugFromPathname,
  getSalonSlugFromRouteParams,
  getSalonSlugFromSearchParams,
  normalizeSalonSlug,
} from './tenantSlug';

describe('tenantSlug helpers', () => {
  it('normalizes slugs consistently', () => {
    expect(normalizeSalonSlug('  Luster  ')).toBe('luster');
    expect(normalizeSalonSlug('')).toBeNull();
  });

  it('prefers slug params from dynamic routes', () => {
    expect(getSalonSlugFromRouteParams({ slug: 'luster' })).toBe('luster');
    expect(getSalonSlugFromRouteParams({ slug: ['luster', 'extra'] })).toBe('luster');
    expect(getSalonSlugFromRouteParams({ locale: 'en' })).toBeNull();
  });

  it('reads legacy salonSlug search params', () => {
    expect(getSalonSlugFromSearchParams({ salonSlug: 'luster' })).toBe('luster');
    expect(getSalonSlugFromSearchParams(new URLSearchParams('salonSlug=luster'))).toBe('luster');
  });

  it('extracts salon slugs from localized tenant paths only', () => {
    expect(getSalonSlugFromPathname('/en/luster', ['en', 'fr'])).toBe('luster');
    expect(getSalonSlugFromPathname('/en/luster/book/service', ['en', 'fr'])).toBe('luster');
    expect(getSalonSlugFromPathname('/en/book/service', ['en', 'fr'])).toBeNull();
    expect(getSalonSlugFromPathname('/luster', ['en', 'fr'])).toBeNull();
  });
});
