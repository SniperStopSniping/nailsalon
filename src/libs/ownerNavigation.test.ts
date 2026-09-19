import { describe, expect, it } from 'vitest';

import {
  isOwnerManagementApp,
  ownerManagementView,
  resolveOwnerNavigationAlias,
  resolveOwnerNavigationPathAlias,
} from './ownerNavigation';

describe('owner navigation aliases', () => {
  it('opens Currency in Payments while preserving the current salon', () => {
    expect(resolveOwnerNavigationAlias(new URLSearchParams('salon=isla&app=settings&view=currency'))?.toString())
      .toBe('salon=isla&app=payments&view=currency');
  });

  it.each([['communications', 'messages'], ['smart-fit', 'smart-fit']])('opens the canonical Marketing editor for %s', (legacy, view) => {
    const original = new URLSearchParams(`salon=isla&app=settings&view=${legacy}&returnTo=calendar`);
    const resolved = resolveOwnerNavigationAlias(original);

    expect(resolved?.get('app')).toBe('marketing');
    expect(resolved?.get('view')).toBe(view);
    expect(resolved?.get('salon')).toBe('isla');
    expect(resolved?.get('returnTo')).toBe('calendar');
    expect(original.get('app')).toBe('settings');
  });

  it('moves legacy Settings plan billing to Plan & Usage while retaining context', () => {
    const resolved = resolveOwnerNavigationAlias(new URLSearchParams('salon=isla&app=settings&view=plan-billing&returnTo=calendar'));

    expect(resolved?.toString()).toBe('salon=isla&app=plan-usage&returnTo=calendar&view=billing');
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
    expect(ownerManagementView('plan-usage', 'billing')).toBe('billing');
    expect(ownerManagementView('help', 'anything')).toBe('home');
  });
});

describe('owner navigation path aliases', () => {
  it.each(['business-profile', 'location'])('moves legacy Settings %s to Business Information without losing context', (view) => {
    const alias = resolveOwnerNavigationPathAlias(
      '/en/admin',
      new URLSearchParams(`salon=isla&returnTo=calendar&technician=tech_1&app=settings&view=${view}`),
    );

    expect(alias?.pathname).toBe('/en/admin/booking-page');
    expect(alias?.query.toString()).toBe('salon=isla&returnTo=calendar&technician=tech_1&panel=business');
  });

  it.each([
    ['branding', 'experience'],
    ['booking-experience', 'experience'],
    ['booking-flow', 'flow'],
  ])('moves legacy Settings %s to Booking Page %s without losing context', (view, panel) => {
    const alias = resolveOwnerNavigationPathAlias(
      '/en/admin',
      new URLSearchParams(`salon=isla&returnTo=calendar&technician=tech_1&app=settings&view=${view}`),
    );

    expect(alias?.pathname).toBe('/en/admin/booking-page');
    expect(alias?.query.toString()).toBe(`salon=isla&returnTo=calendar&technician=tech_1&panel=${panel}`);
  });

  it('leaves query-only aliases and unrelated paths alone', () => {
    expect(resolveOwnerNavigationPathAlias('/en/admin', new URLSearchParams('app=settings&view=booking-policy'))).toBeNull();
    expect(resolveOwnerNavigationPathAlias('/en/admin/booking-page', new URLSearchParams('app=settings&view=location'))).toBeNull();
  });
});
