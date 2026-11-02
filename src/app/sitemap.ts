import type { MetadataRoute } from 'next';

import { MARKETING_ORIGIN, MARKETING_PATHS, marketingAlternates, marketingPath } from '@/libs/marketingSeo';

export default function sitemap(): MetadataRoute.Sitemap {
  // Omit lastModified until editorial dates are tracked; a build is not a content update.
  return MARKETING_PATHS.flatMap(path => ['en', 'fr'].map(locale => ({
    url: `${MARKETING_ORIGIN}${marketingPath(path, locale)}`,
    alternates: { languages: marketingAlternates(path) },
  })));
}
