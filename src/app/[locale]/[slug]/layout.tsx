import type { SalonStatus } from '@/models/Schema';
import { getResolvedSalon } from '@/libs/tenant';
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
      </SalonProvider>
    </ThemeProvider>
  );
}
