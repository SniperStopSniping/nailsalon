import '@/styles/global.css';

import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, unstable_setRequestLocale } from 'next-intl/server';

import { getSalonBySlug } from '@/libs/queries';
import type { SalonStatus } from '@/models/Schema';
import { SalonProvider } from '@/providers/SalonProvider';
import { ThemeProvider } from '@/theme';
import { AllLocales } from '@/utils/AppConfig';

// DEV ONLY: Dynamic import for tree-shaking in production
const DevRoleSwitcher = dynamic(
  () => import('@/components/DevRoleSwitcher'),
  { ssr: false },
);

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

  // Read active salon from cookie, fallback to default
  const cookieStore = await cookies();
  const activeSalonSlug = cookieStore.get('__active_salon_slug')?.value?.trim().toLowerCase() || DEFAULT_SALON_SLUG;

  // Fetch salon data from database
  let salon = await getSalonBySlug(activeSalonSlug);

  // If cookie slug is invalid, fall back to default
  if (!salon) {
    salon = await getSalonBySlug(DEFAULT_SALON_SLUG);
    // Note: Can't delete cookie in layout, but dashboard sync will fix it
  }

  // If still no salon found, redirect to not-found
  if (!salon) {
    redirect('/not-found');
  }

  // Check salon status for context
  const salonStatus = (salon.status || 'active') as SalonStatus;

  // Note: We don't redirect at the root layout level because:
  // 1. Admin/owner routes need to access suspended salons (with banners)
  // 2. Super Admin routes must bypass status checks entirely
  // 3. Individual pages (booking, etc.) handle their own redirects for granular control

  // The `suppressHydrationWarning` in <html> is used to prevent hydration errors caused by `next-themes`.
  // Solution provided by the package itself: https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app

  // The `suppressHydrationWarning` attribute in <body> is used to prevent hydration errors caused by Sentry Overlay,
  // which dynamically adds a `style` attribute to the body tag.
  return (
    <html lang={props.params.locale} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        {/* DEV ONLY: Role switcher for testing */}
        {process.env.NEXT_PUBLIC_DEV_MODE === 'true' && <DevRoleSwitcher />}
        {/* ThemeProvider injects CSS variables based on themeKey */}
        <ThemeProvider themeKey={salon?.themeKey ?? undefined}>
          {/* SalonProvider provides tenant context to all child components */}
          <SalonProvider
            salonId={salon?.id}
            salonName={salon?.name}
            salonSlug={salon?.slug}
            themeKey={salon?.themeKey ?? undefined}
            status={salonStatus}
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
