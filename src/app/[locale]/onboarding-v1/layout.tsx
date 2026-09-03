'use client';

import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/styles.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/ui/final-hybrid.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/onboarding.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/daniela-basics-booking.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/gallery-policy-polish.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/daniela-about-style.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/section-library.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/palette.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/style-colours-save.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/screen-seven-booking.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/screen-eight-about.css';
import '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/feedback/feedback.css';
import '@/features/onboarding-v1-integration/onboarding-integration.css';
import '@/features/onboarding-v1-integration/account-gate/account-gate.css';

import { enUS, frFR } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';

export default function OnboardingV1Layout(props: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const onboardingUrl = `/${props.params.locale}/onboarding-v1`;
  const homeUrl = props.params.locale === 'en' ? '/' : `/${props.params.locale}`;

  return (
    <ClerkProvider
      afterSignOutUrl={homeUrl}
      appearance={{
        variables: {
          borderRadius: '14px',
          colorBackground: '#fffdfb',
          colorPrimary: '#8f3155',
          colorText: '#30262a',
          colorTextSecondary: '#706267',
        },
      }}
      localization={props.params.locale === 'fr' ? frFR : enUS}
      signInFallbackRedirectUrl={`${onboardingUrl}?claim=1`}
      signInUrl={`${onboardingUrl}?auth=sign-in`}
      signUpFallbackRedirectUrl={`${onboardingUrl}?claim=1`}
      signUpUrl={`${onboardingUrl}?auth=sign-up`}
      // Session tasks (for example a forced organization choice) must never
      // strand the owner on a generic Clerk page — the account gate resolves
      // them in place.
      taskUrls={{ 'choose-organization': `${onboardingUrl}?account=1` }}
    >
      {props.children}
    </ClerkProvider>
  );
}
