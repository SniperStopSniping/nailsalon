import '@/styles/global.css';

import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, unstable_setRequestLocale } from 'next-intl/server';

import { getSalonBySlug } from '@/libs/queries';
import { SalonProvider } from '@/providers/SalonProvider';
import { ThemeProvider } from '@/theme';
import { AllLocales } from '@/utils/AppConfig';

export const metadata: Metadata = {
  icons: [
    {
      rel: 'apple-touch-icon',
      url: '/apple-touch-icon.png',
    },
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '32x32',
      url: '/favicon-32x32.png',
    },
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '16x16',
      url: '/favicon-16x16.png',
    },
    {
      rel: 'icon',
      url: '/favicon.ico',
    },
  ],
};

export function generateStaticParams() {
  return AllLocales.map(locale => ({ locale }));
}

// Default salon slug - in the future this would come from subdomain/URL
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

export default async function RootLayout(props: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  unstable_setRequestLocale(props.params.locale);

  // Fetch messages for internationalization
  const messages = await getMessages();

  // Fetch salon data from database
  // In production, this would come from subdomain parsing
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  // The `suppressHydrationWarning` in <html> is used to prevent hydration errors caused by `next-themes`.
  // Solution provided by the package itself: https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app

  // The `suppressHydrationWarning` attribute in <body> is used to prevent hydration errors caused by Sentry Overlay,
  // which dynamically adds a `style` attribute to the body tag.
  return (
    <html lang={props.params.locale} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        {/* ThemeProvider injects CSS variables based on themeKey */}
        <ThemeProvider themeKey={salon?.themeKey ?? undefined}>
          {/* SalonProvider provides tenant context to all child components */}
          <SalonProvider
            salonId={salon?.id}
            salonName={salon?.name}
            salonSlug={salon?.slug}
            themeKey={salon?.themeKey ?? undefined}
          >
            <NextIntlClientProvider
              locale={props.params.locale}
              messages={messages}
            >
              {props.children}
            </NextIntlClientProvider>
          </SalonProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
