import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';

import { OwnerAdminClientBoundary } from './OwnerAdminClientBoundary';

export default async function OwnerAdminLayout(
  props: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
  },
) {
  return (
    <OwnerAdminClientBoundary
      locale={(await props.params).locale}
      onboardingV1IntegrationEnabled={isOnboardingV1IntegrationEnabled()}
    >
      {props.children}
    </OwnerAdminClientBoundary>
  );
}
