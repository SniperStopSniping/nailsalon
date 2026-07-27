import type { CSSProperties } from 'react';

import {
  getBookingExperienceCssVariables,
  resolveBookingExperience,
} from '@/libs/bookingExperience';
import type { PageAppearanceResult } from '@/libs/pageAppearance';
import type { Salon, SalonStatus } from '@/models/Schema';
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
  const bookingExperience = resolveBookingExperience(salon.settings);
  const bookingExperienceStyles = pageName.startsWith('book-')
    ? getBookingExperienceCssVariables(bookingExperience.primaryColor)
    : {};
  const hasBookingColorOverride = Object.keys(bookingExperienceStyles).length > 0;

  return (
    <SalonProvider
      salonId={salon.id}
      salonName={salon.name}
      salonSlug={salon.slug}
      themeKey={salon.themeKey ?? undefined}
      status={(salon.status ?? 'active') as SalonStatus}
      bookingExperience={bookingExperience}
    >
      <PageThemeWrapper
        mode={appearance.mode}
        themeKey={appearance.themeKey}
        pageName={pageName}
      >
        {hasBookingColorOverride
          ? (
              <div
                data-booking-experience-theme={pageName}
                style={bookingExperienceStyles as CSSProperties}
              >
                {children}
              </div>
            )
          : children}
      </PageThemeWrapper>
    </SalonProvider>
  );
}
