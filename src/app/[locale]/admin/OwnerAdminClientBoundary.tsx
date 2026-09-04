'use client';

import { enUS, frFR } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';
import { useMemo } from 'react';

import { AppConfig } from '@/utils/AppConfig';

import { OwnerAdminFeatureFlagsContext } from './OwnerAdminFeatureFlags';

export function OwnerAdminClientBoundary(props: {
  children: React.ReactNode;
  locale: string;
  onboardingV1IntegrationEnabled: boolean;
}) {
  const localePrefix = props.locale === AppConfig.defaultLocale
    ? ''
    : `/${props.locale}`;
  const featureFlags = useMemo(() => ({
    onboardingV1IntegrationEnabled: props.onboardingV1IntegrationEnabled,
  }), [props.onboardingV1IntegrationEnabled]);

  return (
    <ClerkProvider
      localization={props.locale === 'fr' ? frFR : enUS}
      signInUrl={`${localePrefix}/owner-sign-in`}
      signUpUrl={`${localePrefix}/owner-sign-up`}
      signInFallbackRedirectUrl={`${localePrefix}/admin`}
      signUpFallbackRedirectUrl={`${localePrefix}/admin`}
      afterSignOutUrl={`${localePrefix}/owner-sign-in`}
    >
      <OwnerAdminFeatureFlagsContext.Provider value={featureFlags}>
        {props.children}
      </OwnerAdminFeatureFlagsContext.Provider>
    </ClerkProvider>
  );
}
