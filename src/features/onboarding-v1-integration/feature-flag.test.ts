import { describe, expect, it } from 'vitest';

import { resolveOnboardingV1IntegrationEnabled } from './feature-flag';

describe('resolveOnboardingV1IntegrationEnabled', () => {
  it('is dark by default and only accepts the explicit true value', () => {
    expect(resolveOnboardingV1IntegrationEnabled(undefined)).toBe(false);
    expect(resolveOnboardingV1IntegrationEnabled('false')).toBe(false);
    expect(resolveOnboardingV1IntegrationEnabled('TRUE')).toBe(false);
    expect(resolveOnboardingV1IntegrationEnabled('true')).toBe(true);
  });
});
