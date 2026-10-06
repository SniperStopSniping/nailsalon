import { describe, expect, it, vi } from 'vitest';

import { COMMERCIAL_POLICY, textBalanceState, textBalanceSubtitle } from './commercialPolicy';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
const { shouldEnforceBillingLock } = await import('./featureGating');
const { getPlanLimits } = await import('./planLimits');

describe('current free access policy', () => {
  it('includes all features, grants 50 once, and disables new subscriptions centrally', () => {
    expect(COMMERCIAL_POLICY).toMatchObject({ allFeaturesIncluded: true, subscriptionsForSale: false, starterCredits: 50 });
  });

  it.each(['active', 'past_due', 'unpaid', 'canceled', 'incomplete_expired', null])('keeps normal app access for %s subscriptions', (status) => {
    expect(shouldEnforceBillingLock({ billingMode: 'STRIPE', stripeSubscriptionStatus: status, stripeCurrentPeriodEnd: 1 })).toBe(false);
  });

  it.each(['free', 'single_salon', 'multi_salon', 'enterprise'])('keeps tier %s limits unrestricted', (plan) => {
    const limits = getPlanLimits(plan as 'free' | 'single_salon' | 'multi_salon' | 'enterprise');

    expect(limits).toMatchObject({ maxTechs: -1, maxLocations: -1, features: ['all'] });
  });

  it.each([[0, 'empty'], [1, 'low'], [20, 'low'], [21, 'healthy']])('classifies %i credits as %s', (balance, state) => {
    expect(textBalanceState(balance as number)).toBe(state);
  });

  it('uses simple text labels and a sensible low balance action', () => {
    expect(textBalanceSubtitle(42)).toBe('42 texts remaining · Buy more');
    expect(textBalanceSubtitle(1)).toBe('1 text remaining · Top up now');
  });
});
