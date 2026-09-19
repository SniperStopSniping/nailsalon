import { describe, expect, it } from 'vitest';

import {
  isOwnerManagementApp,
  ownerManagementView,
  resolveOwnerNavigationAlias,
} from './ownerNavigation';

describe('owner navigation aliases', () => {
  it('opens Currency in Payments while preserving the current salon', () => {
    expect(resolveOwnerNavigationAlias(new URLSearchParams('salon=isla&app=settings&view=currency'))?.toString())
      .toBe('salon=isla&app=payments&view=currency');
  });

  it('moves legacy Settings links without losing salon, record, or return context', () => {
    const query = new URLSearchParams('salon=isla&appointment=apt_42&returnTo=calendar&app=settings&view=booking-policy');

    expect(resolveOwnerNavigationAlias(query)?.toString()).toBe(
      'salon=isla&appointment=apt_42&returnTo=calendar&app=booking-rules&view=policies',
    );
  });

  it('does not rewrite unknown settings views or unrelated destinations', () => {
    expect(resolveOwnerNavigationAlias(new URLSearchParams('app=settings&view=unknown'))).toBeNull();
    expect(resolveOwnerNavigationAlias(new URLSearchParams('app=marketing&view=reviews'))).toBeNull();
  });

  it('only accepts the views owned by each management destination', () => {
    expect(isOwnerManagementApp('hours')).toBe(true);
    expect(isOwnerManagementApp('marketing')).toBe(false);
    expect(ownerManagementView('booking-rules', 'policies')).toBe('policies');
    expect(ownerManagementView('booking-rules', 'usage')).toBe('home');
    expect(ownerManagementView('plan-usage', 'plans')).toBe('plans');
    expect(ownerManagementView('help', 'anything')).toBe('home');
  });
});
