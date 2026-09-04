// @vitest-environment jsdom

import {
  getAccountGateUrl,
  getOnboardingIntegrationRoute,
  hasAccountGateQuery,
  ONBOARDING_ACCOUNT_HISTORY_STATE,
  pushAccountGateHistory,
} from './account-history';

describe('onboarding account-gate browser history', () => {
  it('pushes one same-origin account entry so Back can reveal Final Review', () => {
    const pushState = vi.fn();

    pushAccountGateHistory('en', { pushState });

    expect(pushState).toHaveBeenCalledWith(
      ONBOARDING_ACCOUNT_HISTORY_STATE,
      '',
      '/en/onboarding-v1?account=1',
    );
    expect(hasAccountGateQuery('?account=1')).toBe(true);
    expect(hasAccountGateQuery('')).toBe(false);
  });

  it('treats Clerk hash-route query states as part of the same account gate', () => {
    expect(hasAccountGateQuery('?auth=sign-in')).toBe(true);
    expect(hasAccountGateQuery('?claim=1')).toBe(true);
    expect(hasAccountGateQuery('?resume=review')).toBe(false);
    expect(getAccountGateUrl('fr')).toBe('/fr/onboarding-v1?account=1');
    expect(getOnboardingIntegrationRoute('unsupported')).toBe('/en/onboarding-v1');
  });
});
