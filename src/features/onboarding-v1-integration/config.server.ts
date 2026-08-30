import 'server-only';

import { Env } from '@/libs/Env';

import { resolveOnboardingV1IntegrationEnabled } from './feature-flag';

/**
 * Dark by default. This gates the integration route and every mutating API;
 * presentation hiding alone is not a security boundary.
 */
export function isOnboardingV1IntegrationEnabled(): boolean {
  return resolveOnboardingV1IntegrationEnabled(
    Env.LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED,
  );
}

export function requireOnboardingV1IntegrationEnabled(): void {
  if (!isOnboardingV1IntegrationEnabled()) {
    throw new OnboardingIntegrationDisabledError();
  }
}

export class OnboardingIntegrationDisabledError extends Error {
  readonly code = 'ONBOARDING_INTEGRATION_DISABLED';

  constructor() {
    super('The account-backed onboarding integration is not enabled.');
    this.name = 'OnboardingIntegrationDisabledError';
  }
}
