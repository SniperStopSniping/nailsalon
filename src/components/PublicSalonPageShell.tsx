import type { Salon, SalonStatus } from '@/models/Schema';
import type { PageAppearanceResult } from '@/libs/pageAppearance';
import { SalonProvider } from '@/providers/SalonProvider';

import { PageThemeWrapper } from './PageThemeWrapper';

type PublicSalonPageShellProps = {
  appearance: PageAppearanceResult;
  children: React.ReactNode;
  pageName: string;
  salon: Salon;
};

export function PublicSalonPageShell({
  appearance,
  children,
  pageName,
  salon,
}: PublicSalonPageShellProps) {
  return (
    <SalonProvider
      salonId={salon.id}
      salonName={salon.name}
      salonSlug={salon.slug}
      themeKey={salon.themeKey ?? undefined}
      status={(salon.status ?? 'active') as SalonStatus}
    >
      <PageThemeWrapper
        mode={appearance.mode}
        themeKey={appearance.themeKey}
        pageName={pageName}
      >
        {children}
      </PageThemeWrapper>
    </SalonProvider>
  );
}
