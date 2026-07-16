import { notFound } from 'next/navigation';

import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import { getResolvedSalon } from '@/libs/tenant';
import type { SalonStatus } from '@/models/Schema';
import { SalonProvider } from '@/providers/SalonProvider';
import { ThemeProvider } from '@/theme';

export const dynamic = 'force-dynamic';

export default async function SlugTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string; slug: string };
}) {
  const salon = await getResolvedSalon(undefined, params);
  if (!salon || (salon.freeSoloEnabled && salon.publicationStatus !== 'published')) {
    notFound();
  }

  return (
    <ThemeProvider themeKey={salon?.themeKey ?? undefined}>
      <SalonProvider
        salonId={salon?.id}
        salonName={salon?.name}
        salonSlug={salon?.slug}
        themeKey={salon?.themeKey ?? undefined}
        status={(salon?.status ?? null) as SalonStatus | null}
      >
        {children}
        {salon.freeSoloEnabled && (
          <footer className="border-t border-stone-200 bg-white p-4 text-center text-xs text-stone-500">
            Free booking by
            {' '}
            <a href="https://luster.com" className="font-semibold text-stone-700 underline underline-offset-2">Luster</a>
            <span className="mx-2">·</span>
            <a href={`/${params.locale}/${params.slug}/find-booking`} className="font-semibold text-stone-700 underline underline-offset-2">Find my booking</a>
            <span className="mx-2">·</span>
            <a href={`${getCanonicalAppOrigin()}/owner`} className="font-semibold text-stone-700 underline underline-offset-2">Salon owner login</a>
          </footer>
        )}
      </SalonProvider>
    </ThemeProvider>
  );
}
