import '@/styles/global.css';

import type { Viewport } from 'next';

import { SITE_FONT_VARIABLES_CSS } from '@/libs/siteFonts';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
