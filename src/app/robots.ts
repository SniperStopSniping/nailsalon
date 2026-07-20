import type { MetadataRoute } from 'next';

import { getBaseUrl } from '@/utils/Helpers';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private customer capability links. They are unguessable, but they must
      // never end up in an index either.
      disallow: ['/manage/', '/*/manage/'],
    },
    sitemap: `${getBaseUrl()}/sitemap.xml`,
  };
}
