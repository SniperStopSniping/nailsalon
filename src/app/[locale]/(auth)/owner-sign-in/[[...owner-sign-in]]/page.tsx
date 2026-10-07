import { Inter, Newsreader } from 'next/font/google';

import { OwnerSignInScreen } from '@/components/owner-entry/OwnerSignInScreen';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';

const entrySans = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-owner-sans' });
const entryDisplay = Newsreader({ subsets: ['latin'], display: 'swap', style: ['normal', 'italic'], variable: '--font-owner-display' });

export default async function OwnerSignInPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;

  return (
    <OwnerSignInScreen
      className={`${entrySans.variable} ${entryDisplay.variable}`}
      createSalonUrl={isOnboardingV1IntegrationEnabled() ? `/${locale}/onboarding-v1` : undefined}
      dashboardUrl={`/${locale}/admin`}
    />
  );
}
