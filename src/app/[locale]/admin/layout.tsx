'use client';

import { enUS, frFR } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';

import { AppConfig } from '@/utils/AppConfig';

export default function OwnerAdminLayout(props: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const localePrefix = props.params.locale === AppConfig.defaultLocale
    ? ''
    : `/${props.params.locale}`;

  return (
    <ClerkProvider
      localization={props.params.locale === 'fr' ? frFR : enUS}
      signInUrl={`${localePrefix}/owner-sign-in`}
      signUpUrl={`${localePrefix}/owner-sign-up`}
      signInFallbackRedirectUrl={`${localePrefix}/admin`}
      signUpFallbackRedirectUrl={`${localePrefix}/admin`}
      afterSignOutUrl={`${localePrefix}/owner-sign-in`}
    >
      {props.children}
    </ClerkProvider>
  );
}
