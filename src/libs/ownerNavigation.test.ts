import { describe, expect, it } from 'vitest';

import {
  isOwnerManagementApp,
  ownerManagementView,
  resolveOwnerNavigationAlias,
} from './ownerNavigation';

describe('owner navigation aliases', () => {
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

  it.each([
    ['team', 'schedules', 'working-hours'],
    ['team', 'blocked-time', 'time-off'],
    ['team', 'time-off', 'time-off'],
    ['team', 'requests', 'requests'],
    ['staff-ops', '', 'requests'],
  ])('preserves record context when moving legacy %s/%s to Hours', (app, view, target) => {
    const next = resolveOwnerNavigationAlias(new URLSearchParams({ app, view, salon: 'salon-a', technician: 'tech_1', returnTo: 'calendar' }));

    expect(next?.get('app')).toBe('hours');
    expect(next?.get('view')).toBe(target);
    expect(next?.get('salon')).toBe('salon-a');
    expect(next?.get('technician')).toBe('tech_1');
    expect(next?.get('returnTo')).toBe('calendar');
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
