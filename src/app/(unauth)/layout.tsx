import type { SalonStatus } from '@/models/Schema';
import { getResolvedSalon } from '@/libs/tenant';
import { SalonProvider } from '@/providers/SalonProvider';

export const dynamic = 'force-dynamic';

export default async function UnauthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const salon = await getResolvedSalon();

  return (
    <SalonProvider
      salonId={salon?.id}
      salonName={salon?.name}
      salonSlug={salon?.slug}
      themeKey={salon?.themeKey ?? undefined}
      status={(salon?.status ?? null) as SalonStatus | null}
    >
      {children}
    </SalonProvider>
  );
}
