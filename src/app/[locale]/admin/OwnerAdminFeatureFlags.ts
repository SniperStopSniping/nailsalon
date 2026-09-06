'use client';

import { createContext, useContext } from 'react';

export type OwnerAdminFeatureFlags = {
  onboardingV1IntegrationEnabled: boolean;
  /**
   * The dark-launched Section Gallery. Owner surfaces only offer a link to
   * `/admin/site-builder/section-gallery` when this is on; the route itself
   * still 404s on its own server-side check, so the flag governs the entry
   * point, never the access decision.
   */
  sectionLibraryV1Enabled: boolean;
};

export const OwnerAdminFeatureFlagsContext = createContext<OwnerAdminFeatureFlags>({
  onboardingV1IntegrationEnabled: false,
  sectionLibraryV1Enabled: false,
});

export function useOwnerAdminFeatureFlags(): OwnerAdminFeatureFlags {
  return useContext(OwnerAdminFeatureFlagsContext);
}
