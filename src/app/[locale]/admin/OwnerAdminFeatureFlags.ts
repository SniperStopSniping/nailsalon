'use client';

import { createContext, useContext } from 'react';

export type OwnerAdminFeatureFlags = {
  onboardingV1IntegrationEnabled: boolean;
};

export const OwnerAdminFeatureFlagsContext = createContext<OwnerAdminFeatureFlags>({
  onboardingV1IntegrationEnabled: false,
});

export function useOwnerAdminFeatureFlags(): OwnerAdminFeatureFlags {
  return useContext(OwnerAdminFeatureFlagsContext);
}
