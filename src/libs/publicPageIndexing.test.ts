import { describe, expect, it } from 'vitest';

import { isUnlistedAccountPage, isUnlistedSalonCapabilityPage } from './publicPageIndexing';

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

describe('public salon search indexing policy', () => {
  it.each([
    '/isla-nail-studio/find-booking',
    '/en/isla-nail-studio/find-booking',
    '/fr/appointments/history',
    '/fr/isla-nail-studio/profile',
    '/en/isla-nail-studio/appointments/history',
    '/en/isla-nail-studio/manage/token',
    '/en/isla-nail-studio/deposit/return',
  ])('marks %s as a customer capability page', (pathname) => {
    expect(isUnlistedSalonCapabilityPage(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/en',
    '/en/isla-nail-studio',
    '/en/isla-nail-studio/book',
    '/en/isla-nail-studio/book/service',
    '/en/features/booking-website',
  ])('keeps %s eligible for indexing', (pathname) => {
    expect(isUnlistedSalonCapabilityPage(pathname)).toBe(false);
  });

  it('recognizes bare custom-domain paths after tenant resolution', () => {
    expect(isUnlistedSalonCapabilityPage('/find-booking', 'isla-nail-studio')).toBe(true);
    expect(isUnlistedSalonCapabilityPage('/fr/profile', 'isla-nail-studio')).toBe(true);
    expect(isUnlistedSalonCapabilityPage('/book/service', 'isla-nail-studio')).toBe(false);
    expect(isUnlistedSalonCapabilityPage('/find-booking')).toBe(false);
    expect(isUnlistedSalonCapabilityPage('/en/find-booking')).toBe(false);
    expect(isUnlistedSalonCapabilityPage('/en/find-booking/profile')).toBe(true);
    expect(isUnlistedSalonCapabilityPage('/profile')).toBe(true);
    expect(isUnlistedSalonCapabilityPage('/api/profile')).toBe(false);
  });
});
