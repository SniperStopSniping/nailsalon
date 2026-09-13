import '@/styles/global.css';

import type { Metadata, Viewport } from 'next';

import { SITE_FONT_VARIABLES_CSS } from '@/libs/siteFonts';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://www.lustergel.app'),
  openGraph: {
    type: 'website',
    title: 'Luster',
    description: 'Free booking, CRM, Calendar sync, and growth tools built for nail techs.',
    siteName: 'Luster',
    url: '/',
    images: [{
      url: '/luster-social-preview.jpg',
      width: 1254,
      height: 1254,
      alt: 'Luster Gel Booking App',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Luster',
    description: 'Free booking, CRM, Calendar sync, and growth tools built for nail techs.',
    images: ['/luster-social-preview.jpg'],
  },
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
