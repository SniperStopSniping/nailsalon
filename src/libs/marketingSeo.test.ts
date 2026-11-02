import { describe, expect, it, vi } from 'vitest';

import sitemap from '@/app/sitemap';

import { marketingPages } from './marketingContent';
import { buildMarketingMetadata, MARKETING_ORIGIN, MARKETING_PATHS } from './marketingSeo';
import { getSalonSlugFromPathname, isReservedSalonSlug } from './tenantSlug';

describe('public marketing URL contract', () => {
  it('keeps preview environment URLs out of canonicals and sitemap entries', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://preview.example.invalid');
    try {
      const metadata = buildMarketingMetadata('/features/booking-website', 'fr', marketingPages.fr.website);

      expect(metadata.alternates).toEqual({
        canonical: 'https://www.lustergel.app/fr/features/booking-website',
        languages: {
          'en': 'https://www.lustergel.app/features/booking-website',
          'fr': 'https://www.lustergel.app/fr/features/booking-website',
          'x-default': 'https://www.lustergel.app/features/booking-website',
        },
      });
      expect(sitemap().every(entry => entry.url.startsWith(MARKETING_ORIGIN))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('publishes only canonical marketing and legal URLs in both supported languages', () => {
    const entries = sitemap();
    const urls = entries.map(entry => new URL(entry.url));

    expect(new Set(entries.map(entry => entry.url)).size).toBe(MARKETING_PATHS.length * 2);
    expect(urls.every(url => !url.search && !url.pathname.startsWith('/en'))).toBe(true);
    expect(urls.some(url => /owner|onboarding|admin|\/book\//u.test(url.pathname))).toBe(false);
    expect(entries.every(entry => entry.alternates?.languages?.en && entry.alternates.languages.fr)).toBe(true);
  });

  it.each(Object.values(marketingPages.en))('keeps the public product route $path out of tenant resolution', ({ path }) => {
    const segment = path.split('/')[1]!;

    expect(isReservedSalonSlug(segment)).toBe(true);
    expect(getSalonSlugFromPathname(`/en${path}`, ['en', 'fr'])).toBeNull();
    expect(getSalonSlugFromPathname(`/fr${path}`, ['en', 'fr'])).toBeNull();
    expect(getSalonSlugFromPathname('/en/isla-nail-studio/book/service', ['en', 'fr'])).toBe('isla-nail-studio');
  });
});
