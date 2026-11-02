import type { Metadata } from 'next';

import { getMarketingLocale, marketingCopy, marketingPages } from './marketingContent';

export const MARKETING_ORIGIN = 'https://www.lustergel.app';

export const MARKETING_PATHS = [
  '/',
  ...Object.values(marketingPages.en).map(page => page.path),
  '/privacy',
  '/terms',
];

export function marketingPath(path: string, locale: string): string {
  return getMarketingLocale(locale) === 'fr' ? `/fr${path === '/' ? '' : path}` : path;
}

export function marketingAlternates(path: string) {
  return {
    'en': `${MARKETING_ORIGIN}${marketingPath(path, 'en')}`,
    'fr': `${MARKETING_ORIGIN}${marketingPath(path, 'fr')}`,
    'x-default': `${MARKETING_ORIGIN}${marketingPath(path, 'en')}`,
  };
}

export function buildMarketingMetadata(
  path: string,
  locale: string,
  overrides?: { title: string; description: string },
): Metadata {
  const language = getMarketingLocale(locale);
  const copy = overrides ?? marketingCopy[language];
  const canonical = `${MARKETING_ORIGIN}${marketingPath(path, language)}`;
  const images = [{ url: `${MARKETING_ORIGIN}/luster-social-preview.jpg`, width: 1254, height: 1254, alt: 'Luster' }];

  return {
    title: { absolute: copy.title },
    description: copy.description,
    alternates: { canonical, languages: marketingAlternates(path) },
    openGraph: {
      type: 'website',
      title: copy.title,
      description: copy.description,
      siteName: 'Luster',
      url: canonical,
      locale: language === 'fr' ? 'fr_CA' : 'en_CA',
      alternateLocale: language === 'fr' ? ['en_CA'] : ['fr_CA'],
      images,
    },
    twitter: { card: 'summary_large_image', title: copy.title, description: copy.description, images },
  };
}

export function buildMarketingJsonLd(locale: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${MARKETING_ORIGIN}/#organization`,
        'name': 'Luster',
        'url': `${MARKETING_ORIGIN}/`,
        'email': 'support@lustergel.app',
      },
      {
        '@type': 'WebSite',
        '@id': `${MARKETING_ORIGIN}/#website`,
        'name': 'Luster',
        'url': `${MARKETING_ORIGIN}/`,
        'description': marketingCopy[getMarketingLocale(locale)].description,
        'inLanguage': ['en', 'fr'],
        'publisher': { '@id': `${MARKETING_ORIGIN}/#organization` },
      },
    ],
  };
}

export function buildAccountPageMetadata(locale: string, page: 'sign-in' | 'sign-up' | 'setup'): Metadata {
  const french = getMarketingLocale(locale) === 'fr';
  const titles = french
    ? { 'sign-in': 'Connexion propriétaire', 'sign-up': 'Accès propriétaire', 'setup': 'Configurer vos réservations' }
    : { 'sign-in': 'Owner sign in', 'sign-up': 'Owner access', 'setup': 'Set up your booking website' };
  return {
    title: { absolute: `${titles[page]} | Luster` },
    description: french ? 'Accédez à votre espace propriétaire Luster et configurez vos réservations.' : 'Access your Luster owner workspace and set up your booking website.',
    robots: { index: false, follow: true },
  };
}
