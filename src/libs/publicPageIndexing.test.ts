import { describe, expect, it } from 'vitest';

import { isUnlistedAccountPage } from './publicPageIndexing';

describe('account-page indexing boundaries', () => {
  it.each(['/owner-sign-in', '/en/owner-sign-in', '/fr/owner-sign-up', '/onboarding-v1', '/fr/onboarding-v1/step', '/en/onboarding/organization-selection'])(
    'excludes the account flow %s',
    (path) => {
      expect(isUnlistedAccountPage(path)).toBe(true);
    },
  );

  it.each(['/', '/fr', '/free-booking', '/fr/features/booking-website', '/terms', '/en/onboarding-v1-nails/book/service', '/en/my-salon/book/service'])(
    'preserves indexing eligibility for %s',
    (path) => {
      expect(isUnlistedAccountPage(path)).toBe(false);
    },
  );
});
