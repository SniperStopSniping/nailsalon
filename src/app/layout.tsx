import '@/styles/global.css';

import type { Metadata, Viewport } from 'next';
import { getLocale } from 'next-intl/server';

import { marketingCopy } from '@/libs/marketingContent';
import { MARKETING_ORIGIN } from '@/libs/marketingSeo';
import { SITE_FONT_VARIABLES_CSS } from '@/libs/siteFonts';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  metadataBase: new URL(MARKETING_ORIGIN),
  openGraph: {
    type: 'website',
    title: 'Luster',
    description: marketingCopy.en.description,
    siteName: 'Luster',
    url: '/',
    images: [{
      url: '/luster-social-preview.jpg',
      width: 1254,
      height: 1254,
      alt: 'Luster booking app',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Luster',
    description: marketingCopy.en.description,
    images: ['/luster-social-preview.jpg'],
  },
};

export default async function RootLayout(props: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          The customer site's style presets resolve to these faces. Declaring
          the variables here is what finally makes the public booking route
          self-host the families its presets have always named; only the body
          face is preloaded, so a page still fetches the one display face it
          actually uses.
        */}
        <style dangerouslySetInnerHTML={{ __html: SITE_FONT_VARIABLES_CSS }} />
      </head>
      <body
        className="bg-background text-foreground antialiased"
        suppressHydrationWarning
      >
        {props.children}
      </body>
    </html>
  );
}
