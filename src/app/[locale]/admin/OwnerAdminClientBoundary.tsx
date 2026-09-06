'use client';

import { enUS, frFR } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';
import { useMemo } from 'react';

import { lusterClerkVariables } from '@/components/auth/clerkAppearance';
import { AppConfig } from '@/utils/AppConfig';

import { OwnerAdminFeatureFlagsContext } from './OwnerAdminFeatureFlags';

export function OwnerAdminClientBoundary(props: {
  children: React.ReactNode;
  locale: string;
  onboardingV1IntegrationEnabled: boolean;
  sectionLibraryV1Enabled: boolean;
}) {
  const localePrefix = props.locale === AppConfig.defaultLocale
    ? ''
    : `/${props.locale}`;
  const featureFlags = useMemo(() => ({
    onboardingV1IntegrationEnabled: props.onboardingV1IntegrationEnabled,
    sectionLibraryV1Enabled: props.sectionLibraryV1Enabled,
  }), [props.onboardingV1IntegrationEnabled, props.sectionLibraryV1Enabled]);

  return (
    <ClerkProvider
      appearance={{ variables: lusterClerkVariables }}
      localization={props.locale === 'fr' ? frFR : enUS}
      // A session task raised inside the workspace is resolved by the owner
      // sign-in page (it creates/activates the Clerk organization server-side)
      // instead of Clerk's generic "Setup your organization" form.
      taskUrls={{ 'choose-organization': `${localePrefix}/owner-sign-in` }}
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
