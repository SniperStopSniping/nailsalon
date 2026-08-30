import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';

import { OwnerAdminClientBoundary } from './OwnerAdminClientBoundary';

export default function OwnerAdminLayout(props: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  return (
    <OwnerAdminClientBoundary
      locale={props.params.locale}
      onboardingV1IntegrationEnabled={isOnboardingV1IntegrationEnabled()}
    >
      {props.children}
    </OwnerAdminClientBoundary>
  );
}
